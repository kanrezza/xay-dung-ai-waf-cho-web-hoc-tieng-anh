"""
Đo độ trễ mà WAF thêm vào mỗi request – trả lời câu "WAF có làm web chậm không?".

Cách đo (để số liệu công bằng):
  - Script tự bật MỘT WAF RIÊNG ở cổng 8099, log ghi ra file tạm. Không dùng WAF
    đang chạy ở 8000 vì lớp hành vi giới hạn 80 request/10 giây: đo vài trăm lần
    sẽ bị chính WAF chặn và làm hỏng số liệu, lại làm bẩn dashboard.
  - Gửi XEN KẼ: một request thẳng EngPro, một request qua WAF, lặp lại. Máy lúc
    nhanh lúc chậm thì cả hai cùng chịu, không lệch về một phía.
  - Bỏ qua các lần khởi động (warm-up), giữ kết nối (keep-alive) như trình duyệt.
  - Báo trung vị (p50) và p95/p99 thay vì chỉ trung bình, vì trung bình bị vài
    lần chậm bất thường kéo lệch.
  - Phần cuối tách thời gian từng thành phần bên trong WAF để biết chậm ở đâu.

Cần EngPro đang chạy ở 127.0.0.1:8080.

    python -m tests.bench_latency            # mặc định 300 lần mỗi kịch bản
    python -m tests.bench_latency -n 1000    # đo kỹ hơn
"""
import argparse
import asyncio
import os
import platform
import statistics
import subprocess
import sys
import tempfile
import time

import httpx

DIRECT = "http://127.0.0.1:8080"
BENCH_PORT = 8099
VIA_WAF = f"http://127.0.0.1:{BENCH_PORT}"
AI_WAF_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ESSAY = ("Many people believe that students should select their courses based on "
         "future career goals, while others argue that they should order their "
         "priorities around personal interests. In my opinion, both views have merit. ") * 6

# (tên, method, đường dẫn, body JSON)
SCENARIOS = [
    ("GET API nhỏ (105 B)",          "GET",  "/api/public/home", None),
    ("GET danh sách khóa học (3 KB)", "GET",  "/api/courses", None),
    ("GET file tĩnh JS (96 KB)",     "GET",  "/js/i18n-en.js", None),
    ("POST bài Writing (~1.5 KB)",   "POST", "/api/writing/prompts/1/submit",
     '{"content":"%s"}' % ESSAY),
]


# ─────────────────────────────────────────────────────────────
#  Bật / tắt WAF riêng cho phép đo
# ─────────────────────────────────────────────────────────────
def start_bench_waf():
    env = {
        **os.environ,
        "WAF_HOST": "127.0.0.1",
        "WAF_PORT": str(BENCH_PORT),
        "BACKEND_URL": DIRECT,
        "WAF_TARGET_NAME": "Benchmark",
        "WAF_DB_PATH": os.path.join(tempfile.mkdtemp(), "bench.db"),
        "WAF_RATE_MAX_REQ": "1000000",   # tắt giới hạn tần suất khi đo
    }
    proc = subprocess.Popen([sys.executable, "-m", "app"], cwd=AI_WAF_DIR, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    deadline = time.time() + 30
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SystemExit("WAF đo không khởi động được:\n" + proc.stderr.read().decode())
        try:
            httpx.get(VIA_WAF + "/api/public/home", timeout=1)
            return proc
        except httpx.HTTPError:
            time.sleep(0.3)
    proc.kill()
    raise SystemExit("WAF đo không phản hồi sau 30 giây")


# ─────────────────────────────────────────────────────────────
#  Phần 1: độ trễ từng request (tuần tự)
# ─────────────────────────────────────────────────────────────
def pct(values, p):
    values = sorted(values)
    k = (len(values) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def one(client, base, method, path, body):
    t = time.perf_counter()
    r = client.request(method, base + path, content=body,
                       headers={"Content-Type": "application/json"} if body else None)
    _ = r.content
    return (time.perf_counter() - t) * 1000, r.status_code


def bench_sequential(n, warmup=30):
    rows = []
    with httpx.Client(timeout=10) as client:
        for name, method, path, body in SCENARIOS:
            for _ in range(warmup):
                one(client, DIRECT, method, path, body)
                one(client, VIA_WAF, method, path, body)
            d, w, codes = [], [], set()
            for _ in range(n):
                ms, c1 = one(client, DIRECT, method, path, body)
                d.append(ms)
                ms, c2 = one(client, VIA_WAF, method, path, body)
                w.append(ms)
                codes.add((c1, c2))
            rows.append((name, d, w, codes))
    return rows


def print_sequential(rows):
    print("\n── 1) Độ trễ mỗi request (mili-giây, tuần tự, giữ kết nối) ──\n")
    print(f"   {'Kịch bản':30s} {'Thẳng p50':>9s} {'Qua WAF p50':>11s} "
          f"{'Thêm p50':>9s} {'Thêm p95':>9s} {'Thêm p99':>9s}")
    print("   " + "─" * 82)
    for name, d, w, codes in rows:
        add50 = statistics.median(w) - statistics.median(d)
        add95 = pct(w, 95) - pct(d, 95)
        add99 = pct(w, 99) - pct(d, 99)
        print(f"   {name:30s} {statistics.median(d):9.2f} {statistics.median(w):11.2f} "
              f"{add50:+9.2f} {add95:+9.2f} {add99:+9.2f}")
        bad = [c for c in codes if c[0] != c[1]]
        if bad:
            print(f"      ! mã trả về khác nhau giữa thẳng và qua WAF: {bad}")


# ─────────────────────────────────────────────────────────────
#  Phần 2: thông lượng khi nhiều người truy cập cùng lúc
# ─────────────────────────────────────────────────────────────
async def throughput(base, path, concurrency, seconds):
    stop = time.perf_counter() + seconds
    count = 0
    lat = []

    async def worker(client):
        nonlocal count
        while time.perf_counter() < stop:
            t = time.perf_counter()
            r = await client.get(base + path)
            await r.aread()
            lat.append((time.perf_counter() - t) * 1000)
            count += 1

    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(timeout=10, limits=limits) as client:
        await asyncio.gather(*(worker(client) for _ in range(concurrency)))
    return count / seconds, statistics.median(lat), pct(lat, 95)


def print_throughput(concurrency, seconds):
    print(f"\n── 2) Thông lượng: {concurrency} người truy cập cùng lúc, mỗi bên {seconds} giây ──\n")
    print(f"   {'':12s} {'request/giây':>13s} {'p50 (ms)':>10s} {'p95 (ms)':>10s}")
    print("   " + "─" * 48)
    res = {}
    for label, base in (("Thẳng EngPro", DIRECT), ("Qua WAF", VIA_WAF)):
        rps, p50, p95 = asyncio.run(throughput(base, "/api/courses", concurrency, seconds))
        res[label] = rps
        print(f"   {label:12s} {rps:13.0f} {p50:10.2f} {p95:10.2f}")
    ratio = res["Qua WAF"] / res["Thẳng EngPro"] * 100
    print(f"\n   → Qua WAF đạt {ratio:.0f}% thông lượng so với gửi thẳng")


# ─────────────────────────────────────────────────────────────
#  Phần 3: thời gian từng thành phần bên trong WAF (đo trực tiếp, không qua mạng)
# ─────────────────────────────────────────────────────────────
def bench_components(n=2000):
    os.environ["WAF_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "comp.db")
    sys.path.insert(0, AI_WAF_DIR)
    from app import config, features, logstore, model, rules  # noqa: E402

    model.load(config.MODEL_PATH)
    logstore.init()
    ua = {"user-agent": "Mozilla/5.0 (Macintosh) Chrome/131.0 Safari/537.36"}
    cases = [
        ("request GET ngắn", ("GET", "/api/courses", "search=ielts", ua, "")),
        ("bài Writing ~1.5 KB", ("POST", "/api/writing/prompts/1/submit", "", ua,
                                 '{"content":"%s"}' % ESSAY)),
    ]

    def timeit(fn):
        for _ in range(100):
            fn()
        t = time.perf_counter()
        for _ in range(n):
            fn()
        return (time.perf_counter() - t) / n * 1000

    print(f"\n── 3) Thời gian từng thành phần bên trong WAF (trung bình {n} lần, mili-giây) ──\n")
    print(f"   {'Thành phần':34s} {'GET ngắn':>10s} {'Writing 1.5KB':>14s}")
    print("   " + "─" * 60)
    res = {}
    for label, (m, p, q, h, b) in cases:
        text = features.build_inspection_text(m, p, q, h, b)
        ml_text = features.build_ml_text(m, p, q, b)
        res[label] = {
            "Trích & giải mã đặc trưng": timeit(lambda: (features.build_inspection_text(m, p, q, h, b),
                                                         features.build_ml_text(m, p, q, b))),
            "Lớp 1 – luật regex (28 luật)": timeit(lambda: rules.match(text)),
            "Lớp 2 – mô hình ML": timeit(lambda: model.score(ml_text)),
            "Ghi log SQLite": timeit(lambda: logstore.record("127.0.0.1", m, p, "allow", "-",
                                                             None, None, 0.0, 0, text)),
        }
    for comp in res[cases[0][0]]:
        print(f"   {comp:34s} {res[cases[0][0]][comp]:10.3f} {res[cases[1][0]][comp]:14.3f}")
    total = [sum(res[c[0]].values()) for c in cases]
    print("   " + "─" * 60)
    print(f"   {'Tổng phần kiểm tra':34s} {total[0]:10.3f} {total[1]:14.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=300, help="số lần đo mỗi kịch bản")
    ap.add_argument("--concurrency", type=int, default=20)
    ap.add_argument("--seconds", type=int, default=5)
    args = ap.parse_args()

    try:
        httpx.get(DIRECT + "/api/public/home", timeout=3)
    except httpx.HTTPError:
        raise SystemExit("EngPro chưa chạy ở 127.0.0.1:8080")

    print(f"Máy đo: {platform.machine()} · {platform.system()} {platform.release()} · "
          f"Python {platform.python_version()} · {args.n} lần mỗi kịch bản")
    proc = start_bench_waf()
    try:
        print_sequential(bench_sequential(args.n))
        print_throughput(args.concurrency, args.seconds)
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    bench_components()


if __name__ == "__main__":
    main()

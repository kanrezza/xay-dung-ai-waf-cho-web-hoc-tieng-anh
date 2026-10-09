"""
Kiểm thử an toàn cho CHÍNH WAF – mỗi bài ứng với một lỗ hổng đã từng có thật.

Không cần EngPro hay DVWA: backend được giả lập bằng httpx.MockTransport, nên
chạy được ở bất kỳ đâu và rất nhanh.

    python -m tests.test_security

Nếu sau này sửa code mà vô tình mở lại lỗ hổng, bài tương ứng sẽ báo FAIL.
"""
import base64
import gzip
import os
import sys
import tempfile
import warnings

# Cảnh báo của starlette về việc dùng httpx trong TestClient, không ảnh hưởng kết quả
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Phải đặt TRƯỚC khi import app (config đọc biến môi trường lúc import)
os.environ["WAF_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["WAF_ADMIN_USER"] = "admin"
os.environ["WAF_ADMIN_PASSWORD"] = "mat-khau-kiem-thu"
os.environ["WAF_TRUSTED_PROXIES"] = ""

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import anomaly, config, main  # noqa: E402

seen = []  # các request mà "backend" nhận được


class _NetworkStream(httpx.AsyncByteStream):
    """
    Thân phản hồi dạng luồng, giống khi đọc từ mạng thật. Nếu tạo phản hồi
    bằng content=bytes, httpx đọc sẵn toàn bộ và WAF (đọc kiểu luồng để giữ
    nguyên gzip) sẽ báo "content has already been streamed" – một lỗi chỉ có
    trong kiểm thử, không có khi chạy với EngPro thật.
    """
    def __init__(self, data: bytes):
        self._data = data

    async def __aiter__(self):
        yield self._data


def _resp(status, body=b"", headers=None):
    return httpx.Response(status, headers=headers, stream=_NetworkStream(body))


def fake_backend(request: httpx.Request) -> httpx.Response:
    seen.append(request)
    if request.url.path == "/api/auth/login":
        return _resp(401, b'{"success":false}', {"content-type": "application/json"})
    if request.url.path == "/two-cookies":
        return _resp(200, b"ok", [("set-cookie", "a=1; Path=/"), ("set-cookie", "b=2; Path=/")])
    if request.url.path == "/gz":
        return _resp(200, gzip.compress(b"xin chao"),
                     {"content-encoding": "gzip", "content-type": "text/plain"})
    return _resp(200, b'{"ok":true}', {"content-type": "application/json"})


def auth(user="admin", pw="mat-khau-kiem-thu"):
    token = base64.b64encode(f"{user}:{pw}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def reset():
    anomaly.reset()
    anomaly._admin_fail.clear()
    seen.clear()


# ── Lỗ hổng 1: giả X-Forwarded-For để né khóa dò mật khẩu ──────────
def test_gia_ip_khong_ne_duoc_khoa_do_mat_khau(c):
    reset()
    responses = [
        c.post("/api/auth/login", json={"email": "a@b.c", "password": f"sai{i}"},
               headers={"X-Forwarded-For": f"10.0.0.{i}"})  # mỗi lần một IP giả
        for i in range(12)
    ]
    blocked = [r for r in responses if r.status_code == 403]
    assert blocked, f"WAF không chặn lần nào: {[r.status_code for r in responses]}"
    assert blocked[0].json()["waf"]["layer"] == "anomaly"


def test_header_forwarding_gia_bi_xoa_truoc_khi_toi_backend(c):
    reset()
    c.get("/api/public/home", headers={
        "X-Forwarded-For": "6.6.6.6", "X-Real-IP": "6.6.6.6",
        "Forwarded": "for=6.6.6.6", "X-Forwarded-Proto": "https"})
    h = seen[-1].headers
    assert h["x-forwarded-for"] == "testclient", h["x-forwarded-for"]
    assert "x-real-ip" not in h and "forwarded" not in h
    assert h["x-forwarded-proto"] == "http"
    assert h["host"] == "testserver", "Host của khách phải được giữ nguyên"


def test_backend_nhan_dung_duong_dan_goc(c):
    reset()
    c.get("/api/courses%3Fsort=new")
    # %3F phải giữ nguyên, không được giải mã thành "?" (biến thành query string)
    assert seen[-1].url.raw_path == b"/api/courses%3Fsort=new", seen[-1].url.raw_path
    assert seen[-1].url.query == b""


def test_chi_tin_x_forwarded_for_tu_proxy_tin_cay(c):
    reset()
    config.TRUSTED_PROXIES = {"testclient"}
    try:
        c.get("/", headers={"X-Forwarded-For": "1.1.1.1, 2.2.2.2"})
        # Lấy giá trị CUỐI (do proxy tin cậy gắn), không lấy giá trị đầu (client tự khai)
        assert seen[-1].headers["x-forwarded-for"] == "2.2.2.2"
    finally:
        config.TRUSTED_PROXIES = set()


# ── Lỗ hổng 2: dashboard và API quản trị không có mật khẩu ──────────
def test_dashboard_va_api_can_mat_khau(c):
    reset()
    for path in ("/waf/dashboard", "/waf/api/events", "/waf/api/stats", "/waf/api/status"):
        assert c.get(path).status_code == 401, f"{path} mở không cần mật khẩu"
        assert c.get(path, headers=auth(pw="sai")).status_code == 401
        assert c.get(path, headers=auth()).status_code == 200


def test_lenh_post_can_header_chong_csrf(c):
    reset()
    for path in ("/waf/api/unban", "/waf/api/clear"):
        assert c.post(path).status_code == 401
        assert c.post(path, headers=auth()).status_code == 403, f"{path} thiếu chống CSRF"
        assert c.post(path, headers={**auth(), "X-WAF-Admin": "1"}).status_code == 200


def test_khoa_khi_do_mat_khau_dashboard(c):
    reset()
    for _ in range(config.ADMIN_MAX_FAIL):
        c.get("/waf/api/status", headers=auth(pw="doan-mo"))
    # Đã bị khóa: kể cả mật khẩu đúng cũng phải chờ
    assert c.get("/waf/api/status", headers=auth()).status_code == 429
    # Nút "Gỡ chặn IP" không được gỡ khóa này
    anomaly.reset()
    assert c.get("/waf/api/status", headers=auth()).status_code == 429
    reset()


# ── Lỗi proxy: làm hỏng phản hồi của backend ───────────────────────
def test_giu_nguyen_nhieu_set_cookie(c):
    reset()
    cookies = c.get("/two-cookies").headers.get_list("set-cookie")
    assert len(cookies) == 2, f"Set-Cookie bị gộp: {cookies}"


def test_phan_hoi_gzip_khong_bi_hong(c):
    reset()
    r = c.get("/gz", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
    assert r.content == b"xin chao", "Header báo gzip nhưng thân không còn là gzip"


def main_():
    tests = [(n, f) for n, f in globals().items() if n.startswith("test_")]
    failed = 0
    with TestClient(main.app) as c:
        main._client = httpx.AsyncClient(transport=httpx.MockTransport(fake_backend),
                                         base_url="http://backend")
        for name, fn in tests:
            try:
                fn(c)
                print(f"  PASS  {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"  FAIL  {name}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} bài đạt")
    return failed


if __name__ == "__main__":
    sys.exit(1 if main_() else 0)

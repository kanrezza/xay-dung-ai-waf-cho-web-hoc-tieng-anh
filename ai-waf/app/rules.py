"""
Lớp 1 – Luật và chữ ký (signature-based).

Nhanh và giải thích được: mỗi luật là một biểu thức chính quy (regex) cho một
họ tấn công phổ biến. Ưu điểm: chắc chắn, biết chặn vì luật nào. Nhược điểm:
dễ bị né bằng biến thể (đây chính là lý do cần thêm lớp học máy ở model.py).
"""
import re

# Mỗi mục: (mã_luật, loại_tấn_công, regex đã biên dịch)
_RAW_RULES = [
    # ── SQL Injection ────────────────────────────────────────────────
    ("SQLI-01", "SQL Injection", r"(?i)\bunion\b\s+(?:all\s+)?\bselect\b"),
    ("SQLI-02", "SQL Injection", r"(?i)\bor\b\s+['\"]?\d+['\"]?\s*=\s*['\"]?\d+"),  # OR 1=1
    ("SQLI-03", "SQL Injection", r"(?i)'\s*(?:or|and)\s+'?\w+'?\s*=\s*'?\w+"),      # ' or 'a'='a
    ("SQLI-04", "SQL Injection", r"(?i)\b(?:sleep|pg_sleep|benchmark|waitfor\s+delay)\s*\("),
    ("SQLI-05", "SQL Injection", r"(?i)\b(?:drop|alter|truncate)\s+table\b"),
    ("SQLI-06", "SQL Injection", r"(?i)\binsert\s+into\b|\bdelete\s+from\b"),
    ("SQLI-07", "SQL Injection", r"(?:--|#)\s*$|/\*.*?\*/"),                        # comment SQL
    ("SQLI-08", "SQL Injection", r"(?i)\b(?:information_schema|pg_catalog|sqlite_master)\b"),
    # "99 OR TRUE--". Phải có số/nháy/ngoặc ngay trước và dấu kết thúc câu lệnh
    # ngay sau, nếu không sẽ chặn nhầm dạng câu hỏi True/False/Not Given của
    # EngPro ("Choose true or false", "The answer is false or true").
    ("SQLI-09", "SQL Injection",
     r"(?i)(?:\d|['\"\)])\s*(?:or|and)\s+(?:true|false)\b\s*(?:--|#|;|\)|$)"),

    # ── Cross-Site Scripting (XSS) ───────────────────────────────────
    ("XSS-01", "XSS", r"(?i)<\s*script\b"),
    ("XSS-02", "XSS", r"(?i)<\s*/\s*script\s*>"),
    ("XSS-03", "XSS", r"(?i)\bon(?:error|load|click|mouseover|focus)\s*="),
    ("XSS-04", "XSS", r"(?i)javascript\s*:"),
    ("XSS-05", "XSS", r"(?i)<\s*(?:img|svg|iframe|body|object|embed)\b[^>]*\b(?:src|onerror|onload)\b"),
    ("XSS-06", "XSS", r"(?i)(?:document\.cookie|document\.location|window\.location)"),
    ("XSS-07", "XSS", r"(?i)<\s*iframe\b"),

    # ── OS Command Injection ─────────────────────────────────────────
    # Đặt TRƯỚC Path Traversal: payload kiểu "; cat /etc/passwd" vừa khớp cả hai,
    # nhưng bản chất là command injection nên cần gán đúng nhãn khi thống kê.
    # Các lệnh có tham số phải kèm đường dẫn/cờ (/ - ~) để không chặn nhầm câu
    # tiếng Anh như "I have a dog; cat food is expensive."
    ("CMDI-01", "Command Injection",
     r"(?:;|\||&&|\|\|)\s*(?:cat|ls|head|tail|rm|chmod|chown|cp|mv)\s+[/\-~$]"),
    # Lệnh mạng/shell: không phải từ tiếng Anh thông thường nên không cần thêm điều kiện
    ("CMDI-02", "Command Injection",
     r"(?:;|\||&&|\|\|)\s*(?:curl|wget|nc|netcat|telnet|bash|powershell)\b"),
    ("CMDI-03", "Command Injection", r"(?:;|\||&&|\|\|)\s*(?:whoami|uname|ifconfig|netstat)\b"),
    ("CMDI-04", "Command Injection", r"\$\([^)]+\)|`[^`]{2,}`"),                     # $(...) hoặc `...`
    ("CMDI-05", "Command Injection", r"(?i)\b(?:/bin/(?:sh|bash)|cmd\.exe|powershell\s+-)\b"),

    # ── Path Traversal / Local File Inclusion ────────────────────────
    ("LFI-01", "Path Traversal", r"(?:\.\./){2,}|(?:\.\.\\){2,}"),
    ("LFI-02", "Path Traversal", r"(?i)/etc/passwd\b|/etc/shadow\b|\bboot\.ini\b"),
    ("LFI-03", "Path Traversal", r"(?i)(?:\.\.%2f|%2e%2e%2f|\.\.%5c)"),
    ("LFI-04", "Path Traversal", r"(?i)\bfile\s*:\s*//"),

    # ── Server-Side Template Injection / mã hóa ─────────────────────
    ("SSTI-01", "Template Injection", r"\{\{.*?\}\}|\$\{.*?\}|<%.*?%>"),

    # ── Công cụ quét lỗ hổng (nhận qua User-Agent) ──────────────────
    ("SCAN-01", "Scanner", r"(?i)\b(?:sqlmap|nikto|nmap|acunetix|nessus|dirbuster|gobuster|wpscan|masscan|hydra)\b"),

    # ── NoSQL / lộ khóa nhạy cảm trong body ─────────────────────────
    ("SENS-01", "Sensitive Path", r"(?i)/\.(?:env|git|htpasswd)\b|\bwp-config\.php\b"),
]

# Biên dịch sẵn để chạy nhanh
_RULES = [(rid, kind, re.compile(pattern)) for rid, kind, pattern in _RAW_RULES]


def match(text: str):
    """
    Trả về (mã_luật, loại_tấn_công) của luật ĐẦU TIÊN khớp, hoặc None nếu sạch.
    """
    for rid, kind, rx in _RULES:
        if rx.search(text):
            return rid, kind
    return None


def rule_count() -> int:
    return len(_RULES)

"""
Kịch bản demo trên BIA TẬP DVWA (Damn Vulnerable Web Application).

Khác với demo_attack.py (chạy trên EngPro và chỉ xem request có bị chặn không),
kịch bản này đo thứ quan trọng hơn: KHAI THÁC CÓ THÀNH CÔNG THẬT không.

DVWA là ứng dụng cố tình có lỗ hổng, dùng làm chuẩn trong nhiều nghiên cứu WAF.
Nhờ nó, ta chứng minh được:
    - Gửi thẳng DVWA (không WAF): SQLi thật sự lấy được danh sách người dùng,
      XSS thật sự được phản chiếu về trang để chạy trong trình duyệt.
    - Qua WAF: các đòn đó bị chặn (403), không lấy được gì.

    python -m tests.demo_dvwa            # tấn công QUA WAF (cổng 8001)
    python -m tests.demo_dvwa --direct   # tấn công THẲNG DVWA (cổng 4280)

Chỉ chạy trên DVWA localhost của chính mình, phục vụ học tập.
"""
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar

DVWA_DIRECT = "http://127.0.0.1:4280"
DVWA_VIA_WAF = "http://127.0.0.1:8001"


def make_client():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    return opener, cj


def _token(html):
    m = re.search(r"user_token'\s*value='([a-f0-9]{32})", html)
    return m.group(1) if m else ""


def _get(opener, base, path):
    try:
        r = opener.open(base + path, timeout=10)
        return r.status, r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")


def _post(opener, base, path, data):
    body = urllib.parse.urlencode(data).encode()
    try:
        r = opener.open(urllib.request.Request(base + path, body), timeout=10)
        return r.status, r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")


def login_and_setup(opener, base):
    """Đăng nhập DVWA, tạo CSDL, đặt mức bảo mật thấp. Trả về True nếu sẵn sàng."""
    _, html = _get(opener, base, "/login.php")
    _post(opener, base, "/login.php",
          {"username": "admin", "password": "password",
           "user_token": _token(html), "Login": "Login"})
    _, html = _get(opener, base, "/setup.php")
    _post(opener, base, "/setup.php",
          {"create_db": "Create / Reset Database", "user_token": _token(html)})
    _, html = _get(opener, base, "/security.php")
    _post(opener, base, "/security.php",
          {"security": "low", "seclev_submit": "Submit", "user_token": _token(html)})
    _, home = _get(opener, base, "/index.php")
    return "Logout" in home


def test_sqli(opener, base):
    """SQLi phản hồi: lấy toàn bộ người dùng. Thành công = lấy được > 1 bản ghi."""
    payload = "' OR '1'='1"
    q = urllib.parse.urlencode({"id": payload, "Submit": "Submit"})
    status, html = _get(opener, base, "/vulnerabilities/sqli/?" + q)
    records = html.count("First name")
    names = re.findall(r"First name:\s*(\w+)", html)
    return {
        "status": status,
        "exploited": records > 1,      # lấy được nhiều hơn 1 người = rò rỉ dữ liệu
        "records": records,
        "sample": names[:3],
    }


def test_xss(opener, base):
    """XSS phản chiếu: payload có bị trả nguyên về trang (chạy được) không."""
    payload = "<script>alert('xss')</script>"
    q = urllib.parse.urlencode({"name": payload})
    status, html = _get(opener, base, "/vulnerabilities/xss_r/?" + q)
    return {
        "status": status,
        "exploited": payload in html,  # trả nguyên xi = script sẽ chạy trong trình duyệt
    }


def run(base, label, via_waf):
    print(f"\n{'=' * 70}\n  {label}\n  {base}\n{'=' * 70}")

    opener, _ = make_client()
    ready = login_and_setup(opener, base)
    if not ready and not via_waf:
        print("  ✗ Không đăng nhập được DVWA. DVWA đã chạy ở cổng 4280 chưa?")
        return
    if via_waf and not ready:
        # Qua WAF, chính bước đăng nhập/thiết lập có thể đã bị WAF chặn – vẫn tiếp tục
        print("  (Lưu ý: thiết lập qua WAF có thể bị chặn một phần, vẫn thử tấn công)")

    print("\n  ── SQL Injection: '  OR '1'='1  (lấy trộm danh sách người dùng) ──")
    r = test_sqli(opener, base)
    if r["exploited"]:
        print(f"   ⚠️  KHAI THÁC THÀNH CÔNG [{r['status']}] – lấy được {r['records']} bản ghi")
        print(f"       Tên lấy trộm: {r['sample']}")
    elif r["status"] == 403:
        print(f"   🛡️  WAF CHẶN [{r['status']}] – không lấy được gì")
    else:
        print(f"   ✓  Không khai thác được [{r['status']}] (bản ghi: {r['records']})")

    print("\n  ── XSS phản chiếu: <script>alert('xss')</script> ──")
    x = test_xss(opener, base)
    if x["exploited"]:
        print(f"   ⚠️  KHAI THÁC THÀNH CÔNG [{x['status']}] – payload phản chiếu nguyên, script sẽ chạy")
    elif x["status"] == 403:
        print(f"   🛡️  WAF CHẶN [{x['status']}] – payload không tới được DVWA")
    else:
        print(f"   ✓  Không khai thác được [{x['status']}]")

    print()
    exploited = int(r["exploited"]) + int(x["exploited"])
    print(f"   → Khai thác thành công {exploited}/2 lỗ hổng")


if __name__ == "__main__":
    if "--direct" in sys.argv:
        run(DVWA_DIRECT, "KHÔNG CÓ WAF – tấn công thẳng DVWA", via_waf=False)
    else:
        run(DVWA_VIA_WAF, "CÓ AI WAF bảo vệ DVWA", via_waf=True)

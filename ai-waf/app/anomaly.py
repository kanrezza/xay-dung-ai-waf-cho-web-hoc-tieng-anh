"""
Lớp 3 – Phát hiện bất thường hành vi (behavior / rate-based).

Không nhìn nội dung mà nhìn TẦN SUẤT theo IP:
  - Gửi quá nhiều request trong cửa sổ ngắn  -> quét/DoS tầng ứng dụng.
  - Đăng nhập sai nhiều lần                    -> dò mật khẩu (brute force).

Lưu trong bộ nhớ (đủ cho đồ án và demo trên localhost). Muốn nhiều tiến trình
thì thay bằng Redis.
"""
import time
from collections import defaultdict, deque

from . import config

# ip -> deque các mốc thời gian request gần đây
_hits = defaultdict(deque)
# ip -> deque các mốc thời gian đăng nhập THẤT BẠI gần đây
_login_fail = defaultdict(deque)
# ip -> deque các lần nhập SAI mật khẩu dashboard WAF. Để riêng, không bị nút
# "Gỡ chặn IP" xóa: kẻ dò mật khẩu quản trị không được tự gỡ khóa cho mình.
_admin_fail = defaultdict(deque)
ADMIN_FAIL_WINDOW_SEC = 300


def _trim(dq: deque, window: float, now: float):
    while dq and now - dq[0] > window:
        dq.popleft()


def check_rate(ip: str):
    """
    Ghi nhận một request từ ip và kiểm tra vượt ngưỡng tần suất chung.
    Trả về (bất_thường, số_request_trong_cửa_sổ).
    """
    now = time.time()
    dq = _hits[ip]
    dq.append(now)
    _trim(dq, config.RATE_WINDOW_SEC, now)
    return len(dq) > config.RATE_MAX_REQ, len(dq)


def note_login_failure(ip: str):
    """Gọi khi EngPro trả 401/429 cho một lần đăng nhập; trả về True nếu đang brute force."""
    now = time.time()
    dq = _login_fail[ip]
    dq.append(now)
    _trim(dq, 60.0, now)  # cửa sổ 1 phút
    return len(dq) > config.LOGIN_MAX_FAIL


def flagged_ips():
    """Danh sách IP đang bị đánh dấu dò mật khẩu, để hiển thị trên dashboard."""
    now = time.time()
    out = []
    for ip, dq in _login_fail.items():
        _trim(dq, 60.0, now)
        if len(dq) > config.LOGIN_MAX_FAIL:
            out.append({"ip": ip, "fails": len(dq)})
    return out


def reset(ip: str | None = None):
    """
    Gỡ chặn. Cần cho lúc demo: sau khi thử dò mật khẩu, chính máy đang demo
    (127.0.0.1) sẽ bị khóa đăng nhập 1 phút.
    """
    if ip:
        _login_fail.pop(ip, None)
        _hits.pop(ip, None)
    else:
        _login_fail.clear()
        _hits.clear()


def note_admin_failure(ip: str):
    now = time.time()
    dq = _admin_fail[ip]
    dq.append(now)
    _trim(dq, ADMIN_FAIL_WINDOW_SEC, now)


def is_admin_locked(ip: str) -> bool:
    """Sai mật khẩu dashboard quá ADMIN_MAX_FAIL lần trong 5 phút thì khóa."""
    now = time.time()
    dq = _admin_fail[ip]
    _trim(dq, ADMIN_FAIL_WINDOW_SEC, now)
    return len(dq) >= config.ADMIN_MAX_FAIL


def is_login_flagged(ip: str) -> bool:
    """Kiểm tra IP có đang bị đánh dấu dò mật khẩu không (không thêm lần mới)."""
    now = time.time()
    dq = _login_fail[ip]
    _trim(dq, 60.0, now)
    return len(dq) > config.LOGIN_MAX_FAIL

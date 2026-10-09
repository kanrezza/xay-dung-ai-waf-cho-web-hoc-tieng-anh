"""
Cấu hình AI WAF. Đọc từ biến môi trường, có giá trị mặc định để chạy ngay.

Ý tưởng: WAF là một reverse proxy nghe ở WAF_PORT, kiểm tra từng request
rồi mới chuyển tiếp (forward) sang EngPro ở BACKEND_URL.

    Trình duyệt ──►  WAF (8000)  ──►  EngPro (8080)
"""
import os
import secrets

# Package nằm ở ai-waf/app/, nên BASE_DIR = thư mục gốc ai-waf/
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_dotenv(path):
    """
    Đọc ai-waf/.env nếu có (không cần thư viện ngoài). Biến đã đặt sẵn trên dòng
    lệnh được ưu tiên, nên vẫn chạy được 2 tiến trình WAF với BACKEND_URL khác nhau.
    """
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(os.path.join(BASE_DIR, ".env"))


def _get(name, default):
    return os.environ.get(name, default)


# Cổng WAF lắng nghe (người dùng truy cập cổng này thay vì 8080)
WAF_HOST = _get("WAF_HOST", "0.0.0.0")
WAF_PORT = int(_get("WAF_PORT", "8000"))

# Địa chỉ ứng dụng thật được bảo vệ (backend)
BACKEND_URL = _get("BACKEND_URL", "http://127.0.0.1:8080")

# Tên mục tiêu, hiện trên dashboard để phân biệt khi một WAF bảo vệ nhiều ứng dụng.
# Đồ án chạy 2 tiến trình WAF: một bảo vệ EngPro, một bảo vệ DVWA (bia tập).
TARGET_NAME = _get("WAF_TARGET_NAME", "EngPro")

# Ngưỡng điểm của mô hình học máy: >= ngưỡng thì coi là tấn công và chặn
ML_THRESHOLD = float(_get("ML_THRESHOLD", "0.80"))

# Chế độ chỉ ghi log, không chặn (bật để đo tỉ lệ báo nhầm trước khi chặn thật)
DETECTION_ONLY = _get("WAF_DETECTION_ONLY", "0") == "1"

# Bật/tắt từng lớp (tiện cho demo "trước và sau")
ENABLE_RULES = _get("WAF_ENABLE_RULES", "1") == "1"
ENABLE_ML = _get("WAF_ENABLE_ML", "1") == "1"
ENABLE_ANOMALY = _get("WAF_ENABLE_ANOMALY", "1") == "1"

# Giới hạn tần suất (lớp 3 – hành vi bất thường)
RATE_WINDOW_SEC = int(_get("WAF_RATE_WINDOW_SEC", "10"))   # cửa sổ thời gian
RATE_MAX_REQ = int(_get("WAF_RATE_MAX_REQ", "80"))         # số request tối đa / cửa sổ / IP
LOGIN_MAX_FAIL = int(_get("WAF_LOGIN_MAX_FAIL", "8"))      # số lần dò đăng nhập / phút / IP

# IP của proxy/cân bằng tải đứng TRƯỚC WAF (nếu có), cách nhau bằng dấu phẩy.
# Chỉ request đến từ các IP này mới được đọc X-Forwarded-For. Mặc định để trống:
# không tin header đó, vì kẻ tấn công tự đặt được nó để giả IP và né khóa dò mật khẩu.
TRUSTED_PROXIES = {ip.strip() for ip in _get("WAF_TRUSTED_PROXIES", "").split(",") if ip.strip()}

# Tài khoản quản trị dashboard và API /waf/api/*. Không đặt mật khẩu thì WAF
# tự sinh mật khẩu ngẫu nhiên mỗi lần chạy và in ra cửa sổ dòng lệnh.
ADMIN_USER = _get("WAF_ADMIN_USER", "admin")
ADMIN_PASSWORD = _get("WAF_ADMIN_PASSWORD", "")
ADMIN_PASSWORD_GENERATED = not ADMIN_PASSWORD
if ADMIN_PASSWORD_GENERATED:
    ADMIN_PASSWORD = secrets.token_urlsafe(12)
ADMIN_MAX_FAIL = int(_get("WAF_ADMIN_MAX_FAIL", "5"))      # sai mật khẩu dashboard / 5 phút / IP

MODEL_PATH = _get("WAF_MODEL_PATH", os.path.join(BASE_DIR, "ml", "model.joblib"))
DB_PATH = _get("WAF_DB_PATH", os.path.join(BASE_DIR, "data", "waf_logs.db"))

# Không kiểm tra body cho các loại nội dung nhị phân lớn (upload video/tài liệu)
SKIP_BODY_INSPECT_PREFIXES = (
    "/api/gv/",          # giảng viên tải video, tài liệu (multipart lớn)
    "/api/user/avatar",  # ảnh đại diện
)
# Giới hạn số byte body đem đi phân tích (tránh chậm với request lớn)
MAX_BODY_INSPECT_BYTES = int(_get("WAF_MAX_BODY_BYTES", "65536"))

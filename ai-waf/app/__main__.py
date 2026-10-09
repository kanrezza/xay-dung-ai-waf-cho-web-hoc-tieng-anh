"""
Khởi động WAF:  python -m app   (chạy trong thư mục ai-waf/)

Cổng, địa chỉ backend, mật khẩu dashboard... lấy từ ai-waf/.env hoặc biến môi
trường (xem app/config.py).

Vì sao không chạy thẳng `uvicorn app.main:app`? Mặc định uvicorn tin header
X-Forwarded-For của mọi request đến từ 127.0.0.1 và thay IP người gửi bằng giá
trị trong header đó. Trên máy demo, kẻ tấn công ở cùng máy chỉ cần tự đặt header
là đổi được IP, né luôn khóa dò mật khẩu. proxy_headers=False tắt hành vi này;
WAF tự quyết định khi nào tin header (WAF_TRUSTED_PROXIES).
"""
import uvicorn

from . import config
from .main import app

if __name__ == "__main__":
    uvicorn.run(app, host=config.WAF_HOST, port=config.WAF_PORT, proxy_headers=False)

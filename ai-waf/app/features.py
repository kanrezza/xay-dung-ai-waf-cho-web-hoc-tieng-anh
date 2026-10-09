"""
Trích đặc trưng từ một HTTP request.

Cả lớp luật (rules) và lớp học máy (model) đều làm việc trên MỘT chuỗi văn bản
gộp từ những phần mà kẻ tấn công điều khiển được: đường dẫn, query string,
một số header đáng ngờ và phần thân (body). URL được giải mã (%3C -> <) để
không bị né bằng cách mã hóa.
"""
from urllib.parse import unquote_plus


# Các header mà kẻ tấn công có thể lợi dụng để chèn payload
SUSPECT_HEADERS = ("user-agent", "referer", "cookie", "x-forwarded-for", "origin")


def decode(text: str) -> str:
    """Giải mã URL nhiều lần để lộ payload bị mã hóa lồng nhau (%253C -> %3C -> <)."""
    if not text:
        return ""
    prev = text
    for _ in range(3):
        cur = unquote_plus(prev)
        if cur == prev:
            break
        prev = cur
    return prev


def build_inspection_text(method: str, path: str, query: str,
                          headers: dict, body: str) -> str:
    """Gộp các phần điều khiển được của request thành một chuỗi để phân tích."""
    parts = [method, decode(path), decode(query)]

    for name in SUSPECT_HEADERS:
        val = headers.get(name)
        if val:
            parts.append(decode(val))

    if body:
        parts.append(decode(body))

    return "\n".join(parts)


def build_ml_text(method: str, path: str, query: str, body: str) -> str:
    """
    Đầu vào cho LỚP HỌC MÁY – cố ý KHÔNG gồm header.

    Vì sao? Nhận diện công cụ quét (sqlmap, nikto...) dựa vào User-Agent là việc
    của lớp luật: danh sách công cụ là hữu hạn và biết trước nên regex đúng gần
    như tuyệt đối. Ngược lại, nếu đưa User-Agent vào mô hình, mô hình chỉ thấy
    vài chục UA lúc huấn luyện và sẽ coi MỌI UA lạ là tấn công – một nguồn báo
    nhầm rất lớn (đã gặp thật: "Mozilla/5.0 (demo)" bị chấm 0.93).

    Mô hình vì thế chỉ tập trung vào thứ nó làm tốt: payload nằm trong đường
    dẫn, tham số và thân request.
    """
    return "\n".join([method, decode(path), decode(query), decode(body or "")])


def feature_summary(text: str) -> dict:
    """Vài đặc trưng số học dễ đọc, dùng để hiển thị và gỡ lỗi (không bắt buộc cho ML)."""
    lower = text.lower()
    specials = sum(text.count(c) for c in "'\"<>();=&|/\\%")
    return {
        "length": len(text),
        "special_chars": specials,
        "has_select": "select" in lower,
        "has_script": "script" in lower or "onerror" in lower,
        "has_dotdot": "../" in text or "..\\" in text,
    }

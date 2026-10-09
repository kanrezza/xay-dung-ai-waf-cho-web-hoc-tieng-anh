"""
Sinh tập dữ liệu huấn luyện (dataset) cho mô hình WAF.

HAI NGUYÊN TẮC BẮT BUỘC (đều từng bị vi phạm và gây lỗi thật):

1. Dữ liệu huấn luyện phải đi qua ĐÚNG hàm trích đặc trưng lúc chạy thật
   (app.features.build_inspection_text). Nếu tự ghép chuỗi theo định dạng khác,
   mô hình học trên một định dạng rồi lại được hỏi trên định dạng khác.

2. Mẫu bình thường và mẫu tấn công phải có cùng "khung" request: cùng có
   User-Agent, Referer, Cookie... Nếu chỉ mẫu tấn công mới có User-Agent, mô
   hình sẽ học nhầm thành "có User-Agent = tấn công" và chặn cả người dùng thật.

3. Payload được chia RỜI NHAU giữa train và test (grouped split), nếu không
   cùng một payload nằm ở cả hai tập, mô hình chỉ cần học thuộc và cho ra độ
   chính xác 100% giả tạo.
"""
import csv
import os
import random

from app import features
from . import payloads as P

# Vị trí có thể nhét payload vào một request
PARAM_NAMES = ["search", "q", "id", "email", "name", "comment", "sort",
               "content", "file", "category", "answer"]

FAMILIES = [
    ("sqli", P.SQLI), ("xss", P.XSS), ("traversal", P.TRAVERSAL),
    ("cmdi", P.CMDI), ("scanner", P.SCANNER_UA), ("misc", P.MISC),
]

WRITING_PATHS = ["/api/writing/prompts/5/submit", "/api/ai/lectures/45/ask",
                 "/api/user/contact-messages/3/reply", "/api/lecture-questions/9/answers"]


def split_pools(test_ratio=0.3, seed=42):
    """
    Chia mỗi họ payload thành phần train và phần test KHÔNG giao nhau.
    Câu tiếng Anh bình thường cũng chia tương tự.
    Trả về (pools_train, pools_test, writing_train, writing_test).
    """
    rnd = random.Random(seed)
    pools_tr, pools_te = [], []
    for name, items in FAMILIES:
        items = list(items)
        rnd.shuffle(items)
        cut = max(1, int(len(items) * (1 - test_ratio)))
        pools_tr.append((name, items[:cut]))
        pools_te.append((name, items[cut:]))

    writing = list(P.BENIGN_WRITING)
    rnd.shuffle(writing)
    cut = max(1, int(len(writing) * (1 - test_ratio)))
    return pools_tr, pools_te, writing[:cut], writing[cut:]


def _headers(rnd: random.Random, scanner_ua: str | None = None) -> dict:
    """Header của một request thật. Mọi mẫu đều có User-Agent."""
    h = {"user-agent": scanner_ua or rnd.choice(P.BENIGN_USER_AGENTS)}
    if rnd.random() < 0.6:
        h["referer"] = rnd.choice(P.BENIGN_REFERERS)
    if rnd.random() < 0.5:
        h["cookie"] = rnd.choice(P.BENIGN_COOKIES)
    return h


def _mal_request(payload: str, family: str, rnd: random.Random):
    """Một request TẤN CÔNG: (method, path, query, headers, body)."""
    path = rnd.choice(P.BENIGN_PATHS)
    param = rnd.choice(PARAM_NAMES)

    # Kẻ tấn công dùng công cụ quét: payload nằm ở User-Agent, phần còn lại bình thường
    if family == "scanner":
        return "GET", path, rnd.choice(P.BENIGN_QUERIES), _headers(rnd, payload), ""

    # Các họ khác: dùng User-Agent trình duyệt bình thường để nguỵ trang
    headers = _headers(rnd)
    where = rnd.choice(["query", "query", "body", "path"])
    if where == "query":
        return "GET", path, f"{param}={payload}", headers, ""
    if where == "body":
        method = rnd.choice(["POST", "PUT"])
        return method, path, "", headers, '{"%s":"%s"}' % (param, payload)
    return "GET", f"{path}/{payload}", "", headers, ""


def _benign_request(writing_pool, rnd: random.Random):
    """Một request BÌNH THƯỜNG của EngPro: (method, path, query, headers, body)."""
    headers = _headers(rnd)
    kind = rnd.random()
    if kind < 0.35:                                   # GET có query
        return "GET", rnd.choice(P.BENIGN_PATHS), rnd.choice(P.BENIGN_QUERIES), headers, ""
    if kind < 0.6:                                    # POST/PUT body JSON/form
        method = rnd.choice(["POST", "PUT"])
        return method, rnd.choice(P.BENIGN_PATHS), "", headers, rnd.choice(P.BENIGN_BODIES)
    if kind < 0.9:                                    # bài Writing / hỏi đáp tiếng Anh
        method = rnd.choice(["POST", "PUT"])
        body = '{"content":"%s"}' % rnd.choice(writing_pool)
        return method, rnd.choice(WRITING_PATHS), "", headers, body
    return "GET", rnd.choice(P.BENIGN_PATHS), "", headers, ""   # GET trơn


def _to_text(req) -> str:
    """
    Dùng ĐÚNG hàm trích đặc trưng mà lớp ML dùng lúc chạy thật (không có header).
    """
    method, path, query, _headers, body = req
    return features.build_ml_text(method, path, query, body)


# Họ payload KHÔNG đưa vào huấn luyện ML: payload của nó nằm ở User-Agent, mà
# lớp ML cố ý không đọc header. Việc này giao cho lớp luật (SCAN-01).
ML_SKIP_FAMILIES = ("scanner",)


def build_from(pools, writing_pool, n_per_family=200, n_benign=1800, seed=0):
    """Sinh danh sách (text, label) từ kho payload đã cho."""
    rnd = random.Random(seed)
    rows = []
    for family, items in pools:
        if not items or family in ML_SKIP_FAMILIES:
            continue
        for _ in range(n_per_family):
            rows.append((_to_text(_mal_request(rnd.choice(items), family, rnd)), 1))
    for _ in range(n_benign):
        rows.append((_to_text(_benign_request(writing_pool, rnd)), 0))
    rnd.shuffle(rows)
    return rows


def build(n_per_family=200, n_benign=1800, seed=0):
    """Toàn bộ dữ liệu (dùng khi chỉ cần xuất dataset để xem)."""
    pools = [(n, list(items)) for n, items in FAMILIES]
    return build_from(pools, list(P.BENIGN_WRITING), n_per_family, n_benign, seed)


def main():
    rows = build()
    out = os.path.join(os.path.dirname(__file__), "dataset.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["text", "label"])
        for text, label in rows:
            w.writerow([text.replace("\n", "\\n"), label])
    mal = sum(1 for _, l in rows if l == 1)
    print(f"Đã sinh {len(rows)} mẫu -> {out}")
    print(f"  tấn công (1): {mal}")
    print(f"  bình thường (0): {len(rows) - mal}")


if __name__ == "__main__":
    main()

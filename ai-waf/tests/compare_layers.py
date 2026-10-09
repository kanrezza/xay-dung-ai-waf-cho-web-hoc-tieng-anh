"""
So sánh lớp LUẬT và lớp HỌC MÁY trên cùng một tập payload.

Đây là phân tích quan trọng nhất để đưa vào báo cáo: nó trả lời câu hỏi
"đã có regex rồi thì cần học máy làm gì?" bằng số liệu, bằng cách chia kết quả
thành 4 nhóm:

    CẢ HAI    – luật bắt được, ML cũng bắt được
    CHỈ LUẬT  – ML bỏ sót, luật cứu
    CHỈ ML    – luật bỏ sót, ML cứu   ← giá trị của học máy nằm ở đây
    BỎ SÓT    – cả hai đều không bắt  ← phần cần cải thiện, nêu thẳng trong báo cáo

Chạy: python -m tests.compare_layers
"""
from app import config, features, model, rules

# Payload biến thể, cố ý viết khác kiểu để thử khả năng tổng quát hóa.
# (mô tả, query string)
VARIANTS = [
    # SQLi viết theo kiểu ít gặp
    ("SQLi: OR 3=3 với # thay --",        "search=x' OR 3=3#"),
    ("SQLi: dùng TRUE thay 1=1",          "id=99 OR TRUE--"),
    ("SQLi: chèn comment giữa từ khóa",   "sort=id/**/DESC,(SELECT/**/1/**/FROM/**/users)"),
    ("SQLi: nối chuỗi lấy mật khẩu",      "q='||(SELECT password FROM users LIMIT 1)||'"),
    ("SQLi: hàm trì hoãn",                "q=1';SELECT pg_sleep(9);--"),
    ("SQLi: đếm bảng hệ thống",           "f=' AND 5=(SELECT COUNT(*) FROM pg_catalog.pg_tables)--"),
    ("SQLi: mã hóa URL hai lần",          "search=%2527%2520OR%25201%253D1--"),

    # XSS với thẻ ít gặp
    ("XSS: thẻ video + source",           "c=<video><source onerror=alert(9)>"),
    ("XSS: thẻ details ontoggle",         "c=<details open ontoggle=alert(1)>"),
    ("XSS: thẻ marquee onstart",          "topic=<marquee onstart=alert(1)>"),
    ("XSS: dấu nháy ngược quanh src",     "q=<img/src=`x`/onerror=prompt(1)>"),
    ("XSS: script kèm nguồn ngoài",       "n=<script src=//evil.js></script>"),

    # Path traversal biến thể
    ("Traversal: ....// lồng nhau",       "f=....//....//....//etc/passwd"),
    ("Traversal: mã hóa hai lần",         "doc=..%252f..%252fserver.js"),
    ("Traversal: đọc file CSDL",          "f=../../db/engpro.sql"),

    # Command injection biến thể
    ("CmdInj: đọc biến môi trường",       "name=test && cat /proc/self/environ"),
    ("CmdInj: printf thay cat",           "q=$(printf /etc/passwd)"),

    # Lưu lượng BÌNH THƯỜNG (phải nằm ở nhóm 'không bắt')
    ("[BT] Tìm 'order of adjectives'",    "search=order of adjectives"),
    ("[BT] Tìm 'drop the ball'",          "search=drop the ball idiom meaning"),
    ("[BT] Tìm 'union vs intersection'",  "search=union vs intersection grammar"),
    ("[BT] Phân trang",                   "page=3&limit=20"),
    ("[BT] VNPay trả về",                 "vnp_ResponseCode=00&vnp_TxnRef=EP1790000123456"),
]

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def main():
    trained = model.load(config.MODEL_PATH)
    print(f"Mô hình: {'đã huấn luyện' if trained else 'CHƯA (heuristic)'} | "
          f"ngưỡng ML = {config.ML_THRESHOLD}\n")

    groups = {"CẢ HAI": [], "CHỈ LUẬT": [], "CHỈ ML": [], "KHÔNG BẮT": []}
    path = "/api/courses"
    hdr = {"user-agent": UA}

    print(f"{'Payload':38s} {'Luật':10s} {'ML':>6s}  Kết luận")
    print("─" * 78)
    for name, query in VARIANTS:
        rule_text = features.build_inspection_text("GET", path, query, hdr, "")
        ml_text = features.build_ml_text("GET", path, query, "")
        hit = rules.match(rule_text)
        score = model.score(ml_text)

        by_rule = hit is not None
        by_ml = score >= config.ML_THRESHOLD
        if by_rule and by_ml:
            g = "CẢ HAI"
        elif by_rule:
            g = "CHỈ LUẬT"
        elif by_ml:
            g = "CHỈ ML"
        else:
            g = "KHÔNG BẮT"
        groups[g].append(name)
        print(f"{name:38s} {(hit[0] if hit else '—'):10s} {score:6.2f}  {g}")

    print("\n" + "═" * 78)
    print("TỔNG KẾT")
    for g, items in groups.items():
        print(f"\n  {g}  ({len(items)})")
        for n in items:
            print(f"     • {n}")

    benign_wrong = [n for g in ("CẢ HAI", "CHỈ LUẬT", "CHỈ ML")
                    for n in groups[g] if n.startswith("[BT]")]
    attack_missed = [n for n in groups["KHÔNG BẮT"] if not n.startswith("[BT]")]
    print("\n" + "═" * 78)
    print(f"  Báo nhầm lưu lượng bình thường : {len(benign_wrong)}")
    print(f"  Tấn công cả 2 lớp đều bỏ sót   : {len(attack_missed)}")
    if groups["CHỈ ML"]:
        print(f"\n  → Học máy cứu được {len([n for n in groups['CHỈ ML'] if not n.startswith('[BT]')]) } "
              f"tấn công mà luật regex bỏ sót.")


if __name__ == "__main__":
    main()

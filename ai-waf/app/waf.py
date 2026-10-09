"""
Bộ điều phối WAF: chạy lần lượt 3 lớp và ra QUYẾT ĐỊNH cho một request.

    Lớp 1 (rules)   -> khớp luật/chữ ký thì chặn ngay (nhanh, chắc chắn)
    Lớp 2 (model)   -> mô hình ML cho điểm; vượt ngưỡng thì chặn
    Lớp 3 (anomaly) -> tần suất/hành vi bất thường thì chặn

Trả về một 'Decision' để reverse proxy quyết định chặn (403) hay chuyển tiếp.
"""
from dataclasses import dataclass

from . import config
from . import rules, model, anomaly, features


@dataclass
class Decision:
    block: bool
    layer: str = "-"          # lớp ra quyết định: rule | ml | anomaly | -
    attack: str = ""          # loại tấn công
    rule_id: str = ""         # mã luật (nếu do lớp luật)
    score: float = 0.0        # điểm ML
    reason: str = ""          # mô tả ngắn để hiển thị/log
    snippet: str = ""         # trích đoạn payload


def evaluate(ip, method, path, query, headers, body) -> Decision:
    # Bỏ qua soi body với các endpoint upload lớn (video/tài liệu/ảnh)
    inspect_body = body or ""
    if any(path.startswith(p) for p in config.SKIP_BODY_INSPECT_PREFIXES):
        inspect_body = ""
    inspect_body = inspect_body[: config.MAX_BODY_INSPECT_BYTES]

    # Lớp luật soi TOÀN BỘ request (gồm cả header, để bắt User-Agent của công cụ quét)
    text = features.build_inspection_text(method, path, query, headers, inspect_body)
    # Lớp ML chỉ soi phần nội dung người dùng gửi (xem features.build_ml_text)
    ml_text = features.build_ml_text(method, path, query, inspect_body)
    snippet = text.replace("\n", " ")[:200]

    # ── Lớp 3a: chặn sớm IP đang dò mật khẩu (kể cả request trông sạch) ──
    if config.ENABLE_ANOMALY and anomaly.is_login_flagged(ip):
        if path.startswith("/api/auth/login"):
            return Decision(True, "anomaly", "Brute Force", score=0.0,
                            reason="Đăng nhập sai nhiều lần", snippet=snippet)

    # ── Lớp 1: luật / chữ ký ──
    if config.ENABLE_RULES:
        hit = rules.match(text)
        if hit:
            rid, kind = hit
            return Decision(True, "rule", kind, rule_id=rid,
                            reason=f"Khớp luật {rid}", snippet=snippet)

    # ── Lớp 2: học máy ──
    ml_score = 0.0
    if config.ENABLE_ML:
        ml_score = model.score(ml_text)
        if ml_score >= config.ML_THRESHOLD:
            return Decision(True, "ml", "ML nghi ngờ", score=ml_score,
                            reason=f"Điểm mô hình {ml_score:.2f}", snippet=snippet)

    # ── Lớp 3b: tần suất chung ──
    if config.ENABLE_ANOMALY:
        abnormal, count = anomaly.check_rate(ip)
        if abnormal:
            return Decision(True, "anomaly", "Rate Limit / Quét",
                            score=ml_score,
                            reason=f"{count} request trong {config.RATE_WINDOW_SEC}s",
                            snippet=snippet)

    # Sạch: cho qua
    return Decision(False, "-", "", score=ml_score, snippet=snippet)

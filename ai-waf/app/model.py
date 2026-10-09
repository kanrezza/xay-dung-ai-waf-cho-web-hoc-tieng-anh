"""
Lớp 2 – Học máy (Machine Learning).

Mô hình: TF-IDF trên n-gram ký tự (1..3) + Logistic Regression. Nó học đặc điểm
của request độc hại từ dữ liệu, nên bắt được cả biến thể mà luật regex bỏ sót
(ví dụ UnIoN/**/SeLeCt, chuỗi mã hóa lạ, mật độ ký tự đặc biệt cao...).

File này chỉ lo NẠP mô hình và CHO ĐIỂM. Việc huấn luyện nằm ở ml/train.py.
Nếu chưa có model.joblib, dùng một bộ chấm điểm dự phòng bằng heuristic để WAF
vẫn chạy được trước khi bạn huấn luyện.
"""
import os
import joblib

from . import features

_pipeline = None          # mô hình scikit-learn đã nạp (nếu có)
_loaded_from = None       # đường dẫn đã nạp, để hiển thị trạng thái


def load(model_path: str) -> bool:
    """Nạp mô hình từ đĩa. Trả về True nếu nạp được mô hình đã huấn luyện."""
    global _pipeline, _loaded_from
    if os.path.exists(model_path):
        try:
            _pipeline = joblib.load(model_path)
            _loaded_from = model_path
            return True
        except Exception as e:  # pragma: no cover - phòng file hỏng
            print(f"[WAF] Không nạp được mô hình: {e}")
    _pipeline = None
    _loaded_from = None
    return False


def is_trained() -> bool:
    return _pipeline is not None


def status() -> dict:
    return {
        "trained": is_trained(),
        "path": _loaded_from,
        "mode": "ml" if is_trained() else "heuristic",
    }


def _heuristic_score(text: str) -> float:
    """
    Bộ chấm dự phòng khi CHƯA huấn luyện. Không phải ML thật, chỉ để hệ thống
    chạy được: cộng điểm theo mật độ ký tự đặc biệt và vài từ khóa nguy hiểm.
    """
    f = features.feature_summary(text)
    lower = text.lower()
    score = 0.0
    if f["length"]:
        score += min(0.4, f["special_chars"] / max(20, f["length"]) * 2)
    for kw in ("select", "union", "script", "onerror", "../", "/etc/passwd",
               "'or", "' or", "1=1", "$(", "${", "<img", "<svg"):
        if kw in lower:
            score += 0.25
    return min(0.99, score)


def score(text: str) -> float:
    """
    Trả về xác suất request là tấn công, trong [0, 1].
    Có mô hình -> dùng predict_proba; chưa có -> heuristic.
    """
    if _pipeline is not None:
        # predict_proba trả [[p_lành, p_độc]]
        return float(_pipeline.predict_proba([text])[0][1])
    return _heuristic_score(text)

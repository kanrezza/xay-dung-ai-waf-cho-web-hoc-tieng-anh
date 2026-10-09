"""
Huấn luyện mô hình học máy cho lớp 2 của WAF.

Pipeline:
    TfidfVectorizer(char_wb, n-gram 1..3)  ->  LogisticRegression

Vì sao n-gram KÝ TỰ chứ không phải từ? Payload tấn công hay dùng ký tự lạ và
biến thể (UnIoN, %3C, ../) nên đặc trưng theo ký tự tổng quát và khó né hơn.

Đánh giá theo 2 mức, ngày càng khắt khe:
    (A) Tập kiểm tra có payload RỜI NHAU với tập huấn luyện – đo khả năng
        tổng quát hóa sang payload chưa từng thấy.
    (B) Tập holdout viết tay riêng (ml/holdout.py) – kiểm tra độc lập cuối cùng.

Chạy:  python -m ml.train
"""
import os

from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
import joblib

from . import generate_data, holdout


def build_pipeline() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(
            analyzer="char_wb",       # n-gram ký tự, có biên từ
            ngram_range=(1, 3),
            min_df=2,
            lowercase=True,
            sublinear_tf=True,
        )),
        ("clf", LogisticRegression(
            max_iter=2000,
            class_weight="balanced",  # dữ liệu lệch (nhiều benign hơn)
            C=4.0,
        )),
    ])


def _report(title, y_true, y_pred, note=""):
    print(f"\n── {title} ──")
    if note:
        print(f"   {note}")
    print(classification_report(
        y_true, y_pred, target_names=["Bình thường", "Tấn công"],
        digits=4, zero_division=0))
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    print(f"   Đúng-bình thường (TN): {tn}")
    print(f"   BÁO NHẦM         (FP): {fp}   <- chặn nhầm người dùng thật")
    print(f"   BỎ SÓT           (FN): {fn}   <- tấn công lọt qua")
    print(f"   Bắt đúng tấn công(TP): {tp}")
    return tn, fp, fn, tp


def main():
    print("1) Chia payload rời nhau giữa train và test (grouped split)...")
    pools_tr, pools_te, writing_tr, writing_te = generate_data.split_pools(test_ratio=0.3)
    n_tr_payload = sum(len(i) for _, i in pools_tr)
    n_te_payload = sum(len(i) for _, i in pools_te)
    print(f"   payload huấn luyện: {n_tr_payload} | payload kiểm tra (chưa từng thấy): {n_te_payload}")

    train_rows = generate_data.build_from(pools_tr, writing_tr,
                                          n_per_family=200, n_benign=1800, seed=1)
    test_rows = generate_data.build_from(pools_te, writing_te,
                                         n_per_family=80, n_benign=700, seed=2)
    X_tr = [t for t, _ in train_rows]; y_tr = [l for _, l in train_rows]
    X_te = [t for t, _ in test_rows];  y_te = [l for _, l in test_rows]
    print(f"   mẫu train: {len(X_tr)} (tấn công {sum(y_tr)}) | "
          f"mẫu test: {len(X_te)} (tấn công {sum(y_te)})")

    print("\n2) Huấn luyện TF-IDF + Logistic Regression...")
    pipe = build_pipeline()
    pipe.fit(X_tr, y_tr)

    _report("(A) Tập kiểm tra – payload CHƯA TỪNG THẤY",
            y_te, pipe.predict(X_te),
            "Payload ở đây không nằm trong tập huấn luyện, nên con số này phản ánh "
            "khả năng tổng quát hóa thật.")

    Xh, yh = holdout.as_xy()
    _report("(B) Tập holdout viết tay – kiểm tra độc lập",
            yh, pipe.predict(Xh),
            "Gồm payload biến thể mới và câu tiếng Anh chứa từ khóa nhạy cảm "
            "(select/table/union/drop...).")

    # Liệt kê các mẫu holdout bị sai để phân tích trong báo cáo
    probs = pipe.predict_proba(Xh)[:, 1]
    wrong = [(Xh[i], yh[i], probs[i]) for i in range(len(Xh))
             if (probs[i] >= 0.5) != bool(yh[i])]
    if wrong:
        print("\n   Các mẫu holdout mô hình còn sai:")
        for text, label, p in wrong:
            kind = "BỎ SÓT" if label == 1 else "BÁO NHẦM"
            print(f"     [{kind}] p={p:.2f}  {text[:88].replace(chr(10), ' | ')}")
    else:
        print("\n   Mô hình đúng toàn bộ tập holdout.")

    out = os.path.join(os.path.dirname(__file__), "model.joblib")
    joblib.dump(pipe, out)
    print(f"\n3) Đã lưu mô hình -> {out}")
    print("   Lưu ý: lớp ML chỉ là 1 trong 3 lớp. Lớp luật vẫn chặn các mẫu rõ ràng,")
    print("   nên tấn công mà ML bỏ sót vẫn có thể bị luật hoặc lớp hành vi bắt lại.")


if __name__ == "__main__":
    main()

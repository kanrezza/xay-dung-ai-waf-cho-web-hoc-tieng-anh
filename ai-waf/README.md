# AI WAF cho EngPro

Tường lửa ứng dụng web (Web Application Firewall) tích hợp học máy, đặt trước hệ
thống học tiếng Anh trực tuyến **EngPro** để chặn tấn công web mà không phải sửa
mã nguồn của EngPro.

```
Trình duyệt / Kẻ tấn công ──►  AI WAF (:8000)  ──►  EngPro (:8080)
                                   │
                                   ├─ Lớp 1  Luật & chữ ký (regex): SQLi, XSS, Path Traversal, Cmd Injection, scanner
                                   ├─ Lớp 2  Học máy (TF-IDF n-gram ký tự + Logistic Regression): bắt biến thể né luật
                                   ├─ Lớp 3  Hành vi bất thường: dò mật khẩu, quét/DoS tầng ứng dụng
                                   └─ Ghi log (SQLite) + Dashboard giám sát thời gian thực
```

WAF là một **reverse proxy** riêng viết bằng Python: mọi request đi vào cổng 8000,
được ba lớp kiểm tra; sạch thì chuyển tiếp sang EngPro (8080), độc hại thì trả 403
và ghi log. Vì tách rời nên chứng minh được WAF bảo vệ web mà không đụng vào code web.

## Vì sao dùng học máy chứ không chỉ dùng luật?

- **Luật (regex)** chắc chắn và nhanh, nhưng dễ bị né bằng biến thể như
  `UnIoN/**/SeLeCt`, `%3Cscript%3E`, đổi hoa thường… Lớp học máy học theo **n-gram
  ký tự** nên tổng quát hơn, bắt được nhiều biến thể mà luật bỏ sót.
- **Chống báo nhầm (false positive).** EngPro có bài Writing và hỏi đáp bằng tiếng
  Anh tự do. Câu như *"students should **select** courses and **order** their study
  plan"* chứa từ khóa SQL nhưng hoàn toàn bình thường. Mô hình được huấn luyện với
  chính loại câu này để **không chặn nhầm** học viên — đây là điểm nhấn của đề tài.

## Hai mục tiêu được bảo vệ (cách đánh giá WAF cho đúng)

Không tự tạo lỗ hổng trong EngPro để rồi tự chặn — đó là lập luận vòng tròn và
làm yếu báo cáo. Thay vào đó, đặt WAF trước **hai mục tiêu** và đo mỗi thứ một vế:

```
                        ┌─►  EngPro (:8080)   → đo BÁO NHẦM trên lưu lượng thật
   AI WAF (2 tiến trình)┤
                        └─►  DVWA  (:4280)    → đo CHẶN được KHAI THÁC THẬT
        WAF cho EngPro ở cổng 8000  ·  WAF cho DVWA ở cổng 8001
```

- **DVWA** (Damn Vulnerable Web Application) là bia tập chuẩn, cố tình có lỗ hổng,
  được dùng trong nhiều nghiên cứu WAF. Trên DVWA ta chứng minh được **khai thác
  thành công thật** (SQLi lấy được danh sách người dùng, XSS phản chiếu chạy được),
  rồi cho thấy WAF chặn đứng chúng.
- **EngPro** dùng truy vấn tham số hóa nên vốn đã an toàn trước SQLi. Vai trò của
  nó trong đánh giá là chứng minh WAF **không làm phiền người dùng thật**.

## Yêu cầu

- Python 3.11+ (đã kiểm thử với 3.11 và 3.14)
- EngPro đang chạy ở `http://127.0.0.1:8080`, với `TRUST_PROXY=1` trong `.env` của
  EngPro (xem mục *Tự đánh giá an toàn* bên dưới)
- Docker (cho DVWA) — tùy chọn, chỉ cần khi demo khai thác thật

## Cài đặt & chạy

```bash
cd ai-waf
cp .env.example .env    # rồi đặt WAF_ADMIN_PASSWORD (mật khẩu dashboard)
./run.sh                # lần đầu tự tạo venv, cài thư viện, huấn luyện mô hình rồi chạy WAF
```

Hoặc làm thủ công từng bước:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m ml.train      # huấn luyện, in precision/recall/F1
python -m app           # chạy WAF
```

> **Luôn chạy bằng `python -m app`, đừng chạy `uvicorn app.main:app` trần.**
> Mặc định uvicorn tin header `X-Forwarded-For` từ `127.0.0.1` và tự đổi IP người
> gửi theo header đó, nên kẻ tấn công trên cùng máy giả được IP để né khóa dò mật
> khẩu. `python -m app` tắt hành vi này (xem `app/__main__.py`).

Sau đó:
- Truy cập EngPro **qua WAF**: <http://127.0.0.1:8000>
- Bảng giám sát: <http://127.0.0.1:8000/waf/dashboard> — trình duyệt sẽ hỏi tài
  khoản: `admin` và mật khẩu `WAF_ADMIN_PASSWORD`. Chưa đặt mật khẩu thì WAF tự
  sinh một mật khẩu tạm mỗi lần chạy và in ra cửa sổ dòng lệnh.

## Kết quả đo được

Số liệu dưới đây lấy từ lần chạy thật trên máy, không phải ước lượng.

### Khai thác thật trên DVWA (`python -m tests.demo_dvwa`)

Đây là số liệu thuyết phục nhất: đo *khai thác có thành công không*, không chỉ
xem mã HTTP.

| Lỗ hổng | Gửi thẳng DVWA | Qua AI WAF |
|---|---|---|
| SQL Injection `' OR '1'='1` | ⚠️ lấy trộm **5 bản ghi** người dùng | 🛡️ chặn (403) |
| XSS phản chiếu `<script>` | ⚠️ payload **phản chiếu, chạy được** | 🛡️ chặn (403) |
| **Khai thác thành công** | **2/2** | **0/2** |

### Hiệu quả trên EngPro (`python -m tests.demo_attack`)

| | Qua WAF | Gửi thẳng EngPro |
|---|---|---|
| Tấn công bị chặn | **13/13** | 0/13 |
| Báo nhầm lưu lượng bình thường | **0/10** | 0/10 |

> Trên EngPro, "0/13 chặn khi gửi thẳng" nghĩa là request *tới được* server
> (HTTP 200), không phải khai thác thành công — EngPro dùng truy vấn tham số hóa
> nên SQLi không lấy được dữ liệu. Vế "khai thác thật bị chặn" đo trên DVWA ở trên.

### Riêng mô hình học máy (`python -m ml.train`)

Payload trong tập kiểm tra **không nằm** trong tập huấn luyện (grouped split):

| | Precision | Recall | F1 | Báo nhầm |
|---|---|---|---|---|
| Tập kiểm tra (payload lạ) | 1.000 | 0.905 | **0.950** | 0 |
| Tập holdout viết tay | 1.000 | 0.947 | **0.973** | 0 |

### So với ModSecurity + OWASP CRS (`python -m tests.compare_modsec`)

ModSecurity với bộ luật OWASP CRS là WAF mã nguồn mở chuẩn công nghiệp. Đặt nó
đứng trước chính EngPro ở hai mức độ gắt (Paranoia Level), rồi chạy **cùng một bộ
test** qua cả ba: 20 tấn công và 19 request bình thường (nhiều câu tiếng Anh tự
do chứa từ khóa trông giống tấn công).

| WAF | Phát hiện tấn công | Báo nhầm tiếng Anh | Độ trễ p50 |
|---|---|---|---|
| **AI WAF (đồ án)** | **20/20 (100%)** | **0/19 (0%)** | 1.1 ms |
| ModSecurity PL1 (mặc định) | 19/20 (95%) | 1/19 (5%) | 1.9 ms |
| ModSecurity PL2 (gắt hơn) | 20/20 (100%) | **6/19 (32%)** | 1.8 ms |

Đây là đánh đổi kinh điển của WAF, và là lý do đề tài gắn với *web học tiếng Anh*:

- **ModSecurity PL1** (mức mặc định) vừa bỏ sót một biến thể SQLi (`admin'#`), vừa
  đã bắt đầu báo nhầm (chặn câu có công thức `=SUM(A1:A10)`).
- **ModSecurity PL2** (mức gắt) bắt đủ 20 tấn công, nhưng **chặn nhầm 6/19 câu
  tiếng Anh bình thường** — gồm *"In SQL we write SELECT name FROM students..."*,
  *"select Save As from the menu"*, *"whether 1=1 is always true"*. Với học viên
  nộp bài Writing, đây là mức báo nhầm không dùng được.
- **AI WAF** đạt 100% phát hiện và 0% báo nhầm trên bộ test này, nhờ lớp học máy
  hiểu được ngữ cảnh câu tiếng Anh thay vì chỉ khớp từ khóa.

> **Giới hạn cần nói thẳng trong báo cáo.** Bộ test gồm 20 tấn công và 19 request
> bình thường, phản ánh lưu lượng thật của EngPro chứ không phải mọi kiểu tấn
> công. ModSecurity CRS có hàng nghìn luật và trên một bộ né tránh rộng hơn sẽ
> bắt được nhiều đòn mà AI WAF bỏ sót. Kết luận đúng là: *trên lưu lượng đặc thù
> của web học tiếng Anh, AI WAF đạt mức phát hiện ngang ModSecurity nhưng báo nhầm
> ít hơn hẳn*, chứ không phải "AI WAF tốt hơn ModSecurity ở mọi mặt".

Dựng ModSecurity để chạy lại: `./modsec.sh up` (cần Docker), rồi
`python -m tests.compare_modsec`, xong thì `./modsec.sh down`.

### Vì sao cần cả luật lẫn học máy (`python -m tests.compare_layers`)

Chạy 17 payload biến thể qua từng lớp riêng:

| Nhóm | Số lượng | Ý nghĩa |
|---|---|---|
| Cả hai lớp bắt | 12 | Tấn công rõ ràng |
| **Chỉ luật bắt** | 3 | ML bỏ sót, regex cứu |
| **Chỉ ML bắt** | 2 | Regex bỏ sót, ML cứu ← giá trị của AI |
| Cả hai bỏ sót | 0 | |

Hai trường hợp chỉ ML bắt được: XSS qua thẻ `<details ontoggle=>` và
`<marquee onstart=>` — các thẻ/sự kiện hiếm mà luật chưa liệt kê. Đây là bằng
chứng bằng số cho câu hỏi "đã có regex rồi thì cần học máy làm gì?".

### WAF làm web chậm đi bao nhiêu (`python -m tests.bench_latency`)

Đo trên Apple M2, 8 lõi, 16 GB RAM. Mỗi kịch bản 1000 lần, gửi xen kẽ thẳng
EngPro và qua WAF, giữ kết nối như trình duyệt.

| Kịch bản | Thẳng EngPro (p50) | Qua WAF (p50) | Thêm p50 | Thêm p95 | Thêm p99 |
|---|---|---|---|---|---|
| GET API nhỏ (105 B) | 3.67 ms | 6.33 ms | **+2.66 ms** | +3.48 ms | +4.40 ms |
| GET danh sách khóa học (3 KB) | 3.30 ms | 5.68 ms | **+2.38 ms** | +2.53 ms | +2.99 ms |
| GET file tĩnh JS (96 KB) | 2.36 ms | 3.62 ms | **+1.27 ms** | +1.51 ms | +1.72 ms |
| POST bài Writing (~1.5 KB) | 0.47 ms | 2.64 ms | **+2.18 ms** | +2.48 ms | +2.72 ms |

**WAF thêm khoảng 1–3 ms mỗi request.** Để so sánh: độ trễ mạng thật từ người
dùng tới máy chủ thường 20–100 ms, và người dùng chỉ cảm nhận được chậm khi vượt
khoảng 100 ms. Mức tăng này không nhận ra được khi dùng web.

Thời gian từng thành phần bên trong WAF (đo trực tiếp, không qua mạng):

| Thành phần | GET ngắn | Bài Writing 1.5 KB |
|---|---|---|
| Trích & giải mã đặc trưng | 0.002 ms | 0.002 ms |
| Lớp 1 – luật regex (29 luật) | 0.023 ms | 0.349 ms |
| Lớp 2 – mô hình ML | 0.153 ms | 0.738 ms |
| Ghi log SQLite | 0.063 ms | 0.049 ms |
| **Tổng phần kiểm tra** | **0.24 ms** | **1.14 ms** |

Điều đáng chú ý: với request GET, phần kiểm tra (gồm cả AI) chỉ tốn 0.24 ms trong
tổng 2.4–2.7 ms tăng thêm. **Khoảng 90% độ trễ đến từ việc chuyển tiếp** (thêm một
chặng HTTP qua Python), không phải từ AI. Mô hình ML là thành phần tốn nhất trong
phần kiểm tra và tăng theo độ dài văn bản (0.15 ms → 0.74 ms).

**Khi nhiều người truy cập cùng lúc** (20 kết nối đồng thời, `/api/courses`), WAF
giữ được khoảng **70–80% thông lượng** so với gửi thẳng (đo nhiều lần dao động
trong khoảng này). Nguyên nhân: WAF chạy một tiến trình duy nhất và phần kiểm tra
(regex, ML, ghi log) chạy tuần tự, nên request phải xếp hàng. Muốn tăng thì chạy
nhiều tiến trình WAF, nhưng khi đó bộ đếm của lớp hành vi (đang để trong bộ nhớ)
phải chuyển sang nơi dùng chung như Redis – xem *Hướng phát triển*.

## Demo "trước và sau khi có WAF"

Mở dashboard rồi chạy kịch bản tấn công:

```bash
source .venv/bin/activate
python -m tests.demo_attack --direct    # gửi THẲNG EngPro (không WAF) – tấn công lọt hết
python -m tests.demo_attack             # gửi QUA WAF – bị chặn, dashboard hiện log
python -m tests.compare_layers          # so sánh lớp luật với lớp học máy
```

Kịch bản gồm SQLi, XSS, Path Traversal, Command Injection, biến thể né luật và
User-Agent của sqlmap/Nikto; kèm request bình thường (bài Writing chứa từ khóa
nhạy cảm, câu True/False, client dùng curl/Postman) để chứng minh WAF
**không chặn nhầm**.

### Demo khai thác thật trên DVWA

```bash
./dvwa.sh up                            # dựng DVWA + MariaDB, thiết lập sẵn (cần Docker)

# bật WAF thứ hai bảo vệ DVWA (cổng 8001)
WAF_TARGET_NAME=DVWA BACKEND_URL=http://127.0.0.1:4280 WAF_PORT=8001 \
  .venv/bin/python -m app &

python -m tests.demo_dvwa --direct      # THẲNG DVWA – SQLi/XSS khai thác thành công
python -m tests.demo_dvwa               # QUA WAF – bị chặn, không lấy được gì
./dvwa.sh down                          # dọn khi xong
```

Đây là phần trực quan nhất để quay video: mở `http://127.0.0.1:4280/vulnerabilities/sqli/`
(đăng nhập `admin`/`password`), nhập `' OR '1'='1` vào ô ID — thấy toàn bộ danh
sách người dùng đổ ra. Rồi thử lại qua `http://127.0.0.1:8001/...` — bị WAF chặn.

### Demo dò mật khẩu (lớp hành vi)

Gửi đăng nhập sai liên tiếp vào `/api/auth/login`. Kết quả thực tế:

```
lần 1-5  → 401  EngPro từ chối
lần 6-8  → 429  EngPro tự giới hạn
lần 9+   → 403  WAF chặn ngay tại cửa, request không còn tới EngPro
```

Lúc này **chính máy đang demo bị khóa đăng nhập 1 phút** (WAF chặn theo IP).
Bấm nút **"Gỡ chặn IP"** trên dashboard để trình bày tiếp ngay, không phải chờ.
Duyệt web bình thường vẫn hoạt động, chỉ riêng endpoint đăng nhập bị khóa.

> Sau khi gỡ chặn ở WAF, EngPro có thể vẫn trả 429 do cơ chế giới hạn riêng của
> nó (`server.js`). Đó là hai lớp bảo vệ độc lập, không phải lỗi.

## Bật/tắt từng lớp (phục vụ so sánh trong báo cáo)

Đặt biến môi trường trước khi chạy:

| Biến | Ý nghĩa |
|---|---|
| `WAF_ENABLE_RULES=0` | Tắt lớp luật (chỉ còn ML) – cho thấy ML bắt được gì |
| `WAF_ENABLE_ML=0` | Tắt lớp ML (chỉ còn luật) – cho thấy luật bỏ sót biến thể |
| `WAF_DETECTION_ONLY=1` | Chỉ ghi log, không chặn – đo tỉ lệ báo nhầm an toàn |
| `ML_THRESHOLD=0.7` | Hạ ngưỡng ML: bắt nhiều hơn nhưng dễ báo nhầm hơn |

Ví dụ chỉ chạy ML để so sánh:

```bash
WAF_ENABLE_RULES=0 python -m app
```

## Tự đánh giá an toàn của chính WAF

Một WAF có lỗ hổng thì còn nguy hiểm hơn không có WAF, vì nó tạo cảm giác an
toàn giả. Rà lại thiết kế ban đầu, tìm được ba lỗ hổng thật và đã vá:

| # | Lỗ hổng | Cách tấn công | Cách vá |
|---|---|---|---|
| 1 | **Giả mạo IP** | Gửi `X-Forwarded-For` khác nhau mỗi lần thử mật khẩu, WAF tưởng là nhiều người nên không bao giờ khóa | Chỉ tin header này từ proxy khai báo trong `WAF_TRUSTED_PROXIES`; tắt `proxy_headers` của uvicorn; xóa các header chuyển tiếp do client tự gửi trước khi đẩy sang backend |
| 2 | **Dashboard không mật khẩu** | Ai vào được cổng 8000 cũng xóa được log (xóa dấu vết) hoặc tự gỡ chặn cho mình | HTTP Basic Auth, so mật khẩu bằng `compare_digest`; sai 5 lần khóa IP 5 phút; thao tác ghi cần thêm header `X-WAF-Admin` để chặn CSRF |
| 3 | **Đi vòng qua WAF** | EngPro nghe ở `0.0.0.0:8080`, gọi thẳng cổng 8080 là bỏ qua WAF hoàn toàn | Bật `TRUST_PROXY=1` thì EngPro chỉ nhận kết nối từ `127.0.0.1`; DVWA cũng chỉ mở ở `127.0.0.1` |

Kiểm chứng trên hệ thống thật sau khi vá:

```
Giả IP, 12 lần mỗi lần một X-Forwarded-For khác → vẫn bị khóa từ lần 10 (403)
Dashboard: không mật khẩu 401 · sai mật khẩu 401 · đúng mật khẩu 200
Xóa log có mật khẩu nhưng thiếu header chống CSRF → 403
Gọi thẳng EngPro qua IP mạng LAN, cổng 8080 → bị từ chối kết nối
```

Khi kiểm thử còn bắt thêm một lỗi chuyển tiếp: WAF gửi sang backend đường dẫn
đã giải mã, nên `/api/courses%3Fx=1` bị biến thành query `x=1` — backend nhận
khác với thứ WAF vừa kiểm tra. Nay WAF gửi nguyên đường dẫn gốc client gửi.

Mỗi lỗ hổng có một bài kiểm thử riêng, vô tình mở lại là báo FAIL ngay. Không cần
EngPro hay DVWA, chạy mất vài giây:

```bash
python -m tests.test_security      # 9/9 bài đạt
```

## Cấu trúc thư mục

```
ai-waf/
├── app/                # WAF (reverse proxy + 3 lớp)
│   ├── __main__.py     #   điểm khởi động: python -m app (tắt tin X-Forwarded-For)
│   ├── main.py         #   proxy FastAPI + API dashboard (có mật khẩu)
│   ├── waf.py          #   điều phối 3 lớp, ra quyết định
│   ├── rules.py        #   Lớp 1: luật/chữ ký (regex)
│   ├── model.py        #   Lớp 2: nạp & chấm điểm mô hình ML
│   ├── anomaly.py      #   Lớp 3: tần suất/hành vi
│   ├── features.py     #   trích & giải mã đặc trưng từ request
│   ├── logstore.py     #   ghi log SQLite cho dashboard
│   └── config.py       #   cấu hình
├── ml/
│   ├── payloads.py     #   kho payload tấn công + câu tiếng Anh bình thường
│   ├── generate_data.py#   sinh dataset (chia payload rời nhau train/test)
│   ├── holdout.py      #   tập kiểm tra độc lập, viết tay, không dùng để train
│   └── train.py        #   huấn luyện TF-IDF + Logistic Regression
├── static/dashboard.html    # bảng giám sát (Chart.js), hiển thị cả EngPro và DVWA
├── tests/
│   ├── demo_attack.py       # demo trên EngPro: chặn tấn công, không báo nhầm
│   ├── demo_dvwa.py         # demo trên DVWA: đo khai thác thật bị chặn
│   ├── compare_layers.py    # so sánh lớp luật với lớp học máy
│   ├── bench_latency.py     # đo độ trễ và thông lượng WAF thêm vào
│   ├── compare_modsec.py    # so sánh với ModSecurity + OWASP CRS
│   └── test_security.py     # kiểm thử an toàn của chính WAF (9 bài)
├── dvwa.sh                  # dựng/xóa bia tập DVWA bằng Docker
├── modsec.sh                # dựng/xóa ModSecurity CRS để so sánh
└── run.sh
```

## Ba bài học kỹ thuật khi xây dựng (nên đưa vào báo cáo)

Ba lỗi dưới đây đều đã xảy ra thật trong quá trình làm và đã sửa. Kể lại chúng
làm báo cáo thuyết phục hơn nhiều so với chỉ khoe kết quả đẹp.

**1. Độ chính xác 100% là dấu hiệu xấu.** Lần huấn luyện đầu đạt F1 = 1.000 vì
tập kiểm tra được sinh từ chính kho payload của tập huấn luyện – mô hình chỉ cần
học thuộc. Sửa bằng cách chia payload rời nhau (`split_pools`), F1 tụt về 0.95 –
và đó mới là con số thật.

**2. Dữ liệu huấn luyện phải đi qua đúng hàm trích đặc trưng lúc chạy.** Ban đầu
bộ sinh dữ liệu tự ghép chuỗi theo một định dạng, còn WAF lúc chạy lại ghép theo
định dạng khác (thiếu ô header). Mô hình học một đằng, bị hỏi một nẻo. Nay
`generate_data.py` gọi thẳng `app.features.build_ml_text` nên không thể lệch.

**3. Dữ liệu lệch sinh ra báo nhầm hàng loạt.** Vì chỉ mẫu tấn công mới có
User-Agent, mô hình học thành "có User-Agent lạ = công cụ quét" và **chặn luôn
trang chủ** (`Mozilla/5.0 (demo)` bị chấm 0.93). Sửa bằng cách bỏ header khỏi
đầu vào của ML và giao hẳn việc nhận diện scanner cho lớp luật – danh sách công
cụ quét là hữu hạn nên regex đúng gần như tuyệt đối. Sau khi sửa, F1 tăng từ
0.932 lên 0.950 và báo nhầm về 0.

## Lưu ý đạo đức & phạm vi

Chỉ tấn công thử nghiệm trên EngPro của chính mình ở `localhost`, phục vụ học tập
môn An toàn và Bảo mật thông tin. Không dùng để tấn công hệ thống của người khác.

## Hướng phát triển thêm (nếu còn thời gian)

- So sánh với **ModSecurity + OWASP CRS** làm mốc đối chứng (tỉ lệ phát hiện, báo
  nhầm, độ trễ).
- Huấn luyện trên bộ **CSIC 2010 HTTP dataset** thay vì dữ liệu tự sinh.
- Thêm lớp chống **prompt injection** cho các endpoint AI (chấm Writing, hỏi đáp).
- Thử mô hình sâu hơn (CNN/LSTM ký tự) và vẽ đường cong ROC.
- Chạy nhiều tiến trình WAF để tăng thông lượng, chuyển bộ đếm của lớp hành vi
  sang Redis để các tiến trình dùng chung.

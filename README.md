# EngPro – Hệ thống học tiếng Anh trực tuyến tích hợp AI hỗ trợ học tập

EngPro là website học và luyện thi ba chứng chỉ IELTS, TOEFL và TOEIC. Học viên học theo lộ trình band điểm với video bài giảng, tài liệu và bài kiểm tra sau mỗi bài. Ngoài ra còn có bài test xếp loại đầu vào, test thử và kho luyện đề. Hệ thống phục vụ ba vai trò là học viên, giảng viên và quản trị viên. Trợ lý AI dùng Google Gemini để giải thích câu làm sai, chấm bài viết, nhận xét quá trình học và trả lời câu hỏi ngay trong bài giảng.

## Tính năng chính

**Học viên**
- Đăng ký khóa học, thanh toán chuyển khoản hoặc VNPay, theo dõi tiến độ ở trang Học tập của tôi.
- Học video bài giảng. Hệ thống ghi lại các đoạn đã xem, phải xem đủ mới mở được bài kiểm tra. Có hạn nộp theo tuần.
- Làm bài kiểm tra, test thử, luyện đề với ba dạng câu: trắc nghiệm, True/False/Not Given và điền từ. Có phần nghe (audio) và phần đọc (bài đọc).
- Xem kết quả học tập, tỉ lệ đúng theo kỹ năng và dạng câu, xem lại từng bài đã làm.
- Hỏi đáp dưới bài giảng với giảng viên, đánh giá khóa học, nhắn tin cho trung tâm và xem câu trả lời ngay trên web.
- Cài đặt tài khoản: đổi mật khẩu, xác thực hai lớp, xác nhận email, ngôn ngữ nhận xét của AI.

**Trợ lý AI (Google Gemini)**
- Giải thích vì sao làm sai một câu, trích căn cứ trong bài đọc hoặc lời thoại.
- Trợ lý học tập: nhận xét quá trình học, chỉ ra điểm mạnh, điểm yếu và kế hoạch 7 ngày.
- Chấm bài Writing theo tiêu chí của IELTS, TOEFL, TOEIC, sửa lỗi và viết đoạn mẫu. Kèm kiểm tra trùng lặp với các bài khác trong hệ thống và dấu hiệu dùng AI (chỉ để tham khảo). Học viên được tự nhập đề riêng.
- Hỏi đáp trong bài giảng dựa trên tài liệu của giảng viên. Không đưa đáp án bài kiểm tra, không viết hộ bài.
- Giảng viên dùng AI để soạn nháp câu hỏi từ bài đọc hoặc lời thoại.

**Giảng viên**
- Soạn khóa học, bài giảng, tải video và tài liệu, rồi gửi admin duyệt.
- Soạn bài kiểm tra, nhập nhiều câu hỏi cùng lúc từ văn bản hoặc Excel, xem thống kê từng câu.
- Theo dõi học viên, nhận xét, trả lời hỏi đáp, xác nhận học viên hoàn thành khóa học.

**Quản trị viên**
- Duyệt khóa học và đăng ký học, quản lý giảng viên, học viên, danh mục, test thử và luyện đề.
- Thống kê doanh thu, học viên và số lượt dùng AI. Quản lý đề Writing và danh sách bài viết cần xem lại.
- Trả lời tin nhắn liên hệ ngay trên web.

## Công nghệ

- Node.js 20.12 trở lên, Express
- PostgreSQL (thư viện `pg`), phiên đăng nhập lưu trong cơ sở dữ liệu (`connect-pg-simple`)
- Google Gemini qua thư viện `@google/genai`
- Gửi email bằng `nodemailer` (Gmail SMTP)
- `bcrypt`, `otpauth`, `multer`, `xlsx`, `mammoth`, `pdf-parse`, `compression`
- Giao diện: HTML, Tailwind CSS, JavaScript thuần

## Cài đặt và chạy

### 1. Cài thư viện

```bash
npm install
```

### 2. Chuẩn bị PostgreSQL

Có thể dùng PostgreSQL cài trên máy hoặc chạy bằng Docker:

```bash
docker run -d --name engpro-postgres -e POSTGRES_PASSWORD=matkhau -e POSTGRES_DB=engpro -p 127.0.0.1:5433:5432 -v engpro-pgdata:/var/lib/postgresql/data postgres:16
```

Tạo bảng và dữ liệu mẫu từ tệp `db/engpro.sql`. Tệp này chạy lại nhiều lần vẫn an toàn và cũng dùng để nâng cấp cơ sở dữ liệu cũ lên phiên bản mới.

```bash
docker exec -i engpro-postgres psql -U postgres -d engpro < db/engpro.sql
```

### 3. Cấu hình

Sao chép `.env.example` thành `.env` rồi điền giá trị. Các biến quan trọng:

| Biến | Ý nghĩa |
|------|---------|
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Kết nối PostgreSQL. Khi triển khai thì dùng `DATABASE_URL` |
| `SESSION_SECRET` | Khóa ký phiên đăng nhập, bắt buộc khi chạy thật |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Bật trợ lý AI. Tạo khóa miễn phí tại https://aistudio.google.com/apikey |
| `AI_LIMIT_*`, `AI_DAILY_TOTAL` | Số lượt AI mỗi học viên mỗi ngày và trần của cả hệ thống |
| `SMTP_USER`, `SMTP_PASS` | Gửi email thật qua Gmail bằng mật khẩu ứng dụng |
| `MAIL_REDIRECT_TO` | Khi phát triển, dồn mọi email về một hộp thư thử. Xóa khi chạy thật |
| `VNP_TMN_CODE`, `VNP_HASH_SECRET` | Thanh toán VNPay sandbox |

Không cấu hình Gemini thì các nút AI tự ẩn. Không cấu hình SMTP thì email chỉ in ra cửa sổ chạy server. Muốn chạy thử AI mà không cần khóa, đặt `AI_PROVIDER=mock`.

### 4. Chạy

```bash
npm run dev
```

Mở http://localhost:8080. Lệnh `npm start` dùng khi triển khai.

### Tài khoản mẫu

Dữ liệu mẫu có ba tài khoản, cùng mật khẩu `123456`: quản trị viên `admin@gmail.com`, giảng viên `hoang@gmail.com`, học viên `danh@gmail.com`. Các địa chỉ này chỉ dùng để đăng nhập thử. Đừng dùng chúng để thử tính năng gửi email.

## Cấu trúc thư mục

```
server.js        Máy chủ Express, toàn bộ API
db.js            Kết nối PostgreSQL
ai.js            Gọi Gemini: đổi model dự phòng khi quá tải, hàng đợi, xoay vòng khóa
mailer.js        Các mẫu email
vnpay.js         Tạo và kiểm tra liên kết thanh toán VNPay
data/            Ngân hàng câu hỏi test xếp loại
db/engpro.sql    Cấu trúc cơ sở dữ liệu và dữ liệu mẫu
index.html       Trang chủ
pages/           Các trang giao diện
js/              Mã JavaScript dùng chung cho nhiều trang
uploads/         Video, tài liệu, ảnh đại diện tải lên (không đưa lên GitHub)
```

## Bảo mật

- Mật khẩu băm bằng bcrypt, có xác thực hai lớp, giới hạn đăng nhập sai và đá phiên khi đổi mật khẩu.
- Video, tài liệu và CV chỉ tải được qua API có kiểm tra quyền.
- Mọi nội dung người dùng nhập đều được thoát ký tự trước khi hiển thị để chống chèn mã.
- Nội dung AI trả về được máy chủ kiểm tra lại từng trường trước khi lưu và hiển thị.
- Tệp `.env` chứa khóa bí mật đã nằm trong `.gitignore`, không đưa lên GitHub.

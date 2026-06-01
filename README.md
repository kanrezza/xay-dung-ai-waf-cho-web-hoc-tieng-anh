# EngPro – Hệ thống học và luyện thi chứng chỉ tiếng Anh trực tuyến

Website học và luyện thi ba chứng chỉ IELTS, TOEFL, TOEIC. Nội dung được tổ chức theo lộ trình band điểm, gắn kết bài giảng với bài kiểm tra, kèm bài test xếp loại đầu vào, bài test thử và kho luyện đề. Hệ thống phục vụ ba vai trò: học viên, giảng viên và quản trị viên.

## Công nghệ sử dụng

- **Backend:** Node.js, Express
- **Cơ sở dữ liệu:** MySQL 8.0+
- **Xác thực:** bcrypt, express-session
- **Tải tệp:** multer
- **Nhập câu hỏi từ Excel:** xlsx
- **Giao diện:** HTML, Tailwind CSS, JavaScript (Fetch API)

## Yêu cầu môi trường

- Node.js phiên bản 18 trở lên
- MySQL 8.0 trở lên

## Hướng dẫn cài đặt và chạy

### 1. Cài đặt thư viện

```bash
npm install
```

### 2. Tạo cơ sở dữ liệu

Import tệp `db/engpro.sql` vào MySQL. Tệp này tạo sẵn cơ sở dữ liệu `engpro`, toàn bộ bảng và một số dữ liệu mẫu.

```bash
mysql -u root -p < db/engpro.sql
```

### 3. Cấu hình kết nối

Hệ thống đọc thông tin kết nối từ các biến môi trường, nếu không có thì dùng giá trị mặc định cho MySQL trên máy. Bạn có thể đặt các biến sau khi cần:

| Biến | Ý nghĩa | Mặc định |
|------|---------|----------|
| `MYSQLHOST` | Địa chỉ máy chủ MySQL | `127.0.0.1` |
| `MYSQLPORT` | Cổng MySQL | `3306` |
| `MYSQLUSER` | Tên đăng nhập MySQL | `root` |
| `MYSQLPASSWORD` | Mật khẩu MySQL |  |
| `MYSQLDATABASE` | Tên cơ sở dữ liệu | `engpro` |
| `PORT` | Cổng chạy ứng dụng | `8080` |

Nếu muốn kết nối tới một cơ sở dữ liệu từ xa thay cho MySQL trên máy, ví dụ cơ sở dữ liệu đặt trên Railway, bạn tạo một tệp tên `.env` ở thư mục gốc của dự án và khai báo các biến ở trên trong đó. Tệp `.env` đã được Git bỏ qua nên thông tin kết nối không bị đẩy lên kho mã, và ứng dụng sẽ tự động đọc tệp này khi khởi động.

### 4. Chạy ứng dụng

```bash
npm start
```

Sau đó mở trình duyệt và truy cập `http://localhost:8080`.

## Tài khoản mẫu

| Vai trò | Email | Mật khẩu |
|---------|-------|----------|
| Quản trị viên | admin@gmail.com | 123456 |
| Giảng viên | hoang@gmail.com | 123456 |
| Học viên | danh@gmail.com | 123456 |

## Cấu trúc thư mục

```
project_EngPro/
├── db/
│   ├── engpro.sql      # Lược đồ cơ sở dữ liệu và dữ liệu mẫu
│   └── eer.png         # Sơ đồ thực thể liên kết
├── js/
│   └── auth-nav.js     # Xử lý trạng thái đăng nhập trên thanh điều hướng
├── pages/              # Các trang giao diện
├── uploads/            # Nơi lưu tệp tải lên (tự tạo khi chạy)
├── index.html          # Trang chủ
├── server.js           # Máy chủ Express và toàn bộ API
└── package.json
```

## Ghi chú

- Thư mục `uploads/` và `node_modules/` không được đưa lên kho mã. Thư mục `uploads/` sẽ được ứng dụng tự tạo khi có tệp tải lên.
- Không đặt mật khẩu cơ sở dữ liệu trực tiếp trong `server.js` khi đẩy mã lên kho công khai. Hãy dùng biến môi trường để bảo mật thông tin kết nối.

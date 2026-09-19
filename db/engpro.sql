-- ============================================================
--  EngPro – Database Schema (khớp với mã nguồn server.js)
--  PostgreSQL 14+  |  Encoding: UTF8
--
--  Cách tạo CSDL (chạy một lần):
--    createdb engpro
--    psql -d engpro -f db/engpro.sql
--  Trên Railway: tạo dịch vụ PostgreSQL rồi chạy file này bằng psql
--  với chuỗi kết nối DATABASE_URL của dịch vụ đó.
--
--  File chạy lại nhiều lần vẫn an toàn (IF NOT EXISTS, ON CONFLICT).
--  Mật khẩu các tài khoản mẫu là: 123456
-- ============================================================

-- Tự cập nhật cột updated_at mỗi khi sửa dòng (MySQL dùng ON UPDATE CURRENT_TIMESTAMP)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 1. USERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    email       VARCHAR(150)  NOT NULL UNIQUE,
    password    VARCHAR(255)  NOT NULL,                 -- bcrypt hash
    role        VARCHAR(10)   NOT NULL DEFAULT 'user'   CHECK (role IN ('admin','gv','user')),
    phone       VARCHAR(20)   NULL,
    specialty   VARCHAR(10)   NULL                      CHECK (specialty IN ('IELTS','TOEFL','TOEIC')), -- chỉ dùng cho GV
    avatar      VARCHAR(255)  NULL,
    cv_url      VARCHAR(255)  NULL,                      -- hồ sơ năng lực của GV
    status      VARCHAR(10)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked')),
    sound_effects       SMALLINT     NOT NULL DEFAULT 1,  -- âm thanh chúc mừng khi hoàn thành bài
    totp_enabled        SMALLINT     NOT NULL DEFAULT 0,  -- xác thực 2 lớp bằng ứng dụng Authenticator
    totp_secret         VARCHAR(64)  NULL,                -- khóa bí mật (base32) đang dùng
    totp_pending_secret VARCHAR(64)  NULL,                -- khóa đang thiết lập, chưa xác nhận
    email_verified_at   TIMESTAMPTZ  NULL,                -- lúc xác nhận email bằng mã gửi qua email
    email_reminders     SMALLINT     NOT NULL DEFAULT 1,  -- nhận email nhắc bài sắp đến hạn nộp
    session_version     INT          NOT NULL DEFAULT 0,  -- tăng lên khi đổi mật khẩu, bị khóa... để đăng xuất các phiên cũ
    bio                 TEXT         NULL,                -- giới thiệu ngắn của giảng viên, hiện ở trang chi tiết khóa học
    totp_recovery_codes TEXT         NULL,                -- mảng JSON mã dự phòng đã băm SHA-256
    deleted_at          TIMESTAMPTZ  NULL,                -- tài khoản đã xóa (thông tin cá nhân đã ẩn danh)
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 2. CATEGORIES  (danh mục chứng chỉ)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    type        VARCHAR(10)   NOT NULL CHECK (type IN ('IELTS','TOEFL','TOEIC')),
    description TEXT          NULL,
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 3. COURSES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
    id            SERIAL PRIMARY KEY,
    category_id   INT           NULL REFERENCES categories(id) ON DELETE SET NULL,
    teacher_id    INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         VARCHAR(200)  NOT NULL,
    band_from     VARCHAR(20)   NOT NULL DEFAULT '',     -- ví dụ "5.5" | "450"
    band_to       VARCHAR(20)   NOT NULL DEFAULT '',     -- ví dụ "6.5" | "600"
    level         VARCHAR(20)   NOT NULL DEFAULT 'Cơ bản' CHECK (level IN ('Cơ bản','Trung cấp','Nâng cao')),
    description   TEXT          NULL,
    objectives    TEXT          NULL,   -- mục tiêu khóa học, mỗi dòng một mục tiêu
    thumbnail     VARCHAR(500)  NULL,
    price         NUMERIC(12,0) NOT NULL DEFAULT 0,
    -- draft: GV đang soạn | pending: đã gửi, chờ admin duyệt | active: đã duyệt, học viên thấy | rejected: bị từ chối, GV sửa rồi gửi lại
    status        VARCHAR(10)   NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','active','locked','rejected')),
    reject_reason TEXT          NULL,   -- lý do admin từ chối lần gần nhất
    submitted_at  TIMESTAMPTZ   NULL,   -- lần GV gửi duyệt gần nhất
    reviewed_at   TIMESTAMPTZ   NULL,   -- lần admin duyệt hoặc từ chối gần nhất
    published_at  TIMESTAMPTZ   NULL,   -- lần đầu được duyệt
    due_weekday   SMALLINT      NULL,   -- hạn nộp bài hằng tuần: 1 = Thứ 2 … 7 = Chủ nhật (NULL = không đặt hạn)
    due_time      TIME          NULL,   -- giờ hạn nộp, giờ Việt Nam
    created_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 4. LECTURES  (video bài giảng)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lectures (
    id               SERIAL PRIMARY KEY,
    course_id        INT           NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title            VARCHAR(200)  NOT NULL,
    skill            VARCHAR(20)   NOT NULL DEFAULT 'Listening'
                     CHECK (skill IN ('Listening','Reading','Writing','Speaking','Grammar','Vocabulary')),
    video_url        VARCHAR(500)  NULL,   -- cột cũ (link YouTube), không còn dùng
    video_path       VARCHAR(255)  NULL,   -- tên file trong uploads/videos
    video_size       BIGINT        NULL,   -- dung lượng file (byte)
    video_duration   INT           NULL,   -- thời lượng video (giây)
    duration_minutes INT           NULL,
    description      TEXT          NULL,
    order_num        INT           NOT NULL DEFAULT 1,
    week_number      SMALLINT      NULL,   -- bài giảng thuộc tuần thứ mấy của lộ trình (NULL = chưa xếp tuần)
    created_at       TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 5. MATERIALS  (tài liệu đính kèm)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
    id          SERIAL PRIMARY KEY,
    course_id   INT           NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    lecture_id  INT           NULL     REFERENCES lectures(id) ON DELETE SET NULL,
    teacher_id  INT           NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    filename    VARCHAR(255)  NOT NULL,
    filepath    VARCHAR(500)  NOT NULL,
    filesize    INT           NULL,
    filetype    VARCHAR(100)  NULL,
    description VARCHAR(255)  NULL,
    text_content TEXT         NULL,   -- chữ bóc từ file (.docx, .pdf, .txt) cho trợ lý AI đọc; NULL = chưa bóc, rỗng = không đọc được
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 6. TESTS  (bài kiểm tra của khóa học, có thể gắn với 1 bài giảng)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tests (
    id               SERIAL PRIMARY KEY,
    course_id        INT           NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    lecture_id       INT           NULL     REFERENCES lectures(id) ON DELETE SET NULL,
    title            VARCHAR(200)  NOT NULL,
    duration_minutes INT           NOT NULL DEFAULT 30,    -- 0 = không giới hạn thời gian
    num_questions    INT           NOT NULL DEFAULT 20,
    pass_percent     SMALLINT      NOT NULL DEFAULT 60,
    max_attempts     SMALLINT      NOT NULL DEFAULT 0,     -- số lần làm tối đa, 0 = không giới hạn
    shuffle_questions SMALLINT     NOT NULL DEFAULT 0,     -- xáo thứ tự câu hỏi lẻ cho từng lượt làm
    shuffle_options  SMALLINT      NOT NULL DEFAULT 0,     -- xáo thứ tự đáp án trắc nghiệm
    created_at       TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 7. ADMIN_TESTS  (bài test thử & luyện đề, phân biệt bằng cột type)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_tests (
    id               SERIAL PRIMARY KEY,
    title            VARCHAR(200)  NOT NULL,
    type             VARCHAR(10)   NOT NULL CHECK (type IN ('test_thu','luyen_de')),
    category_id      INT           NULL REFERENCES categories(id) ON DELETE SET NULL,
    skill            VARCHAR(50)   NULL,
    difficulty       VARCHAR(50)   NULL,
    description      TEXT          NULL,
    duration_minutes INT           NOT NULL DEFAULT 60,    -- 0 = không giới hạn thời gian
    num_questions    INT           NOT NULL DEFAULT 30,
    pass_percent     SMALLINT      NOT NULL DEFAULT 60,
    max_attempts     SMALLINT      NOT NULL DEFAULT 0,
    shuffle_questions SMALLINT     NOT NULL DEFAULT 0,
    shuffle_options  SMALLINT      NOT NULL DEFAULT 0,
    status           VARCHAR(10)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft')), -- draft = nháp, học viên chưa thấy
    created_at       TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 8. TEST_SECTIONS  (phần nghe / phần đọc của một bài kiểm tra hoặc một đề test thử, luyện đề)
--    Một phần chứa tài liệu dùng chung (file audio hoặc đoạn văn) cho nhiều câu hỏi.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_sections (
    id             SERIAL PRIMARY KEY,
    test_id        INT           NULL REFERENCES tests(id)       ON DELETE CASCADE, -- bài kiểm tra khóa học
    admin_test_id  INT           NULL REFERENCES admin_tests(id) ON DELETE CASCADE, -- test thử / luyện đề
    type           VARCHAR(10)   NOT NULL CHECK (type IN ('listening','reading')),
    title          VARCHAR(200)  NULL,
    instructions   TEXT          NULL,     -- ví dụ "Questions 1–4: Choose the correct letter"
    audio_path     VARCHAR(255)  NULL,     -- phần nghe: tên file trong uploads/audio
    audio_size     BIGINT        NULL,
    audio_duration INT           NULL,     -- giây
    max_plays      SMALLINT      NOT NULL DEFAULT 0, -- số lần được nghe, 0 = không giới hạn
    transcript     TEXT          NULL,     -- phần nghe: lời thoại, chỉ hiện sau khi nộp bài
    passage        TEXT          NULL,     -- phần đọc: đoạn văn, các đoạn cách nhau một dòng trống
    order_num      INT           NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_sections_owner CHECK ((test_id IS NULL) <> (admin_test_id IS NULL))
);

-- ------------------------------------------------------------
-- 9. QUESTIONS  (câu hỏi của bài kiểm tra khóa học)
--    question_type: mcq = trắc nghiệm A–D | tfng = Đúng / Sai / Không có thông tin | fill = điền từ
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questions (
    id               SERIAL PRIMARY KEY,
    test_id          INT           NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    section_id       INT           NULL REFERENCES test_sections(id) ON DELETE CASCADE, -- NULL = câu hỏi lẻ
    question_type    VARCHAR(10)   NOT NULL DEFAULT 'mcq',
    question_text    TEXT          NOT NULL,
    option_a         VARCHAR(500)  NULL,
    option_b         VARCHAR(500)  NULL,
    option_c         VARCHAR(500)  NULL,
    option_d         VARCHAR(500)  NULL,
    correct_answer   VARCHAR(10)   NULL,   -- mcq: A, B, C, D | tfng: TRUE, FALSE, NOT_GIVEN
    accepted_answers TEXT          NULL,   -- fill: mảng JSON các đáp án được chấp nhận
    order_num        INT           NOT NULL DEFAULT 1
);

-- ------------------------------------------------------------
-- 10. ADMIN_QUESTIONS  (câu hỏi của test thử / luyện đề, cùng cấu trúc với QUESTIONS)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_questions (
    id               SERIAL PRIMARY KEY,
    admin_test_id    INT           NOT NULL REFERENCES admin_tests(id) ON DELETE CASCADE,
    section_id       INT           NULL REFERENCES test_sections(id) ON DELETE CASCADE,
    question_type    VARCHAR(10)   NOT NULL DEFAULT 'mcq',
    question_text    TEXT          NOT NULL,
    option_a         VARCHAR(500)  NULL,
    option_b         VARCHAR(500)  NULL,
    option_c         VARCHAR(500)  NULL,
    option_d         VARCHAR(500)  NULL,
    correct_answer   VARCHAR(10)   NULL,
    accepted_answers TEXT          NULL,
    order_num        INT           NOT NULL DEFAULT 1
);

-- ------------------------------------------------------------
-- 11. ENROLLMENTS  (đăng ký khóa học)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
    id               SERIAL PRIMARY KEY,
    user_id          INT         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    course_id        INT         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    progress_percent SMALLINT    NOT NULL DEFAULT 0,
    status           VARCHAR(10) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','active','completed','rejected','paused')),
    enrolled_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    activated_at     TIMESTAMPTZ NULL,   -- lúc admin kích hoạt; hạn nộp bài của học viên tính từ mốc này
    price            NUMERIC(12,0) NULL, -- học phí lúc đăng ký; doanh thu tính theo cột này nên đổi giá khóa học không làm đổi số liệu cũ
    CONSTRAINT uk_enrollment UNIQUE (user_id, course_id)
);

-- ------------------------------------------------------------
-- 12. LECTURE_PROGRESS  (tiến độ xem bài giảng)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lecture_progress (
    id              SERIAL PRIMARY KEY,
    user_id         INT          NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    lecture_id      INT          NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    completed       SMALLINT     NOT NULL DEFAULT 0,  -- 1 = đã xem xong bài giảng
    watched_at      TIMESTAMPTZ  NULL,
    watched_ranges  TEXT         NULL,                -- các đoạn đã xem [[giây bắt đầu, giây kết thúc], ...]
    watched_seconds INT          NOT NULL DEFAULT 0,  -- tổng số giây đã xem (không tính trùng)
    last_position   INT          NOT NULL DEFAULT 0,  -- vị trí dừng gần nhất (giây)
    last_watched_at TIMESTAMPTZ  NULL,
    CONSTRAINT uk_lp UNIQUE (user_id, lecture_id)
);

-- ------------------------------------------------------------
-- 13. TEST_RESULTS  (kết quả bài kiểm tra khóa học)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_results (
    id           SERIAL PRIMARY KEY,
    user_id      INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_id      INT           NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    score        NUMERIC(6,2)  NOT NULL,
    correct      INT           NULL,     -- số câu đúng (NULL với các lần làm bài cũ)
    total        INT           NULL,     -- tổng số câu
    passed       SMALLINT      NOT NULL DEFAULT 0,
    due_at       TIMESTAMPTZ   NULL,     -- hạn nộp của học viên cho bài này tại lúc nộp
    is_late      SMALLINT      NOT NULL DEFAULT 0,  -- 1 = nộp sau hạn
    submitted_at TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 14. FEEDBACK  (phản hồi trong khóa học)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
    id          SERIAL PRIMARY KEY,
    user_id     INT         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    course_id   INT         NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    lecture_id  INT         NULL     REFERENCES lectures(id) ON DELETE SET NULL,
    message     TEXT        NOT NULL,
    reply       TEXT        NULL,
    replied_by  INT         NULL     REFERENCES users(id)    ON DELETE SET NULL,
    replied_at  TIMESTAMPTZ NULL,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 15. TEACHER_FEEDBACK  (nhận xét của giảng viên cho học viên theo bài giảng)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_feedback (
    id          SERIAL PRIMARY KEY,
    teacher_id  INT         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    student_id  INT         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    course_id   INT         NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    lecture_id  INT         NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    content     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_tf UNIQUE (teacher_id, student_id, lecture_id)
);

-- ------------------------------------------------------------
-- 16. ADMIN_TEST_RESULTS  (kết quả làm test thử / luyện đề)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_test_results (
    id            SERIAL PRIMARY KEY,
    user_id       INT           NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    admin_test_id INT           NOT NULL REFERENCES admin_tests(id) ON DELETE CASCADE,
    score         NUMERIC(6,2)  NOT NULL,
    correct       INT           NOT NULL DEFAULT 0,
    total         INT           NOT NULL DEFAULT 0,
    passed        SMALLINT      NOT NULL DEFAULT 0,
    submitted_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 17. TEST_ANSWERS  (câu trả lời từng câu trong mỗi lần làm bài kiểm tra khóa học)
--     Dùng cho trang Kết quả học tập (xem lại bài làm, tỉ lệ đúng theo kỹ năng)
--     và làm dữ liệu cho trợ lý học tập AI.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_answers (
    id          SERIAL PRIMARY KEY,
    result_id   INT           NOT NULL REFERENCES test_results(id) ON DELETE CASCADE,
    question_id INT           NOT NULL REFERENCES questions(id)    ON DELETE CASCADE,
    chosen      VARCHAR(200)  NULL,      -- đáp án chọn hoặc chữ học viên điền; NULL = bỏ trống
    is_correct  SMALLINT      NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- 18. ADMIN_TEST_ANSWERS  (câu trả lời từng câu trong mỗi lần làm test thử / luyện đề)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_test_answers (
    id          SERIAL PRIMARY KEY,
    result_id   INT           NOT NULL REFERENCES admin_test_results(id) ON DELETE CASCADE,
    question_id INT           NOT NULL REFERENCES admin_questions(id)    ON DELETE CASCADE,
    chosen      VARCHAR(200)  NULL,
    is_correct  SMALLINT      NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- 19. LEARNING_DAYS  (thời gian học mỗi ngày của học viên)
--     lecture_progress chỉ giữ lần xem gần nhất, bảng này cộng dồn số giây
--     xem video theo từng ngày để vẽ lịch hoạt động và thống kê 4 tuần.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_days (
    user_id       INT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day           DATE  NOT NULL,                -- theo giờ Việt Nam
    video_seconds INT   NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

-- ------------------------------------------------------------
-- 20. NOTIFICATIONS  (thông báo cho người dùng: đăng ký, kích hoạt khóa học, nhận xét, hạn nộp bài)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(30)   NOT NULL,     -- enroll_pending, enroll_active, enroll_rejected, course_completed, teacher_feedback, deadline_soon, deadline_overdue
    title       VARCHAR(200)  NOT NULL,
    body        TEXT          NULL,
    link        VARCHAR(300)  NULL,         -- trang trong thư mục pages, ví dụ course-learn.html?id=3
    dedupe_key  VARCHAR(150)  NULL,         -- chống tạo trùng, ví dụ nhắc hạn của cùng một bài chỉ tạo một lần
    read_at     TIMESTAMPTZ   NULL,
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_notifications_dedupe UNIQUE (user_id, dedupe_key)
);

-- ------------------------------------------------------------
-- 21. EMAIL_CODES  (mã 6 số gửi qua email: đặt lại mật khẩu, xác nhận email)
--     Chỉ lưu bản băm của mã; mã hết hạn sau ít phút và bị khóa khi nhập sai quá số lần.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_codes (
    id          SERIAL PRIMARY KEY,
    user_id     INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(20)   NOT NULL CHECK (purpose IN ('reset_password','verify_email')),
    code_hash   CHAR(64)      NOT NULL,
    attempts    SMALLINT      NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ   NOT NULL,
    used_at     TIMESTAMPTZ   NULL,     -- đã dùng hoặc bị thay bằng mã mới
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_codes (user_id, purpose, created_at DESC);

-- ------------------------------------------------------------
-- 22. CONTACT_MESSAGES  (tin nhắn gửi từ trang Liên hệ)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_messages (
    id          SERIAL PRIMARY KEY,
    user_id     INT           NULL REFERENCES users(id) ON DELETE SET NULL,
    name        VARCHAR(100)  NOT NULL,
    email       VARCHAR(150)  NOT NULL,
    topic       VARCHAR(20)   NOT NULL DEFAULT 'other' CHECK (topic IN ('account','course','payment','technical','other')),
    message     TEXT          NOT NULL,
    status      VARCHAR(10)   NOT NULL DEFAULT 'new' CHECK (status IN ('new','done')),
    handled_at  TIMESTAMPTZ   NULL,
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages (status, created_at DESC);

-- Các lượt trả lời qua lại trong một tin nhắn liên hệ: trung tâm trả lời, học viên hỏi thêm
CREATE TABLE IF NOT EXISTS contact_replies (
    id          SERIAL PRIMARY KEY,
    message_id  INT           NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
    user_id     INT           NULL REFERENCES users(id) ON DELETE SET NULL,
    is_staff    SMALLINT      NOT NULL DEFAULT 0,   -- 1 = quản trị viên trả lời, 0 = người gửi hỏi thêm
    content     TEXT          NOT NULL,
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contact_replies_message ON contact_replies (message_id, created_at);

-- ------------------------------------------------------------
-- 23. PLACEMENT_RESULTS  (kết quả bài kiểm tra xếp trình độ)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS placement_results (
    id          SERIAL PRIMARY KEY,
    user_id     INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exam        VARCHAR(10)   NOT NULL CHECK (exam IN ('ielts','toefl','toeic')),
    correct     SMALLINT      NOT NULL,
    total       SMALLINT      NOT NULL,
    band        VARCHAR(20)   NOT NULL,     -- ví dụ "5.5 – 6.5"
    level       VARCHAR(20)   NOT NULL,     -- Cơ bản | Trung cấp | Nâng cao, dùng để gợi ý khóa học
    skills      TEXT          NOT NULL,     -- JSON [{ "cat": "Ngữ pháp", "correct": 5, "total": 7 }]
    answers     TEXT          NOT NULL,     -- JSON { "ielts-1": 1, ... } (chỉ số đáp án đã chọn)
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_placement_results_user ON placement_results (user_id, created_at DESC);

-- ------------------------------------------------------------
-- 24. TEST_ATTEMPTS  (một lượt làm bài đang diễn ra: giờ bắt đầu, hạn giờ, thứ tự câu đã xáo, đáp án tự lưu)
--     Server dựa vào bảng này để giữ giờ làm bài, giới hạn số lần làm và cho làm tiếp khi tải lại trang.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_attempts (
    id              SERIAL PRIMARY KEY,
    user_id         INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_id         INT           NULL REFERENCES tests(id)       ON DELETE CASCADE,  -- bài kiểm tra khóa học
    admin_test_id   INT           NULL REFERENCES admin_tests(id) ON DELETE CASCADE,  -- test thử / luyện đề
    started_at      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deadline_at     TIMESTAMPTZ   NULL,                    -- NULL = không giới hạn thời gian
    question_order  TEXT          NOT NULL,                -- JSON mảng id câu hỏi theo thứ tự hiển thị
    option_orders   TEXT          NOT NULL DEFAULT '{}',   -- JSON { "id câu": ["C","A","B","D"] } đáp án gốc ứng với A, B, C, D đang hiển thị
    answers         TEXT          NOT NULL DEFAULT '{}',   -- JSON đáp án tự lưu, theo chữ cái đang hiển thị
    audio_plays     TEXT          NOT NULL DEFAULT '{}',   -- JSON { "id phần nghe": số lượt đã nghe }
    saved_at        TIMESTAMPTZ   NULL,
    submitted_at    TIMESTAMPTZ   NULL,
    result_id       INT           NULL,                    -- id trong test_results / admin_test_results
    time_expired    SMALLINT      NOT NULL DEFAULT 0,      -- 1 = hết giờ, chấm theo đáp án đã tự lưu
    CONSTRAINT chk_test_attempts_kind CHECK ((test_id IS NULL) <> (admin_test_id IS NULL))
);
-- Mỗi học viên chỉ có một lượt đang làm cho mỗi đề
CREATE UNIQUE INDEX IF NOT EXISTS uk_test_attempts_open_course ON test_attempts (user_id, test_id)
    WHERE submitted_at IS NULL AND test_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_test_attempts_open_admin  ON test_attempts (user_id, admin_test_id)
    WHERE submitted_at IS NULL AND admin_test_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_test_attempts_deadline ON test_attempts (deadline_at) WHERE submitted_at IS NULL;

-- ------------------------------------------------------------
-- 25. LECTURE_QUESTIONS  (hỏi đáp dưới bài giảng: học viên hỏi, giảng viên trả lời)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lecture_questions (
    id          SERIAL PRIMARY KEY,
    lecture_id  INT           NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    course_id   INT           NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    user_id     INT           NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    content     TEXT          NOT NULL,
    video_time  INT           NULL,     -- giây trong video lúc đặt câu hỏi (bấm để tua tới)
    status      VARCHAR(10)   NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','resolved')),
                                        -- open: chờ giảng viên | answered: giảng viên đã trả lời | resolved: người hỏi đã hiểu
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP  -- lần có trả lời gần nhất, để xếp câu hỏi mới hoạt động lên đầu
);
CREATE INDEX IF NOT EXISTS idx_lecture_questions_lecture ON lecture_questions (lecture_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lecture_questions_course  ON lecture_questions (course_id, status);

-- ------------------------------------------------------------
-- 26. LECTURE_ANSWERS  (các trả lời trong một câu hỏi)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lecture_answers (
    id          SERIAL PRIMARY KEY,
    question_id INT           NOT NULL REFERENCES lecture_questions(id) ON DELETE CASCADE,
    user_id     INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT          NOT NULL,
    is_teacher  SMALLINT      NOT NULL DEFAULT 0,   -- 1 = giảng viên hoặc quản trị trả lời
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lecture_answers_question ON lecture_answers (question_id, created_at);

-- ------------------------------------------------------------
-- 27. EMAIL_REMINDERS  (đã gửi email nhắc hạn nào cho ai, để mỗi hạn nộp chỉ nhắc một lần)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_reminders (
    id          SERIAL PRIMARY KEY,
    user_id     INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dedupe_key  VARCHAR(150)  NOT NULL,   -- deadline:<id bài kiểm tra>:<hạn nộp ISO>
    sent_at     TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_email_reminders UNIQUE (user_id, dedupe_key)
);

-- ------------------------------------------------------------
-- 28. PAYMENTS  (thanh toán học phí trực tuyến qua VNPay; chuyển khoản thủ công vẫn do admin duyệt)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id              SERIAL PRIMARY KEY,
    user_id         INT           NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    course_id       INT           NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    enrollment_id   INT           NULL     REFERENCES enrollments(id) ON DELETE SET NULL,
    provider        VARCHAR(10)   NOT NULL DEFAULT 'vnpay',
    txn_ref         VARCHAR(40)   NOT NULL UNIQUE,     -- mã đơn gửi sang VNPay (vnp_TxnRef)
    amount          NUMERIC(12,0) NOT NULL,
    status          VARCHAR(10)   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
    response_code   VARCHAR(10)   NULL,                -- vnp_ResponseCode
    transaction_no  VARCHAR(30)   NULL,                -- mã giao dịch tại VNPay
    bank_code       VARCHAR(20)   NULL,
    pay_date        VARCHAR(14)   NULL,                -- yyyyMMddHHmmss do VNPay trả về
    created_at      TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    paid_at         TIMESTAMPTZ   NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_enrollment ON payments (enrollment_id);

-- ------------------------------------------------------------
-- 29. USER_SESSIONS  (phiên đăng nhập, lưu trong CSDL để khởi động lại server không làm mọi người bị đăng xuất)
--     Cấu trúc theo yêu cầu của thư viện connect-pg-simple.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    sid     VARCHAR       NOT NULL COLLATE "default" PRIMARY KEY,
    sess    JSON          NOT NULL,
    expire  TIMESTAMP(6)  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire);

-- ------------------------------------------------------------
-- 30. COURSE_REVIEWS  (học viên chấm sao và nhận xét khóa học sau khi học)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_reviews (
    id            SERIAL PRIMARY KEY,
    course_id     INT           NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id       INT           NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    rating        SMALLINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment       TEXT          NULL,
    teacher_reply TEXT          NULL,     -- giảng viên phản hồi đánh giá
    replied_at    TIMESTAMPTZ   NULL,
    hidden        SMALLINT      NOT NULL DEFAULT 0,  -- 1 = admin ẩn vì vi phạm, không tính vào điểm trung bình
    created_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_course_reviews UNIQUE (course_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_course_reviews_course ON course_reviews (course_id, hidden, updated_at DESC);

-- ------------------------------------------------------------
-- 31. AI_USAGE  (mỗi lần gọi trợ lý AI: ai gọi, tính năng nào, bao nhiêu token, thành công hay lỗi)
--     Dùng để giới hạn lượt dùng mỗi ngày và để admin theo dõi mức sử dụng.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
    id            SERIAL PRIMARY KEY,
    user_id       INT           NULL REFERENCES users(id) ON DELETE SET NULL,
    feature       VARCHAR(20)   NOT NULL CHECK (feature IN ('explain','insights','writing','generate','ask')),
    status        VARCHAR(10)   NOT NULL CHECK (status IN ('ok','cached','error')),
    model         VARCHAR(60)   NULL,
    input_tokens  INT           NULL,
    output_tokens INT           NULL,
    error_code    VARCHAR(30)   NULL,
    guard         VARCHAR(20)   NULL,   -- lượt bị chặn vì xin đáp án hoặc nhờ làm hộ bài: 'answer' | 'do_work'
    created_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage (user_id, feature, created_at DESC);

-- ------------------------------------------------------------
-- 32. AI_EXPLANATIONS  (lời giải thích câu làm sai do AI viết, dùng lại cho người chọn cùng đáp án)
--     content_hash đổi khi giảng viên sửa câu hỏi, lúc đó AI giải thích lại.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_explanations (
    id            SERIAL PRIMARY KEY,
    kind          VARCHAR(10)   NOT NULL CHECK (kind IN ('course','admin')),  -- bài kiểm tra khóa học | test thử, luyện đề
    question_id   INT           NOT NULL,
    chosen_key    VARCHAR(200)  NOT NULL DEFAULT '',   -- đáp án học viên chọn (đã chuẩn hóa), rỗng = bỏ trống
    content_hash  CHAR(64)      NOT NULL,
    explanation   TEXT          NOT NULL,              -- JSON
    model         VARCHAR(60)   NULL,
    created_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_ai_explanations UNIQUE (kind, question_id, chosen_key, content_hash)
);

-- ------------------------------------------------------------
-- 33. AI_INSIGHTS  (nhận xét quá trình học và lộ trình gợi ý do trợ lý AI tạo cho từng học viên)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_insights (
    id          SERIAL PRIMARY KEY,
    user_id     INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report      TEXT          NOT NULL,   -- JSON nhận xét đã kiểm tra
    profile     TEXT          NOT NULL,   -- JSON số liệu học tập đã gửi cho AI (không có họ tên, email)
    model       VARCHAR(60)   NULL,
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_user ON ai_insights (user_id, created_at DESC);

-- ------------------------------------------------------------
-- 34. WRITING_PROMPTS  (đề luyện viết do admin soạn)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS writing_prompts (
    id            SERIAL PRIMARY KEY,
    task_type     VARCHAR(20)   NOT NULL CHECK (task_type IN ('ielts_task1','ielts_task2','toefl_discussion','toeic_opinion')),
    title         VARCHAR(200)  NOT NULL,
    prompt_text   TEXT          NOT NULL,
    min_words     SMALLINT      NOT NULL DEFAULT 250,
    time_minutes  SMALLINT      NOT NULL DEFAULT 40,
    status        VARCHAR(10)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','personal')),
    created_by    INT           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- 35. WRITING_SUBMISSIONS  (bài viết của học viên và kết quả AI chấm theo tiêu chí của kỳ thi)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS writing_submissions (
    id             SERIAL PRIMARY KEY,
    user_id        INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt_id      INT           NOT NULL REFERENCES writing_prompts(id) ON DELETE CASCADE,
    essay          TEXT          NOT NULL,
    word_count     INT           NOT NULL,
    status         VARCHAR(10)   NOT NULL DEFAULT 'grading' CHECK (status IN ('grading','graded','failed')),
    overall_score  NUMERIC(3,1)  NULL,
    scale_max      NUMERIC(3,1)  NULL,     -- 9 với IELTS, 5 với TOEFL và TOEIC
    result         TEXT          NULL,     -- JSON điểm từng tiêu chí, nhận xét, câu sửa
    integrity      TEXT          NULL,     -- JSON kết quả kiểm tra trùng lặp và dấu hiệu dùng AI
    error          VARCHAR(200)  NULL,
    model          VARCHAR(60)   NULL,
    created_at     TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    graded_at      TIMESTAMPTZ   NULL
);
CREATE INDEX IF NOT EXISTS idx_writing_submissions_user ON writing_submissions (user_id, created_at DESC);

-- ============================================================
-- Nâng cấp CSDL tạo từ bản cũ (câu hỏi chỉ có trắc nghiệm A–D)
-- Trên CSDL mới tạo, các lệnh này không làm thay đổi gì.
-- ============================================================
ALTER TABLE questions       ADD COLUMN IF NOT EXISTS section_id INT NULL REFERENCES test_sections(id) ON DELETE CASCADE;
ALTER TABLE admin_questions ADD COLUMN IF NOT EXISTS section_id INT NULL REFERENCES test_sections(id) ON DELETE CASCADE;
ALTER TABLE questions       ADD COLUMN IF NOT EXISTS question_type VARCHAR(10) NOT NULL DEFAULT 'mcq';
ALTER TABLE admin_questions ADD COLUMN IF NOT EXISTS question_type VARCHAR(10) NOT NULL DEFAULT 'mcq';
ALTER TABLE questions       ADD COLUMN IF NOT EXISTS accepted_answers TEXT NULL;
ALTER TABLE admin_questions ADD COLUMN IF NOT EXISTS accepted_answers TEXT NULL;
ALTER TABLE questions       DROP CONSTRAINT IF EXISTS questions_correct_answer_check;
ALTER TABLE admin_questions DROP CONSTRAINT IF EXISTS admin_questions_correct_answer_check;
ALTER TABLE questions
    ALTER COLUMN correct_answer TYPE VARCHAR(10), ALTER COLUMN correct_answer DROP NOT NULL,
    ALTER COLUMN option_a DROP NOT NULL, ALTER COLUMN option_b DROP NOT NULL,
    ALTER COLUMN option_c DROP NOT NULL, ALTER COLUMN option_d DROP NOT NULL;
ALTER TABLE admin_questions
    ALTER COLUMN correct_answer TYPE VARCHAR(10), ALTER COLUMN correct_answer DROP NOT NULL,
    ALTER COLUMN option_a DROP NOT NULL, ALTER COLUMN option_b DROP NOT NULL,
    ALTER COLUMN option_c DROP NOT NULL, ALTER COLUMN option_d DROP NOT NULL;

ALTER TABLE test_results ADD COLUMN IF NOT EXISTS correct INT NULL;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS total   INT NULL;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS due_at  TIMESTAMPTZ NULL;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS is_late SMALLINT NOT NULL DEFAULT 0;

-- Cài đặt tài khoản
ALTER TABLE users ADD COLUMN IF NOT EXISTS sound_effects       SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled        SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret         VARCHAR(64) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret VARCHAR(64) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_codes TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at          TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at   TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_reminders     SMALLINT NOT NULL DEFAULT 1;
-- Ngôn ngữ trợ lý AI dùng khi nhận xét, giải thích, chấm bài cho học viên: vi | en
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_language         VARCHAR(5) NOT NULL DEFAULT 'vi';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ai_language_check;
ALTER TABLE users ADD CONSTRAINT users_ai_language_check CHECK (ai_language IN ('vi','en'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version     INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio                 TEXT NULL;

-- Quy trình soạn và duyệt khóa học: GV soạn bản nháp đủ nội dung rồi mới gửi duyệt
ALTER TABLE courses ADD COLUMN IF NOT EXISTS objectives   TEXT NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS reviewed_at  TIMESTAMPTZ NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_status_check;
ALTER TABLE courses ADD CONSTRAINT courses_status_check CHECK (status IN ('draft','pending','active','locked','rejected'));
ALTER TABLE courses ALTER COLUMN status SET DEFAULT 'draft';
-- Khóa gửi từ bản cũ (chưa có bản nháp) vẫn nằm trong hàng chờ duyệt; khóa đã duyệt lấy ngày tạo làm ngày công khai
UPDATE courses SET submitted_at = created_at WHERE status = 'pending' AND submitted_at IS NULL;
UPDATE courses SET published_at = created_at WHERE status = 'active' AND published_at IS NULL;

-- Đề test thử / luyện đề: trạng thái nháp (bản cũ ghi là inactive)
ALTER TABLE writing_submissions ADD COLUMN IF NOT EXISTS integrity TEXT NULL;

-- Học viên tự nhập đề luyện viết của mình: thêm trạng thái 'personal'
ALTER TABLE writing_prompts DROP CONSTRAINT IF EXISTS writing_prompts_status_check;
ALTER TABLE writing_prompts ADD CONSTRAINT writing_prompts_status_check CHECK (status IN ('active','draft','personal'));

ALTER TABLE ai_usage  ADD COLUMN IF NOT EXISTS guard        VARCHAR(20) NULL;
-- Trợ lý AI đọc tài liệu bài học: lưu sẵn phần chữ bóc từ file
ALTER TABLE materials ADD COLUMN IF NOT EXISTS text_content TEXT NULL;

-- Hỏi đáp AI trong bài giảng thêm sau, nới ràng buộc feature của bảng ai_usage
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_feature_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_feature_check CHECK (feature IN ('explain','insights','writing','generate','ask'));

ALTER TABLE admin_tests DROP CONSTRAINT IF EXISTS admin_tests_status_check;
UPDATE admin_tests SET status = 'draft' WHERE status NOT IN ('active','draft');
ALTER TABLE admin_tests ADD CONSTRAINT admin_tests_status_check CHECK (status IN ('active','draft'));

-- Giới hạn lượt làm bài, xáo câu hỏi và đáp án
ALTER TABLE tests       ADD COLUMN IF NOT EXISTS max_attempts      SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE tests       ADD COLUMN IF NOT EXISTS shuffle_questions SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE tests       ADD COLUMN IF NOT EXISTS shuffle_options   SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE admin_tests ADD COLUMN IF NOT EXISTS max_attempts      SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE admin_tests ADD COLUMN IF NOT EXISTS shuffle_questions SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE admin_tests ADD COLUMN IF NOT EXISTS shuffle_options   SMALLINT NOT NULL DEFAULT 0;

-- Hạn nộp bài theo tuần
ALTER TABLE courses     ADD COLUMN IF NOT EXISTS due_weekday  SMALLINT NULL;
ALTER TABLE courses     ADD COLUMN IF NOT EXISTS due_time     TIME NULL;
ALTER TABLE lectures    ADD COLUMN IF NOT EXISTS week_number  SMALLINT NULL;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NULL;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS price NUMERIC(12,0) NULL;
-- Đăng ký từ bản cũ chưa lưu học phí: lấy học phí hiện tại của khóa học
UPDATE enrollments e SET price = c.price FROM courses c WHERE c.id = e.course_id AND e.price IS NULL;
-- Đăng ký đã kích hoạt từ trước khi có cột này: lấy ngày đăng ký làm mốc
UPDATE enrollments SET activated_at = enrolled_at
WHERE activated_at IS NULL AND status IN ('active', 'completed');

ALTER TABLE courses DROP CONSTRAINT IF EXISTS chk_courses_due;
ALTER TABLE courses ADD CONSTRAINT chk_courses_due CHECK (
    (due_weekday IS NULL) = (due_time IS NULL) AND (due_weekday IS NULL OR due_weekday BETWEEN 1 AND 7)
);
ALTER TABLE lectures DROP CONSTRAINT IF EXISTS chk_lectures_week;
ALTER TABLE lectures ADD CONSTRAINT chk_lectures_week CHECK (week_number IS NULL OR week_number BETWEEN 1 AND 52);

-- Đáp án phải khớp với loại câu hỏi
ALTER TABLE questions DROP CONSTRAINT IF EXISTS chk_questions_answer;
ALTER TABLE questions ADD CONSTRAINT chk_questions_answer CHECK (
    (question_type = 'mcq'  AND correct_answer IN ('A','B','C','D')) OR
    (question_type = 'tfng' AND correct_answer IN ('TRUE','FALSE','NOT_GIVEN')) OR
    (question_type = 'fill' AND accepted_answers IS NOT NULL)
);
ALTER TABLE admin_questions DROP CONSTRAINT IF EXISTS chk_admin_questions_answer;
ALTER TABLE admin_questions ADD CONSTRAINT chk_admin_questions_answer CHECK (
    (question_type = 'mcq'  AND correct_answer IN ('A','B','C','D')) OR
    (question_type = 'tfng' AND correct_answer IN ('TRUE','FALSE','NOT_GIVEN')) OR
    (question_type = 'fill' AND accepted_answers IS NOT NULL)
);

-- ============================================================
-- Trigger cập nhật updated_at
-- ============================================================
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_courses_updated_at ON courses;
CREATE TRIGGER trg_courses_updated_at BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_teacher_feedback_updated_at ON teacher_feedback;
CREATE TRIGGER trg_teacher_feedback_updated_at BEFORE UPDATE ON teacher_feedback
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Index cho khóa ngoại (MySQL tự tạo, PostgreSQL thì không)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_courses_teacher          ON courses (teacher_id);
CREATE INDEX IF NOT EXISTS idx_courses_category         ON courses (category_id);
CREATE INDEX IF NOT EXISTS idx_lectures_course          ON lectures (course_id);
CREATE INDEX IF NOT EXISTS idx_materials_course         ON materials (course_id);
CREATE INDEX IF NOT EXISTS idx_materials_lecture        ON materials (lecture_id);
CREATE INDEX IF NOT EXISTS idx_tests_course             ON tests (course_id);
CREATE INDEX IF NOT EXISTS idx_tests_lecture            ON tests (lecture_id);
CREATE INDEX IF NOT EXISTS idx_questions_test           ON questions (test_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course       ON enrollments (course_id);
CREATE INDEX IF NOT EXISTS idx_lecture_progress_lecture ON lecture_progress (lecture_id);
CREATE INDEX IF NOT EXISTS idx_test_results_user_test   ON test_results (user_id, test_id);
CREATE INDEX IF NOT EXISTS idx_test_results_test        ON test_results (test_id);
CREATE INDEX IF NOT EXISTS idx_teacher_feedback_course  ON teacher_feedback (course_id, student_id);
CREATE INDEX IF NOT EXISTS idx_admin_questions_test     ON admin_questions (admin_test_id);
CREATE INDEX IF NOT EXISTS idx_sections_test            ON test_sections (test_id);
CREATE INDEX IF NOT EXISTS idx_sections_admin_test      ON test_sections (admin_test_id);
CREATE INDEX IF NOT EXISTS idx_questions_section        ON questions (section_id);
CREATE INDEX IF NOT EXISTS idx_admin_questions_section  ON admin_questions (section_id);
CREATE INDEX IF NOT EXISTS idx_test_answers_result      ON test_answers (result_id);
CREATE INDEX IF NOT EXISTS idx_test_answers_question    ON test_answers (question_id);
CREATE INDEX IF NOT EXISTS idx_admin_answers_result     ON admin_test_answers (result_id);
CREATE INDEX IF NOT EXISTS idx_admin_answers_question   ON admin_test_answers (question_id);
CREATE INDEX IF NOT EXISTS idx_admin_results_user_test  ON admin_test_results (user_id, admin_test_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user      ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_results_user       ON admin_test_results (user_id);
CREATE INDEX IF NOT EXISTS idx_courses_status           ON courses (status);

-- ============================================================
-- SEED: 3 danh mục chứng chỉ mặc định
-- ============================================================
INSERT INTO categories (id, name, type, description) VALUES
(1, 'IELTS Mastery',       'IELTS',  'Luyện đủ 4 kỹ năng Nghe, Đọc, Viết, Nói. Lộ trình theo band điểm từ 4.5 đến 8.0+.'),
(2, 'TOEFL iBT Academic',  'TOEFL',  'Chinh phục TOEFL iBT với lộ trình theo dải điểm từ 60 đến 110+. Phù hợp du học Mỹ, Canada.'),
(3, 'TOEIC Professional',  'TOEIC',  'Nắm vững TOEIC Listening & Reading. Lộ trình từ 450 đến 900+, phù hợp môi trường công sở.')
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: tài khoản mẫu (mật khẩu của cả ba tài khoản là: 123456)
-- ============================================================
INSERT INTO users (id, name, email, password, role, specialty, status) VALUES
(1, 'Quản trị viên', 'admin@gmail.com', '$2b$12$FVNGBemdBGn9BFY2TgNNleZHQlMG3zq9VFyB6NQ8uN6cDuiEmY9hS', 'admin', NULL,    'active'),
(2, 'Hoàng',         'hoang@gmail.com', '$2b$12$FVNGBemdBGn9BFY2TgNNleZHQlMG3zq9VFyB6NQ8uN6cDuiEmY9hS', 'gv',    'IELTS', 'active'),
(3, 'Danh',          'danh@gmail.com',  '$2b$12$FVNGBemdBGn9BFY2TgNNleZHQlMG3zq9VFyB6NQ8uN6cDuiEmY9hS', 'user',  NULL,    'active')
ON CONFLICT DO NOTHING;

-- Seed chèn id thủ công nên phải đẩy bộ đếm SERIAL lên, tránh trùng id khi thêm dòng mới
SELECT setval(pg_get_serial_sequence('categories', 'id'), GREATEST((SELECT MAX(id) FROM categories), 1));
SELECT setval(pg_get_serial_sequence('users', 'id'),      GREATEST((SELECT MAX(id) FROM users), 1));

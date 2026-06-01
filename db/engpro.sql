-- ============================================================
--  EngPro – Database Schema (khớp với mã nguồn server.js)
--  MySQL 8.0+  |  Charset: utf8mb4
--  Ghi chú: file này được dựng lại theo đúng các bảng mà
--  server.js đang sử dụng. Mật khẩu các tài khoản mẫu là: 123456
-- ============================================================

CREATE DATABASE IF NOT EXISTS engpro
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE engpro;

-- ------------------------------------------------------------
-- 1. USERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    email       VARCHAR(150)  NOT NULL UNIQUE,
    password    VARCHAR(255)  NOT NULL,                 -- bcrypt hash
    role        ENUM('admin','gv','user') NOT NULL DEFAULT 'user',
    phone       VARCHAR(20)   NULL,
    specialty   ENUM('IELTS','TOEFL','TOEIC') NULL,     -- chỉ dùng cho GV
    avatar      VARCHAR(255)  NULL,
    cv_url      VARCHAR(255)  NULL,                      -- hồ sơ năng lực của GV
    status      ENUM('active','locked') NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 2. CATEGORIES  (danh mục chứng chỉ)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    type        ENUM('IELTS','TOEFL','TOEIC') NOT NULL,
    description TEXT          NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 3. COURSES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    category_id   INT           NULL,
    teacher_id    INT           NOT NULL,
    title         VARCHAR(200)  NOT NULL,
    band_from     VARCHAR(20)   NOT NULL DEFAULT '',     -- ví dụ "5.5" | "450"
    band_to       VARCHAR(20)   NOT NULL DEFAULT '',     -- ví dụ "6.5" | "600"
    level         ENUM('Cơ bản','Trung cấp','Nâng cao') NOT NULL DEFAULT 'Cơ bản',
    description   TEXT          NULL,
    thumbnail     VARCHAR(500)  NULL,
    price         DECIMAL(12,0) NOT NULL DEFAULT 0,
    status        ENUM('pending','active','locked','rejected') NOT NULL DEFAULT 'pending',
    reject_reason TEXT          NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (teacher_id)  REFERENCES users(id)      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 4. LECTURES  (video bài giảng)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lectures (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    course_id        INT           NOT NULL,
    title            VARCHAR(200)  NOT NULL,
    skill            ENUM('Listening','Reading','Writing','Speaking','Grammar','Vocabulary') NOT NULL DEFAULT 'Listening',
    video_url        VARCHAR(500)  NULL,
    duration_minutes INT           NULL,
    description      TEXT          NULL,
    order_num        INT           NOT NULL DEFAULT 1,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 5. MATERIALS  (tài liệu đính kèm)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    course_id   INT           NOT NULL,
    lecture_id  INT           NULL,
    teacher_id  INT           NOT NULL,
    filename    VARCHAR(255)  NOT NULL,
    filepath    VARCHAR(500)  NOT NULL,
    filesize    INT           NULL,
    filetype    VARCHAR(100)  NULL,
    description VARCHAR(255)  NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE,
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE SET NULL,
    FOREIGN KEY (teacher_id) REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 6. TESTS  (bài kiểm tra của khóa học, có thể gắn với 1 bài giảng)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tests (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    course_id        INT           NOT NULL,
    lecture_id       INT           NULL,
    title            VARCHAR(200)  NOT NULL,
    duration_minutes INT           NOT NULL DEFAULT 30,
    num_questions    INT           NOT NULL DEFAULT 20,
    pass_percent     TINYINT       NOT NULL DEFAULT 60,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE,
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 7. QUESTIONS  (câu hỏi của bài kiểm tra khóa học)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    test_id         INT           NOT NULL,
    question_text   TEXT          NOT NULL,
    option_a        VARCHAR(500)  NOT NULL,
    option_b        VARCHAR(500)  NOT NULL,
    option_c        VARCHAR(500)  NOT NULL,
    option_d        VARCHAR(500)  NOT NULL,
    correct_answer  ENUM('A','B','C','D') NOT NULL,
    order_num       INT           NOT NULL DEFAULT 1,
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 8. ENROLLMENTS  (đăng ký khóa học)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT     NOT NULL,
    course_id        INT     NOT NULL,
    progress_percent TINYINT NOT NULL DEFAULT 0,
    status           ENUM('pending','active','completed','rejected','paused') NOT NULL DEFAULT 'pending',
    enrolled_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_enrollment (user_id, course_id),
    FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 9. LECTURE_PROGRESS  (tiến độ xem bài giảng)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lecture_progress (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NOT NULL,
    lecture_id  INT          NOT NULL,
    completed   TINYINT(1)   NOT NULL DEFAULT 0,
    watched_at  TIMESTAMP    NULL,
    UNIQUE KEY uk_lp (user_id, lecture_id),
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 10. TEST_RESULTS  (kết quả bài kiểm tra khóa học)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_results (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT            NOT NULL,
    test_id      INT            NOT NULL,
    score        DECIMAL(6,2)   NOT NULL,
    passed       TINYINT(1)     NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 11. FEEDBACK  (phản hồi trong khóa học)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT       NOT NULL,
    course_id   INT       NOT NULL,
    lecture_id  INT       NULL,
    message     TEXT      NOT NULL,
    reply       TEXT      NULL,
    replied_by  INT       NULL,
    replied_at  TIMESTAMP NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE,
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE SET NULL,
    FOREIGN KEY (replied_by) REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 12. TEACHER_FEEDBACK  (nhận xét của giảng viên cho học viên theo bài giảng)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teacher_feedback (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    teacher_id  INT       NOT NULL,
    student_id  INT       NOT NULL,
    course_id   INT       NOT NULL,
    lecture_id  INT       NOT NULL,
    content     TEXT      NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tf (teacher_id, student_id, lecture_id),
    FOREIGN KEY (teacher_id) REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (course_id)  REFERENCES courses(id)  ON DELETE CASCADE,
    FOREIGN KEY (lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 13. ADMIN_TESTS  (bài test thử & luyện đề, phân biệt bằng cột type)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_tests (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    title            VARCHAR(200)  NOT NULL,
    type             ENUM('test_thu','luyen_de') NOT NULL,
    category_id      INT           NULL,
    skill            VARCHAR(50)   NULL,
    difficulty       VARCHAR(50)   NULL,
    description      TEXT          NULL,
    duration_minutes INT           NOT NULL DEFAULT 60,
    num_questions    INT           NOT NULL DEFAULT 30,
    pass_percent     TINYINT       NOT NULL DEFAULT 60,
    status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 14. ADMIN_QUESTIONS  (câu hỏi của test thử / luyện đề)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_questions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    admin_test_id   INT           NOT NULL,
    question_text   TEXT          NOT NULL,
    option_a        VARCHAR(500)  NOT NULL,
    option_b        VARCHAR(500)  NOT NULL,
    option_c        VARCHAR(500)  NOT NULL,
    option_d        VARCHAR(500)  NOT NULL,
    correct_answer  ENUM('A','B','C','D') NOT NULL,
    order_num       INT           NOT NULL DEFAULT 1,
    FOREIGN KEY (admin_test_id) REFERENCES admin_tests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 15. ADMIN_TEST_RESULTS  (kết quả làm test thử / luyện đề)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_test_results (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT           NOT NULL,
    admin_test_id INT           NOT NULL,
    score         DECIMAL(6,2)  NOT NULL,
    correct       INT           NOT NULL DEFAULT 0,
    total         INT           NOT NULL DEFAULT 0,
    passed        TINYINT(1)    NOT NULL DEFAULT 0,
    submitted_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
    FOREIGN KEY (admin_test_id) REFERENCES admin_tests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SEED: 3 danh mục chứng chỉ mặc định
-- ============================================================
INSERT IGNORE INTO categories (id, name, type, description) VALUES
(1, 'IELTS Mastery',       'IELTS',  'Luyện đủ 4 kỹ năng Nghe, Đọc, Viết, Nói. Lộ trình theo band điểm từ 4.5 đến 8.0+.'),
(2, 'TOEFL iBT Academic',  'TOEFL',  'Chinh phục TOEFL iBT với lộ trình theo dải điểm từ 60 đến 110+. Phù hợp du học Mỹ, Canada.'),
(3, 'TOEIC Professional',  'TOEIC',  'Nắm vững TOEIC Listening & Reading. Lộ trình từ 450 đến 900+, phù hợp môi trường công sở.');

-- ============================================================
-- SEED: tài khoản mẫu (mật khẩu của cả ba tài khoản là: 123456)
-- ============================================================
INSERT IGNORE INTO users (id, name, email, password, role, specialty, status) VALUES
(1, 'Quản trị viên', 'admin@gmail.com', '$2b$12$FVNGBemdBGn9BFY2TgNNleZHQlMG3zq9VFyB6NQ8uN6cDuiEmY9hS', 'admin', NULL,    'active'),
(2, 'Hoàng',         'hoang@gmail.com', '$2b$12$FVNGBemdBGn9BFY2TgNNleZHQlMG3zq9VFyB6NQ8uN6cDuiEmY9hS', 'gv',    'IELTS', 'active'),
(3, 'Danh',          'danh@gmail.com',  '$2b$12$FVNGBemdBGn9BFY2TgNNleZHQlMG3zq9VFyB6NQ8uN6cDuiEmY9hS', 'user',  NULL,    'active');

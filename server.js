/**
 * EngPro – Express Backend
 * node server.js  →  http://localhost:8080
 */
const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const mysql   = require('mysql2/promise');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const XLSX    = require('xlsx');

const app  = express();
const PORT = process.env.PORT || 8080;

// ─────────────────────────────────────────────────────────────
//  Database pool
// ─────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:              process.env.MYSQLHOST     || '127.0.0.1',
  port:              process.env.MYSQLPORT     || 3306,
  user:              process.env.MYSQLUSER     || 'root',
  password:          process.env.MYSQLPASSWORD || '',
  database:          process.env.MYSQLDATABASE || 'engpro',
  charset:           'utf8mb4',
  waitForConnections: true,
  connectionLimit:   10,
});

// ─────────────────────────────────────────────────────────────
//  Middleware
// ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret:            'engpro-secret-2025',
  resave:            false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 86400_000 }, // 1 ngày
}));

// Serve toàn bộ thư mục project (HTML, CSS, JS, uploads…)
app.use(express.static(__dirname));

// ─────────────────────────────────────────────────────────────
//  Response helpers
// ─────────────────────────────────────────────────────────────
const ok  = (res, data = null, status = 200) => res.status(status).json({ success: true,  data });
const err = (res, msg,  status = 400)        => res.status(status).json({ success: false, message: msg });

// ─────────────────────────────────────────────────────────────
//  Auth helpers
// ─────────────────────────────────────────────────────────────
function authRequired(req, res) {
  if (!req.session?.user) { err(res, 'Chưa đăng nhập', 401); return null; }
  return req.session.user;
}

// ── Helper: đánh dấu bài giảng hoàn thành + cập nhật tiến độ enrollment ──────
async function completeLecture(userId, lectureId, courseId) {
  await pool.query(
    `INSERT INTO lecture_progress (user_id, lecture_id, completed, watched_at)
     VALUES (?,?,1,NOW())
     ON DUPLICATE KEY UPDATE completed=1, watched_at=NOW()`,
    [userId, lectureId]
  );
  const pct = await calcProgress(userId, courseId);
  await pool.query(
    'UPDATE enrollments SET progress_percent=? WHERE user_id=? AND course_id=?',
    [pct, userId, courseId]
  );
  return pct;
}

// ── Helper: tính tiến độ đúng (chỉ tính bài đã pass test HOẶC bài không có test đã xem) ──
async function calcProgress(userId, courseId) {
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) AS total FROM lectures WHERE course_id=?', [courseId]
  );
  if (total === 0) return 0;
  // Bài "hoàn thành" khi:
  //   có test → test đã pass   |   không có test → lecture_progress.completed = 1
  const [[{ done }]] = await pool.query(
    `SELECT COUNT(*) AS done FROM lectures l
     WHERE l.course_id = ?
       AND (
         EXISTS (
           SELECT 1 FROM tests t
           JOIN test_results tr ON tr.test_id = t.id
           WHERE t.lecture_id = l.id AND tr.user_id = ? AND tr.passed = 1
         )
         OR (
           NOT EXISTS (SELECT 1 FROM tests t2 WHERE t2.lecture_id = l.id)
           AND EXISTS (
             SELECT 1 FROM lecture_progress lp
             WHERE lp.lecture_id = l.id AND lp.user_id = ? AND lp.completed = 1
           )
         )
       )`,
    [courseId, userId, userId]
  );
  return Math.round(done / total * 100);
}
function roleRequired(req, res, roles) {
  const user = authRequired(req, res);
  if (!user) return null;
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(user.role)) { err(res, 'Không có quyền truy cập', 403); return null; }
  return user;
}

// ─────────────────────────────────────────────────────────────
//  File upload (multer)
// ─────────────────────────────────────────────────────────────

// Upload CV (chỉ PDF/DOC)
const uploadCV = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(__dirname, 'uploads', 'cv');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname);
      cb(null, `cv_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(req, file, cb) {
    const allowed = ['.pdf', '.doc', '.docx'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file PDF hoặc Word (.doc, .docx)'));
  },
});

// Upload tài liệu bài giảng
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(__dirname, 'uploads', 'materials');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext  = path.extname(file.originalname);
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// Multer for Excel uploads (memory – no disk write)
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(req, file, cb) {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Chỉ chấp nhận file .xlsx, .xls, .csv'), ok);
  },
});

// ═════════════════════════════════════════════════════════════
//  AUTH
// ═════════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return err(res, 'Vui lòng nhập email và mật khẩu');
  try {
    const [[user]] = await pool.query(
      'SELECT id,name,email,password,role,status FROM users WHERE email=? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    if (!user) return err(res, 'Email hoặc mật khẩu không đúng', 401);
    // PHP dùng $2y$, Node bcrypt dùng $2b$ — hai prefix tương đương, cần normalize
    const hash = user.password.replace(/^\$2y\$/, '$2b$');
    if (!(await bcrypt.compare(password, hash)))
      return err(res, 'Email hoặc mật khẩu không đúng', 401);
    if (user.status === 'locked')
      return err(res, 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.', 403);

    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    const redirects  = { admin: 'dashboard-admin.html', gv: 'dashboard-gv.html', user: '../index.html' };
    ok(res, { user: req.session.user, redirect: redirects[user.role] ?? '../index.html' });
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => ok(res));
});

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
  const user = authRequired(req, res);
  if (!user) return;
  try {
    const [[u]] = await pool.query(
      'SELECT id,name,email,role,phone,specialty,avatar,status,created_at FROM users WHERE id=? LIMIT 1',
      [user.id]
    );
    ok(res, u ?? null);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// POST /api/auth/register  (multipart/form-data để nhận CV)
app.post('/api/auth/register', uploadCV.single('cv'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name?.trim())                          return err(res, 'Vui lòng nhập họ và tên');
  if (!email || !/\S+@\S+\.\S+/.test(email)) return err(res, 'Email không hợp lệ');
  if (!password || password.length < 6)       return err(res, 'Mật khẩu phải có ít nhất 6 ký tự');
  if (!['user', 'gv'].includes(role))         return err(res, 'Vai trò không hợp lệ');
  if (role === 'gv' && !req.file)             return err(res, 'Giảng viên cần nộp CV để đăng ký');
  try {
    const [[exist]] = await pool.query('SELECT id FROM users WHERE email=? LIMIT 1', [email.toLowerCase()]);
    if (exist) {
      // Xóa file CV vừa upload nếu email trùng
      if (req.file) fs.unlinkSync(req.file.path);
      return err(res, 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.');
    }
    const hash   = await bcrypt.hash(password, 12);
    const status = role === 'gv' ? 'locked' : 'active';
    const cvUrl  = req.file ? 'uploads/cv/' + req.file.filename : null;
    await pool.query(
      'INSERT INTO users (name,email,password,role,status,cv_url) VALUES (?,?,?,?,?,?)',
      [name.trim(), email.toLowerCase(), hash, role, status, cvUrl]
    );
    ok(res, { name: name.trim(), email: email.toLowerCase(), role, status }, 201);
  } catch (e) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error(e); err(res, 'Lỗi hệ thống', 500);
  }
});

// ═════════════════════════════════════════════════════════════
//  ADMIN – THỐNG KÊ
// ═════════════════════════════════════════════════════════════
// ── Public: danh sách khóa học đã được duyệt ──────────────────
app.get('/api/courses', async (req, res) => {
  try {
    const { type } = req.query;
    const userId = req.session?.user?.id || null;
    const enrollSub = userId
      ? ',(SELECT status FROM enrollments WHERE course_id=c.id AND user_id=? LIMIT 1) AS enroll_status'
      : '';
    let sql = `
      SELECT c.id, c.title, c.description, c.price, c.band_from, c.band_to, c.level,
             cat.name AS category_name, cat.type AS category_type,
             u.name  AS teacher_name,
             (SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) AS student_count,
             (SELECT COUNT(*) FROM lectures   WHERE course_id=c.id) AS lecture_count
             ${enrollSub}
      FROM courses c
      LEFT JOIN categories cat ON cat.id = c.category_id
      LEFT JOIN users      u   ON u.id   = c.teacher_id
      WHERE c.status = 'active'`;
    const params = userId ? [userId] : [];
    if (type) { sql += ' AND cat.type = ?'; params.push(type); }
    sql += ' ORDER BY c.created_at DESC';
    const [rows] = await pool.query(sql, params);
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// GET /api/admin/revenue
app.get('/api/admin/revenue', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    const [[{ total }]] = await pool.query(`
      SELECT COALESCE(SUM(c.price),0) AS total
      FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.status IN ('active','completed') AND c.price > 0`);

    const [[{ this_month }]] = await pool.query(`
      SELECT COALESCE(SUM(c.price),0) AS this_month
      FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.status IN ('active','completed') AND c.price > 0
        AND MONTH(e.enrolled_at)=MONTH(NOW()) AND YEAR(e.enrolled_at)=YEAR(NOW())`);

    const [[{ last_month }]] = await pool.query(`
      SELECT COALESCE(SUM(c.price),0) AS last_month
      FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.status IN ('active','completed') AND c.price > 0
        AND MONTH(e.enrolled_at)=MONTH(DATE_SUB(NOW(),INTERVAL 1 MONTH))
        AND YEAR(e.enrolled_at)=YEAR(DATE_SUB(NOW(),INTERVAL 1 MONTH))`);

    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(e.enrolled_at,'%Y-%m') AS month,
             SUM(c.price) AS revenue, COUNT(*) AS cnt
      FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.status IN ('active','completed') AND c.price > 0
        AND e.enrolled_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY month ORDER BY month ASC`);

    const [by_course] = await pool.query(`
      SELECT c.title, c.price, COUNT(*) AS enrollments, SUM(c.price) AS revenue
      FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.status IN ('active','completed') AND c.price > 0
      GROUP BY c.id ORDER BY revenue DESC LIMIT 15`);

    const [by_month_course] = await pool.query(`
      SELECT DATE_FORMAT(e.enrolled_at,'%Y-%m') AS month,
             c.title AS course_title, c.price,
             COUNT(*) AS enrollments, SUM(c.price) AS revenue
      FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.status IN ('active','completed') AND c.price > 0
        AND e.enrolled_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY month, c.id
      ORDER BY month ASC, revenue DESC`);

    ok(res, { total, this_month, last_month, monthly, by_course, by_month_course });
  } catch(e) { console.error(e); err(res,'Lỗi hệ thống',500); }
});

app.get('/api/admin/stats', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    const [[{ total_teachers }]]   = await pool.query("SELECT COUNT(*) AS total_teachers FROM users WHERE role='gv'");
    const [[{ total_students }]]   = await pool.query("SELECT COUNT(*) AS total_students FROM users WHERE role='user'");
    const [[{ total_courses }]]    = await pool.query("SELECT COUNT(*) AS total_courses  FROM courses WHERE status='active'");
    const [[{ total_enrollments }]]= await pool.query('SELECT COUNT(*) AS total_enrollments FROM enrollments');
    const [[{ pending_count }]]    = await pool.query("SELECT COUNT(*) AS pending_count FROM courses WHERE status='pending'");
    const [recent_users]           = await pool.query(
      "SELECT id,name,email,role,created_at FROM users WHERE role!='admin' ORDER BY created_at DESC LIMIT 5"
    );
    const [pending_courses]        = await pool.query(`
      SELECT c.id,c.title,c.status,c.created_at,u.name AS teacher_name,cat.name AS category_name
      FROM courses c
      JOIN users u ON u.id=c.teacher_id
      LEFT JOIN categories cat ON cat.id=c.category_id
      WHERE c.status='pending' ORDER BY c.created_at DESC LIMIT 5
    `);
    ok(res, { total_teachers, total_students, total_courses, total_enrollments, pending_count, recent_users, pending_courses });
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  ADMIN – USERS
// ═════════════════════════════════════════════════════════════
app.route('/api/admin/users')
  .get(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { role: r, search, page = 1, limit = 20 } = req.query;
    let where = "WHERE u.role!='admin'"; const params = [];
    if (r)      { where += ' AND u.role=?';                                  params.push(r); }
    if (search) { where += ' AND (u.name LIKE ? OR u.email LIKE ?)';         params.push(`%${search}%`, `%${search}%`); }
    try {
      const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
      const [rows]        = await pool.query(
        `SELECT u.id,u.name,u.email,u.role,u.status,u.phone,u.specialty,u.cv_url,u.created_at FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
        [...params, +limit, (+page - 1) * +limit]
      );
      ok(res, { total, rows });
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { name, email, password, role, phone, specialty } = req.body;
    if (!name || !email || !password || !role) return err(res, 'Thiếu thông tin bắt buộc');
    try {
      const [[exist]] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
      if (exist) return err(res, 'Email đã tồn tại');
      const hash = await bcrypt.hash(password, 12);
      const [result] = await pool.query(
        'INSERT INTO users (name,email,password,role,phone,specialty) VALUES (?,?,?,?,?,?)',
        [name, email, hash, role, phone||null, specialty||null]
      );
      ok(res, { id: result.insertId }, 201);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

app.route('/api/admin/users/:id')
  .put(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { name, email, role, status, phone, specialty } = req.body;
    try {
      await pool.query(
        'UPDATE users SET name=?,email=?,role=?,status=?,phone=?,specialty=? WHERE id=?',
        [name, email, role, status, phone||null, specialty||null, req.params.id]
      );
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .delete(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    try {
      await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

// POST /api/admin/users/:id/toggle  →  khoá / mở tài khoản
app.post('/api/admin/users/:id/toggle', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    const [[u]] = await pool.query('SELECT status FROM users WHERE id=?', [req.params.id]);
    if (!u) return err(res, 'Không tìm thấy user', 404);
    const newStatus = u.status === 'active' ? 'locked' : 'active';
    await pool.query('UPDATE users SET status=? WHERE id=?', [newStatus, req.params.id]);
    ok(res, { status: newStatus });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  ADMIN – CATEGORIES
// ═════════════════════════════════════════════════════════════
app.route('/api/admin/categories')
  .get(async (req, res) => {
    // GET: cho phép mọi user đã đăng nhập (GV cần để tạo khóa học)
    if (!req.session.user) return err(res, 'Chưa đăng nhập', 401);
    try {
      const [rows] = await pool.query(`
        SELECT c.*,
          (SELECT COUNT(*) FROM courses WHERE category_id=c.id AND status='active') AS course_count,
          (SELECT COUNT(*) FROM enrollments e JOIN courses co ON co.id=e.course_id WHERE co.category_id=c.id) AS student_count
        FROM categories c ORDER BY c.id
      `);
      ok(res, rows);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { name, type, description } = req.body;
    if (!name || !type) return err(res, 'Thiếu tên hoặc loại chứng chỉ');
    try {
      const [result] = await pool.query(
        'INSERT INTO categories (name,type,description) VALUES (?,?,?)',
        [name, type, description||null]
      );
      ok(res, { id: result.insertId }, 201);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

app.route('/api/admin/categories/:id')
  .put(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { name, type, description } = req.body;
    try {
      await pool.query('UPDATE categories SET name=?,type=?,description=? WHERE id=?',
        [name, type, description||null, req.params.id]);
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .delete(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    try {
      const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM courses WHERE category_id=?', [req.params.id]);
      if (cnt > 0) return err(res, 'Không thể xóa danh mục đang có khóa học');
      await pool.query('DELETE FROM categories WHERE id=?', [req.params.id]);
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

// ═════════════════════════════════════════════════════════════
//  ADMIN – TEST THỬ & LUYỆN ĐỀ
// ═════════════════════════════════════════════════════════════
// Public endpoint – no auth needed, returns only active items
app.get('/api/public/admin-tests', async (req, res) => {
  const { type } = req.query;
  let q = `SELECT t.id, t.title, t.type, t.skill, t.difficulty, t.description,
                   t.duration_minutes, t.num_questions, t.pass_percent,
                   cat.name AS category_name
           FROM admin_tests t LEFT JOIN categories cat ON cat.id=t.category_id
           WHERE t.status='active'`;
  const p = [];
  if (type) { q += ' AND t.type=?'; p.push(type); }
  q += ' ORDER BY t.created_at DESC';
  try { const [rows] = await pool.query(q, p); ok(res, rows); }
  catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

app.route('/api/admin/admin-tests')
  .get(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { type } = req.query;
    let q = `SELECT t.*, cat.name AS category_name
             FROM admin_tests t LEFT JOIN categories cat ON cat.id=t.category_id`;
    const p = [];
    if (type) { q += ' WHERE t.type=?'; p.push(type); }
    q += ' ORDER BY t.created_at DESC';
    try { const [rows] = await pool.query(q, p); ok(res, rows); }
    catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { title, type, category_id, skill, difficulty, description, duration_minutes, num_questions, pass_percent, status } = req.body;
    if (!title || !type) return err(res, 'Thiếu thông tin');
    try {
      const [r] = await pool.query(
        'INSERT INTO admin_tests (title,type,category_id,skill,difficulty,description,duration_minutes,num_questions,pass_percent,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [title, type, category_id||null, skill||null, difficulty||null, description||null, duration_minutes||60, num_questions||30, pass_percent||60, status||'active']
      );
      ok(res, { id: r.insertId }, 201);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

app.route('/api/admin/admin-tests/:id')
  .put(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { title, category_id, skill, difficulty, description, duration_minutes, num_questions, pass_percent, status } = req.body;
    if (!title) return err(res, 'Thiếu tiêu đề');
    try {
      await pool.query(
        'UPDATE admin_tests SET title=?,category_id=?,skill=?,difficulty=?,description=?,duration_minutes=?,num_questions=?,pass_percent=?,status=? WHERE id=?',
        [title, category_id||null, skill||null, difficulty||null, description||null, duration_minutes||60, num_questions||30, pass_percent||60, status||'active', req.params.id]
      );
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .delete(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    try { await pool.query('DELETE FROM admin_tests WHERE id=?', [req.params.id]); ok(res); }
    catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

// ═════════════════════════════════════════════════════════════
//  ADMIN – COURSES
// ═════════════════════════════════════════════════════════════
app.get('/api/admin/courses', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  const { status: s, search, page = 1, limit = 20 } = req.query;
  let where = 'WHERE 1=1'; const params = [];
  if (s)      { where += ' AND c.status=?';     params.push(s); }
  if (search) { where += ' AND c.title LIKE ?';  params.push(`%${search}%`); }
  try {
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM courses c ${where}`, params);
    const [rows]        = await pool.query(
      `SELECT c.id, c.title, c.status, c.price, c.created_at,
              u.name AS teacher_name, cat.name AS category_name,
              COUNT(DISTINCT e.user_id)                                        AS student_count,
              SUM(CASE WHEN e.status='completed' THEN 1 ELSE 0 END)            AS completed_count
       FROM courses c
       LEFT JOIN users u        ON u.id  = c.teacher_id
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN enrollments e  ON e.course_id = c.id AND e.status IN ('active','completed')
       ${where}
       GROUP BY c.id, c.title, c.status, c.price, c.created_at, u.name, cat.name
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [...params, +limit, (+page - 1) * +limit]
    );
    ok(res, { total, rows });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

app.route('/api/admin/courses/:id')
  .put(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const { action, title, category_id, price, description } = req.body;
    try {
      if (action === 'approve') {
        await pool.query("UPDATE courses SET status='active'   WHERE id=?", [req.params.id]);
      } else if (action === 'reject') {
        await pool.query("UPDATE courses SET status='rejected' WHERE id=?", [req.params.id]);
      } else {
        await pool.query('UPDATE courses SET title=?,category_id=?,price=?,description=? WHERE id=?',
          [title, category_id, price, description, req.params.id]);
      }
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .delete(async (req, res) => {
    if (!roleRequired(req, res, 'admin')) return;
    const cid = req.params.id;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Xóa cascade theo thứ tự phụ thuộc
      // test_results & questions → tests
      const [tests] = await conn.query('SELECT id FROM tests WHERE course_id=?', [cid]);
      if (tests.length) {
        const tids = tests.map(t => t.id);
        await conn.query('DELETE FROM test_results WHERE test_id IN (?)', [tids]);
        await conn.query('DELETE FROM questions    WHERE test_id IN (?)', [tids]);
      }
      await conn.query('DELETE FROM tests WHERE course_id=?', [cid]);
      // lecture_progress & teacher_feedback & feedback → lectures
      const [lecs] = await conn.query('SELECT id FROM lectures WHERE course_id=?', [cid]);
      if (lecs.length) {
        const lids = lecs.map(l => l.id);
        await conn.query('DELETE FROM lecture_progress  WHERE lecture_id IN (?)', [lids]);
        await conn.query('DELETE FROM teacher_feedback  WHERE lecture_id IN (?)', [lids]);
        await conn.query('DELETE FROM feedback          WHERE lecture_id IN (?)', [lids]);
        await conn.query('DELETE FROM materials         WHERE lecture_id IN (?)', [lids]);
      }
      await conn.query('DELETE FROM lectures  WHERE course_id=?', [cid]);
      await conn.query('DELETE FROM materials WHERE course_id=?', [cid]);
      await conn.query('DELETE FROM enrollments       WHERE course_id=?', [cid]);
      await conn.query('DELETE FROM feedback          WHERE course_id=?', [cid]);
      await conn.query('DELETE FROM teacher_feedback  WHERE course_id=?', [cid]);
      await conn.query('DELETE FROM courses WHERE id=?', [cid]);
      await conn.commit();
      ok(res);
    } catch (e) {
      await conn.rollback();
      console.error(e);
      err(res, 'Lỗi hệ thống', 500);
    } finally { conn.release(); }
  });

// GET /api/admin/courses/:id/students — danh sách học sinh đăng ký khóa
app.get('/api/admin/courses/:id/students', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, e.status, e.progress_percent, e.enrolled_at
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       WHERE e.course_id = ?
       ORDER BY e.enrolled_at DESC`,
      [req.params.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// GET /api/admin/users/:id/progress — chi tiết khóa học + điểm kiểm tra của 1 sinh viên
app.get('/api/admin/users/:id/progress', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    const uid = req.params.id;
    const [[user]] = await pool.query(
      'SELECT id, name, email, status FROM users WHERE id=? AND role="user"', [uid]
    );
    if (!user) return err(res, 'Không tìm thấy học viên', 404);

    const [enrollRows] = await pool.query(
      `SELECT e.course_id, e.status, e.progress_percent, e.enrolled_at,
              c.title AS course_title, c.price,
              cat.name AS category_name, cat.type AS category_type
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN categories cat ON cat.id = c.category_id
       WHERE e.user_id = ?
       ORDER BY e.enrolled_at DESC`,
      [uid]
    );
    if (!enrollRows.length) return ok(res, { user, courses: [] });

    const courseIds = enrollRows.map(r => r.course_id);
    const [testRows] = await pool.query(
      'SELECT id, course_id, title, pass_percent FROM tests WHERE course_id IN (?)',
      [courseIds]
    );
    const testIds = testRows.map(t => t.id);
    let resultRows = [];
    if (testIds.length) {
      const [rr] = await pool.query(
        `SELECT tr.test_id, tr.score, tr.passed, tr.submitted_at
         FROM test_results tr
         INNER JOIN (
           SELECT test_id, MAX(submitted_at) AS latest
           FROM test_results WHERE user_id=? AND test_id IN (?)
           GROUP BY test_id
         ) mx ON mx.test_id=tr.test_id AND mx.latest=tr.submitted_at
         WHERE tr.user_id=?`,
        [uid, testIds, uid]
      );
      resultRows = rr;
    }
    const latestByTest = {};
    resultRows.forEach(r => { latestByTest[r.test_id] = r; });

    const courses = enrollRows.map(e => {
      const courseTests = testRows.filter(t => t.course_id === e.course_id);
      const tests = courseTests.map(t => {
        const r = latestByTest[t.id];
        return { test_id: t.id, test_title: t.title, pass_percent: t.pass_percent,
                 score: r?.score ?? null, passed: r?.passed ?? null, submitted_at: r?.submitted_at ?? null };
      });
      return {
        course_id: e.course_id, course_title: e.course_title,
        category_name: e.category_name, category_type: e.category_type,
        enroll_status: e.status, progress_percent: e.progress_percent,
        enrolled_at: e.enrolled_at, price: e.price || 0, tests,
      };
    });
    ok(res, { user, courses });
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  GV – COURSES
// ═════════════════════════════════════════════════════════════
app.route('/api/gv/courses')
  .get(async (req, res) => {
    const user = roleRequired(req, res, ['gv', 'admin']);
    if (!user) return;
    try {
      const [rows] = await pool.query(`
        SELECT c.*, cat.name AS category_name,
          (SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) AS student_count,
          (SELECT COUNT(*) FROM lectures   WHERE course_id=c.id) AS lecture_count
        FROM courses c LEFT JOIN categories cat ON cat.id=c.category_id
        WHERE c.teacher_id=? ORDER BY c.created_at DESC
      `, [user.id]);
      ok(res, rows);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { title, category_id, description, price } = req.body;
    if (!title) return err(res, 'Thiếu tên khóa học');
    try {
      const [r] = await pool.query(
        "INSERT INTO courses (teacher_id,category_id,title,description,price,band_from,band_to,status) VALUES (?,?,?,?,?,?,?,'pending')",
        [user.id, category_id||null, title, description||null, price||0, '', '']
      );
      ok(res, { id: r.insertId }, 201);
    } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
  });

app.route('/api/gv/courses/:id')
  .put(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { title, category_id, description, price, thumbnail } = req.body;
    try {
      await pool.query(
        'UPDATE courses SET title=?,category_id=?,description=?,price=?,thumbnail=? WHERE id=? AND teacher_id=?',
        [title, category_id||null, description||null, price||0, thumbnail||null, req.params.id, user.id]
      );
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .delete(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    try {
      await pool.query('DELETE FROM courses WHERE id=? AND teacher_id=?', [req.params.id, user.id]);
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

// GET /api/gv/courses/:id/lectures  – dùng cho cascade select trong modal
app.get('/api/gv/courses/:id/lectures', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  try {
    const [[c]] = await pool.query('SELECT id FROM courses WHERE id=? AND teacher_id=?', [req.params.id, user.id]);
    if (!c) return err(res, 'Không có quyền', 403);
    const [rows] = await pool.query('SELECT id,title FROM lectures WHERE course_id=? ORDER BY order_num,id', [req.params.id]);
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  GV – LECTURES
// ═════════════════════════════════════════════════════════════
app.route('/api/gv/lectures')
  .get(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { course_id } = req.query;
    let q = 'SELECT l.*,c.title AS course_title FROM lectures l JOIN courses c ON c.id=l.course_id WHERE c.teacher_id=?';
    const p = [user.id];
    if (course_id) { q += ' AND l.course_id=?'; p.push(course_id); }
    q += ' ORDER BY l.order_num,l.id';
    try { const [rows] = await pool.query(q, p); ok(res, rows); }
    catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { course_id, title, skill, video_url, duration_minutes, order_num, description } = req.body;
    if (!course_id || !title) return err(res, 'Thiếu course_id hoặc tiêu đề');
    try {
      const [[c]] = await pool.query('SELECT id FROM courses WHERE id=? AND teacher_id=?', [course_id, user.id]);
      if (!c) return err(res, 'Khóa học không tồn tại hoặc bạn không có quyền', 403);
      const [r] = await pool.query(
        'INSERT INTO lectures (course_id,title,skill,video_url,duration_minutes,order_num,description) VALUES (?,?,?,?,?,?,?)',
        [course_id, title, skill||'Listening', video_url||null, duration_minutes||null, order_num||0, description||null]
      );
      ok(res, { id: r.insertId }, 201);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

app.route('/api/gv/lectures/:id')
  .put(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { title, video_url, duration_min, order_num, description } = req.body;
    try {
      await pool.query(
        `UPDATE lectures l JOIN courses c ON c.id=l.course_id
         SET l.title=?,l.video_url=?,l.duration_min=?,l.order_num=?,l.description=?
         WHERE l.id=? AND c.teacher_id=?`,
        [title, video_url||null, duration_min||null, order_num||0, description||null, req.params.id, user.id]
      );
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .delete(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    try {
      await pool.query(
        'DELETE l FROM lectures l JOIN courses c ON c.id=l.course_id WHERE l.id=? AND c.teacher_id=?',
        [req.params.id, user.id]
      );
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

// ═════════════════════════════════════════════════════════════
//  GV – MATERIALS
// ═════════════════════════════════════════════════════════════
app.route('/api/gv/materials')
  .get(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { course_id } = req.query;
    let q = 'SELECT m.*,c.title AS course_title,l.title AS lecture_title FROM materials m JOIN courses c ON c.id=m.course_id LEFT JOIN lectures l ON l.id=m.lecture_id WHERE c.teacher_id=?';
    const p = [user.id];
    if (course_id) { q += ' AND m.course_id=?'; p.push(course_id); }
    q += ' ORDER BY m.created_at DESC';
    try { const [rows] = await pool.query(q, p); ok(res, rows); }
    catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(upload.single('file'), async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { course_id, lecture_id, description } = req.body;
    if (!course_id || !req.file) return err(res, 'Thiếu thông tin hoặc file');
    try {
      const [[c]] = await pool.query('SELECT id FROM courses WHERE id=? AND teacher_id=?', [course_id, user.id]);
      if (!c) return err(res, 'Không có quyền', 403);
      const [r] = await pool.query(
        'INSERT INTO materials (course_id,lecture_id,teacher_id,filename,filepath,filetype,filesize,description) VALUES (?,?,?,?,?,?,?,?)',
        [course_id, lecture_id||null, user.id, req.file.originalname, 'uploads/materials/'+req.file.filename, req.file.mimetype, req.file.size, description||null]
      );
      ok(res, { id: r.insertId }, 201);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

app.delete('/api/gv/materials/:id', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  try {
    const [[m]] = await pool.query(
      'SELECT m.filepath FROM materials m JOIN courses c ON c.id=m.course_id WHERE m.id=? AND c.teacher_id=?',
      [req.params.id, user.id]
    );
    if (!m) return err(res, 'Không tìm thấy', 404);
    const fp = path.join(__dirname, m.filepath);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await pool.query('DELETE FROM materials WHERE id=?', [req.params.id]);
    ok(res);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  GV – TESTS
// ═════════════════════════════════════════════════════════════
app.route('/api/gv/tests')
  .get(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { course_id, with_questions } = req.query;
    let q = `SELECT t.*,c.title AS course_title,l.title AS lecture_title,(SELECT COUNT(*) FROM questions WHERE test_id=t.id) AS question_count
             FROM tests t JOIN courses c ON c.id=t.course_id LEFT JOIN lectures l ON l.id=t.lecture_id WHERE c.teacher_id=?`;
    const p = [user.id];
    if (course_id) { q += ' AND t.course_id=?'; p.push(course_id); }
    q += ' ORDER BY t.created_at DESC';
    try {
      const [tests] = await pool.query(q, p);
      if (with_questions === '1') {
        for (const t of tests) {
          const [qs] = await pool.query('SELECT * FROM questions WHERE test_id=? ORDER BY order_num,id', [t.id]);
          t.questions = qs;
        }
      }
      ok(res, tests);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { course_id, lecture_id, title, duration_minutes, num_questions, pass_percent, questions } = req.body;
    if (!course_id || !title) return err(res, 'Thiếu thông tin');
    try {
      const [[c]] = await pool.query('SELECT id FROM courses WHERE id=? AND teacher_id=?', [course_id, user.id]);
      if (!c) return err(res, 'Không có quyền', 403);
      const [r] = await pool.query(
        'INSERT INTO tests (course_id,lecture_id,title,duration_minutes,num_questions,pass_percent) VALUES (?,?,?,?,?,?)',
        [course_id, lecture_id||null, title, duration_minutes||30, num_questions||20, pass_percent||60]
      );
      const testId = r.insertId;
      if (Array.isArray(questions)) {
        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          await pool.query(
            'INSERT INTO questions (test_id,content,option_a,option_b,option_c,option_d,correct,order_num) VALUES (?,?,?,?,?,?,?,?)',
            [testId, q.content, q.option_a, q.option_b, q.option_c||null, q.option_d||null, q.correct, i+1]
          );
        }
      }
      ok(res, { id: testId }, 201);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

app.route('/api/gv/tests/:id')
  .put(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { title, duration_min, pass_score } = req.body;
    try {
      await pool.query(
        'UPDATE tests t JOIN courses c ON c.id=t.course_id SET t.title=?,t.duration_min=?,t.pass_score=? WHERE t.id=? AND c.teacher_id=?',
        [title, duration_min||60, pass_score||70, req.params.id, user.id]
      );
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .delete(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    try {
      await pool.query(
        'DELETE t FROM tests t JOIN courses c ON c.id=t.course_id WHERE t.id=? AND c.teacher_id=?',
        [req.params.id, user.id]
      );
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

// ═════════════════════════════════════════════════════════════
//  GV – FEEDBACK (nhận xét học sinh)
// ═════════════════════════════════════════════════════════════
app.route('/api/gv/feedback')
  .get(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    try {
      const [rows] = await pool.query(
        `SELECT tf.*, u.name AS student_name, u.email AS student_email,
                c.title AS course_title, l.title AS lecture_title
         FROM teacher_feedback tf
         JOIN users   u ON u.id = tf.student_id
         JOIN courses c ON c.id = tf.course_id
         JOIN lectures l ON l.id = tf.lecture_id
         WHERE tf.teacher_id = ?
         ORDER BY tf.updated_at DESC`,
        [user.id]
      );
      ok(res, rows);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { student_id, course_id, lecture_id, content } = req.body;
    if (!student_id || !course_id || !lecture_id || !content?.trim()) return err(res, 'Thiếu thông tin');
    try {
      const [[enroll]] = await pool.query(
        `SELECT e.id FROM enrollments e JOIN courses c ON c.id=e.course_id
         WHERE e.user_id=? AND e.course_id=? AND c.teacher_id=?`,
        [student_id, course_id, user.id]
      );
      if (!enroll) return err(res, 'Học sinh không thuộc khóa học của bạn', 403);
      const [r] = await pool.query(
        `INSERT INTO teacher_feedback (teacher_id, student_id, course_id, lecture_id, content)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE content=VALUES(content), updated_at=CURRENT_TIMESTAMP`,
        [user.id, student_id, course_id, lecture_id, content.trim()]
      );
      ok(res, { id: r.insertId || null }, 201);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

app.route('/api/gv/feedback/:id')
  .put(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { content } = req.body;
    if (!content?.trim()) return err(res, 'Nội dung không được để trống');
    try {
      const [r] = await pool.query(
        'UPDATE teacher_feedback SET content=? WHERE id=? AND teacher_id=?',
        [content.trim(), req.params.id, user.id]
      );
      if (!r.affectedRows) return err(res, 'Không tìm thấy', 404);
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .delete(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    try {
      await pool.query('DELETE FROM teacher_feedback WHERE id=? AND teacher_id=?', [req.params.id, user.id]);
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

// GET /api/user/courses/:id/feedback – nhận xét GV cho học sinh trong khóa này
app.get('/api/user/courses/:id/feedback', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  try {
    const [rows] = await pool.query(
      `SELECT tf.id, tf.lecture_id, tf.content, tf.updated_at,
              u.name AS teacher_name
       FROM teacher_feedback tf
       JOIN users u ON u.id = tf.teacher_id
       WHERE tf.course_id=? AND tf.student_id=?
       ORDER BY tf.lecture_id`,
      [req.params.id, user.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  GV – STUDENTS
// ═════════════════════════════════════════════════════════════
// POST /api/gv/enrollments/complete — GV xác nhận học sinh hoàn thành khóa học
app.post('/api/gv/enrollments/complete', async (req, res) => {
  const gv = roleRequired(req, res, 'gv');
  if (!gv) return;
  const { user_id, course_id } = req.body;
  if (!user_id || !course_id) return err(res, 'Thiếu tham số');
  try {
    // Kiểm tra khóa học thuộc về GV này
    const [[course]] = await pool.query(
      'SELECT id FROM courses WHERE id=? AND teacher_id=?', [course_id, gv.id]
    );
    if (!course) return err(res, 'Không có quyền', 403);
    // Kiểm tra học sinh đang active và tiến độ 100%
    const [[enroll]] = await pool.query(
      `SELECT id, progress_percent FROM enrollments
       WHERE user_id=? AND course_id=? AND status='active'`,
      [user_id, course_id]
    );
    if (!enroll) return err(res, 'Không tìm thấy đăng ký active');
    if (enroll.progress_percent < 100) return err(res, 'Học viên chưa hoàn thành 100%');
    await pool.query(
      `UPDATE enrollments SET status='completed' WHERE id=?`, [enroll.id]
    );
    ok(res, { message: 'Đã xác nhận hoàn thành' });
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

app.get('/api/gv/students', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  const { course_id } = req.query;
  let q = `SELECT u.id, u.name, u.email, u.phone,
                  c.id AS course_id, c.title AS course_title,
                  e.status AS enroll_status, e.progress_percent, e.enrolled_at
           FROM enrollments e
           JOIN users   u ON u.id = e.user_id
           JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = ?`;
  const p = [user.id];
  if (course_id) { q += ' AND c.id=?'; p.push(course_id); }
  q += ' ORDER BY e.enrolled_at DESC';
  try { const [rows] = await pool.query(q, p); ok(res, rows); }
  catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  GV – RESULTS
// ═════════════════════════════════════════════════════════════
// GET /api/gv/results — all test results for students in GV's courses
app.get('/api/gv/results', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  try {
    const [rows] = await pool.query(
      `SELECT u.name AS student_name, u.email AS student_email,
              t.title AS test_title, c.id AS course_id, c.title AS course_title,
              tr.score, tr.passed, tr.submitted_at
       FROM test_results tr
       JOIN users u  ON u.id  = tr.user_id
       JOIN tests t  ON t.id  = tr.test_id
       JOIN courses c ON c.id = t.course_id
       WHERE c.teacher_id = ?
       ORDER BY tr.submitted_at DESC
       LIMIT 300`,
      [user.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  GV – FEEDBACK
// ═════════════════════════════════════════════════════════════
app.route('/api/gv/feedback')
  .get(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    try {
      const [rows] = await pool.query(
        `SELECT f.*,u.name AS student_name,c.title AS course_title
         FROM feedback f JOIN users u ON u.id=f.user_id JOIN courses c ON c.id=f.course_id
         WHERE c.teacher_id=? ORDER BY f.created_at DESC`, [user.id]);
      ok(res, rows);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  })
  .post(async (req, res) => {
    const user = roleRequired(req, res, 'gv');
    if (!user) return;
    const { feedback_id, reply } = req.body;
    if (!feedback_id || !reply) return err(res, 'Thiếu thông tin');
    try {
      await pool.query('UPDATE feedback SET reply=?,replied_at=NOW() WHERE id=?', [reply, feedback_id]);
      ok(res);
    } catch (e) { err(res, 'Lỗi hệ thống', 500); }
  });

// ═════════════════════════════════════════════════════════════
//  USER – ENROLL & LEARNING
// ═════════════════════════════════════════════════════════════

// Đăng ký khóa học → chờ admin duyệt
app.post('/api/user/enroll/:courseId', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  const courseId = req.params.courseId;
  try {
    const [[course]] = await pool.query("SELECT id,title FROM courses WHERE id=? AND status='active'", [courseId]);
    if (!course) return err(res, 'Khóa học không tồn tại hoặc chưa được duyệt', 404);
    const [[existing]] = await pool.query('SELECT id,status FROM enrollments WHERE user_id=? AND course_id=?', [user.id, courseId]);
    if (existing) return ok(res, { already: true, status: existing.status, message: 'Bạn đã gửi yêu cầu đăng ký khóa học này rồi' });
    await pool.query(
      "INSERT INTO enrollments (user_id,course_id,progress_percent,status) VALUES (?,?,0,'pending')",
      [user.id, courseId]
    );
    ok(res, { enrolled: true, pending: true, course_id: courseId, title: course.title });
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

// Danh sách khóa học đã đăng ký của học viên
app.get('/api/user/courses', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  try {
    const [rows] = await pool.query(`
      SELECT c.id, c.title, c.description, c.price,
             cat.name AS category_name, cat.type AS category_type,
             u.name   AS teacher_name,
             e.id AS enrollment_id, e.progress_percent, e.status AS enroll_status, e.enrolled_at,
             (SELECT COUNT(*) FROM lectures WHERE course_id=c.id) AS lecture_count
      FROM enrollments e
      JOIN courses    c   ON c.id  = e.course_id
      LEFT JOIN categories cat ON cat.id = c.category_id
      LEFT JOIN users      u   ON u.id  = c.teacher_id
      WHERE e.user_id = ? ORDER BY e.enrolled_at DESC
    `, [user.id]);
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// GET /api/user/progress-summary — tiến độ & điểm bài kiểm tra theo từng khóa đã đăng ký
app.get('/api/user/progress-summary', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  try {
    // Khóa đang học hoặc đã hoàn thành
    const [enrollRows] = await pool.query(
      `SELECT e.course_id, e.progress_percent, e.status,
              c.title AS course_title,
              cat.name AS category_name, cat.type AS category_type
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN categories cat ON cat.id = c.category_id
       WHERE e.user_id = ? AND e.status IN ('active','completed')
       ORDER BY e.enrolled_at DESC`,
      [user.id]
    );
    if (!enrollRows.length) return ok(res, []);

    const courseIds = enrollRows.map(r => r.course_id);

    // Tất cả bài kiểm tra của các khóa này
    const [testRows] = await pool.query(
      `SELECT id, course_id, title, pass_percent FROM tests WHERE course_id IN (?)`,
      [courseIds]
    );

    // Kết quả kiểm tra mới nhất cho mỗi (user, test)
    let resultRows = [];
    const testIds = testRows.map(t => t.id);
    if (testIds.length) {
      const [rr] = await pool.query(
        `SELECT tr.test_id, tr.score, tr.passed, tr.submitted_at
         FROM test_results tr
         INNER JOIN (
           SELECT test_id, MAX(submitted_at) AS latest
           FROM test_results WHERE user_id = ? AND test_id IN (?)
           GROUP BY test_id
         ) mx ON mx.test_id = tr.test_id AND mx.latest = tr.submitted_at
         WHERE tr.user_id = ?`,
        [user.id, testIds, user.id]
      );
      resultRows = rr;
    }

    const latestByTest = {};
    resultRows.forEach(r => { latestByTest[r.test_id] = r; });

    // Tổng hợp theo khóa
    const summary = enrollRows.map(e => {
      const courseTests = testRows.filter(t => t.course_id === e.course_id);
      const testDetails = courseTests.map(t => {
        const r = latestByTest[t.id];
        return {
          test_id:      t.id,
          test_title:   t.title,
          pass_percent: t.pass_percent,
          score:        r ? r.score        : null,
          passed:       r ? r.passed       : null,
          submitted_at: r ? r.submitted_at : null,
        };
      });
      const done   = testDetails.filter(t => t.score !== null);
      const passed = done.filter(t => t.passed);
      const avg    = done.length
        ? Math.round(done.reduce((s, t) => s + t.score, 0) / done.length)
        : null;
      return {
        course_id:        e.course_id,
        course_title:     e.course_title,
        category_name:    e.category_name,
        category_type:    e.category_type,
        progress_percent: e.progress_percent,
        enroll_status:    e.status,
        total_tests:      courseTests.length,
        done_tests:       done.length,
        passed_tests:     passed.length,
        avg_score:        avg,
        test_details:     testDetails,
      };
    });

    ok(res, summary);
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

// GET /api/user/courses/:id/completion — xem kết quả hoàn thành (điểm TB, comment GV, tài liệu)
app.get('/api/user/courses/:id/completion', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  const courseId = req.params.id;
  try {
    const [[enroll]] = await pool.query(
      `SELECT e.id, e.status, e.progress_percent, c.title AS course_title,
              cat.name AS category_name, u.name AS teacher_name
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN users u ON u.id = c.teacher_id
       WHERE e.user_id=? AND e.course_id=?`,
      [user.id, courseId]
    );
    if (!enroll) return err(res, 'Chưa đăng ký khóa này', 403);

    // Điểm kiểm tra mới nhất từng bài
    const [testRows] = await pool.query(
      `SELECT t.title AS test_title, tr.score, tr.passed, tr.submitted_at
       FROM tests t
       LEFT JOIN (
         SELECT test_id, score, passed, submitted_at
         FROM test_results
         WHERE user_id=?
         ORDER BY submitted_at DESC
       ) tr ON tr.test_id = t.id
       WHERE t.course_id=?
       GROUP BY t.id, t.title, tr.score, tr.passed, tr.submitted_at
       ORDER BY t.id`,
      [user.id, courseId]
    );
    const done   = testRows.filter(t => t.score !== null);
    const avg    = done.length ? Math.round(done.reduce((s,t) => s+t.score, 0) / done.length) : null;
    const passed = done.filter(t => t.passed).length;

    // Nhận xét GV
    const [feedbackRows] = await pool.query(
      `SELECT gf.content, gf.updated_at, u.name AS teacher_name, l.title AS lecture_title
       FROM gv_feedback gf
       JOIN lectures l ON l.id = gf.lecture_id
       JOIN users u ON u.id = gf.teacher_id
       WHERE l.course_id=? AND gf.student_id=?
       ORDER BY gf.updated_at DESC`,
      [courseId, user.id]
    );

    // Tài liệu GV đã upload
    const [materials] = await pool.query(
      `SELECT m.filename, m.filepath, m.filesize, m.description, l.title AS lecture_title
       FROM materials m
       JOIN lectures l ON l.id = m.lecture_id
       WHERE l.course_id=?
       ORDER BY l.order_num, l.id, m.id`,
      [courseId]
    );

    ok(res, {
      course_title: enroll.course_title,
      category_name: enroll.category_name,
      teacher_name: enroll.teacher_name,
      enroll_status: enroll.status,
      progress_percent: enroll.progress_percent,
      avg_score: avg,
      tests_done: done.length,
      tests_passed: passed,
      tests_total: testRows.length,
      test_results: testRows,
      feedback: feedbackRows,
      materials,
    });
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

// Chi tiết khóa học + danh sách bài giảng — chỉ cho status=active
app.get('/api/user/courses/:id', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  const courseId = req.params.id;
  try {
    const [[enroll]] = await pool.query(
      'SELECT * FROM enrollments WHERE user_id=? AND course_id=?', [user.id, courseId]
    );
    if (!enroll)                       return err(res, 'Bạn chưa đăng ký khóa học này', 403);
    if (enroll.status === 'pending')   return err(res, 'Đăng ký của bạn đang chờ Admin phê duyệt', 403);
    if (enroll.status === 'rejected')  return err(res, 'Đăng ký của bạn đã bị từ chối', 403);
    const [[course]] = await pool.query(`
      SELECT c.*, cat.name AS category_name, cat.type AS category_type, u.name AS teacher_name
      FROM courses c
      LEFT JOIN categories cat ON cat.id = c.category_id
      LEFT JOIN users      u   ON u.id  = c.teacher_id
      WHERE c.id = ?
    `, [courseId]);
    const [lectures] = await pool.query(
      'SELECT * FROM lectures WHERE course_id=? ORDER BY order_num, id', [courseId]
    );
    const [tests] = await pool.query(
      'SELECT id,lecture_id,title,duration_minutes,num_questions,pass_percent FROM tests WHERE course_id=?', [courseId]
    );
    const [materials] = await pool.query(
      'SELECT id,lecture_id,filename,filepath,filetype,filesize,description FROM materials WHERE course_id=?', [courseId]
    );
    // Danh sách test_id mà user đã pass (dùng để lock/unlock bài giảng)
    let passed_test_ids = [];
    if (tests.length) {
      const [ptRows] = await pool.query(
        `SELECT DISTINCT test_id FROM test_results
         WHERE user_id=? AND test_id IN (?) AND passed=1`,
        [user.id, tests.map(t => t.id)]
      );
      passed_test_ids = ptRows.map(r => r.test_id);
    }
    // Recalculate tiến độ đúng (sửa dữ liệu cũ sai nếu có)
    const correct_pct = await calcProgress(user.id, courseId);
    if (correct_pct !== enroll.progress_percent) {
      await pool.query(
        'UPDATE enrollments SET progress_percent=? WHERE user_id=? AND course_id=?',
        [correct_pct, user.id, courseId]
      );
      enroll.progress_percent = correct_pct;
    }
    ok(res, { course, lectures, tests, materials, enrollment: enroll, passed_test_ids });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// POST /api/user/lectures/:id/complete — đánh dấu bài giảng đã xem xong + cập nhật tiến độ
app.post('/api/user/lectures/:id/complete', async (req, res) => {
  const user = roleRequired(req, res, 'user');
  if (!user) return;
  const lectureId = req.params.id;
  try {
    const [[lec]] = await pool.query('SELECT id, course_id FROM lectures WHERE id=?', [lectureId]);
    if (!lec) return err(res, 'Không tìm thấy bài giảng', 404);
    const [[enroll]] = await pool.query(
      `SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')`,
      [user.id, lec.course_id]
    );
    if (!enroll) return err(res, 'Chưa đăng ký', 403);
    const pct = await completeLecture(user.id, lectureId, lec.course_id);
    ok(res, { progress_percent: pct });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ── Profile học viên ──────────────────────────────────────────
app.get('/api/user/profile', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  try {
    const [[u]] = await pool.query(
      'SELECT id,name,email,phone,role,avatar,created_at FROM users WHERE id=?', [user.id]
    );
    const [[stats]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status='active') AS active_count,
              SUM(status='pending') AS pending_count,
              SUM(status='completed') AS completed_count
       FROM enrollments WHERE user_id=?`, [user.id]
    );
    ok(res, { ...u, stats });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

app.put('/api/user/profile', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  const { name, phone } = req.body;
  if (!name?.trim()) return err(res, 'Tên không được để trống');
  try {
    await pool.query('UPDATE users SET name=?,phone=? WHERE id=?', [name.trim(), phone||null, user.id]);
    req.session.user = { ...req.session.user, name: name.trim() };
    ok(res, { updated: true });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

app.put('/api/user/password', async (req, res) => {
  const user = req.session.user;
  if (!user) return err(res, 'Chưa đăng nhập', 401);
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return err(res, 'Thiếu thông tin');
  if (new_password.length < 6) return err(res, 'Mật khẩu mới phải có ít nhất 6 ký tự');
  try {
    const [[u]] = await pool.query('SELECT password FROM users WHERE id=?', [user.id]);
    const hash = u.password.replace(/^\$2y\$/, '$2b$');
    if (!(await bcrypt.compare(current_password, hash))) return err(res, 'Mật khẩu hiện tại không đúng');
    const newHash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password=? WHERE id=?', [newHash, user.id]);
    ok(res, { updated: true });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ── Admin: Duyệt đăng ký học viên ────────────────────────────
app.get('/api/admin/enrollments', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    const { status } = req.query;
    let sql = `
      SELECT e.id, e.status, e.enrolled_at,
             u.id AS user_id, u.name AS user_name, u.email AS user_email,
             c.id AS course_id, c.title AS course_title,
             cat.name AS category_name
      FROM enrollments e
      JOIN users    u   ON u.id  = e.user_id
      JOIN courses  c   ON c.id  = e.course_id
      LEFT JOIN categories cat ON cat.id = c.category_id`;
    const params = [];
    if (status) { sql += ' WHERE e.status=?'; params.push(status); }
    sql += ' ORDER BY e.enrolled_at DESC';
    const [rows] = await pool.query(sql, params);
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

app.put('/api/admin/enrollments/:id', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  const { action } = req.body; // 'approve' | 'reject'
  if (!['approve','reject'].includes(action)) return err(res, 'Action không hợp lệ');
  const newStatus = action === 'approve' ? 'active' : 'rejected';
  try {
    const [r] = await pool.query('UPDATE enrollments SET status=? WHERE id=?', [newStatus, req.params.id]);
    if (r.affectedRows === 0) return err(res, 'Không tìm thấy đăng ký', 404);
    ok(res, { updated: true, status: newStatus });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  USER – LÀM BÀI KIỂM TRA (course tests – enrollment required)
// ═════════════════════════════════════════════════════════════

// GET /api/user/tests/:id  — load đề + câu hỏi (không có đáp án)
app.get('/api/user/tests/:id', async (req, res) => {
  const user = roleRequired(req, res, 'user');
  if (!user) return;
  try {
    const [[t]] = await pool.query(
      `SELECT t.id, t.title, t.duration_minutes, t.num_questions, t.pass_percent,
              t.course_id, t.lecture_id, c.title AS course_title
       FROM tests t JOIN courses c ON c.id=t.course_id WHERE t.id=?`,
      [req.params.id]
    );
    if (!t) return err(res, 'Không tìm thấy bài kiểm tra', 404);
    // Phải đăng ký và được duyệt mới làm bài
    const [[enroll]] = await pool.query(
      `SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')`,
      [user.id, t.course_id]
    );
    if (!enroll) return err(res, 'Bạn chưa đăng ký hoặc chưa được duyệt vào khóa học này', 403);
    const [questions] = await pool.query(
      `SELECT id, question_text, option_a, option_b, option_c, option_d
       FROM questions WHERE test_id=? ORDER BY order_num, id`,
      [req.params.id]
    );
    if (!questions.length) return err(res, 'Bài kiểm tra chưa có câu hỏi', 422);
    ok(res, { test: t, questions });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// POST /api/user/tests/:id/submit  — nộp bài, trả về điểm
app.post('/api/user/tests/:id/submit', async (req, res) => {
  const user = roleRequired(req, res, 'user');
  if (!user) return;
  const { answers } = req.body; // { "questionId": "A", ... }
  if (!answers || typeof answers !== 'object') return err(res, 'Dữ liệu không hợp lệ');
  try {
    const [[t]] = await pool.query(
      `SELECT t.id, t.pass_percent, t.course_id FROM tests t WHERE t.id=?`,
      [req.params.id]
    );
    if (!t) return err(res, 'Không tìm thấy', 404);
    const [[enroll]] = await pool.query(
      `SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')`,
      [user.id, t.course_id]
    );
    if (!enroll) return err(res, 'Chưa đăng ký', 403);
    const [questions] = await pool.query(
      `SELECT id, correct_answer FROM questions WHERE test_id=?`,
      [req.params.id]
    );
    let correct = 0;
    const review = questions.map(q => {
      const chosen = answers[String(q.id)] || null;
      const isCorrect = chosen === q.correct_answer;
      if (isCorrect) correct++;
      return { id: q.id, correct_answer: q.correct_answer, chosen, is_correct: isCorrect };
    });
    const total  = questions.length;
    const score  = total > 0 ? Math.round((correct / total) * 100) : 0;
    const passed = score >= (t.pass_percent || 60);
    await pool.query(
      `INSERT INTO test_results (user_id, test_id, score, passed) VALUES (?,?,?,?)`,
      [user.id, req.params.id, score, passed ? 1 : 0]
    );
    // Nếu đạt → đánh dấu bài giảng hoàn thành và cập nhật tiến độ
    let progress_percent = null;
    if (passed) {
      const [[tFull]] = await pool.query('SELECT lecture_id FROM tests WHERE id=?', [req.params.id]);
      if (tFull?.lecture_id) {
        progress_percent = await completeLecture(user.id, tFull.lecture_id, t.course_id);
      }
    }
    ok(res, { score, correct, total, passed, pass_percent: t.pass_percent, review, progress_percent });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  USER – LÀM BÀI TEST THỬ / LUYỆN ĐỀ (admin tests – login required)
// ═════════════════════════════════════════════════════════════

// GET /api/user/admin-tests/:id  — load đề + câu hỏi
app.get('/api/user/admin-tests/:id', async (req, res) => {
  if (!req.session?.user) return err(res, 'Vui lòng đăng nhập để làm bài', 401);
  try {
    const [[t]] = await pool.query(
      `SELECT at.id, at.title, at.type, at.duration_minutes, at.num_questions, at.pass_percent,
              cat.name AS category_name
       FROM admin_tests at LEFT JOIN categories cat ON cat.id=at.category_id
       WHERE at.id=? AND at.status='active'`,
      [req.params.id]
    );
    if (!t) return err(res, 'Không tìm thấy bài thi', 404);
    const [questions] = await pool.query(
      `SELECT id, question_text, option_a, option_b, option_c, option_d
       FROM admin_questions WHERE admin_test_id=? ORDER BY order_num, id`,
      [req.params.id]
    );
    if (!questions.length) return err(res, 'Bài thi chưa có câu hỏi', 422);
    ok(res, { test: t, questions });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// POST /api/user/admin-tests/:id/submit
app.post('/api/user/admin-tests/:id/submit', async (req, res) => {
  if (!req.session?.user) return err(res, 'Vui lòng đăng nhập', 401);
  const user = req.session.user;
  const { answers } = req.body;
  if (!answers || typeof answers !== 'object') return err(res, 'Dữ liệu không hợp lệ');
  try {
    const [[t]] = await pool.query(
      `SELECT id, pass_percent FROM admin_tests WHERE id=? AND status='active'`,
      [req.params.id]
    );
    if (!t) return err(res, 'Không tìm thấy', 404);
    const [questions] = await pool.query(
      `SELECT id, correct_answer FROM admin_questions WHERE admin_test_id=?`,
      [req.params.id]
    );
    let correct = 0;
    const review = questions.map(q => {
      const chosen = answers[String(q.id)] || null;
      const isCorrect = chosen === q.correct_answer;
      if (isCorrect) correct++;
      return { id: q.id, correct_answer: q.correct_answer, chosen, is_correct: isCorrect };
    });
    const total  = questions.length;
    const score  = total > 0 ? Math.round((correct / total) * 100) : 0;
    const passed = score >= (t.pass_percent || 60);
    await pool.query(
      `INSERT INTO admin_test_results (user_id, admin_test_id, score, correct, total, passed) VALUES (?,?,?,?,?,?)`,
      [user.id, req.params.id, score, correct, total, passed ? 1 : 0]
    );
    ok(res, { score, correct, total, passed, pass_percent: t.pass_percent, review });
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  GV – QUESTIONS (course tests, per-lecture)
// ═════════════════════════════════════════════════════════════

// GET  /api/gv/tests/:id/questions  — list all questions of a test
app.get('/api/gv/tests/:id/questions', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  try {
    // Verify teacher owns this test
    const [[t]] = await pool.query(
      'SELECT t.id FROM tests t JOIN courses c ON c.id=t.course_id WHERE t.id=? AND c.teacher_id=?',
      [req.params.id, user.id]
    );
    if (!t) return err(res, 'Không có quyền', 403);
    const [rows] = await pool.query(
      'SELECT * FROM questions WHERE test_id=? ORDER BY order_num,id',
      [req.params.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// POST /api/gv/tests/:id/questions  — add one question
app.post('/api/gv/tests/:id/questions', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  const { question_text, option_a, option_b, option_c, option_d, correct_answer, order_num } = req.body;
  if (!question_text || !option_a || !option_b || !option_c || !option_d || !correct_answer)
    return err(res, 'Thiếu thông tin câu hỏi');
  if (!['A','B','C','D'].includes(correct_answer))
    return err(res, 'Đáp án không hợp lệ (A/B/C/D)');
  try {
    const [[t]] = await pool.query(
      'SELECT t.id FROM tests t JOIN courses c ON c.id=t.course_id WHERE t.id=? AND c.teacher_id=?',
      [req.params.id, user.id]
    );
    if (!t) return err(res, 'Không có quyền', 403);
    const [r] = await pool.query(
      'INSERT INTO questions (test_id,question_text,option_a,option_b,option_c,option_d,correct_answer,order_num) VALUES (?,?,?,?,?,?,?,?)',
      [req.params.id, question_text, option_a, option_b, option_c, option_d, correct_answer, order_num||0]
    );
    // Update num_questions
    await pool.query('UPDATE tests SET num_questions=(SELECT COUNT(*) FROM questions WHERE test_id=?) WHERE id=?', [req.params.id, req.params.id]);
    ok(res, { id: r.insertId }, 201);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// DELETE /api/gv/tests/:testId/questions/:qId  — remove one question
app.delete('/api/gv/tests/:testId/questions/:qId', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  try {
    const [[t]] = await pool.query(
      'SELECT t.id FROM tests t JOIN courses c ON c.id=t.course_id WHERE t.id=? AND c.teacher_id=?',
      [req.params.testId, user.id]
    );
    if (!t) return err(res, 'Không có quyền', 403);
    await pool.query('DELETE FROM questions WHERE id=? AND test_id=?', [req.params.qId, req.params.testId]);
    await pool.query('UPDATE tests SET num_questions=(SELECT COUNT(*) FROM questions WHERE test_id=?) WHERE id=?', [req.params.testId, req.params.testId]);
    ok(res);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// DELETE /api/gv/tests/:id/questions  — clear all questions
app.delete('/api/gv/tests/:id/questions', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  try {
    const [[t]] = await pool.query(
      'SELECT t.id FROM tests t JOIN courses c ON c.id=t.course_id WHERE t.id=? AND c.teacher_id=?',
      [req.params.id, user.id]
    );
    if (!t) return err(res, 'Không có quyền', 403);
    await pool.query('DELETE FROM questions WHERE test_id=?', [req.params.id]);
    await pool.query('UPDATE tests SET num_questions=0 WHERE id=?', [req.params.id]);
    ok(res);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  ADMIN – QUESTIONS (admin_tests: test thử & luyện đề)
// ═════════════════════════════════════════════════════════════

// GET  /api/admin/admin-tests/:id/questions
app.get('/api/admin/admin-tests/:id/questions', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    const [rows] = await pool.query(
      'SELECT * FROM admin_questions WHERE admin_test_id=? ORDER BY order_num,id',
      [req.params.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// GET  /api/admin/admin-tests/:id/questions/template  — download Excel template
app.get('/api/admin/admin-tests/:id/questions/template', (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  const wb = XLSX.utils.book_new();
  const headers = [['question_text','option_a','option_b','option_c','option_d','correct_answer']];
  const example = [['What does "ubiquitous" mean?','Rare','Present everywhere','Hidden','Ancient','B']];
  const ws = XLSX.utils.aoa_to_sheet([...headers, ...example]);
  // Column widths
  ws['!cols'] = [{ wch: 60 }, { wch: 30 }, { wch: 30 }, { wch: 30 }, { wch: 30 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="question_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /api/admin/admin-tests/:id/questions/upload  — upload Excel
app.post('/api/admin/admin-tests/:id/questions/upload', uploadExcel.single('file'), async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  if (!req.file) return err(res, 'Không tìm thấy file');
  try {
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows.length) return err(res, 'File không có dữ liệu');

    const valid = [];
    const errors = [];
    rows.forEach((r, i) => {
      const q = (r['question_text']||'').toString().trim();
      const a = (r['option_a']||'').toString().trim();
      const b = (r['option_b']||'').toString().trim();
      const c = (r['option_c']||'').toString().trim();
      const d = (r['option_d']||'').toString().trim();
      const ans = (r['correct_answer']||'').toString().trim().toUpperCase();
      if (!q || !a || !b || !c || !d) { errors.push(`Dòng ${i+2}: thiếu nội dung`); return; }
      if (!['A','B','C','D'].includes(ans)) { errors.push(`Dòng ${i+2}: correct_answer phải là A/B/C/D`); return; }
      valid.push([req.params.id, q, a, b, c, d, ans, i]);
    });

    if (errors.length && !valid.length) return err(res, 'File lỗi: ' + errors.slice(0,3).join('; '));

    // Replace existing questions
    await pool.query('DELETE FROM admin_questions WHERE admin_test_id=?', [req.params.id]);
    if (valid.length) {
      await pool.query(
        'INSERT INTO admin_questions (admin_test_id,question_text,option_a,option_b,option_c,option_d,correct_answer,order_num) VALUES ?',
        [valid]
      );
    }
    // Update num_questions in admin_tests
    await pool.query('UPDATE admin_tests SET num_questions=? WHERE id=?', [valid.length, req.params.id]);

    ok(res, {
      imported: valid.length,
      skipped:  errors.length,
      errors:   errors.slice(0, 10),
    });
  } catch (e) {
    console.error(e);
    err(res, 'Không thể đọc file: ' + e.message, 500);
  }
});

// DELETE /api/admin/admin-tests/:id/questions  — clear all
app.delete('/api/admin/admin-tests/:id/questions', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    await pool.query('DELETE FROM admin_questions WHERE admin_test_id=?', [req.params.id]);
    await pool.query('UPDATE admin_tests SET num_questions=0 WHERE id=?', [req.params.id]);
    ok(res);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  GV – STATISTICS
// ═════════════════════════════════════════════════════════════

// GET /api/gv/stats — summary stats for a GV
app.get('/api/gv/stats', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  try {
    const [[totalRow]] = await pool.query(
      `SELECT COUNT(DISTINCT e.user_id) AS total_students,
              (SELECT COUNT(*) FROM courses WHERE teacher_id = ?) AS total_courses
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       WHERE c.teacher_id = ? AND e.status IN ('active','completed')`,
      [user.id, user.id]
    );

    const [perCourse] = await pool.query(
      `SELECT c.id, c.title, c.status,
              COUNT(DISTINCT e.user_id)     AS student_count,
              ROUND(AVG(e.progress_percent),1) AS avg_progress
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.status IN ('active','completed')
       WHERE c.teacher_id = ?
       GROUP BY c.id, c.title, c.status
       ORDER BY student_count DESC, c.created_at DESC`,
      [user.id]
    );

    ok(res, { total_students: totalRow.total_students || 0, total_courses: totalRow.total_courses || 0, per_course: perCourse });
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

// GET /api/gv/courses/:id/student-progress — detailed progress for one course
app.get('/api/gv/courses/:id/student-progress', async (req, res) => {
  const user = roleRequired(req, res, 'gv');
  if (!user) return;
  const courseId = req.params.id;
  try {
    // Verify ownership
    const [[course]] = await pool.query(
      'SELECT id, title FROM courses WHERE id = ? AND teacher_id = ?',
      [courseId, user.id]
    );
    if (!course) return err(res, 'Không có quyền', 403);

    const [[{ total_lectures }]] = await pool.query(
      'SELECT COUNT(*) AS total_lectures FROM lectures WHERE course_id = ?',
      [courseId]
    );

    // Enrolled students with their completed lecture count
    const [students] = await pool.query(
      `SELECT u.id, u.name, u.email, e.progress_percent, e.status, e.enrolled_at,
              (SELECT COUNT(*) FROM lecture_progress lp
               JOIN lectures l ON l.id = lp.lecture_id
               WHERE l.course_id = ? AND lp.user_id = u.id AND lp.completed = 1) AS completed_lectures
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       WHERE e.course_id = ? AND e.status IN ('active','completed')
       ORDER BY e.enrolled_at DESC`,
      [courseId, courseId]
    );

    // All test results for this course (latest attempt per student per test)
    const [testResults] = await pool.query(
      `SELECT t.id AS test_id, t.title AS test_title, t.pass_percent,
              tr.user_id, tr.score, tr.passed, tr.submitted_at
       FROM tests t
       LEFT JOIN test_results tr ON tr.test_id = t.id
       WHERE t.course_id = ?
       ORDER BY t.id, tr.submitted_at DESC`,
      [courseId]
    );

    // Get distinct tests for this course
    const testsMap = {};
    testResults.forEach(r => {
      if (!testsMap[r.test_id]) testsMap[r.test_id] = { id: r.test_id, title: r.test_title, pass_percent: r.pass_percent };
    });

    // Map results per student (take latest)
    const resultByStudentTest = {};
    testResults.forEach(r => {
      if (!r.user_id) return;
      const key = `${r.user_id}_${r.test_id}`;
      if (!resultByStudentTest[key]) resultByStudentTest[key] = r; // already ordered by submitted_at DESC
    });

    const tests = Object.values(testsMap);

    const studentsWithTests = students.map(s => ({
      ...s,
      tests: tests.map(t => {
        const r = resultByStudentTest[`${s.id}_${t.id}`];
        return { test_id: t.id, test_title: t.title, pass_percent: t.pass_percent,
                 score: r ? r.score : null, passed: r ? !!r.passed : null, submitted_at: r ? r.submitted_at : null };
      }),
    }));

    ok(res, { course, total_lectures, tests, students: studentsWithTests });
  } catch (e) { console.error(e); err(res, 'Lỗi hệ thống', 500); }
});

// ═════════════════════════════════════════════════════════════
//  ADMIN – STATISTICS
// ═════════════════════════════════════════════════════════════

// GET /api/admin/students-progress — all students with enrollment + test score summary
app.get('/api/admin/students-progress', async (req, res) => {
  if (!roleRequired(req, res, 'admin')) return;
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.status, u.created_at,
              COUNT(DISTINCT e.id)               AS courses_enrolled,
              ROUND(AVG(e.progress_percent), 1)  AS avg_progress,
              MAX(e.enrolled_at)                 AS last_enrolled,
              ROUND(AVG(tr.score), 1)            AS avg_score
       FROM users u
       LEFT JOIN enrollments e  ON e.user_id  = u.id AND e.status IN ('active','completed')
       LEFT JOIN test_results tr ON tr.user_id = u.id
       WHERE u.role = 'user'
       GROUP BY u.id, u.name, u.email, u.status, u.created_at
       ORDER BY courses_enrolled DESC, last_enrolled DESC`
    );
    ok(res, rows);
  } catch (e) { err(res, 'Lỗi hệ thống', 500); }
});

// ─────────────────────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅  EngPro đang chạy tại http://localhost:${PORT}`);
});

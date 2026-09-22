// Số việc chờ admin xử lý hiện trên menu: khóa chờ duyệt, đăng ký chờ duyệt, tin nhắn liên hệ mới
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
function client() { let cookie = ''; return async (method, url, body) => { const o = { method, headers: {} }; if (cookie) o.headers.cookie = cookie; if (body !== undefined) { o.body = JSON.stringify(body); o.headers['content-type'] = 'application/json'; } const r = await fetch(BASE + url, o); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, data: await r.json() }; }; }
const sql = q => execSync(`docker exec engpro-pg-test psql -U postgres -d engpro -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

(async () => {
  const admin = client(), hv = client(), gv = client(), anon = client();
  await admin('POST', '/api/auth/login', { email: 'admin@gmail.com', password: '123456' });
  await hv('POST', '/api/auth/login', { email: 'danh@gmail.com', password: '123456' });
  await gv('POST', '/api/auth/login', { email: 'hoang@gmail.com', password: '123456' });
  const counts = async () => (await admin('GET', '/api/admin/pending-counts')).data.data;

  console.log('\n[Quyền]');
  check('học viên, giảng viên không xem được (403), khách 401',
    (await hv('GET', '/api/admin/pending-counts')).status === 403 &&
    (await gv('GET', '/api/admin/pending-counts')).status === 403 &&
    (await anon('GET', '/api/admin/pending-counts')).status === 401);

  console.log('\n[Số liệu khớp với CSDL]');
  let c = await counts();
  check('trả về số (không phải chuỗi) cho cả ba mục', ['courses', 'enrollments', 'contact'].every(k => typeof c[k] === 'number'), c);
  check('khớp số khóa chờ duyệt, đăng ký chờ duyệt, tin nhắn mới trong CSDL',
    c.courses === +sql("SELECT count(*) FROM courses WHERE status='pending'") &&
    c.enrollments === +sql("SELECT count(*) FROM enrollments WHERE status='pending'") &&
    c.contact === +sql("SELECT count(*) FROM contact_messages WHERE status='new'"), c);

  console.log('\n[Số tự tăng giảm theo thao tác]');
  const base = c;
  // Tự tạo dữ liệu: một khóa giảng viên vừa gửi duyệt, một khóa đang mở có học viên chờ kích hoạt
  sql("INSERT INTO courses (teacher_id, title, status) SELECT id, 'Khóa chờ duyệt để đếm', 'pending' FROM users WHERE email='hoang@gmail.com'");
  const openCourse = sql("INSERT INTO courses (teacher_id, title, status) SELECT id, 'Khóa đang mở để đếm', 'active' FROM users WHERE email='hoang@gmail.com' RETURNING id").split('\n')[0];
  const enrollId = sql(`INSERT INTO enrollments (user_id, course_id, status) SELECT id, ${openCourse}, 'pending' FROM users WHERE email='danh@gmail.com' RETURNING id`).split('\n')[0];
  await anon('POST', '/api/contact', { name: 'Khách', email: 'khach@example.com', topic: 'other', message: 'Cho em hỏi lịch học tháng sau ạ.' });
  c = await counts();
  check('giảng viên gửi duyệt, học viên đăng ký, khách nhắn tin → mỗi mục tăng 1',
    c.courses === base.courses + 1 && c.enrollments === base.enrollments + 1 && c.contact === base.contact + 1, { base, c, enrollId });
  const r = await admin('PUT', `/api/admin/enrollments/${enrollId}`, { action: 'approve' });
  c = await counts();
  check('admin duyệt đăng ký → số đăng ký chờ duyệt giảm 1', r.status === 200 && c.enrollments === base.enrollments, { status: r.status, c });

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
})();

const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 700) : ''); } };
function client() { let cookie = ''; return async (method, url, body) => { const o = { method, headers: {} }; if (cookie) o.headers.cookie = cookie; if (body) { o.body = JSON.stringify(body); o.headers['content-type'] = 'application/json'; } const r = await fetch(BASE + url, o); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, data: await r.json(), cookie }; }; }
const sql = q => execSync(`docker exec engpro-pg-test psql -U postgres -d engpro -tAc "${q}"`).toString().trim();
const notifs = async c => (await c('GET', '/api/notifications')).data.data;
// Nộp bài theo luồng mới: bắt đầu (hoặc làm tiếp) lượt làm bài rồi mới nộp
const takeSubmit = async (c, url, body) => { await c('POST', url.replace(/\/submit$/, '/start')); return c('POST', url, body); };
(async () => {
  const admin = client(), gv = client(), s1 = client(), s2 = client(), anon = client();
  await admin('POST', '/api/auth/login', { email: 'admin@gmail.com', password: '123456' });
  await gv('POST', '/api/auth/login', { email: 'hoang@gmail.com', password: '123456' });
  const l1 = await s1('POST', '/api/auth/login', { email: 'danh@gmail.com', password: '123456' });
  const reg = new FormData(); reg.append('name', 'Học viên 2'); reg.append('email', 'hv2@gmail.com'); reg.append('password', 'matkhau123'); reg.append('role', 'user');
  await fetch(BASE + '/api/auth/register', { method: 'POST', body: reg });
  await s2('POST', '/api/auth/login', { email: 'hv2@gmail.com', password: 'matkhau123' });

  // Hạn "sắp tới" = 24 giờ nữa, đặt đúng thứ và giờ của mốc đó theo giờ Việt Nam
  const target = new Date(Math.floor((Date.now() + 24 * 3600e3) / 60000) * 60000);
  const vnParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(target).map(p => [p.type, p.value]));
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[vnParts.weekday];
  const time = `${vnParts.hour}:${vnParts.minute}`;

  const paid = (await gv('POST', '/api/gv/courses', { title: 'IELTS 6.5', category_id: 1, price: 1500000 })).data.data.id;
  const free = (await gv('POST', '/api/gv/courses', { title: 'Ngữ pháp miễn phí', category_id: 1, price: 0 })).data.data.id;
  for (const id of [paid, free]) await admin('PUT', `/api/admin/courses/${id}`, { action: 'approve' });
  await gv('PUT', `/api/gv/courses/${paid}/schedule`, { due_weekday: weekday, due_time: time });
  const lec = async (title, week) => (await gv('POST', '/api/gv/lectures', { course_id: paid, title, week_number: week })).data.data.id;
  const L1 = await lec('Bài tuần 1', 1), L2 = await lec('Bài tuần 2', 2);
  const mkTest = async (lecture, title) => { const id = (await gv('POST', '/api/gv/tests', { course_id: paid, lecture_id: lecture, title, pass_percent: 50 })).data.data.id; const q = (await gv('POST', `/api/gv/tests/${id}/questions`, { question_type: 'mcq', question_text: 'q', option_a: 'a', option_b: 'b', correct_answer: 'A' })).data.data.id; return { id, q }; };
  const T1 = await mkTest(L1, 'Kiểm tra tuần 1'), T2 = await mkTest(L2, 'Kiểm tra tuần 2');

  console.log('\n[Đăng ký, thanh toán, kích hoạt]');
  check('chưa đăng nhập → 401', (await anon('GET', '/api/notifications')).status === 401);
  check('ban đầu không có thông báo', (await notifs(s1)).items.length === 0);
  await s1('POST', `/api/user/enroll/${paid}`);
  let n = await notifs(s1);
  check('thanh toán khóa có phí → "Đã ghi nhận thanh toán", link Thanh toán', n.unread === 1 && n.items[0].type === 'enroll_pending' && n.items[0].title.includes('Đã ghi nhận thanh toán khóa IELTS 6.5') && n.items[0].link === 'purchases.html', n);
  await s1('POST', `/api/user/enroll/${free}`);
  n = await notifs(s1);
  check('khóa miễn phí → "Đã gửi đăng ký", link Học tập của tôi', n.items[0].title.startsWith('Đã gửi đăng ký') && n.items[0].link === 'my-learning.html');
  const pend = (await admin('GET', '/api/admin/enrollments?status=pending')).data.data;
  const ePaid = pend.find(e => e.course_id === paid).id, eFree = pend.find(e => e.course_id === free).id;
  await admin('PUT', `/api/admin/enrollments/${ePaid}`, { action: 'approve' });
  await admin('PUT', `/api/admin/enrollments/${ePaid}`, { action: 'approve' });
  await admin('PUT', `/api/admin/enrollments/${eFree}`, { action: 'reject' });
  n = await notifs(s1);
  const welcome = n.items.filter(x => x.type === 'enroll_active');
  check('kích hoạt → "Chào mừng bạn đến với khóa…", duyệt lại không tạo trùng', welcome.length === 1 && welcome[0].title === 'Chào mừng bạn đến với khóa IELTS 6.5!' && welcome[0].link === `course-learn.html?id=${paid}`, welcome);
  check('từ chối → thông báo chưa được duyệt', n.items.some(x => x.type === 'enroll_rejected' && x.title.includes('Ngữ pháp miễn phí')));
  check('mới nhất ở trên đầu, 4 chưa đọc', n.items[0].type === 'enroll_rejected' && n.unread === 4, n.items.map(x => x.type));

  console.log('\n[Nhắc hạn nộp]');
  sql(`UPDATE enrollments SET activated_at = '${new Date(target.getTime() - 7 * 864e5 - 60e3).toISOString()}' WHERE id=${ePaid}`);
  n = await notifs(s1);
  const soon = n.items.filter(x => x.type === 'deadline_soon');
  check('còn 24 giờ → "Sắp đến hạn: Kiểm tra tuần 1" (tuần 2 chưa nhắc)', soon.length === 1 && soon[0].title === 'Sắp đến hạn: Kiểm tra tuần 1' && soon[0].link === `course-learn.html?id=${paid}&lecture=${L1}`, soon);
  check('nội dung ghi hạn theo giờ VN', soon[0].body.includes(time) && soon[0].body.includes('Khóa IELTS 6.5'), soon[0].body);
  await notifs(s1); await notifs(s1);
  check('tải lại nhiều lần không nhắc trùng', (await notifs(s1)).items.filter(x => x.type === 'deadline_soon').length === 1);

  await s2('POST', `/api/user/enroll/${paid}`);
  const e2 = (await admin('GET', '/api/admin/enrollments?status=pending')).data.data.find(e => e.course_id === paid).id;
  await admin('PUT', `/api/admin/enrollments/${e2}`, { action: 'approve' });
  sql(`UPDATE enrollments SET activated_at = '${new Date(target.getTime() - 14 * 864e5 - 60e3).toISOString()}' WHERE id=${e2}`);
  let n2 = await notifs(s2);
  check('học viên 2: quá hạn tuần 1 + sắp hạn tuần 2', n2.items.some(x => x.type === 'deadline_overdue' && x.title === 'Đã quá hạn: Kiểm tra tuần 1' && x.body.includes('nộp muộn')) && n2.items.some(x => x.type === 'deadline_soon' && x.title === 'Sắp đến hạn: Kiểm tra tuần 2'), n2.items.map(x => [x.type, x.title]));
  sql(`UPDATE enrollments SET activated_at = '${new Date(target.getTime() - 60 * 864e5).toISOString()}' WHERE id=${e2}`);
  const before = (await notifs(s2)).items.length;
  check('quá hạn lâu (hơn 7 ngày) không tạo thêm thông báo', (await notifs(s2)).items.length === before);

  await takeSubmit(s1, `/api/user/tests/${T1.id}/submit`, { answers: { [T1.q]: 'A' } });
  await gv('PUT', `/api/gv/courses/${paid}/schedule`, { due_weekday: weekday, due_time: time === '23:59' ? '23:58' : (time.slice(0, 3) + String((Number(time.slice(3)) + 1) % 60).padStart(2, '0')) });
  n = await notifs(s1);
  check('đã đạt tuần 1 → đổi lịch cũng không nhắc lại bài đó', n.items.filter(x => x.type === 'deadline_soon' && x.title.includes('tuần 1')).length === 1);

  console.log('\n[Giảng viên nhận xét, hoàn thành khóa]');
  const fb = await gv('POST', '/api/gv/feedback', { student_id: 3, course_id: paid, lecture_id: L1, content: 'Em nghe tốt phần số đếm, cần luyện thêm chính tả tên riêng.' });
  n = await notifs(s1);
  const fbn = n.items.find(x => x.type === 'teacher_feedback');
  check('nhận xét mới → thông báo có tên GV, bài, trích nội dung, link bài', fbn && fbn.title === 'Giảng viên Hoàng đã nhận xét bài "Bài tuần 1"' && fbn.body.startsWith('Em nghe tốt') && fbn.link === `course-learn.html?id=${paid}&lecture=${L1}`, fbn);
  await gv('PUT', `/api/gv/feedback/${fb.data.data.id}`, { content: 'Đã sửa nhận xét' });
  check('sửa nhận xét → thông báo mới', (await notifs(s1)).items.filter(x => x.type === 'teacher_feedback').length === 2);
  sql(`UPDATE enrollments SET progress_percent=100 WHERE id=${ePaid}`);
  await gv('POST', '/api/gv/enrollments/complete', { user_id: 3, course_id: paid });
  n = await notifs(s1);
  check('GV xác nhận hoàn thành → chúc mừng, link Kết quả', n.items[0].type === 'course_completed' && n.items[0].title === 'Chúc mừng bạn đã hoàn thành khóa IELTS 6.5!' && n.items[0].link === 'results.html');
  await new Promise(r => setTimeout(r, 300));
  const logText = require('fs').readFileSync(__dirname + '/server.log', 'utf8');
  const congrats = logText.split('📧').find(b => b.includes('Tới: danh@gmail.com') && b.includes('Chúc mừng bạn đã hoàn thành khóa IELTS 6.5!'));
  check('đồng thời gửi email chúc mừng hoàn thành khóa, có tên giảng viên và đường dẫn đánh giá khóa',
    !!congrats && congrats.includes('Giảng viên Hoàng') && congrats.includes(`course-detail.html?id=${paid}#reviews`), congrats);

  console.log('\n[Đánh dấu đã đọc]');
  const unreadBefore = n.unread;
  const someId = n.items[0].id;
  check('học viên khác không đánh dấu hộ được', (await s2('POST', '/api/notifications/read', { id: someId })).data.success && (await notifs(s1)).unread === unreadBefore);
  await s1('POST', '/api/notifications/read', { id: someId });
  n = await notifs(s1);
  check('đọc 1 thông báo → giảm 1', n.unread === unreadBefore - 1 && n.items.find(x => x.id === someId).is_read === true);
  check('thiếu id → 400', (await s1('POST', '/api/notifications/read', {})).status === 400);
  await s1('POST', '/api/notifications/read', { all: true });
  check('đọc tất cả → 0', (await notifs(s1)).unread === 0);
  check('GV gọi được, không bị tạo nhắc hạn (chỉ có thông báo khóa học được duyệt)', (await gv('GET', '/api/notifications')).status === 200 && (await notifs(gv)).items.every(x => x.type === 'course_approved'));
  check('xóa tài khoản học viên → xóa thông báo (cascade)', (await admin('DELETE', '/api/admin/users/4')).data.success && sql(`SELECT COUNT(*) FROM notifications WHERE user_id=4`) === '0');

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
  console.log('COOKIE_S1 ' + l1.cookie.replace('connect.sid=', ''));
})();

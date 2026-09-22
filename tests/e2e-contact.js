// Liên hệ trung tâm: admin trả lời ngay trên web, học viên xem và hỏi thêm, email và thông báo đi kèm
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 600) : ''); } };
function client() { let cookie = ''; return async (method, url, body) => { const o = { method, headers: {} }; if (cookie) o.headers.cookie = cookie; if (body !== undefined) { o.body = JSON.stringify(body); o.headers['content-type'] = 'application/json'; } const r = await fetch(BASE + url, o); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, data: await r.json() }; }; }
const sql = q => execSync(`docker exec engpro-pg-test psql -U postgres -d engpro -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mails = to => fs.readFileSync(__dirname + '/server.log', 'utf8').split('📧').filter(b => b.includes(`Tới: ${to}\n`));
async function newUser(name) {
  const f = new FormData(); f.append('name', name); f.append('email', name + '@example.com'); f.append('password', 'matkhau123'); f.append('role', 'user');
  await fetch(BASE + '/api/auth/register', { method: 'POST', body: f });
  const c = client(); await c('POST', '/api/auth/login', { email: name + '@example.com', password: 'matkhau123' }); return c;
}

(async () => {
  const admin = client(), anon = client();
  await admin('POST', '/api/auth/login', { email: 'admin@gmail.com', password: '123456' });
  const hv = await newUser('lienhe.hocvien');
  const khac = await newUser('lienhe.khac');

  console.log('\n[Khách chưa có tài khoản]');
  await anon('POST', '/api/contact', { name: 'Khách Lạ', email: 'khachla@example.com', topic: 'course', message: 'Cho em hỏi khóa IELTS có lớp tối không ạ?' });
  let list = (await admin('GET', '/api/admin/contact-messages')).data.data;
  const guestMsg = list.items.find(m => m.email === 'khachla@example.com');
  check('admin thấy tin nhắn mới, chưa có trả lời', guestMsg && guestMsg.status === 'new' && guestMsg.replies.length === 0, guestMsg);
  check('admin nhận thông báo qua chuông khi có tin nhắn mới',
    (await admin('GET', '/api/notifications')).data.data.items.some(n => n.type === 'contact_new' && n.link === 'dashboard-admin.html#contact'));
  let r = await admin('POST', `/api/admin/contact-messages/${guestMsg.id}/reply`, { content: 'Chào bạn, trung tâm có lớp tối từ 19 giờ nhé.' });
  await sleep(300);
  check('admin trả lời ngay trên web → tin nhắn chuyển sang đã xử lý', r.status === 201 && sql(`SELECT status FROM contact_messages WHERE id=${guestMsg.id}`) === 'done');
  const guestMail = mails('khachla@example.com').pop();
  check('khách nhận câu trả lời qua email, được dặn trả lời thẳng email', guestMail && guestMail.includes('EngPro đã trả lời tin nhắn của bạn') && guestMail.includes('lớp tối từ 19 giờ') && guestMail.includes('trả lời thẳng email này'), guestMail);

  console.log('\n[Học viên có tài khoản]');
  await hv('POST', '/api/contact', { name: 'Học viên', email: 'lienhe.hocvien@example.com', topic: 'payment', message: 'Em đã chuyển khoản nhưng chưa thấy kích hoạt khóa.' });
  list = (await admin('GET', '/api/admin/contact-messages?status=new')).data.data;
  const t = list.items.find(m => m.email === 'lienhe.hocvien@example.com');
  await admin('POST', `/api/admin/contact-messages/${t.id}/reply`, { content: 'Trung tâm đã kích hoạt khóa cho bạn rồi nhé.' });
  await sleep(300);
  let mine = (await hv('GET', '/api/user/contact-messages')).data.data;
  check('học viên thấy câu trả lời ngay trên web', mine.length === 1 && mine[0].status === 'done' && mine[0].replies[0].is_staff === true && mine[0].replies[0].content.includes('kích hoạt'), mine);
  const note = (await hv('GET', '/api/notifications')).data.data.items.find(n => n.type === 'contact_reply');
  check('học viên nhận thông báo qua chuông, bấm vào mở đúng tin nhắn', note && note.link === `contact.html#ticket-${t.id}`, note);
  const hvMail = mails('lienhe.hocvien@example.com').pop();
  check('học viên cũng nhận email, có nút xem trên web', hvMail && hvMail.includes('Xem và hỏi thêm tại:') && hvMail.includes(`contact.html#ticket-${t.id}`), hvMail);

  r = await hv('POST', `/api/user/contact-messages/${t.id}/reply`, { content: 'Em cảm ơn, cho em hỏi thêm về hóa đơn ạ.' });
  check('học viên hỏi thêm → tin nhắn quay về chưa xử lý', r.status === 201 && sql(`SELECT status FROM contact_messages WHERE id=${t.id}`) === 'new');
  check('admin nhận thông báo học viên hỏi thêm',
    (await admin('GET', '/api/notifications')).data.data.items.some(n => n.type === 'contact_followup'));
  list = (await admin('GET', '/api/admin/contact-messages')).data.data;
  const thread = list.items.find(m => m.id === t.id).replies;
  check('admin thấy đủ cuộc trao đổi theo thứ tự', thread.length === 2 && thread[0].is_staff && !thread[1].is_staff && thread[1].content.includes('hóa đơn'), thread);

  await hv('POST', '/api/contact', { name: 'Tên Giả', email: 'gia@example.com', topic: 'other', message: 'Tin nhắn thứ hai của học viên đã đăng nhập.' });
  check('đã đăng nhập thì lưu họ tên và email theo tài khoản, bỏ qua thông tin nhập tay',
    sql("SELECT name || '|' || email FROM contact_messages WHERE message='Tin nhắn thứ hai của học viên đã đăng nhập.'") === 'lienhe.hocvien|lienhe.hocvien@example.com');

  console.log('\n[Quyền và dữ liệu sai]');
  check('người khác không hỏi thêm được vào tin nhắn của mình (404), khách 401',
    (await khac('POST', `/api/user/contact-messages/${t.id}/reply`, { content: 'chen ngang' })).status === 404 &&
    (await anon('POST', `/api/user/contact-messages/${t.id}/reply`, { content: 'chen ngang' })).status === 401);
  check('người khác không xem được tin nhắn của mình', (await khac('GET', '/api/user/contact-messages')).data.data.length === 0);
  check('học viên không trả lời thay admin (403); trả lời rỗng → 400; tin nhắn không có → 404',
    (await hv('POST', `/api/admin/contact-messages/${t.id}/reply`, { content: 'giả admin' })).status === 403 &&
    (await admin('POST', `/api/admin/contact-messages/${t.id}/reply`, { content: ' ' })).status === 400 &&
    (await admin('POST', '/api/admin/contact-messages/999999/reply', { content: 'xin chào' })).status === 404);
  check('nội dung có mã HTML được lưu nguyên văn để trang tự thoát ký tự khi hiển thị',
    (await hv('POST', `/api/user/contact-messages/${t.id}/reply`, { content: '<img src=x onerror=alert(1)>' })).status === 201 &&
    sql(`SELECT content FROM contact_replies WHERE message_id=${t.id} ORDER BY id DESC LIMIT 1`) === '<img src=x onerror=alert(1)>');

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
})();

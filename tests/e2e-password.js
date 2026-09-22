// Đổi mật khẩu phải có mã xác nhận gửi về email; ngôn ngữ giao diện và ngôn ngữ trợ lý AI là hai cài đặt riêng
const fs = require('fs');
const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
function client() { let cookie = ''; return async (method, url, body) => { const o = { method, headers: {} }; if (cookie) o.headers.cookie = cookie; if (body !== undefined) { o.body = JSON.stringify(body); o.headers['content-type'] = 'application/json'; } const r = await fetch(BASE + url, o); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, data: await r.json() }; }; }
const mails = to => fs.readFileSync(__dirname + '/server.log', 'utf8').split('📧').filter(b => b.includes(`Tới: ${to}\n`));
const lastCode = to => (mails(to).pop() || '').match(/(\d{6}) là mã xác nhận đổi mật khẩu/)?.[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const email = `doimatkhau.${Date.now()}@example.com`;
  const form = new FormData();
  form.append('name', 'Học viên đổi mật khẩu'); form.append('email', email); form.append('password', 'matkhau123'); form.append('role', 'user');
  await fetch(BASE + '/api/auth/register', { method: 'POST', body: form });
  await sleep(300);

  console.log('\n[Đăng ký]');
  check('đăng ký xong không tự gửi email nào', mails(email).length === 0, mails(email).length);

  const hv = client();
  await hv('POST', '/api/auth/login', { email, password: 'matkhau123' });
  let me = (await hv('GET', '/api/auth/me')).data.data;
  check('tài khoản mới: AI trả lời tiếng Anh, giao diện tiếng Việt', me.ai_language === 'en' && me.ui_language === 'vi', me);

  console.log('\n[Đổi mật khẩu cần mã xác nhận]');
  let r = await hv('PUT', '/api/user/password', { current_password: 'matkhau123', new_password: 'matkhaumoi456' });
  check('thiếu mã → 400, mật khẩu chưa đổi', r.status === 400 && /mã xác nhận/.test(r.data.message), r.data);

  r = await hv('POST', '/api/user/password/send-code');
  await sleep(300);
  const code = lastCode(email);
  check('gửi mã về đúng email đăng ký, mã 6 số', r.status === 200 && r.data.data.email === email && /^\d{6}$/.test(code || ''), { data: r.data, code });

  r = await hv('POST', '/api/user/password/send-code');
  check('gửi lại ngay → 429, phải chờ', r.status === 429 && r.data.data.wait_seconds > 0, r.data);

  r = await hv('PUT', '/api/user/password', { current_password: 'saimatkhau', new_password: 'matkhaumoi456', code });
  check('sai mật khẩu hiện tại → 400, mã chưa bị dùng', r.status === 400 && /hiện tại không đúng/.test(r.data.message), r.data);

  const wrong = code === '000000' ? '111111' : '000000';
  r = await hv('PUT', '/api/user/password', { current_password: 'matkhau123', new_password: 'matkhaumoi456', code: wrong });
  check('sai mã → 400, báo còn bao nhiêu lần thử', r.status === 400 && /Mã không đúng/.test(r.data.message), r.data);

  r = await hv('PUT', '/api/user/password', { current_password: 'matkhau123', new_password: 'matkhaumoi456', code });
  check('đúng mật khẩu và đúng mã → đổi thành công', r.status === 200 && r.data.data.updated, r.data);

  const oldLogin = await client()('POST', '/api/auth/login', { email, password: 'matkhau123' });
  const newLogin = await client()('POST', '/api/auth/login', { email, password: 'matkhaumoi456' });
  check('mật khẩu cũ hết dùng được, mật khẩu mới đăng nhập được', !oldLogin.data.success && newLogin.data.success, { old: oldLogin.status, now: newLogin.status });

  r = await hv('PUT', '/api/user/password', { current_password: 'matkhaumoi456', new_password: 'matkhauthu789', code });
  check('dùng lại mã cũ → 400', r.status === 400, r.data);

  const anon = client();
  check('chưa đăng nhập không xin được mã (401)', (await anon('POST', '/api/user/password/send-code')).status === 401);

  console.log('\n[Hai cài đặt ngôn ngữ độc lập]');
  r = await hv('PUT', '/api/user/settings', { ui_language: 'en' });
  me = (await hv('GET', '/api/auth/me')).data.data;
  check('đổi giao diện sang English không đổi ngôn ngữ AI', r.status === 200 && me.ui_language === 'en' && me.ai_language === 'en', me);
  r = await hv('PUT', '/api/user/settings', { ai_language: 'vi' });
  me = (await hv('GET', '/api/auth/me')).data.data;
  check('tắt AI tiếng Anh không đổi giao diện', r.status === 200 && me.ai_language === 'vi' && me.ui_language === 'en', me);
  r = await hv('PUT', '/api/user/settings', { ui_language: 'fr' });
  check('ngôn ngữ không hỗ trợ → 400', r.status === 400, r.data);
  const profile = (await hv('GET', '/api/user/profile')).data.data;
  check('trang Cài đặt nhận đủ hai cài đặt', profile && profile.ui_language === 'en' && profile.ai_language === 'vi', profile && { ui: profile.ui_language, ai: profile.ai_language });

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
})();

// Chưa cấu hình GEMINI_API_KEY: các tính năng AI báo 503 rõ ràng, phần còn lại của web vẫn chạy
const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
function client() { let cookie = ''; return async (method, url, body) => { const o = { method, headers: {} }; if (cookie) o.headers.cookie = cookie; if (body !== undefined) { o.body = JSON.stringify(body); o.headers['content-type'] = 'application/json'; } const r = await fetch(BASE + url, o); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, data: await r.json() }; }; }
(async () => {
  const admin = client(), gv = client(), user = client();
  await admin('POST', '/api/auth/login', { email: 'admin@gmail.com', password: '123456' });
  await gv('POST', '/api/auth/login', { email: 'hoang@gmail.com', password: '123456' });
  await user('POST', '/api/auth/login', { email: 'danh@gmail.com', password: '123456' });
  check('trạng thái: chưa bật AI', (await user('GET', '/api/ai/status')).data.data.enabled === false);
  const P = (await admin('POST', '/api/admin/writing-prompts', { task_type: 'ielts_task2', title: 'Đề', prompt_text: 'Some people think technology makes life more complicated. Discuss.' })).data.data.id;
  check('danh sách đề viết vẫn xem được, enabled=false', (await user('GET', '/api/writing/prompts')).data.data.enabled === false);
  const essay = Array.from({ length: 40 }, (_, i) => 'word' + i).join(' ');
  let r = await user('POST', `/api/writing/prompts/${P}/submit`, { essay });
  check('nộp bài viết → 503 báo chưa bật AI, không lưu bài', r.status === 503 && r.data.message.includes('GEMINI_API_KEY'), r.data);
  await user('POST', '/api/placement/ielts/submit', { answers: {} });
  r = await user('POST', '/api/ai/insights');
  check('nhận xét học tập → 503 hoặc 422 (không lỗi hệ thống)', [503, 422].includes(r.status), r);
  const C = (await gv('POST', '/api/gv/courses', { title: 'Khóa tắt AI', category_id: 1 })).data.data.id;
  const L = (await gv('POST', '/api/gv/lectures', { course_id: C, title: 'Bài 1' })).data.data.id;
  r = await admin('POST', `/api/ai/lectures/${L}/ask`, { question: 'Câu hỏi hợp lệ về ngữ pháp' });
  check('hỏi đáp trong bài giảng → 503 báo chưa bật AI', r.status === 503 && r.data.message.includes('GEMINI_API_KEY'), r.data);
  const at = (await admin('POST', '/api/admin/admin-tests', { title: 'x', type: 'luyen_de' })).data.data.id;
  r = await admin('POST', `/api/admin/admin-tests/${at}/questions/generate`, { count: 2, types: ['mcq'], topic: 'Travel plans' });
  check('tạo câu hỏi → 503', r.status === 503, r.data);
  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
})();

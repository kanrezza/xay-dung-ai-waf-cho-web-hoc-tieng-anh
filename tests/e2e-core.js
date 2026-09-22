// Các luồng chính của EngPro từ đầu đến cuối: tài khoản, giảng viên soạn khóa, admin duyệt,
// học viên đăng ký, học, làm bài, xem kết quả; test thử, test xếp loại, hỏi đáp, đánh giá và phân quyền.
const fs = require('fs');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
function client() {
  let cookie = '';
  return async (method, url, body, isForm = false) => {
    const o = { method, headers: {} };
    if (cookie) o.headers.cookie = cookie;
    if (body !== undefined) {
      if (isForm) o.body = body;
      else { o.body = JSON.stringify(body); o.headers['content-type'] = 'application/json'; }
    }
    const r = await fetch(BASE + url, o);
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
}
const sql = q => execSync(`docker exec engpro-pg-test psql -U postgres -d engpro -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const mails = to => fs.readFileSync(__dirname + '/server.log', 'utf8').split('📧').filter(b => b.includes(`Tới: ${to}\n`));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const login = async (email, password = '123456') => { const c = client(); const r = await c('POST', '/api/auth/login', { email, password }); return r.data.success ? c : null; };

(async () => {
  const anon = client();
  const admin = await login('admin@gmail.com');
  const gv = await login('hoang@gmail.com');
  const stamp = Date.now();
  const email = `hocvien.${stamp}@example.com`;

  console.log('\n[1. Tài khoản]');
  const form = new FormData();
  form.append('name', 'Học viên Kiểm Thử'); form.append('email', email); form.append('password', 'matkhau123'); form.append('role', 'user');
  let r = await anon('POST', '/api/auth/register', form, true);
  check('đăng ký học viên → 201, tài khoản hoạt động ngay', r.status === 201 && r.data.data.status === 'active', r.data);
  const dup = new FormData();
  dup.append('name', 'Trùng'); dup.append('email', email.toUpperCase()); dup.append('password', 'matkhau123'); dup.append('role', 'user');
  r = await anon('POST', '/api/auth/register', dup, true);
  check('đăng ký trùng email (khác hoa thường) → báo lỗi', !r.data.success, r.data);
  const weak = new FormData();
  weak.append('name', 'Yếu'); weak.append('email', `yeu.${stamp}@example.com`); weak.append('password', '123'); weak.append('role', 'user');
  check('mật khẩu dưới 8 ký tự → báo lỗi', !(await anon('POST', '/api/auth/register', weak, true)).data.success);
  r = await anon('POST', '/api/auth/login', { email, password: 'saimatkhau' });
  check('sai mật khẩu → không đăng nhập được', !r.data.success, r.data);
  const hv = await login(email, 'matkhau123');
  check('đúng mật khẩu → đăng nhập được, /me trả đúng vai trò', hv && (await hv('GET', '/api/auth/me')).data.data.role === 'user');

  // Quên mật khẩu: mã gửi về email, xác nhận mã rồi đặt mật khẩu mới
  r = await anon('POST', '/api/auth/password/forgot', { email });
  await sleep(300);
  const resetCode = (mails(email).pop() || '').match(/(\d{6}) là mã đặt lại mật khẩu/)?.[1];
  check('quên mật khẩu → gửi mã 6 số về email', r.data.success && /^\d{6}$/.test(resetCode || ''), r.data);
  r = await anon('POST', '/api/auth/password/verify', { email, code: '000000' === resetCode ? '111111' : '000000' });
  check('mã sai → báo lỗi', !r.data.success, r.data);
  r = await anon('POST', '/api/auth/password/reset', { email, code: resetCode, new_password: 'matkhaumoi789' });
  check('mã đúng → đặt lại mật khẩu, đăng nhập bằng mật khẩu mới được', r.data.success && !!(await login(email, 'matkhaumoi789')), r.data);
  const student = await login(email, 'matkhaumoi789');

  console.log('\n[2. Giảng viên soạn khóa học]');
  const cat = sql("SELECT id FROM categories WHERE type='IELTS' LIMIT 1");
  r = await gv('POST', '/api/gv/courses', {
    title: `Khóa kiểm thử ${stamp}`, category_id: cat, price: 500000, level: 'Cơ bản', band_from: '4.0', band_to: '5.0',
    description: 'Khóa học dùng để kiểm thử toàn bộ luồng học tập trên EngPro, từ soạn bài đến chấm điểm.',
    objectives: 'Hiểu thì hiện tại đơn\nLàm đúng bài kiểm tra',
  });
  const courseId = r.data.data?.id;
  check('tạo khóa học → bản nháp', r.status === 201 && r.data.data.status === 'draft', r.data);
  r = await gv('POST', `/api/gv/courses/${courseId}/submit`);
  check('gửi duyệt khi chưa có bài giảng → bị chặn', !r.data.success, r.data);
  r = await gv('POST', '/api/gv/lectures', { course_id: courseId, title: 'Bài 1: Thì hiện tại đơn', skill: 'Grammar', order_num: 1, week_number: 1 });
  const lectureId = r.data.data?.id;
  check('thêm bài giảng', r.data.success && lectureId, r.data);
  const mat = new FormData();
  mat.append('course_id', courseId); mat.append('lecture_id', lectureId);
  mat.append('file', new Blob(['Hien tai don: S + V(s/es). She goes to school every day.'], { type: 'text/plain' }), 'tai-lieu.txt');
  r = await gv('POST', '/api/gv/materials', mat, true);
  check('tải tài liệu cho bài giảng', r.data.success, r.data);
  r = await gv('POST', '/api/gv/tests', { course_id: courseId, lecture_id: lectureId, title: 'Kiểm tra bài 1', num_questions: 2, duration_minutes: 10, pass_percent: 50 });
  const testId = r.data.data?.id;
  check('tạo bài kiểm tra', r.data.success && testId, r.data);
  r = await gv('POST', `/api/gv/tests/${testId}/questions`, { question_type: 'mcq', question_text: 'She ___ to school every day.', option_a: 'go', option_b: 'goes', option_c: 'going', correct_answer: 'B' });
  const q1 = r.data.data?.id;
  r = await gv('POST', `/api/gv/tests/${testId}/questions`, { question_type: 'fill', question_text: 'He ___ (watch) TV.', accepted_answers: ['watches'] });
  const q2 = r.data.data?.id;
  check('thêm câu trắc nghiệm và câu điền từ', q1 && q2, r.data);
  r = await gv('POST', `/api/gv/tests/${testId}/questions`, { question_type: 'mcq', question_text: 'Thiếu đáp án đúng', option_a: 'x', option_b: 'y' });
  check('câu trắc nghiệm thiếu đáp án đúng → báo lỗi', !r.data.success, r.data);
  r = await gv('POST', `/api/gv/courses/${courseId}/submit`);
  check('đủ điều kiện → gửi duyệt, khóa chuyển sang chờ duyệt', r.data.success && sql(`SELECT status FROM courses WHERE id=${courseId}`) === 'pending', r.data);
  r = await gv('POST', '/api/gv/lectures', { course_id: courseId, title: 'Sửa khi đang chờ duyệt' });
  check('đang chờ duyệt thì không sửa nội dung được (409)', r.status === 409, r.data);
  check('khóa chưa duyệt không hiện ở trang Khóa học', !JSON.stringify((await anon('GET', '/api/courses')).data).includes(`Khóa kiểm thử ${stamp}`));

  console.log('\n[3. Admin duyệt]');
  check('admin thấy 1 khóa chờ duyệt', (await admin('GET', '/api/admin/pending-counts')).data.data.courses === 1);
  r = await admin('PUT', `/api/admin/courses/${courseId}`, { action: 'reject' });
  check('từ chối phải ghi lý do', !r.data.success, r.data);
  r = await admin('PUT', `/api/admin/courses/${courseId}`, { action: 'approve' });
  check('duyệt → khóa hoạt động và hiện công khai', r.data.success && JSON.stringify((await anon('GET', '/api/courses')).data).includes(`Khóa kiểm thử ${stamp}`), r.data);
  check('giảng viên nhận thông báo khóa đã được duyệt', (await gv('GET', '/api/notifications')).data.data.items.some(n => n.title.includes('đã được duyệt')));

  console.log('\n[4. Học viên đăng ký và học]');
  r = await student('GET', `/api/tests/${testId}`);
  r = await student('GET', `/api/user/tests/${testId}`);
  check('chưa đăng ký khóa thì chưa làm bài được', !r.data.success, r.data);
  r = await student('POST', `/api/user/enroll/${courseId}`);
  check('đăng ký khóa có phí → chờ kích hoạt', r.data.success && sql(`SELECT status FROM enrollments WHERE course_id=${courseId}`) === 'pending', r.data);
  r = await student('POST', `/api/user/enroll/${courseId}`);
  check('bấm đăng ký lần nữa không tạo đăng ký trùng', r.data.data?.already && sql(`SELECT count(*) FROM enrollments WHERE course_id=${courseId}`) === '1', r.data);
  const enrollId = sql(`SELECT id FROM enrollments WHERE course_id=${courseId}`);
  r = await admin('PUT', `/api/admin/enrollments/${enrollId}`, { action: 'approve' });
  check('admin kích hoạt → học viên vào học được', r.data.success && (await student('GET', `/api/user/courses/${courseId}`)).data.success, r.data);
  check('học viên nhận thông báo khóa đã kích hoạt', (await student('GET', '/api/notifications')).data.data.items.some(n => n.type && n.link && n.link.includes(String(courseId))));
  r = await student('GET', `/api/user/courses/${courseId}`);
  check('trang học có bài giảng, tài liệu và bài kiểm tra', r.data.data.lectures?.length === 1 && JSON.stringify(r.data.data).includes('tai-lieu.txt'), Object.keys(r.data.data || {}));

  console.log('\n[5. Làm bài kiểm tra]');
  r = await student('GET', `/api/user/tests/${testId}`);
  check('xem thông tin bài: 2 câu, còn lượt', r.data.success && r.data.data.question_count === 2, r.data);
  r = await student('POST', `/api/user/tests/${testId}/start`);
  const attemptId = r.data.data?.attempt?.id;
  check('bắt đầu làm bài → có lượt và hạn giờ', r.status === 201 && attemptId && r.data.data.attempt.deadline_at, r.data);
  check('đề gửi về không lộ đáp án', !JSON.stringify(r.data.data.questions).includes('correct_answer') && !JSON.stringify(r.data.data.questions).includes('watches'));
  r = await student('PUT', `/api/user/attempts/${attemptId}`, { answers: { [q1]: 'B' } });
  check('tự lưu đáp án giữa chừng', r.data.success, r.data);
  r = await student('POST', `/api/user/tests/${testId}/start`);
  check('tải lại trang → làm tiếp đúng lượt cũ, đáp án đã lưu còn nguyên', r.status === 200 && r.data.data.attempt.resumed && r.data.data.attempt.answers[q1] === 'B', r.data.data?.attempt);
  r = await student('POST', `/api/user/tests/${testId}/submit`, { attempt_id: attemptId, answers: { [q1]: 'B', [q2]: ' Watches ' } });
  check('nộp bài → chấm đúng 2/2 (điền từ không phân biệt hoa thường, khoảng trắng)', r.data.success && r.data.data.correct === 2 && r.data.data.score === 100, r.data);
  check('tiến độ khóa học lên 100%', sql(`SELECT progress_percent FROM enrollments WHERE id=${enrollId}`) === '100');
  check('giảng viên được báo học viên đã học xong', (await gv('GET', '/api/notifications')).data.data.items.some(n => n.title.includes('đã học xong')));
  const results = (await student('GET', '/api/user/results')).data.data;
  check('trang Kết quả học tập có lượt làm vừa rồi', results.attempts.some(a => a.test_title === 'Kiểm tra bài 1' && Math.round(a.score) === 100), results.summary);
  const resultId = results.attempts.find(a => a.test_title === 'Kiểm tra bài 1')?.id;
  r = await student('GET', `/api/user/results/course/${resultId}`);
  check('xem lại bài làm có đáp án đúng từng câu', r.data.success && JSON.stringify(r.data.data).includes('watches'), r.data);

  console.log('\n[6. Hỏi đáp dưới bài giảng]');
  r = await student('POST', `/api/lectures/${lectureId}/questions`, { content: 'Khi nào động từ thêm -es ạ?' });
  const qaId = r.data.data?.id;
  check('học viên đặt câu hỏi', r.data.success && qaId, r.data);
  r = await gv('POST', `/api/lecture-questions/${qaId}/answers`, { content: 'Động từ tận cùng bằng o, s, x, ch, sh thì thêm -es.' });
  check('giảng viên trả lời → học viên có thông báo', r.data.success && (await student('GET', '/api/notifications')).data.data.items.some(n => n.title.includes('trả lời câu hỏi')), r.data);

  console.log('\n[7. Đánh giá khóa học]');
  r = await student('PUT', `/api/user/courses/${courseId}/review`, { rating: 5, comment: 'Khóa học rất dễ hiểu.' });
  check('học xong được đánh giá 5 sao', r.data.success, r.data);
  r = await anon('GET', `/api/courses/${courseId}/reviews`);
  check('đánh giá hiện công khai trên trang khóa học', JSON.stringify(r.data).includes('Khóa học rất dễ hiểu.'));
  r = await student('PUT', `/api/user/courses/${courseId}/review`, { rating: 9 });
  check('số sao ngoài 1–5 → báo lỗi', !r.data.success, r.data);

  console.log('\n[8. Test thử và test xếp loại]');
  r = await admin('POST', '/api/admin/admin-tests', { title: `Test thử ${stamp}`, type: 'test_thu', category_id: cat, duration_minutes: 15, num_questions: 1, max_attempts: 1 });
  const mockId = r.data.data?.id;
  const mq = (await admin('POST', `/api/admin/admin-tests/${mockId}/questions`, { question_type: 'tfng', question_text: 'The sun rises in the east.', correct_answer: 'TRUE' })).data.data?.id;
  check('admin tạo đề test thử có câu True/False/Not Given', mockId && mq, r.data);
  r = await student('POST', `/api/user/admin-tests/${mockId}/start`);
  const mockAttempt = r.data.data?.attempt?.id;
  r = await student('POST', `/api/user/admin-tests/${mockId}/submit`, { attempt_id: mockAttempt, answers: { [mq]: 'TRUE' } });
  check('học viên làm test thử → đúng 1/1', r.data.success && r.data.data.correct === 1, r.data);
  r = await student('POST', `/api/user/admin-tests/${mockId}/start`);
  check('hết lượt làm (tối đa 1) → bị chặn (409)', r.status === 409, r.data);
  r = await anon('GET', '/api/placement/ielts');
  const placementQs = r.data.data?.questions || [];
  check('test xếp loại IELTS có 20 câu, không lộ đáp án', placementQs.length === 20 && placementQs.every(q => !('ans' in q) && !('answer' in q)), placementQs[0]);
  r = await student('POST', '/api/placement/ielts/submit', { answers: Object.fromEntries(placementQs.map(q => [q.id, 0])) });
  check('nộp test xếp loại → có band và lưu vào kết quả', r.data.success && r.data.data.band && (await student('GET', '/api/user/placement-results')).data.data.length === 1, r.data);

  console.log('\n[9. Phân quyền]');
  check('học viên không vào được API quản trị (403)', (await student('GET', '/api/admin/stats')).status === 403);
  check('học viên không vào được API giảng viên (403)', (await student('GET', '/api/gv/stats')).status === 403);
  check('giảng viên không duyệt khóa học được (403)', (await gv('PUT', `/api/admin/courses/${courseId}`, { action: 'lock' })).status === 403);
  check('khách không xem được hồ sơ (401)', (await anon('GET', '/api/user/profile')).status === 401);
  const danh = await login('danh@gmail.com');
  check('học viên khác không xem được bài làm của người khác', !(await danh('GET', `/api/user/results/course/${resultId}`)).data.success);
  check('học viên chưa đăng ký không xem được video, tài liệu của khóa', (await danh('GET', `/api/user/courses/${courseId}`)).status >= 400);
  r = await anon('GET', `/uploads/materials/${sql(`SELECT regexp_replace(filepath, '^.*/', '') FROM materials WHERE course_id=${courseId}`)}`);
  check('khách không tải trực tiếp được tài liệu', r.status === 401 || r.status === 403, r.status);

  console.log('\n[10. Admin thống kê]');
  const stats = (await admin('GET', '/api/admin/stats')).data.data;
  check('thống kê có khóa và đăng ký mới', stats.total_courses >= 1 && stats.total_enrollments >= 1, stats);
  r = await admin('GET', '/api/admin/analytics?months=6');
  check('biểu đồ thống kê trả về 6 tháng', r.data.success && r.data.data.months.length === 6, r.data);
  r = await admin('GET', '/api/admin/revenue');
  check('doanh thu tính cả học phí khóa vừa kích hoạt', r.data.success && JSON.stringify(r.data.data).includes('500000'), r.data);

  // Dọn file tài liệu do bộ test tải lên (CSDL test bị xóa sạch sau mỗi lần chạy)
  for (const f of sql(`SELECT filepath FROM materials WHERE course_id=${courseId}`).split('\n').filter(Boolean)) {
    fs.rmSync(require('path').join(__dirname, '..', f), { force: true });
  }

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
})();

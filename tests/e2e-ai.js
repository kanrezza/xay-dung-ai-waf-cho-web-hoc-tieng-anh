// Kiểm thử trợ lý AI ở chế độ giả lập (AI_PROVIDER=mock, AI_LIMIT_EXPLAIN=4, AI_LIMIT_INSIGHTS=2):
// giải thích câu sai, nhận xét học tập, chấm Writing, sinh câu hỏi cho giảng viên
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 700) : ''); } };
function client() { let cookie = ''; return async (method, url, body) => { const o = { method, headers: {} }; if (cookie) o.headers.cookie = cookie; if (body !== undefined) { o.body = JSON.stringify(body); o.headers['content-type'] = 'application/json'; } const r = await fetch(BASE + url, o); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, data: await r.json() }; }; }
const sql = q => execSync(`docker exec engpro-pg-test psql -U postgres -d engpro -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
async function newUser(name) {
  const f = new FormData(); f.append('name', name); f.append('email', name + '@gmail.com'); f.append('password', 'matkhau123'); f.append('role', 'user');
  await fetch(BASE + '/api/auth/register', { method: 'POST', body: f });
  const c = client(); await c('POST', '/api/auth/login', { email: name + '@gmail.com', password: 'matkhau123' }); return c;
}
const usage = (email, feature, status) => sql(`SELECT COUNT(*) FROM ai_usage a JOIN users u ON u.id=a.user_id WHERE u.email='${email}' AND a.feature='${feature}' AND a.status='${status}'`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Bài viết được chấm ở nền nên chờ tới khi trạng thái khác 'grading'
async function waitGraded(client, id, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const view = (await client('GET', '/api/user/writing/' + id)).data.data;
    if (view.status !== 'grading') return view;
    await sleep(200);
  }
  return null;
}
const ESSAY = 'Some people believe that technology has made our lives more complicated, while others think it makes life easier. '
  + 'In my opinion, technology brings more benefits than problems because it saves time and connects people. '
  + 'For example, online banking allows people to pay bills in minutes instead of waiting in long queues. '
  + 'However, technology can also cause stress when people depend on devices too much.';

(async () => {
  const admin = client(), gv = client(), anon = client();
  await admin('POST', '/api/auth/login', { email: 'admin@gmail.com', password: '123456' });
  await gv('POST', '/api/auth/login', { email: 'hoang@gmail.com', password: '123456' });
  const s1 = await newUser('ai.mot'), s2 = await newUser('ai.hai'), s3 = await newUser('ai.moi');

  check('trạng thái AI: đã bật, có giới hạn và số lượt còn lại', await (async () => {
    const r = (await s1('GET', '/api/ai/status')).data.data;
    return r.enabled === true && r.limits.explain === 4 && r.remaining.explain === 4 && (await anon('GET', '/api/ai/status')).data.data.remaining === null;
  })());

  // Khóa học: bài giảng không video, bài kiểm tra có phần đọc và 4 câu
  const C = (await gv('POST', '/api/gv/courses', { title: 'Khóa có AI', category_id: 1 })).data.data.id;
  const L = (await gv('POST', '/api/gv/lectures', { course_id: C, title: 'Bài đọc 1', skill: 'Reading' })).data.data.id;
  const T = (await gv('POST', '/api/gv/tests', { course_id: C, lecture_id: L, title: 'Kiểm tra đọc', pass_percent: 50 })).data.data.id;
  const B = `/api/gv/tests/${T}`;
  const R = (await gv('POST', `${B}/sections`, { type: 'reading' })).data.data.id;
  await gv('PUT', `${B}/sections/${R}`, { title: 'Coffee', passage: 'Coffee was first grown in Ethiopia. It spread to Arabia in the 15th century. Later it became popular in Europe.' });
  const q1 = (await gv('POST', `${B}/questions`, { section_id: R, question_type: 'tfng', question_text: 'Coffee was first grown in England.', correct_answer: 'FALSE' })).data.data.id;
  const q2 = (await gv('POST', `${B}/questions`, { section_id: R, question_type: 'mcq', question_text: 'Where did coffee spread in the 15th century?', option_a: 'Europe', option_b: 'Arabia', option_c: 'Asia', correct_answer: 'B' })).data.data.id;
  const q3 = (await gv('POST', `${B}/questions`, { question_type: 'fill', question_text: 'Coffee became popular in ___.', accepted_answers: 'Europe' })).data.data.id;
  const q4 = (await gv('POST', `${B}/questions`, { question_type: 'tfng', question_text: 'Coffee is sweet.', correct_answer: 'NOT_GIVEN' })).data.data.id;
  await admin('PUT', `/api/admin/courses/${C}`, { action: 'approve' });
  for (const s of [s1, s2]) await s('POST', `/api/user/enroll/${C}`);
  for (const id of sql(`SELECT id FROM enrollments WHERE course_id=${C}`).split('\n')) await admin('PUT', `/api/admin/enrollments/${id}`, { action: 'approve' });
  const take = async (c, answers) => { await c('POST', `/api/user/tests/${T}/start`); return (await c('POST', `/api/user/tests/${T}/submit`, { answers })).data.data; };
  const r1 = await take(s1, { [q1]: 'TRUE', [q2]: 'A', [q3]: 'asia', [q4]: 'NOT_GIVEN' });
  const r2 = await take(s2, { [q1]: 'TRUE', [q2]: 'B' });

  console.log('\n[1. Giải thích câu làm sai]');
  let r = await s1('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q1 });
  const ex = r.data.data?.explanation;
  check('câu sai → lời giải thích đủ trường, chưa có sẵn', r.status === 200 && r.data.data.cached === false && ex.correct_reason && ex.tip && Array.isArray(ex.vocabulary) && ex.mistake_reason, r.data);
  check('căn cứ trích từ bài đọc', ex?.evidence.startsWith('Coffee was first grown in Ethiopia'), ex);
  check('ghi một lượt dùng thành công', usage('ai.mot@gmail.com', 'explain', 'ok') === '1');
  r = await s1('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q1 });
  check('hỏi lại → dùng lời giải thích đã lưu, không tính lượt', r.data.data.cached === true && usage('ai.mot@gmail.com', 'explain', 'ok') === '1' && usage('ai.mot@gmail.com', 'explain', 'cached') === '1');
  r = await s2('POST', '/api/ai/explain', { kind: 'course', result_id: r2.result_id, question_id: q1 });
  check('học viên khác chọn cùng đáp án sai → dùng lại lời giải thích', r.data.data?.cached === true);
  r = await s2('POST', '/api/ai/explain', { kind: 'course', result_id: r2.result_id, question_id: q3 });
  check('câu bỏ trống → giải thích mới, không có lý do chọn sai', r.data.data?.cached === false && r.data.data.explanation.mistake_reason === '', r.data);
  check('câu đã làm đúng → 400', (await s2('POST', '/api/ai/explain', { kind: 'course', result_id: r2.result_id, question_id: q2 })).status === 400);
  check('bài làm của người khác → 404', (await s2('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q2 })).status === 404);
  check('loại đề, mã không hợp lệ → 400; chưa đăng nhập → 401',
    (await s1('POST', '/api/ai/explain', { kind: 'khac', result_id: r1.result_id, question_id: q1 })).status === 400 &&
    (await s1('POST', '/api/ai/explain', { kind: 'course', result_id: 'abc', question_id: q1 })).status === 400 &&
    (await anon('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q1 })).status === 401);
  await gv('PUT', `${B}/sections/${R}`, { title: 'Coffee', passage: 'Coffee was first grown in Ethiopia around the 9th century. It spread to Arabia in the 15th century.' });
  r = await s1('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q1 });
  check('giảng viên sửa bài đọc → giải thích lại theo nội dung mới', r.data.data?.cached === false && r.data.data.explanation.evidence.includes('9th century'), r.data);
  await s1('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q2 });
  r = await s1('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q3 });
  check('lượt thứ 4 trong ngày vẫn được', r.status === 200 && r.data.data.cached === false);
  await gv('PUT', `${B}/sections/${R}`, { title: 'Coffee', passage: 'Coffee was first grown in Ethiopia. It later spread to Arabia in the 15th century.' });
  r = await s1('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q1 });
  check('dùng hết 4 lượt trong ngày → 429 có thông báo', r.status === 429 && r.data.message.includes('4 lượt'), r.data);
  check('trạng thái: còn 0 lượt giải thích', (await s1('GET', '/api/ai/status')).data.data.remaining.explain === 0);
  const cachedAgain = await s1('POST', '/api/ai/explain', { kind: 'course', result_id: r1.result_id, question_id: q3 });
  check('hết lượt nhưng câu đã có lời giải thích (không đổi nội dung) vẫn xem được', cachedAgain.status === 200 && cachedAgain.data.data.cached === true);

  // Test thử (kind admin)
  const at = (await admin('POST', '/api/admin/admin-tests', { title: 'Test thử AI', type: 'test_thu', category_id: 1, skill: 'reading' })).data.data.id;
  const aq = (await admin('POST', `/api/admin/admin-tests/${at}/questions`, { question_type: 'tfng', question_text: 'The sky is green.', correct_answer: 'FALSE' })).data.data.id;
  await s2('POST', `/api/user/admin-tests/${at}/start`);
  const ar = (await s2('POST', `/api/user/admin-tests/${at}/submit`, { answers: { [aq]: 'TRUE' } })).data.data;
  r = await s2('POST', '/api/ai/explain', { kind: 'admin', result_id: ar.result_id, question_id: aq });
  check('giải thích được câu sai trong test thử', r.status === 200 && r.data.data.explanation.correct_reason.includes('False'), r.data);

  console.log('\n[2. Trợ lý học tập]');
  r = await s3('POST', '/api/ai/insights');
  check('chưa có dữ liệu học tập → 422, không tính lượt', r.status === 422 && usage('ai.moi@gmail.com', 'insights', 'ok') === '0', r.data);
  check('giảng viên không dùng trợ lý học tập (403)', (await gv('POST', '/api/ai/insights')).status === 403);
  check('chưa tạo nhận xét → report null', (await s1('GET', '/api/ai/insights')).data.data.report === null);
  r = await s1('POST', '/api/ai/insights');
  const rep = r.data.data?.report;
  check('tạo nhận xét → 201, đủ tổng quan, điểm mạnh, điểm yếu, kế hoạch', r.status === 201 && rep.summary.includes('4 câu') && rep.strengths.length && rep.weaknesses[0].advice && rep.plan.length === 2, r.data);
  check('gợi ý chỉ giữ mục có thật, kèm link đúng', rep.recommendations.length === 2 &&
    rep.recommendations.some(x => x.type === 'practice' && x.id === at && x.link === `test-take.html?source=admin&id=${at}`) &&
    !rep.recommendations.some(x => x.id === 999999), rep.recommendations);
  const savedProfile = sql("SELECT i.profile FROM ai_insights i JOIN users u ON u.id=i.user_id WHERE u.email='ai.mot@gmail.com'");
  check('số liệu gửi cho AI không có họ tên, email của học viên', !savedProfile.includes('ai.mot') && savedProfile.includes('tong_so_cau_da_lam'));
  const profile = JSON.parse(savedProfile);
  check('số liệu có tỉ lệ đúng theo phần, dạng câu và các câu sai gần đây', profile.tong_so_cau_da_lam === 4 &&
    profile.ti_le_dung_theo_phan.find(p => p.name === 'doc').answered === 2 && profile.cau_sai_gan_day.length === 3, profile);
  r = await s1('GET', '/api/ai/insights');
  check('xem lại nhận xét đã lưu, chưa có bài làm mới', r.data.data.report.summary === rep.summary && r.data.data.has_new_activity === false && r.data.data.remaining_today === 1);
  await new Promise(res => setTimeout(res, 1100));
  await take(s1, { [q1]: 'FALSE', [q2]: 'B', [q3]: 'Europe', [q4]: 'NOT_GIVEN' });
  check('làm bài mới → báo có hoạt động mới để cập nhật nhận xét', (await s1('GET', '/api/ai/insights')).data.data.has_new_activity === true);
  await s1('POST', '/api/ai/insights');
  check('hết 2 lượt nhận xét trong ngày → 429', (await s1('POST', '/api/ai/insights')).status === 429);

  console.log('\n[3. Hỏi đáp AI trong bài giảng]');
  const ASK = `/api/ai/lectures/${L}/ask`;
  r = await s1('POST', ASK, { question: 'Khi nào dùng thì hiện tại hoàn thành?' });
  check('học viên đang học hỏi trợ lý → có câu trả lời và số lượt còn lại', r.status === 200 && r.data.data.answer.includes('hiện tại hoàn thành') && r.data.data.remaining_today === 2, r.data);
  check('ghi một lượt hỏi đáp', usage('ai.mot@gmail.com', 'ask', 'ok') === '1');
  r = await s1('POST', ASK, { question: 'Trong video thầy nói gì ở phút thứ 3?' });
  check('câu hỏi về nội dung video → gợi ý hỏi giảng viên', r.data.data.ask_teacher === true, r.data.data);
  r = await s1('POST', ASK, { question: 'Cách phân biệt hai thì này là gì?' });
  check('hỏi tiếp câu thứ ba vẫn trả lời bình thường', r.status === 200 && r.data.data.key_points.length > 0, r.data);
  r = await s1('POST', ASK, { question: 'Vì sao vậy bạn?' });
  check('hết lượt hỏi trong ngày → 429', r.status === 429 && r.data.message.includes('hỏi đáp bài giảng'), r.data);
  await s3('POST', `/api/user/enroll/${C}`);
  for (const id of sql(`SELECT id FROM enrollments WHERE course_id=${C} AND status='pending'`).split('\n').filter(Boolean)) await admin('PUT', `/api/admin/enrollments/${id}`, { action: 'approve' });
  check('câu hỏi quá ngắn hoặc bỏ trống → 400; chưa đăng nhập → 401; bài giảng không có → 404',
    (await s3('POST', ASK, { question: 'ab' })).status === 400 &&
    (await s3('POST', ASK, {})).status === 400 &&
    (await anon('POST', ASK, { question: 'Câu hỏi hợp lệ về ngữ pháp' })).status === 401 &&
    (await s1('POST', '/api/ai/lectures/999999/ask', { question: 'Câu hỏi hợp lệ về ngữ pháp' })).status === 404);
  console.log('\n[3a. Trợ lý đọc tài liệu và không lặp câu hỏi trong đề]');
  // Tạo một tài liệu .txt thật cho bài giảng rồi hỏi trợ lý
  const matDir = require('path').join(process.cwd(), 'uploads', 'materials');
  const matName = 'test_ai_' + Date.now() + '.txt';
  require('fs').writeFileSync(require('path').join(matDir, matName), 'Penny universities: London coffee houses charged one penny for a cup of coffee. Customers could listen to lectures all day.');
  sql(`INSERT INTO materials (course_id, lecture_id, teacher_id, filename, filepath, filetype, filesize) VALUES (${C}, ${L}, 2, '${matName}', 'uploads/materials/${matName}', 'text/plain', 100)`);
  const hv = await newUser('ai.tailieu');
  await hv('POST', `/api/user/enroll/${C}`);
  for (const id of sql(`SELECT id FROM enrollments WHERE course_id=${C} AND status='pending'`).split('\n').filter(Boolean)) await admin('PUT', `/api/admin/enrollments/${id}`, { action: 'approve' });
  r = await hv('POST', ASK, { question: 'Tài liệu bài này nói gì về penny universities?' });
  check('trợ lý báo đã đọc tài liệu của bài giảng', r.status === 200 && r.data.data.used_materials === 1, r.data.data);
  check('chữ trong tài liệu được bóc và lưu lại để lần sau khỏi đọc file',
    sql(`SELECT LEFT(text_content, 18) FROM materials WHERE filename='${matName}'`) === 'Penny universities');
  const bankQuestion = sql(`SELECT q.question_text FROM questions q JOIN tests t ON t.id=q.test_id WHERE t.lecture_id=${L} ORDER BY q.order_num, q.id LIMIT 1`);
  r = await hv('POST', ASK, { question: 'Cho mình vài cách luyện tập thêm với' });   // dữ liệu mẫu cố tình chèn một câu trong đề
  check('gợi ý trùng câu hỏi giảng viên đã ra bị loại bỏ',
    r.data.data.key_points.length === 2 && !r.data.data.key_points.some(t => t.includes(bankQuestion)), { bankQuestion, key_points: r.data.data.key_points });
  require('fs').unlinkSync(require('path').join(matDir, matName));
  sql(`DELETE FROM materials WHERE filename='${matName}'`);

  console.log('\n[3b. Không cho xin đáp án, không làm hộ bài]');
  const qText = sql(`SELECT question_text FROM questions WHERE id=${q2}`);
  r = await s2('POST', ASK, { question: qText });
  check('chép nguyên câu trong đề → chặn, thay bằng hướng dẫn cách làm', r.status === 200 && r.data.data.guided === true && r.data.data.guard_reason === 'answer' && !/Đáp án là B/.test(r.data.data.answer) && r.data.data.key_points.length === 3, r.data.data);
  check('ghi nhận lượt bị chặn trong nhật ký AI', sql("SELECT COUNT(*) FROM ai_usage WHERE feature='ask' AND guard='answer'") === '1');
  r = await s2('POST', ASK, { question: 'Câu 2 chọn A hay B vậy bạn?' });
  check('hỏi kiểu "chọn A hay B" → vẫn chặn', r.data.data.guided === true && r.data.data.guard_reason === 'answer', r.data.data);
  r = await s2('POST', ASK, { question: 'Viết hộ mình bài luận 250 từ về chủ đề này với' });
  check('nhờ viết hộ bài luận → chặn kiểu làm hộ', r.data.data.guided === true && r.data.data.guard_reason === 'do_work' && r.data.data.answer.includes('không viết hộ bài'), r.data.data);
  check('giảng viên nhận thông báo khi học viên xin đáp án nhiều lần',
    (await gv('GET', '/api/notifications')).data.data.items.filter(n => n.type === 'ai_answer_request').length === 1);
  r = await s3('POST', ASK, { question: 'Dạng câu True False Not Given nên làm thế nào cho nhanh?' });
  check('hỏi cách làm dạng câu → trả lời bình thường, không bị chặn', r.data.data.guided === false, r.data.data);

  const ngoai = await newUser('ai.ngoaikhoa');
  check('giảng viên của khóa hỏi được, người chưa đăng ký khóa bị chặn 403',
    (await gv('POST', ASK, { question: 'Gợi ý cách giảng phần này?' })).status === 200 &&
    (await ngoai('POST', ASK, { question: 'Câu hỏi hợp lệ về ngữ pháp' })).status === 403);

  console.log('\n[3. Chấm Writing]');
  check('dạng bài lạ, đề quá ngắn → 400',
    (await admin('POST', '/api/admin/writing-prompts', { task_type: 'essay', title: 'x', prompt_text: 'x'.repeat(30) })).status === 400 &&
    (await admin('POST', '/api/admin/writing-prompts', { task_type: 'ielts_task2', title: 'Đề', prompt_text: 'ngắn' })).status === 400);
  r = await admin('POST', '/api/admin/writing-prompts', { task_type: 'ielts_task2', title: 'Technology and life', prompt_text: 'Some people think technology makes life more complicated. To what extent do you agree or disagree?' });
  const P = r.data.data?.id;
  check('admin tạo đề IELTS Task 2 (số từ, thời gian mặc định theo dạng bài)', r.status === 201 && sql(`SELECT min_words || '|' || time_minutes FROM writing_prompts WHERE id=${P}`) === '250|40');
  const draft = (await admin('POST', '/api/admin/writing-prompts', { task_type: 'toeic_opinion', title: 'Nháp', prompt_text: 'Do you agree that working from home is better?', status: 'draft' })).data.data.id;
  const toefl = (await admin('POST', '/api/admin/writing-prompts', { task_type: 'toefl_discussion', title: 'Online classes', prompt_text: 'Your professor asks: are online classes as effective as in-person classes? Contribute to the discussion.' })).data.data.id;
  check('học viên không vào được route quản lý đề (403)', (await s1('GET', '/api/admin/writing-prompts')).status === 403);
  let list = (await anon('GET', '/api/writing/prompts')).data.data;
  check('danh sách công khai: chỉ đề đang mở, kèm thang điểm', list.enabled && list.prompts.length === 2 && !list.prompts.some(p => p.id === draft) && list.prompts.find(p => p.id === P).scale_max === 9);
  check('bài dưới 30 từ → 400; đề nháp → 404; GV nộp → 403',
    (await s1('POST', `/api/writing/prompts/${P}/submit`, { essay: 'Too short essay.' })).status === 400 &&
    (await s1('POST', `/api/writing/prompts/${draft}/submit`, { essay: ESSAY })).status === 404 &&
    (await gv('POST', `/api/writing/prompts/${P}/submit`, { essay: ESSAY })).status === 403);
  r = await s1('POST', `/api/writing/prompts/${P}/submit`, { essay: ESSAY });
  check('nộp bài → trả lời ngay với trạng thái đang chấm, không bắt chờ AI', r.status === 201 && r.data.data.status === 'grading' && r.data.data.result === null, r.data);
  let sub = await waitGraded(s1, r.data.data.id);
  check('chấm ở nền xong: 4 tiêu chí IELTS', sub && sub.status === 'graded' && sub.result.criteria.length === 4 && sub.result.criteria[0].name === 'Task Response', sub);
  check('học viên nhận thông báo đã chấm xong', (await s1('GET', '/api/notifications')).data.data.items.some(n => n.type === 'writing_graded' && n.link === `writing-task.html?submission=${sub.id}`));
  check('band tổng: (6.5 + 6 + 6 + 6) / 4 = 6.125 → 6.0', sub.overall_score === 6 && sub.scale_max === 9, sub);
  check('chỉ giữ câu sửa trích đúng từ bài viết', sub.result.corrections.length === 1 && ESSAY.includes(sub.result.corrections[0].original), sub.result.corrections);
  check('đếm số từ', sub.word_count === 64, sub.word_count);
  r = await s1('POST', `/api/writing/prompts/${toefl}/submit`, { essay: ESSAY });
  const toeflSub = await waitGraded(s1, r.data.data.id);
  check('TOEFL: thang 5, 3 tiêu chí', toeflSub.overall_score === 3 && toeflSub.scale_max === 5 && toeflSub.result.criteria.length === 3, toeflSub);
  list = (await s1('GET', '/api/user/writing')).data.data;
  check('lịch sử bài viết của học viên', list.length === 2 && list[0].exam === 'TOEFL');
  check('xem chi tiết bài của người khác → 404', (await s2('GET', `/api/user/writing/${sub.id}`)).status === 404 && (await s1('GET', `/api/user/writing/${sub.id}`)).data.data.essay === ESSAY);
  const promptView = (await s1('GET', `/api/writing/prompts/${P}`)).data.data;
  check('trang đề hiện tiêu chí và các lần nộp của mình', promptView.prompt.criteria.length === 4 && promptView.history.length === 1);
  check('bài đã chấm → không chấm lại (409)', (await s1('POST', `/api/user/writing/${sub.id}/regrade`)).status === 409);
  sql(`UPDATE writing_submissions SET status='failed', overall_score=NULL, result=NULL WHERE id=${sub.id}`);
  r = await s1('POST', `/api/user/writing/${sub.id}/regrade`);
  const regraded = await waitGraded(s1, sub.id);
  check('bài chấm lỗi → chấm lại được', r.status === 200 && regraded.status === 'graded' && regraded.overall_score === 6, regraded);

  check('đề đã có bài nộp → không xóa được (409); đề nháp chưa có bài → xóa được',
    (await admin('DELETE', `/api/admin/writing-prompts/${P}`)).status === 409 && (await admin('DELETE', `/api/admin/writing-prompts/${draft}`)).data.success);
  const adminList = (await admin('GET', '/api/admin/writing-prompts')).data.data;
  check('admin thấy số bài đã chấm và điểm trung bình', adminList.find(p => p.id === P).submissions === 1 && adminList.find(p => p.id === P).avg_score === 6);

  console.log('\n[3c. Học viên tự nhập đề luyện viết]');
  r = await s2('POST', '/api/writing/prompts/mine', { task_type: 'ielts_task2', title: 'Đề Cam 18 Test 2', prompt_text: 'Some people say that music is a good way of bringing people of different cultures together. To what extent do you agree?' });
  const mine = r.data.data?.id;
  check('học viên tạo đề riêng', r.status === 201 && sql(`SELECT status FROM writing_prompts WHERE id=${mine}`) === 'personal');
  check('đề thiếu nội dung hoặc sai dạng bài → 400',
    (await s2('POST', '/api/writing/prompts/mine', { task_type: 'ielts_task2', title: 'x', prompt_text: 'ngắn' })).status === 400 &&
    (await s2('POST', '/api/writing/prompts/mine', { task_type: 'essay', title: 'x', prompt_text: 'x'.repeat(40) })).status === 400);
  check('giảng viên và khách không tạo được đề riêng',
    (await gv('POST', '/api/writing/prompts/mine', { task_type: 'ielts_task2', title: 'x', prompt_text: 'x'.repeat(40) })).status === 403 &&
    (await anon('POST', '/api/writing/prompts/mine', { task_type: 'ielts_task2', title: 'x', prompt_text: 'x'.repeat(40) })).status === 401);
  let mylist = (await s2('GET', '/api/writing/prompts')).data.data.prompts;
  check('chủ nhân thấy đề riêng của mình, có đánh dấu', mylist.some(p => p.id === mine && p.mine === true), mylist.map(p => [p.id, p.mine]));
  check('người khác và khách không thấy đề riêng đó',
    !(await s1('GET', '/api/writing/prompts')).data.data.prompts.some(p => p.id === mine) &&
    !(await anon('GET', '/api/writing/prompts')).data.data.prompts.some(p => p.id === mine));
  check('người khác mở thẳng đề riêng → 404; chủ nhân mở được',
    (await s1('GET', `/api/writing/prompts/${mine}`)).status === 404 &&
    (await s2('GET', `/api/writing/prompts/${mine}`)).status === 200);
  check('đề riêng không lọt vào trang quản trị đề', !(await admin('GET', '/api/admin/writing-prompts')).data.data.some(p => p.id === mine));
  check('người khác nộp bài theo đề riêng → 404', (await s1('POST', `/api/writing/prompts/${mine}/submit`, { essay: ESSAY })).status === 404);
  r = await s2('POST', `/api/writing/prompts/${mine}/submit`, { essay: ESSAY });
  const mineSub = r.status === 201 ? await waitGraded(s2, r.data.data.id) : null;
  check('chủ nhân viết theo đề riêng và được chấm', mineSub && mineSub.status === 'graded' && mineSub.prompt_title === 'Đề Cam 18 Test 2', mineSub && mineSub.status);
  check('đã viết bài rồi thì không xóa được đề (409)', (await s2('DELETE', `/api/writing/prompts/mine/${mine}`)).status === 409);
  const spare = (await s2('POST', '/api/writing/prompts/mine', { task_type: 'toeic_opinion', title: 'Đề bỏ', prompt_text: 'Do you agree that reading books is better than watching films?' })).data.data.id;
  check('đề chưa viết bài thì xóa được, đề của người khác thì không',
    (await s1('DELETE', `/api/writing/prompts/mine/${spare}`)).status === 404 &&
    (await s2('DELETE', `/api/writing/prompts/mine/${spare}`)).data.success &&
    sql(`SELECT COUNT(*) FROM writing_prompts WHERE id=${spare}`) === '0');

  console.log('\n[3d. Kiểm tra tính trung thực của bài viết]');
  check('bài đã chấm có kết quả kiểm tra: mức trùng lặp, dấu hiệu AI, trạng thái tra cứu web',
    sub.integrity === undefined ? (await s1('GET', `/api/user/writing/${sub.id}`)).data.data.integrity?.ai_likelihood === 'thap' : true);
  r = await s2('POST', `/api/writing/prompts/${P}/submit`, { essay: ESSAY });   // chép y nguyên bài của s1 ở cùng đề
  const copied = await waitGraded(s2, r.data.data.id);
  check('chép bài của học viên khác cùng đề → trùng lặp mức cao, ghi rõ nguồn',
    copied.integrity.similarity_level === 'cao' && copied.integrity.matches[0].type === 'other' && copied.integrity.matches[0].percent >= 90, copied.integrity);
  check('tra cứu web ở chế độ chạy thử vẫn chạy và không tìm thấy câu trùng', copied.integrity.web.checked === true && copied.integrity.web.found.length === 0, copied.integrity.web);
  const promptText = sql(`SELECT prompt_text FROM writing_prompts WHERE id=${P}`);
  r = await s3('POST', `/api/writing/prompts/${P}/submit`, { essay: promptText + ' ' + promptText + ' In my view technology helps people in many ways every single day and I agree with that idea.' });
  const padded = await waitGraded(s3, r.data.data.id);
  check('chép lại đề bài để lấp số từ → phát hiện trùng với đề', padded.integrity.matches.some(m => m.type === 'prompt'), padded.integrity);
  const flags = (await admin('GET', '/api/admin/writing-flags')).data.data;
  check('admin thấy các bài cần xem lại', flags.some(f => f.id === copied.id) && flags.some(f => f.id === padded.id), flags.map(f => f.id));
  const sach = await newUser('ai.tuviet');
  r = await sach('POST', `/api/writing/prompts/${toefl}/submit`, { essay: 'Online classes save travel time, but I think students still need a real classroom. When my cousin studied online last year, she often lost focus and could not ask the teacher quickly. Group work was also harder because the internet was slow in her village.' });
  const own = await waitGraded(sach, r.data.data.id);
  const flags2 = (await admin('GET', '/api/admin/writing-flags')).data.data;
  check('bài tự viết không trùng ai thì không bị đưa vào danh sách cần xem lại', own.integrity.similarity_level === 'thap' && !flags2.some(f => f.id === own.id), own.integrity);
  r = await admin('GET', `/api/admin/writing/${copied.id}`);
  check('admin mở được nội dung bài kèm kết quả kiểm tra', r.status === 200 && r.data.data.essay === ESSAY && r.data.data.integrity.similarity_level === 'cao');
  check('học viên và giảng viên không vào được danh sách cần xem lại',
    (await s1('GET', '/api/admin/writing-flags')).status === 403 && (await gv('GET', `/api/admin/writing/${copied.id}`)).status === 403);

  console.log('\n[3e. Trang luyện viết]');
  const plist = (await s1('GET', '/api/writing/prompts')).data.data.prompts;
  const pCard = plist.find(p => p.id === P);
  check('thẻ đề có liên kết tới bài gần nhất để xem bài cũ', pCard.my_latest_id > 0 && pCard.my_submissions >= 1, pCard);
  const myRows = (await s2('GET', '/api/user/writing')).data.data;
  check('danh sách bài viết đánh dấu bài theo đề tự tạo', myRows.some(r => r.prompt_id === mine && r.mine === true) && myRows.some(r => r.prompt_id === P && r.mine === false), myRows.map(r => [r.prompt_id, r.mine]));

  console.log('\n[3f. Ngôn ngữ nhận xét của AI]');
  const nn = await newUser('ai.ngonngu');
  check('mặc định trợ lý AI trả lời bằng tiếng Anh', (await nn('GET', '/api/user/profile')).data.data.ai_language === 'en');
  check('ngôn ngữ không hỗ trợ → 400', (await nn('PUT', '/api/user/settings', { ai_language: 'fr' })).status === 400);
  r = await nn('PUT', '/api/user/settings', { ai_language: 'vi' });
  check('tắt tiếng Anh thì lưu tiếng Việt', r.data.success && (await nn('GET', '/api/user/profile')).data.data.ai_language === 'vi');
  r = await nn('PUT', '/api/user/settings', { ai_language: 'en' });
  check('bật lại tiếng Anh và lưu lại', r.data.success && (await nn('GET', '/api/user/profile')).data.data.ai_language === 'en');
  await nn('POST', `/api/user/enroll/${C}`);
  for (const id of sql(`SELECT id FROM enrollments WHERE course_id=${C} AND status='pending'`).split('\n').filter(Boolean)) await admin('PUT', `/api/admin/enrollments/${id}`, { action: 'approve' });
  r = await nn('POST', ASK, { question: 'How should I practise this lesson?' });
  check('trợ lý nhận được chỉ dẫn trả lời bằng tiếng Anh', r.status === 200 && r.data.data.answer.endsWith('[EN]'), r.data);
  await s2('PUT', '/api/user/settings', { ai_language: 'vi' });
  r = await s2('POST', ASK, { question: 'Nên luyện bài này thế nào?' });
  check('học viên chọn tiếng Việt thì không bị đổi ngôn ngữ', r.status !== 200 || !r.data.data.answer.endsWith('[EN]'), r.data);
  const before = Number(sql(`SELECT COUNT(*) FROM ai_explanations WHERE question_id=${q1} AND kind='course'`));
  const rn = await take(nn, { [q1]: 'TRUE' });
  r = await nn('POST', '/api/ai/explain', { kind: 'course', result_id: rn.result_id, question_id: q1 });
  check('lời giải thích tiếng Anh lưu riêng, không dùng lại bản tiếng Việt', r.status === 200 && r.data.data.cached === false &&
    Number(sql(`SELECT COUNT(*) FROM ai_explanations WHERE question_id=${q1} AND kind='course'`)) === before + 1, r.data);

  console.log('\n[4. Sinh câu hỏi cho giảng viên]');
  r = await gv('POST', `${B}/questions/generate`, { count: 3, types: ['mcq', 'tfng', 'fill'], topic: 'Travel and tourism', level: 'Trung cấp' });
  let items = r.data.data?.items || [];
  check('tạo 3 câu lẻ + 1 câu lỗi được báo lỗi', r.status === 200 && items.length === 4 && items.filter(i => i.question).length === 3 && items[3].error.startsWith('Câu AI tạo chưa hợp lệ'), r.data);
  const mcq = items.find(i => i.question?.question_type === 'mcq')?.question;
  const tfng = items.find(i => i.question?.question_type === 'tfng')?.question;
  const fill = items.find(i => i.question?.question_type === 'fill')?.question;
  check('chuẩn hóa: bỏ "A." thừa, "not given" → NOT_GIVEN, đáp án điền từ bỏ trùng', mcq.option_a === 'First' && mcq.correct_answer === 'B' && tfng.correct_answer === 'NOT_GIVEN' && fill.accepted_answers.length === 2, items);
  r = await gv('POST', `${B}/questions/bulk`, { questions: items.filter(i => i.question).map(i => i.question), section_id: null });
  check('thêm các câu AI tạo vào đề qua route nhập nhiều câu', r.data.success && r.data.data.imported === 3, r.data);
  r = await gv('POST', `${B}/questions/generate`, { section_id: R, count: 2, types: ['tfng'] });
  check('tạo câu cho phần đọc dùng bài đọc của phần (không cần chủ đề)', r.status === 200 && r.data.data.items.length === 3);
  const lis = (await gv('POST', `${B}/sections`, { type: 'listening' })).data.data.id;
  r = await gv('POST', `${B}/questions/generate`, { section_id: lis, count: 2, types: ['mcq'] });
  check('phần nghe chưa có transcript, không ghi chủ đề → 400 hướng dẫn', r.status === 400 && r.data.message.includes('transcript'), r.data);
  check('số câu 0 hoặc 16, không chọn dạng câu, chủ đề quá ngắn → 400',
    (await gv('POST', `${B}/questions/generate`, { count: 0, types: ['mcq'], topic: 'Travel' })).status === 400 &&
    (await gv('POST', `${B}/questions/generate`, { count: 16, types: ['mcq'], topic: 'Travel' })).status === 400 &&
    (await gv('POST', `${B}/questions/generate`, { count: 3, types: [], topic: 'Travel' })).status === 400 &&
    (await gv('POST', `${B}/questions/generate`, { count: 3, types: ['mcq'], topic: 'ab' })).status === 400);
  await admin('POST', '/api/admin/users', { name: 'GV khác', email: 'gvkhac.ai@gmail.com', password: 'matkhau123', role: 'gv' });
  const gv2 = client(); await gv2('POST', '/api/auth/login', { email: 'gvkhac.ai@gmail.com', password: 'matkhau123' });
  check('giảng viên khác → 403; học viên → 403', (await gv2('POST', `${B}/questions/generate`, { count: 1, types: ['mcq'], topic: 'Travel' })).status === 403 &&
    (await s1('POST', `${B}/questions/generate`, { count: 1, types: ['mcq'], topic: 'Travel' })).status === 403);
  r = await admin('POST', `/api/admin/admin-tests/${at}/questions/generate`, { count: 2, types: ['fill'], topic: 'Daily routines' });
  check('admin tạo câu cho test thử', r.status === 200 && r.data.data.items.filter(i => i.question).length === 2);
  check('ghi lượt dùng tạo câu hỏi cho giảng viên', usage('hoang@gmail.com', 'generate', 'ok') === '2');

  console.log('\n[Thống kê AI cho admin]');
  r = await admin('GET', '/api/admin/ai-usage');
  const feat = f => r.data.data.features.find(x => x.feature === f);
  check('admin xem thống kê: bật mock, đủ 5 tính năng kèm giới hạn', r.status === 200 && r.data.data.enabled && r.data.data.model === 'mock' && r.data.data.features.length === 5 && feat('explain').daily_limit === 4 && feat('ask').calls >= 3, r.data);
  check('đếm lượt ok, lượt dùng lại lời giải, số người dùng', feat('generate').calls >= 3 && feat('explain').cached >= 1 && feat('explain').users >= 1 && feat('writing').today >= 1, r.data.data.features);
  check('thống kê bài Writing đã chấm', r.data.data.writing.graded >= 1, r.data.data.writing);
  check('giảng viên và học viên không xem được thống kê AI', (await gv('GET', '/api/admin/ai-usage')).status === 403 && (await s1('GET', '/api/admin/ai-usage')).status === 403);

  console.log('\n[Xóa tài khoản]');
  r = await s1('DELETE', '/api/user/account', { password: 'matkhau123' });
  check('xóa tài khoản → xóa bài viết và nhận xét AI', r.data.success &&
    sql("SELECT COUNT(*) FROM writing_submissions s JOIN users u ON u.id=s.user_id WHERE u.email LIKE 'deleted-%'") === '0' &&
    sql("SELECT COUNT(*) FROM ai_insights i JOIN users u ON u.id=i.user_id WHERE u.email LIKE 'deleted-%'") === '0');

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
})();

/**
 * EngPro – Tạo dữ liệu demo để trình bày
 *
 * Dùng:
 *   npm run demo -- --video <file.mp4> --doc <file.docx>   tạo dữ liệu demo
 *   npm run demo -- --remove                                xóa toàn bộ dữ liệu demo, kể cả file đã chép vào uploads/
 * Tùy chọn khi tạo: --ielts-teacher <email> giảng viên đứng tên khóa IELTS (mặc định hoang@gmail.com),
 *                   --teacher <email> giảng viên đứng tên khóa TOEIC, TOEFL.
 *
 * Tạo 5 khóa học IELTS, TOEIC, TOEFL. Mỗi khóa 3 bài giảng dùng chung một video và một tài liệu,
 * mỗi bài giảng có một bài kiểm tra. Thêm 3 đề test thử và 3 đề luyện.
 * KHÔNG tạo học viên hay giảng viên ảo: khóa học đứng tên các tài khoản giảng viên có sẵn,
 * số học viên và đánh giá là của người dùng thật.
 * Chỉ thêm dữ liệu mới, không sửa hay xóa dữ liệu có sẵn.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../db');

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days, hour = 19) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, (days * 7) % 60, 0, 0);
  return d;
};
const randomId = () => Math.random().toString(36).slice(2, 13);

// Tài khoản mẫu của phiên bản cũ (có giảng viên, học viên ảo @example.com): lệnh --remove vẫn dọn nếu còn sót
const LEGACY_DEMO_EMAILS = [
  'thu.giangvien@example.com', 'bao.giangvien@example.com', 'hoang.giangvien@example.com',
  'lan.hocvien@example.com', 'khoa.hocvien@example.com', 'anh.hocvien@example.com', 'ha.hocvien@example.com',
];

// ── Ngân hàng câu hỏi về thì hiện tại đơn (khớp nội dung tài liệu) ─────
const mcq = (text, options, answer) => ({ type: 'mcq', text, options, answer });
const fill = (text, accepted) => ({ type: 'fill', text, accepted });
const tfng = (text, answer) => ({ type: 'tfng', text, answer });

const POOL = {
  q1: mcq('She ___ to school every day.', ['go', 'goes', 'going', 'gone'], 'B'),
  q2: mcq('They ___ students at this university.', ['is', 'am', 'are', 'be'], 'C'),
  q3: mcq('Water ___ at 100 degrees Celsius.', ['boil', 'boils', 'boiling', 'is boil'], 'B'),
  q4: mcq('___ he work in a bank?', ['Do', 'Does', 'Is', 'Are'], 'B'),
  q5: mcq('I ___ coffee in the morning.', ["doesn't drink", "don't drink", 'not drink', 'am not drink'], 'B'),
  q6: mcq('My brother ___ football on Sundays.', ['play', 'plays', 'playing', 'is play'], 'B'),
  q7: mcq('The sun ___ in the east.', ['rise', 'rises', 'rising', 'rose'], 'B'),
  q8: mcq('We ___ happy with the result.', ['is', 'am', 'are', 'be'], 'C'),
  q9: mcq('How often ___ you check your email?', ['do', 'does', 'are', 'is'], 'A'),
  q10: mcq('The meeting ___ at 9 a.m. every Monday.', ['start', 'starts', 'starting', 'is start'], 'B'),
  q11: mcq('Our company ___ office supplies to local schools.', ['provide', 'provides', 'providing', 'are provide'], 'B'),
  q12: mcq('Most employees ___ to work by bus.', ['commutes', 'commute', 'commuting', 'is commute'], 'B'),
  q13: mcq('The report ___ the sales figures for each quarter.', ['show', 'shows', 'showing', 'are show'], 'B'),
  q14: mcq('It ___ a lot in this region during the rainy season.', ['rain', 'rains', 'raining', 'is rain'], 'B'),
  q15: mcq('My sister ___ like spicy food.', ["don't", "doesn't", "isn't", 'not'], 'B'),
  q16: mcq('Plants ___ sunlight to make their food.', ['needs', 'need', 'needing', 'is need'], 'B'),
  q17: mcq('The library ___ at 8 p.m. on weekdays.', ['close', 'closes', 'closing', 'are close'], 'B'),
  q18: mcq('Many people believe that exercise ___ mental health.', ['improve', 'improves', 'improving', 'are improve'], 'B'),
  f1: fill('He ___ (watch) TV every evening.', ['watches']),
  f2: fill('She ___ (study) English three times a week.', ['studies']),
  f3: fill('The train ___ (leave) at 7:30 every morning.', ['leaves']),
  f4: fill('I ___ (be) a student at EngPro.', ['am']),
  f5: fill('My parents ___ (live) in Da Nang.', ['live']),
  f6: fill('___ (do) your teacher give homework every day?', ['does']),
  f7: fill('Cats ___ (not / like) water.', ["don't like", 'do not like']),
  f8: fill('The manager ___ (check) the reports every Friday.', ['checks']),
  f9: fill('Bees ___ (make) honey from flowers.', ['make']),
  f10: fill('The shop ___ (not / open) on Sundays.', ["doesn't open", 'does not open']),
};

// ── Bài đọc cho phần Reading ─────────────────────────────────
const PASSAGES = {
  linh: {
    title: 'Reading: A student\'s daily life',
    instructions: 'Read the passage and answer the questions. Choose TRUE, FALSE or NOT GIVEN.',
    passage: 'Linh is a second-year student at a university in Hanoi. She lives in a small apartment near the campus with two friends. Every morning, she gets up at six o\'clock and goes jogging in the park. She usually has breakfast at a café on her way to class.\n\nLinh studies economics, and she has classes from Monday to Friday. On Tuesdays and Thursdays, she works part-time at a bookstore. She doesn\'t go out much during the week because she needs time to study. At weekends, she often visits her grandparents in the countryside.',
    questions: [
      tfng('Linh lives with her family.', 'FALSE'),
      tfng('Linh goes jogging every morning.', 'TRUE'),
      tfng('Linh\'s apartment has three bedrooms.', 'NOT_GIVEN'),
      tfng('Linh works at a bookstore two days a week.', 'TRUE'),
      mcq('What does Linh often do at weekends?', ['She studies at the library.', 'She visits her grandparents.', 'She works at the bookstore.', 'She goes to the cinema.'], 'B'),
    ],
  },
  notice: {
    title: 'Part 7: Staff notice',
    instructions: 'Read the notice and answer the questions.',
    passage: 'NOTICE TO ALL STAFF\n\nThe office cafeteria opens at 7:00 a.m. and closes at 3:00 p.m. from Monday to Friday. Hot meals are available from 11:30 a.m. to 1:30 p.m. Employees who work late can order dinner through the online system before 4:00 p.m.\n\nThe cafeteria does not open on weekends or public holidays. For questions, please contact the Facilities Department at extension 204.',
    questions: [
      tfng('The cafeteria serves hot meals all day.', 'FALSE'),
      tfng('Employees can order dinner online.', 'TRUE'),
      tfng('The cafeteria is open on Saturdays.', 'FALSE'),
      tfng('The cafeteria changes its prices every month.', 'NOT_GIVEN'),
      mcq('What time does the cafeteria close on weekdays?', ['7:00 a.m.', '11:30 a.m.', '3:00 p.m.', '4:00 p.m.'], 'C'),
    ],
  },
  water: {
    title: 'Reading: The water cycle',
    instructions: 'Read the passage and answer the questions. Choose TRUE, FALSE or NOT GIVEN.',
    passage: 'Water constantly moves between the Earth\'s surface and the atmosphere. The sun heats water in oceans, lakes, and rivers, and the water evaporates into the air. As water vapor rises, it cools and condenses into tiny droplets that form clouds.\n\nWhen these droplets become heavy, they fall back to the ground as rain or snow. Plants also release water vapor through their leaves, a process that scientists call transpiration. Together, these processes keep the amount of water on Earth almost the same over time.',
    questions: [
      tfng('The sun causes water to evaporate.', 'TRUE'),
      tfng('Clouds form when water vapor becomes warmer.', 'FALSE'),
      tfng('Transpiration happens through the roots of plants.', 'FALSE'),
      tfng('Snow falls more often than rain.', 'NOT_GIVEN'),
      mcq('What is transpiration?', ['Water falling as rain', 'Water vapor released by plants', 'Water moving into oceans', 'Clouds forming in the sky'], 'B'),
    ],
  },
};

// ── Khóa học ──────────────────────────────────────────────────
const COURSES = [
  {
    key: 'ielts1', teacher: 'ielts', category: 'IELTS', title: 'IELTS Foundation 4.0 – 5.5', level: 'Cơ bản',
    band_from: '4.0', band_to: '5.5', price: 1490000, published: 50,
    description: 'Khóa nền tảng cho người mới bắt đầu luyện IELTS: củng cố ngữ pháp cốt lõi, làm quen cấu trúc đề thi và luyện phản xạ bốn kỹ năng qua các chủ đề quen thuộc hằng ngày.',
    objectives: 'Nắm chắc thì hiện tại đơn và cách chia động từ\nTự tin trả lời IELTS Speaking Part 1 về thói quen, sở thích\nViết câu đúng ngữ pháp khi nêu sự thật, quan điểm trong Writing Task 2',
    lectures: [
      { title: 'Thì hiện tại đơn: định nghĩa và công thức', skill: 'Grammar', week: 1, qs: ['q1', 'q2', 'q15', 'f1', 'f4'] },
      { title: 'Hiện tại đơn trong IELTS Speaking Part 1: nói về thói quen', skill: 'Speaking', week: 1, qs: ['q5', 'q6', 'q9', 'f2', 'f7'] },
      { title: 'Viết về sự thật hiển nhiên trong Writing Task 2', skill: 'Writing', week: 2, qs: ['q3', 'q7', 'q18', 'q16', 'f9'] },
    ],
  },
  {
    key: 'ielts2', teacher: 'ielts', category: 'IELTS', title: 'IELTS Intensive 5.5 – 6.5', level: 'Trung cấp',
    band_from: '5.5', band_to: '6.5', price: 2490000, published: 42,
    description: 'Khóa tăng tốc cho học viên đã có nền tảng: sửa các lỗi ngữ pháp làm mất điểm, luyện mô tả quy trình trong Writing Task 1 và đọc hiểu dạng True / False / Not Given.',
    objectives: 'Loại bỏ lỗi chia động từ thường gặp ở band 5.5\nMô tả quy trình và số liệu bằng thì hiện tại đơn\nLàm đúng dạng True / False / Not Given trong Reading',
    lectures: [
      { title: 'Ôn nhanh hiện tại đơn và lỗi chia động từ thường gặp', skill: 'Grammar', week: 1, qs: ['q12', 'q13', 'q15', 'f7', 'f10'] },
      { title: 'Mô tả quy trình bằng hiện tại đơn trong Writing Task 1', skill: 'Writing', week: 1, qs: ['q3', 'q14', 'q16', 'f3', 'f9'] },
      { title: 'Reading: nhận diện thói quen và sự thật trong bài đọc', skill: 'Reading', week: 2, passage: 'linh' },
    ],
  },
  {
    key: 'toeic1', teacher: 'other', category: 'TOEIC', title: 'TOEIC 450+ cho người mới bắt đầu', level: 'Cơ bản',
    band_from: '250', band_to: '450', price: 990000, published: 55,
    description: 'Lộ trình TOEIC từ con số 0: nắm ngữ pháp nền tảng, làm quen các Part trong đề Listening & Reading và luyện mẹo chọn đáp án nhanh cho người đi làm bận rộn.',
    objectives: 'Phân biệt động từ to be và động từ thường ở thì hiện tại đơn\nLàm đúng các câu chia động từ trong Part 5\nNghe và trả lời câu hỏi Do / Does trong Part 2',
    lectures: [
      { title: 'Hiện tại đơn: động từ to be và động từ thường', skill: 'Grammar', week: 1, qs: ['q2', 'q8', 'q1', 'f4', 'f5'] },
      { title: 'TOEIC Part 5: chọn dạng đúng của động từ', skill: 'Grammar', week: 1, qs: ['q10', 'q11', 'q13', 'f8', 'f3'] },
      { title: 'TOEIC Part 2: câu hỏi Do / Does và cách trả lời', skill: 'Listening', week: 2, qs: ['q4', 'q9', 'q5', 'f6', 'f10'] },
    ],
  },
  {
    key: 'toeic2', teacher: 'other', category: 'TOEIC', title: 'TOEIC 650+ Listening & Reading', level: 'Trung cấp',
    band_from: '450', band_to: '650', price: 1690000, published: 35,
    description: 'Khóa luyện đề cho mục tiêu 650+: tập trung Part 3, Part 5 và Part 7 với ngữ cảnh công sở, email, thông báo và lịch trình làm việc thường gặp trong đề thi.',
    objectives: 'Nắm quy tắc hòa hợp chủ ngữ và động từ\nĐọc nhanh thông báo, lịch trình trong Part 7\nNghe hiểu hội thoại về công việc hằng ngày trong Part 3',
    lectures: [
      { title: 'Hòa hợp chủ ngữ và động từ ở thì hiện tại đơn', skill: 'Grammar', week: 1, qs: ['q11', 'q12', 'q13', 'f8', 'f2'] },
      { title: 'TOEIC Part 7: đọc thông báo và lịch trình', skill: 'Reading', week: 1, passage: 'notice' },
      { title: 'TOEIC Part 3: hội thoại về công việc hằng ngày', skill: 'Listening', week: 2, qs: ['q10', 'q17', 'q9', 'f3', 'f6'] },
    ],
  },
  {
    key: 'toefl1', teacher: 'other', category: 'TOEFL', title: 'TOEFL iBT Starter 60+', level: 'Cơ bản',
    band_from: '40', band_to: '60', price: 1990000, published: 28,
    description: 'Khóa khởi động TOEFL iBT cho học sinh chuẩn bị du học: làm quen văn phong học thuật, đọc hiểu bài khoa học và viết đoạn thảo luận Academic Discussion.',
    objectives: 'Dùng hiện tại đơn đúng văn phong học thuật\nĐọc hiểu bài đọc về sự thật khoa học\nViết đoạn nêu quan điểm rõ ràng cho Academic Discussion',
    lectures: [
      { title: 'Hiện tại đơn trong văn phong học thuật', skill: 'Grammar', week: 1, qs: ['q3', 'q7', 'q16', 'f9', 'f1'] },
      { title: 'Academic Discussion: nêu quan điểm bằng hiện tại đơn', skill: 'Writing', week: 1, qs: ['q18', 'q12', 'q6', 'f5', 'f7'] },
      { title: 'TOEFL Reading: sự thật khoa học và thì hiện tại đơn', skill: 'Reading', week: 2, passage: 'water' },
    ],
  },
];

// ── Test thử và luyện đề ─────────────────────────────────────
const ADMIN_TESTS = [
  { title: 'IELTS Mini Test: Grammar & Reading', type: 'test_thu', category: 'IELTS', skill: 'full', difficulty: 'medium', duration: 20,
    description: 'Đề rút gọn 10 câu gồm ngữ pháp và một bài đọc True / False / Not Given, làm trong 20 phút để ước lượng band hiện tại.',
    passage: 'linh', qs: ['q1', 'q3', 'q9', 'f2', 'f7'] },
  { title: 'TOEIC Mini Test: Part 5 & Part 7', type: 'test_thu', category: 'TOEIC', skill: 'reading', difficulty: 'medium', duration: 20,
    description: 'Mô phỏng Part 5 và Part 7 của đề TOEIC Reading với ngữ cảnh công sở, 10 câu trong 20 phút.',
    passage: 'notice', qs: ['q10', 'q11', 'q12', 'q13', 'f8'] },
  { title: 'TOEFL Mini Test: Academic Reading', type: 'test_thu', category: 'TOEFL', skill: 'reading', difficulty: 'hard', duration: 20,
    description: 'Bài đọc học thuật về vòng tuần hoàn của nước kèm câu hỏi ngữ pháp, 10 câu trong 20 phút.',
    passage: 'water', qs: ['q7', 'q16', 'q18', 'f9', 'f3'] },
  { title: 'Luyện ngữ pháp: Thì hiện tại đơn', type: 'luyen_de', category: 'IELTS', skill: null, difficulty: 'easy', duration: 15,
    description: '10 câu trắc nghiệm và điền từ về công thức, cách dùng thì hiện tại đơn.',
    qs: ['q1', 'q2', 'q4', 'q5', 'q8', 'q15', 'f1', 'f4', 'f6', 'f7'] },
  { title: 'TOEIC Part 5: Chia động từ', type: 'luyen_de', category: 'TOEIC', skill: 'reading', difficulty: 'medium', duration: 10,
    description: 'Luyện nhanh các câu chia động từ thường gặp trong Part 5 của đề TOEIC.',
    qs: ['q10', 'q11', 'q12', 'q13', 'q17', 'f8', 'f10', 'f3'] },
  { title: 'TOEFL Reading: Sự thật khoa học', type: 'luyen_de', category: 'TOEFL', skill: 'reading', difficulty: 'medium', duration: 15,
    description: 'Một bài đọc khoa học ngắn kèm câu hỏi True / False / Not Given theo văn phong TOEFL.',
    passage: 'water', qs: [] },
];

const COURSE_TITLES = COURSES.map(c => c.title);
const ADMIN_TEST_TITLES = ADMIN_TESTS.map(t => t.title);

// ── Tiện ích ─────────────────────────────────────────────────
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

async function insertQuestions(conn, { table, ownerCol, ownerId, sectionId, questions, startOrder }) {
  const ids = [];
  for (const [i, q] of questions.entries()) {
    const [r] = await conn.query(
      `INSERT INTO ${table} (${ownerCol}, section_id, question_type, question_text, option_a, option_b, option_c, option_d,
                             correct_answer, accepted_answers, order_num)
       VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      [ownerId, sectionId, q.type, q.text, ...(q.options || [null, null, null, null]),
       q.type === 'fill' ? null : q.answer, q.type === 'fill' ? JSON.stringify(q.accepted) : null, startOrder + i]
    );
    ids.push({ id: r.insertId, q });
  }
  return ids;
}

// Thêm câu hỏi của một đề: phần đọc (nếu có) trước, câu hỏi lẻ sau
async function buildQuestions(conn, { kind, ownerId, passageKey, qs }) {
  const table = kind === 'course' ? 'questions' : 'admin_questions';
  const ownerCol = kind === 'course' ? 'test_id' : 'admin_test_id';
  let all = [];
  if (passageKey) {
    const p = PASSAGES[passageKey];
    const [s] = await conn.query(
      `INSERT INTO test_sections (${kind === 'course' ? 'test_id' : 'admin_test_id'}, type, title, instructions, passage, order_num)
       VALUES (?,?,?,?,?,1) RETURNING id`,
      [ownerId, 'reading', p.title, p.instructions, p.passage]
    );
    all = all.concat(await insertQuestions(conn, { table, ownerCol, ownerId, sectionId: s.insertId, questions: p.questions, startOrder: 1 }));
  }
  all = all.concat(await insertQuestions(conn, {
    table, ownerCol, ownerId, sectionId: null, questions: qs.map(k => POOL[k]), startOrder: all.length + 1,
  }));
  return all;
}

// Giảng viên đứng tên khóa demo: tài khoản giảng viên có sẵn, không tạo tài khoản mới
async function pickTeachers() {
  const [rows] = await pool.query("SELECT id, email FROM users WHERE role='gv' AND status='active' AND deleted_at IS NULL ORDER BY id");
  if (!rows.length) throw new Error('Cần ít nhất một tài khoản giảng viên đang hoạt động để đứng tên các khóa demo.');
  const byEmail = email => {
    if (!email) return null;
    const row = rows.find(r => r.email === email.toLowerCase());
    if (!row) throw new Error(`Không có giảng viên đang hoạt động với email ${email}`);
    return row.id;
  };
  const ielts = byEmail(argValue('--ielts-teacher')) ?? (rows.find(r => r.email === 'hoang@gmail.com') || rows[0]).id;
  const other = byEmail(argValue('--teacher')) ?? (rows.find(r => r.id !== ielts) || rows[0]).id;
  return { ielts, other };
}

// ── Tạo dữ liệu ──────────────────────────────────────────────
async function seed(videoFile, docFile) {
  const [[exists]] = await pool.query('SELECT COUNT(*) AS n FROM courses WHERE title IN (?)', [COURSE_TITLES]);
  if (exists.n) throw new Error('Đã có dữ liệu demo. Chạy "npm run demo -- --remove" trước nếu muốn tạo lại.');
  const teachers = await pickTeachers();

  const videoSize = fs.statSync(videoFile).size;
  const docSize = fs.statSync(docFile).size;
  const docName = path.basename(docFile).normalize('NFC');
  const copied = [];   // file đã chép, xóa lại nếu có lỗi giữa chừng
  const copy = (from, dir, name) => {
    const to = path.join(ROOT, 'uploads', dir, name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied.push(to);
  };

  const conn = await pool.getConnection();
  const counts = { courses: 0, lectures: 0, tests: 0, admin_tests: 0 };
  try {
    await conn.beginTransaction();
    const [cats] = await conn.query('SELECT id, type FROM categories ORDER BY id');
    const categoryId = type => (cats.find(c => c.type === type) || {}).id || null;

    // Khóa học, bài giảng, tài liệu, bài kiểm tra
    const courses = {};
    for (const c of COURSES) {
      const [r] = await conn.query(
        `INSERT INTO courses (category_id, teacher_id, title, band_from, band_to, level, description, objectives, price, status,
                              submitted_at, reviewed_at, published_at, due_weekday, due_time, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'active',?,?,?,7,'20:00',?,?) RETURNING id`,
        [categoryId(c.category), teachers[c.teacher], c.title, c.band_from, c.band_to, c.level, c.description, c.objectives, c.price,
         daysAgo(c.published + 1), daysAgo(c.published), daysAgo(c.published), daysAgo(c.published + 5), daysAgo(c.published)]);
      const course = { id: r.insertId, teacherId: teachers[c.teacher], price: c.price, lectures: [] };
      courses[c.key] = course;
      counts.courses++;

      for (const [i, l] of c.lectures.entries()) {
        const [lr] = await conn.query(
          `INSERT INTO lectures (course_id, title, skill, duration_minutes, description, order_num, week_number, created_at)
           VALUES (?,?,?,1,?,?,?,?) RETURNING id`,
          [course.id, l.title, l.skill, `Bài ${i + 1} của khóa ${c.title}. Xem video, đọc tài liệu đính kèm rồi làm bài kiểm tra cuối bài.`,
           i + 1, l.week, daysAgo(c.published + 3)]);
        const lectureId = lr.insertId;
        const videoName = `lec${lectureId}_${Date.now()}_${randomId()}${path.extname(videoFile).toLowerCase() || '.mp4'}`;
        copy(videoFile, 'videos', videoName);
        await conn.query('UPDATE lectures SET video_path=?, video_size=? WHERE id=?', [videoName, videoSize, lectureId]);

        const docStored = `${Date.now()}_${randomId()}${path.extname(docFile).toLowerCase()}`;
        copy(docFile, 'materials', docStored);
        await conn.query(
          `INSERT INTO materials (course_id, lecture_id, teacher_id, filename, filepath, filesize, filetype, created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [course.id, lectureId, course.teacherId, docName, `uploads/materials/${docStored}`, docSize,
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document', daysAgo(c.published + 3)]);

        const questionCount = (l.passage ? PASSAGES[l.passage].questions.length : 0) + (l.qs || []).length;
        const [tr] = await conn.query(
          `INSERT INTO tests (course_id, lecture_id, title, duration_minutes, num_questions, pass_percent, created_at)
           VALUES (?,?,?,15,?,60,?) RETURNING id`,
          [course.id, lectureId, `Kiểm tra bài ${i + 1}: ${l.title}`.slice(0, 200), questionCount, daysAgo(c.published + 3)]);
        const questions = await buildQuestions(conn, { kind: 'course', ownerId: tr.insertId, passageKey: l.passage, qs: l.qs || [] });
        course.lectures.push({ id: lectureId, testId: tr.insertId, questions });
        counts.lectures++;
        counts.tests++;
      }
    }

    // Test thử và luyện đề
    const adminTests = {};
    for (const t of ADMIN_TESTS) {
      const questionCount = (t.passage ? PASSAGES[t.passage].questions.length : 0) + t.qs.length;
      const [r] = await conn.query(
        `INSERT INTO admin_tests (title, type, category_id, skill, difficulty, description, duration_minutes, num_questions, pass_percent, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,60,'active',?) RETURNING id`,
        [t.title, t.type, categoryId(t.category), t.skill, t.difficulty, t.description, t.duration, questionCount, daysAgo(45)]);
      adminTests[t.title] = { id: r.insertId, questions: await buildQuestions(conn, { kind: 'admin', ownerId: r.insertId, passageKey: t.passage, qs: t.qs }) };
      counts.admin_tests++;
    }

    await conn.commit();
    return counts;
  } catch (e) {
    await conn.rollback();
    copied.forEach(file => fs.rmSync(file, { force: true }));
    throw e;
  } finally {
    conn.release();
  }
}

// ── Xóa dữ liệu demo ─────────────────────────────────────────
async function remove() {
  const [users] = await pool.query('SELECT id FROM users WHERE email IN (?)', [LEGACY_DEMO_EMAILS]);
  const userIds = users.map(u => u.id);
  const [courses] = await pool.query('SELECT id FROM courses WHERE title IN (?)', [COURSE_TITLES]);
  const courseIds = courses.map(c => c.id);
  const files = [];
  if (courseIds.length) {
    const [videos] = await pool.query('SELECT video_path FROM lectures WHERE course_id IN (?) AND video_path IS NOT NULL', [courseIds]);
    const [docs] = await pool.query('SELECT filepath FROM materials WHERE course_id IN (?)', [courseIds]);
    videos.forEach(v => files.push(path.join(ROOT, 'uploads', 'videos', path.basename(v.video_path))));
    docs.forEach(d => files.push(path.join(ROOT, 'uploads', 'materials', path.basename(d.filepath))));
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (courseIds.length) await conn.query('DELETE FROM courses WHERE id IN (?)', [courseIds]);
    const [t] = await conn.query('DELETE FROM admin_tests WHERE title IN (?)', [ADMIN_TEST_TITLES]);
    if (userIds.length) await conn.query('DELETE FROM users WHERE id IN (?)', [userIds]);
    await conn.commit();
    files.forEach(file => fs.rmSync(file, { force: true }));
    return { courses: courseIds.length, admin_tests: t.affectedRows, users: userIds.length, files: files.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

(async () => {
  try {
    if (process.argv.includes('--remove')) {
      const r = await remove();
      console.log(`Đã xóa dữ liệu demo: ${r.courses} khóa học, ${r.admin_tests} đề test thử / luyện đề, ${r.files} file trong uploads/`
        + (r.users ? `, ${r.users} tài khoản mẫu còn sót của phiên bản cũ.` : '.'));
    } else {
      const videoFile = argValue('--video');
      const docFile = argValue('--doc');
      if (!videoFile || !docFile || !fs.existsSync(videoFile) || !fs.existsSync(docFile)) {
        console.error('Cần đường dẫn video và tài liệu: npm run demo -- --video <file.mp4> --doc <file.docx>');
        process.exitCode = 1;
        return;
      }
      const r = await seed(videoFile, docFile);
      console.log(`Đã tạo dữ liệu demo: ${r.courses} khóa học, ${r.lectures} bài giảng (mỗi bài có video, tài liệu và bài kiểm tra), `
        + `${r.admin_tests} đề test thử / luyện đề. Không tạo tài khoản nào.`);
    }
  } catch (e) {
    console.error('Lỗi:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

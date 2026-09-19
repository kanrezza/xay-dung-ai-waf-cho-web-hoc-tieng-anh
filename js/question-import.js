/**
 * EngPro – Đọc nhiều câu hỏi lẻ một lần, từ văn bản dán vào hoặc từ các dòng của file Excel.
 * Dùng chung cho trình duyệt (xem trước ngay khi dán) và server (đọc file Excel).
 *
 *   EngProQuestionImport.parseText(text)  → [{ line, question } | { line, error }]
 *   EngProQuestionImport.parseRows(rows)  → [{ line, question } | { line, error }]   rows: mảng object theo tiêu đề cột
 *   EngProQuestionImport.normalizeText(s) → chuỗi dùng để so câu trùng
 *
 * Cách viết khi dán (mỗi câu cách nhau một dòng trống, hoặc bắt đầu bằng "Câu 1:" / "1."):
 *   Câu 1: She ___ to school every day.        Câu 2: Coffee was first grown in England.
 *   A. go   B. goes   C. going   D. gone        Đáp án: False
 *   Đáp án: B
 *                                               Câu 3: The man will stay at ___ Hotel.
 *   Có thể đánh dấu * trước đáp án đúng         Đáp án: Grand | The Grand
 *   thay cho dòng "Đáp án", ví dụ: *B. goes
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EngProQuestionImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LETTERS = ['A', 'B', 'C', 'D'];
  const MAX_TEXT = 2000;

  // Bỏ dấu tiếng Việt, chữ thường, chỉ giữ chữ và số: "Đáp án đúng" → "dapandung"
  const key = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');

  const TYPE_ALIASES = {
    mcq:  ['mcq', 'tracnghiem', 'abcd', 'multiplechoice'],
    tfng: ['tfng', 'dungsai', 'dungsaikhongcothongtin', 'truefalse', 'truefalsenotgiven'],
    fill: ['fill', 'dientu', 'dienvaochotrong', 'gapfill', 'completion'],
  };
  const TFNG_ALIASES = {
    TRUE:      ['true', 't', 'dung'],
    FALSE:     ['false', 'f', 'sai'],
    NOT_GIVEN: ['notgiven', 'ng', 'khongcothongtin', 'khongduathongtin'],
  };
  const findAlias = (table, value) => Object.keys(table).find(k => table[k].includes(key(value))) || null;

  const QUESTION_NUMBER = /^\s*(?:(?:câu|cau|question|q)\s*\d+\s*[:.)\-–]?|\d+\s*[.)])\s*/i;
  const ANSWER_LINE = /^\s*(?:đáp\s*án(?:\s*đúng)?|dap\s*an(?:\s*dung)?|answer|key|correct)\s*[:：=]\s*(.*)$/i;
  const OPTION_START = /^\s*(\*?)\s*([A-Da-d])\s*[.)]\s+/;

  // Tách một dòng đáp án, kể cả khi nhiều đáp án nằm chung một dòng: "A. go  B. goes  *C. going"
  function splitOptions(line) {
    const marks = [];
    const re = /(?:^|\s)(\*?)\s*([A-Da-d])\s*[.)]\s+/g;
    let m;
    while ((m = re.exec(line))) {
      const letter = m[2].toUpperCase();
      const expected = marks.length ? LETTERS[LETTERS.indexOf(marks[marks.length - 1].letter) + 1] : letter;
      // Chỉ nhận chữ cái theo đúng thứ tự A → B → C → D để không cắt nhầm nội dung đáp án
      if (letter !== expected) continue;
      marks.push({ letter, star: !!m[1], start: m.index, contentStart: m.index + m[0].length });
    }
    return marks.map((mark, i) => ({
      letter: mark.letter,
      star: mark.star,
      text: line.slice(mark.contentStart, i + 1 < marks.length ? marks[i + 1].start : undefined).trim(),
    }));
  }

  // Dựng câu hỏi từ phần thô { type?, text, options: {A..D}, starred: [], answer }
  function buildQuestion(raw) {
    const text = String(raw.text ?? '').trim();
    const options = raw.options || {};
    const answer = String(raw.answer ?? '').trim();
    const hasOptions = LETTERS.some(l => options[l]);
    if (!text) return { error: 'Thiếu nội dung câu hỏi' };
    if (text.length > MAX_TEXT) return { error: `Nội dung câu hỏi dài quá ${MAX_TEXT} ký tự` };

    let type = raw.type ? findAlias(TYPE_ALIASES, raw.type) : null;
    if (raw.type && !type) return { error: `Không hiểu dạng câu "${raw.type}" (dùng Trắc nghiệm, Đúng/Sai hoặc Điền từ)` };
    if (!type) type = hasOptions ? 'mcq' : findAlias(TFNG_ALIASES, answer) ? 'tfng' : 'fill';

    const q = { question_type: type, question_text: text };
    if (type === 'mcq') {
      LETTERS.forEach(l => { q['option_' + l.toLowerCase()] = String(options[l] ?? '').trim() || null; });
      if (!q.option_a || !q.option_b) return { error: 'Câu trắc nghiệm cần ít nhất đáp án A và B' };
      if (!q.option_c && q.option_d) return { error: 'Có đáp án D nhưng thiếu đáp án C' };
      const starred = raw.starred || [];
      if (starred.length > 1) return { error: 'Chỉ đánh dấu * cho một đáp án đúng' };
      // Nhận "B", "b", "B.", "(B)", "B. goes"
      const letter = answer ? (answer.match(/^\(?\s*([A-D])(?![A-Za-z0-9])/i)?.[1] || '').toUpperCase() : '';
      if (answer && !letter) return { error: `Đáp án "${answer}" không hợp lệ, hãy ghi một chữ A, B, C hoặc D` };
      if (letter && starred.length && starred[0] !== letter) return { error: `Dấu * ở ${starred[0]} khác với dòng Đáp án ${letter}` };
      q.correct_answer = letter || starred[0];
      if (!q.correct_answer) return { error: 'Thiếu đáp án đúng (thêm dòng "Đáp án: B" hoặc dấu * trước đáp án)' };
      if (!q['option_' + q.correct_answer.toLowerCase()]) return { error: `Đáp án đúng là ${q.correct_answer} nhưng chưa có nội dung đáp án ${q.correct_answer}` };
    } else if (type === 'tfng') {
      if (!answer) return { error: 'Thiếu đáp án (True, False hoặc Not Given)' };
      q.correct_answer = findAlias(TFNG_ALIASES, answer);
      if (!q.correct_answer) return { error: `Đáp án "${answer}" không hợp lệ, hãy ghi True, False hoặc Not Given` };
    } else {
      const accepted = [...new Set(answer.split('|').map(a => a.trim()).filter(Boolean))];
      if (!accepted.length) return { error: 'Thiếu đáp án (nhiều đáp án được chấp nhận thì cách nhau bằng dấu |)' };
      q.accepted_answers = accepted;
    }
    return { question: q };
  }

  // ── Văn bản dán vào ────────────────────────────────────────
  function parseText(input) {
    const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let block = null;
    const finish = () => { if (block) blocks.push(block); block = null; };

    lines.forEach((rawLine, i) => {
      const line = rawLine.replace(/\t/g, '  ').trimEnd();
      if (!line.trim()) { finish(); return; }
      const isAnswer = ANSWER_LINE.test(line);
      // Dòng đầu tiên sau "Đáp án", hoặc dòng đánh số "Câu 2:" / "2.", là câu mới
      if (block && !isAnswer && (block.answer !== undefined || QUESTION_NUMBER.test(line))) finish();
      if (!block) block = { line: i + 1, textLines: [], options: {}, starred: [], hasOptions: false, lastOption: null };

      if (isAnswer) {
        block.answer = line.match(ANSWER_LINE)[1];
      } else if (block.textLines.length && OPTION_START.test(line)) {
        splitOptions(line.trim()).forEach(o => {
          if (block.options[o.letter] !== undefined) block.duplicateOption = o.letter;
          block.options[o.letter] = o.text;
          if (o.star) block.starred.push(o.letter);
          block.lastOption = o.letter;
        });
        block.hasOptions = true;
      } else if (block.hasOptions) {
        // Đáp án dài bị xuống dòng
        block.options[block.lastOption] = `${block.options[block.lastOption]} ${line.trim()}`.trim();
      } else {
        block.textLines.push(block.textLines.length ? line.trim() : line.replace(QUESTION_NUMBER, '').trim());
      }
    });
    finish();

    return blocks.map(b => {
      if (b.duplicateOption) return { line: b.line, error: `Đáp án ${b.duplicateOption} bị lặp` };
      const built = buildQuestion({ text: b.textLines.join('\n'), options: b.options, starred: b.starred, answer: b.answer });
      return { line: b.line, ...built };
    });
  }

  // ── Các dòng của file Excel ────────────────────────────────
  const COLUMN_ALIASES = {
    type:   ['dangcau', 'dang', 'loai', 'loaicau', 'type', 'questiontype'],
    text:   ['cauhoi', 'noidung', 'noidungcauhoi', 'question', 'questiontext'],
    A:      ['a', 'optiona', 'dapana'],
    B:      ['b', 'optionb', 'dapanb'],
    C:      ['c', 'optionc', 'dapanc'],
    D:      ['d', 'optiond', 'dapand'],
    answer: ['dapan', 'dapandung', 'answer', 'correctanswer', 'correct'],
  };

  function parseRows(rows) {
    const items = [];
    (rows || []).forEach((row, i) => {
      const values = {};
      Object.entries(row).forEach(([header, value]) => {
        const field = Object.keys(COLUMN_ALIASES).find(f => COLUMN_ALIASES[f].includes(key(header)));
        if (field) values[field] = String(value ?? '').trim();
      });
      // Bỏ qua dòng trống hoàn toàn
      if (!Object.values(values).some(Boolean)) return;
      const built = buildQuestion({
        type: values.type,
        text: values.text,
        options: { A: values.A, B: values.B, C: values.C, D: values.D },
        answer: values.answer,
      });
      items.push({ line: i + 2, ...built }); // dòng 1 là tiêu đề
    });
    return items;
  }

  const normalizeText = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

  return { parseText, parseRows, buildQuestion, normalizeText, COLUMN_ALIASES };
});

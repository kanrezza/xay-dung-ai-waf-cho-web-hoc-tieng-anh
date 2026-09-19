/**
 * EngPro – Hộp thống kê từng câu hỏi của một đề
 * Dùng chung cho bảng điều khiển giảng viên (bài kiểm tra khóa học) và admin (test thử, luyện đề).
 *
 *   EngProTestStats.open({ url: '/api/gv/tests/5/stats', title: 'Kiểm tra Unit 1' })
 *
 * Cho biết điểm trung bình, tỉ lệ đạt, phân bố điểm và tỉ lệ đúng của từng câu,
 * học viên hay chọn đáp án sai nào, để giảng viên biết câu nào cần giảng lại hoặc sửa đề.
 */
(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const TYPE_LABEL = { mcq: 'Trắc nghiệm', tfng: 'Đúng / Sai / Không có', fill: 'Điền từ' };
  const TFNG_LABEL = { TRUE: 'True', FALSE: 'False', NOT_GIVEN: 'Not Given' };
  const SECTION_LABEL = { listening: 'Phần nghe', reading: 'Phần đọc' };

  let modal = null;
  let state = { url: '', title: '', scope: 'all', sort: 'hardest', onlyWeak: false, data: null };

  const rateColor = rate => (rate === null ? 'bg-outline-variant' : rate < 50 ? 'bg-red-500' : rate < 75 ? 'bg-amber-500' : 'bg-green-600');
  const rateText = rate => (rate === null ? 'text-on-surface-variant' : rate < 50 ? 'text-red-700' : rate < 75 ? 'text-amber-700' : 'text-green-700');

  function build() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'hidden fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'ts-title');
    modal.innerHTML = `
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" data-close></div>
      <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col" style="max-height:94vh">
        <div class="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-outline-variant/30 shrink-0">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-secondary uppercase tracking-wider">Thống kê câu hỏi</p>
            <h3 id="ts-title" class="font-bold text-primary truncate"></h3>
          </div>
          <button type="button" data-close class="p-1.5 hover:bg-surface-low rounded-lg" aria-label="Đóng">
            <span class="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-b border-outline-variant/30 shrink-0 text-xs font-semibold">
          <div class="flex gap-1 p-1 bg-surface-low rounded-xl" role="group" aria-label="Lượt làm được tính">
            <button type="button" data-scope="all" class="px-3 py-1.5 rounded-lg">Mọi lượt làm</button>
            <button type="button" data-scope="first" class="px-3 py-1.5 rounded-lg" title="Chỉ tính lần làm đầu tiên của mỗi học viên">Lượt đầu mỗi học viên</button>
          </div>
          <div class="flex gap-1 p-1 bg-surface-low rounded-xl" role="group" aria-label="Sắp xếp">
            <button type="button" data-sort="hardest" class="px-3 py-1.5 rounded-lg">Sai nhiều nhất trước</button>
            <button type="button" data-sort="order" class="px-3 py-1.5 rounded-lg">Theo thứ tự đề</button>
          </div>
          <label class="flex items-center gap-2 ml-auto cursor-pointer">
            <input type="checkbox" data-weak class="rounded accent-secondary" /> Chỉ câu đúng dưới 50%
          </label>
        </div>
        <div data-body class="flex-grow overflow-y-auto px-4 sm:px-6 py-4"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    modal.querySelectorAll('[data-scope]').forEach(btn => btn.addEventListener('click', () => {
      if (state.scope === btn.dataset.scope) return;
      state.scope = btn.dataset.scope;
      load();
    }));
    modal.querySelectorAll('[data-sort]').forEach(btn => btn.addEventListener('click', () => { state.sort = btn.dataset.sort; render(); }));
    modal.querySelector('[data-weak]').addEventListener('change', e => { state.onlyWeak = e.target.checked; render(); });
  }

  function open({ url, title }) {
    build();
    state = { ...state, url, title, scope: 'all', data: null };
    modal.querySelector('#ts-title').textContent = title || '';
    modal.classList.remove('hidden');
    load();
  }

  function close() { modal?.classList.add('hidden'); }

  async function load() {
    const body = modal.querySelector('[data-body]');
    body.innerHTML = '<p class="py-12 text-center text-sm text-on-surface-variant">Đang tải thống kê...</p>';
    syncToolbar();
    try {
      const sep = state.url.includes('?') ? '&' : '?';
      const json = await (await fetch(`${state.url}${sep}scope=${state.scope}`, { credentials: 'include' })).json();
      if (!json.success) throw new Error(json.message);
      state.data = json.data;
      render();
    } catch (e) {
      body.innerHTML = `<p class="py-12 text-center text-sm text-red-700">${esc(e.message || 'Không tải được thống kê')}</p>`;
    }
  }

  function syncToolbar() {
    const on = 'bg-white text-primary shadow-sm', off = 'text-on-surface-variant hover:text-primary';
    modal.querySelectorAll('[data-scope]').forEach(btn => { btn.className = `px-3 py-1.5 rounded-lg ${btn.dataset.scope === state.scope ? on : off}`; });
    modal.querySelectorAll('[data-sort]').forEach(btn => { btn.className = `px-3 py-1.5 rounded-lg ${btn.dataset.sort === state.sort ? on : off}`; });
  }

  function render() {
    syncToolbar();
    const body = modal.querySelector('[data-body]');
    const { summary, score_distribution: dist, questions } = state.data;
    if (!questions.length) {
      body.innerHTML = '<p class="py-12 text-center text-sm text-on-surface-variant">Đề chưa có câu hỏi.</p>';
      return;
    }
    const tile = (label, value) => `
      <div class="bg-surface-low rounded-xl px-4 py-3">
        <p class="text-xs text-on-surface-variant">${label}</p>
        <p class="text-xl font-bold text-primary">${value}</p>
      </div>`;
    const maxBucket = Math.max(1, ...dist.map(b => b.count));
    let list = [...questions];
    if (state.sort === 'hardest') list.sort((a, b) => (a.correct_rate ?? 101) - (b.correct_rate ?? 101) || a.number - b.number);
    if (state.onlyWeak) list = list.filter(q => q.correct_rate !== null && q.correct_rate < 50);

    body.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        ${tile('Lượt làm', summary.attempts)}
        ${tile('Học viên', summary.students)}
        ${tile('Điểm trung bình', summary.avg_score === null ? '–' : summary.avg_score + '%')}
        ${tile('Tỉ lệ đạt', summary.pass_rate === null ? '–' : summary.pass_rate + '%')}
      </div>
      ${summary.attempts ? `
        <div class="mb-5">
          <p class="text-xs font-semibold text-on-surface-variant mb-2">Phân bố điểm</p>
          <div class="grid grid-cols-5 gap-2 items-end h-24" aria-label="Phân bố điểm">
            ${dist.map(b => `
              <div class="flex flex-col items-center justify-end h-full gap-1" title="${b.count} lượt đạt ${b.from}–${b.to}%">
                <span class="text-xs font-semibold text-on-surface">${b.count}</span>
                <div class="w-full rounded-t-md bg-secondary/80" style="height:${Math.max(4, Math.round(b.count / maxBucket * 64))}px"></div>
              </div>`).join('')}
          </div>
          <div class="grid grid-cols-5 gap-2 mt-1 text-[11px] text-center text-on-surface-variant">
            ${dist.map(b => `<span>${b.from}–${b.to}%</span>`).join('')}
          </div>
        </div>` : '<p class="mb-5 text-sm text-on-surface-variant bg-surface-low rounded-xl px-4 py-3">Chưa có học viên nào nộp bài này.</p>'}
      <p class="text-xs text-on-surface-variant mb-3">${list.length} câu${state.onlyWeak ? ' có tỉ lệ đúng dưới 50%' : ''}. Tỉ lệ đúng tính trên số lượt có câu đó (bỏ trống tính là sai).</p>
      <div class="space-y-3">${list.map(questionHtml).join('') || '<p class="py-6 text-center text-sm text-on-surface-variant">Không có câu nào dưới 50%.</p>'}</div>`;
  }

  function choiceRows(q) {
    if (!q.answered) return '';
    const total = q.answered;
    let rows;
    if (q.question_type === 'mcq') {
      rows = Object.entries(q.options || {}).map(([letter, text]) => ({
        label: `${letter}. ${text}`, count: q.choices.find(c => c.answer === letter)?.count || 0, correct: letter === q.correct_answer,
      }));
    } else if (q.question_type === 'tfng') {
      rows = Object.keys(TFNG_LABEL).map(key => ({
        label: TFNG_LABEL[key], count: q.choices.find(c => c.answer === key)?.count || 0, correct: key === q.correct_answer,
      }));
    } else {
      rows = q.choices.map(c => ({ label: `"${c.answer}"`, count: c.count, correct: c.is_correct }));
    }
    if (q.skipped) rows.push({ label: 'Bỏ trống', count: q.skipped, correct: false, muted: true });
    return `
      <div class="mt-3 space-y-1.5">
        ${q.question_type === 'fill' ? '<p class="text-[11px] font-semibold text-on-surface-variant">Câu trả lời gặp nhiều nhất</p>' : ''}
        ${rows.map(r => {
          const pct = Math.round(r.count / total * 100);
          return `
            <div class="grid grid-cols-[minmax(0,1fr)_7rem] sm:grid-cols-[minmax(0,1fr)_10rem] items-center gap-3 text-xs">
              <span class="truncate ${r.correct ? 'font-semibold text-green-700' : r.muted ? 'text-on-surface-variant italic' : 'text-on-surface'}">
                ${r.correct ? '<span class="material-symbols-outlined text-sm align-[-3px]" aria-label="Đáp án đúng">check_circle</span> ' : ''}${esc(r.label)}
              </span>
              <span class="flex items-center gap-2">
                <span class="flex-1 h-2 rounded-full bg-surface-low overflow-hidden"><span class="block h-full rounded-full ${r.correct ? 'bg-green-600' : r.muted ? 'bg-outline-variant' : 'bg-red-400'}" style="width:${pct}%"></span></span>
                <span class="w-14 text-right text-on-surface-variant">${r.count} · ${pct}%</span>
              </span>
            </div>`;
        }).join('')}
      </div>`;
  }

  function questionHtml(q) {
    const answerText = q.question_type === 'fill'
      ? (q.accepted_answers || []).join(' / ')
      : q.question_type === 'tfng' ? TFNG_LABEL[q.correct_answer] : q.correct_answer;
    return `
      <article class="border border-outline-variant/40 rounded-xl p-4">
        <div class="flex items-start gap-3">
          <span class="shrink-0 w-8 h-8 rounded-lg bg-surface-low text-primary text-sm font-bold flex items-center justify-center">${q.number}</span>
          <div class="flex-1 min-w-0">
            <p class="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-on-surface-variant mb-1">
              <span>${TYPE_LABEL[q.question_type] || q.question_type}</span>
              ${q.section ? `<span>· ${esc(SECTION_LABEL[q.section.type] || '')}${q.section.title ? ': ' + esc(q.section.title) : ''}</span>` : ''}
              <span>· Đáp án: <strong class="text-green-700">${esc(answerText)}</strong></span>
            </p>
            <p class="text-sm text-on-surface whitespace-pre-line line-clamp-3">${esc(q.question_text)}</p>
          </div>
          <div class="shrink-0 text-right w-20">
            <p class="text-lg font-bold ${rateText(q.correct_rate)}">${q.correct_rate === null ? '–' : q.correct_rate + '%'}</p>
            <p class="text-[11px] text-on-surface-variant">${q.answered ? `${q.correct}/${q.answered} đúng` : 'chưa có lượt'}</p>
          </div>
        </div>
        <div class="mt-2 h-1.5 rounded-full bg-surface-low overflow-hidden"><div class="h-full ${rateColor(q.correct_rate)}" style="width:${q.correct_rate || 0}%"></div></div>
        ${choiceRows(q)}
      </article>`;
  }

  window.EngProTestStats = { open, close };
})();

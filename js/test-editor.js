/**
 * EngPro – Trình soạn đề: phần nghe (audio), phần đọc (đoạn văn) và câu hỏi nhiều dạng
 * Dùng chung cho bài kiểm tra khóa học (dashboard GV) và test thử / luyện đề (dashboard admin).
 * Cần js/media.js và js/question-import.js được nạp trước.
 *
 *   TestEditor.open({ base, listEl, formEl, countEl, toast, onChange })
 *     base: '/api/gv/tests/12' hoặc '/api/admin/admin-tests/5'
 *   TestEditor.reload()   — tải lại sau khi dữ liệu thay đổi từ bên ngoài
 *   TestEditor.close()    — dừng audio; trả về false nếu người dùng chọn ở lại vì còn phần chưa lưu
 */
(function () {
  const TYPE_LABELS = { mcq: 'Trắc nghiệm', tfng: 'Đúng / Sai / Không có thông tin', fill: 'Điền từ' };
  const TYPE_SHORT  = { mcq: 'trắc nghiệm', tfng: 'đúng/sai', fill: 'điền từ' };
  const TFNG_LABELS = { TRUE: 'True (Đúng)', FALSE: 'False (Sai)', NOT_GIVEN: 'Not Given (Không có thông tin)' };
  const TEXT_PLACEHOLDERS = {
    mcq:  'Nội dung câu hỏi *',
    tfng: 'Câu nhận định *, ví dụ: Coffee was first grown in England.',
    fill: 'Câu có chỗ trống *, ví dụ: The man will stay at ___ Hotel.',
  };
  const INPUT_CLS = 'w-full px-3 py-2 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-secondary bg-white';
  const IMPORT_BTN_CLS = 'flex items-center gap-1 px-3 py-1.5 bg-secondary/10 text-secondary text-xs font-semibold rounded-lg hover:bg-secondary/15 transition-colors';

  let opts = null;
  let data = { sections: [], questions: [] };
  let drafts = {};          // sectionId → các ô đã sửa nhưng chưa lưu
  let uploads = {};         // sectionId → % upload audio đang chạy
  let formType = 'mcq';
  let formOpen = false;     // form thêm câu hỏi thu gọn để danh sách có chỗ hiển thị

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = (msg, type = 'success') => opts?.toast?.(msg, type);

  async function api(method, path, body) {
    const res = await fetch(opts.base + path, {
      method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({ success: false, message: 'Phản hồi không hợp lệ' }));
    if (!json.success) throw new Error(json.message || 'Thao tác thất bại');
    return json.data;
  }

  function sectionValues(s) {
    return { ...s, ...(drafts[s.id] || {}) };
  }

  // ── Mở / đóng ─────────────────────────────────────────────
  async function open(options) {
    if (opts?.base !== options.base) resetImport();
    opts = options;
    data = { sections: [], questions: [] };
    drafts = {};
    uploads = {};
    formType = 'mcq';
    opts.listEl.innerHTML = '<p class="text-sm text-on-surface-variant text-center py-8">Đang tải...</p>';
    renderForm();
    if (!opts.listEl.dataset.bound) bindListEvents(opts.listEl);
    await reload();
    setFormOpen(data.questions.length === 0); // đề trống thì mở sẵn form
  }

  async function reload(changed = false) {
    try {
      data = await api('GET', '/content');
      render();
      if (changed) opts.onChange?.();
    } catch (e) {
      opts.listEl.innerHTML = `<p class="text-sm text-error text-center py-8">${esc(e.message)}</p>`;
    }
  }

  function stopMedia() {
    opts?.listEl.querySelectorAll('audio').forEach(a => a.pause());
  }

  function close() {
    if (Object.keys(drafts).length && !confirm('Có phần nghe/đọc chưa lưu. Đóng mà không lưu?')) return false;
    stopMedia();
    closeImport();
    return true;
  }

  // ── Danh sách phần & câu hỏi ──────────────────────────────
  function render() {
    const { sections, questions } = data;
    opts.countEl.textContent = `${questions.length} câu` + (sections.length ? ` · ${sections.length} phần` : '');
    const numberOf = Object.fromEntries(questions.map((q, i) => [q.id, i + 1]));
    const standalone = questions.filter(q => !q.section_id);

    opts.listEl.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <button data-action="add-section" data-type="listening"
          class="flex items-center gap-1.5 px-3 py-2 border border-outline-variant rounded-xl text-xs font-semibold hover:bg-surface-low transition-colors">
          <span class="material-symbols-outlined text-base text-secondary">headphones</span>Thêm phần nghe
        </button>
        <button data-action="add-section" data-type="reading"
          class="flex items-center gap-1.5 px-3 py-2 border border-outline-variant rounded-xl text-xs font-semibold hover:bg-surface-low transition-colors">
          <span class="material-symbols-outlined text-base text-emerald-600">menu_book</span>Thêm bài đọc
        </button>
        <p class="text-xs text-on-surface-variant">Một phần gồm audio hoặc đoạn văn dùng chung cho nhiều câu hỏi.</p>
      </div>
      ${sections.map(s => renderSection(s, questions.filter(q => q.section_id === s.id), numberOf)).join('')}
      <div class="border border-dashed border-outline-variant rounded-2xl p-4 space-y-2">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p class="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Câu hỏi lẻ</p>
          <p class="text-xs text-on-surface-variant">ngữ pháp, từ vựng… không cần audio hay bài đọc</p>
          <button data-action="import" data-target-section="" class="ml-auto ${IMPORT_BTN_CLS}">
            <span class="material-symbols-outlined text-base">playlist_add</span>Nhập nhiều câu
          </button>
        </div>
        ${standalone.length
          ? standalone.map(q => renderQuestion(q, numberOf[q.id])).join('')
          : '<p class="text-xs text-on-surface-variant">Chưa có câu hỏi lẻ.</p>'}
        <button data-action="target" data-target-section="" class="text-xs font-semibold text-secondary hover:underline">+ Thêm câu hỏi lẻ</button>
      </div>`;
    updateTargetOptions();
  }

  function renderSection(section, questions, numberOf) {
    const s = sectionValues(section);
    const listening = s.type === 'listening';
    const dirty = !!drafts[s.id];
    const pct = uploads[s.id];
    return `
      <div class="border border-outline-variant/60 rounded-2xl p-4 space-y-3" data-section="${s.id}">
        <div class="flex items-center gap-2">
          <span class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${listening ? 'bg-blue-50 text-secondary' : 'bg-emerald-50 text-emerald-700'}">
            <span class="material-symbols-outlined text-sm">${listening ? 'headphones' : 'menu_book'}</span>${listening ? 'Nghe' : 'Đọc'}
          </span>
          <input data-field="title" value="${esc(s.title)}" maxlength="200" placeholder="Tên phần"
            class="flex-grow min-w-0 px-2 py-1 text-sm font-semibold text-on-surface border border-transparent hover:border-outline-variant focus:border-secondary rounded-lg focus:outline-none" />
          <button data-action="delete-section" class="shrink-0 text-xs text-error hover:underline">Xóa phần</button>
        </div>
        <input data-field="instructions" value="${esc(s.instructions)}"
          placeholder="Hướng dẫn, ví dụ: Questions 1–4. Choose the correct letter A, B, C or D." class="${INPUT_CLS}" />
        ${listening ? renderAudio(s, pct) : `
          <textarea data-field="passage" rows="8" class="${INPUT_CLS} leading-relaxed"
            placeholder="Dán bài đọc vào đây. Các đoạn cách nhau một dòng trống, học viên sẽ thấy đoạn A, B, C…">${esc(s.passage)}</textarea>`}
        <div class="flex items-center gap-3">
          <span data-dirty class="text-xs font-semibold text-amber-600 ${dirty ? '' : 'hidden'}">Chưa lưu</span>
          <button data-action="save-section"
            class="ml-auto px-3 py-1.5 border border-secondary text-secondary text-xs font-semibold rounded-lg hover:bg-blue-50 transition-colors">
            Lưu phần này
          </button>
        </div>
        <div class="space-y-2">
          ${questions.length
            ? questions.map(q => renderQuestion(q, numberOf[q.id])).join('')
            : '<p class="text-xs text-on-surface-variant">Chưa có câu hỏi trong phần này.</p>'}
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button data-action="target" data-target-section="${s.id}" class="text-xs font-semibold text-secondary hover:underline">+ Thêm câu hỏi vào phần này</button>
          <button data-action="import" data-target-section="${s.id}" class="ml-auto ${IMPORT_BTN_CLS}">
            <span class="material-symbols-outlined text-base">playlist_add</span>Nhập nhiều câu
          </button>
        </div>
      </div>`;
  }

  function renderAudio(s, pct) {
    const meta = [EngProMedia.fmtDuration(s.audio_duration), EngProMedia.fmtSize(s.audio_size)].filter(Boolean).join(' · ');
    return `
      <div class="bg-surface-low rounded-xl p-3 space-y-2">
        ${s.has_audio
          ? `<audio controls preload="none" src="/api/sections/${s.id}/audio" class="w-full h-10"></audio>
             <div class="flex items-center gap-3 text-xs">
               <span class="text-on-surface-variant">${meta}</span>
               <button data-action="pick-audio" class="ml-auto font-semibold text-secondary hover:underline">Thay audio</button>
               <button data-action="delete-audio" class="font-semibold text-error hover:underline">Gỡ</button>
             </div>`
          : `<button data-action="pick-audio"
               class="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-outline-variant rounded-xl text-sm font-semibold text-secondary hover:bg-white transition-colors">
               <span class="material-symbols-outlined">upload_file</span>Tải file nghe lên (MP3, M4A, WAV, OGG)
             </button>`}
        <div data-progress class="${pct === undefined ? 'hidden' : ''}">
          <div class="flex justify-between text-xs text-on-surface-variant mb-1">
            <span>Đang tải audio lên...</span><span data-progress-text>${pct ?? 0}%</span>
          </div>
          <div class="h-1.5 bg-outline-variant/30 rounded-full overflow-hidden">
            <div data-progress-bar class="h-full bg-secondary rounded-full transition-all" style="width:${pct ?? 0}%"></div>
          </div>
        </div>
        <input data-file type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" class="hidden" />
      </div>
      <label class="flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
        Số lần được nghe
        <select data-field="max_plays" class="px-2 py-1.5 text-xs border border-outline-variant rounded-lg bg-white focus:outline-none focus:border-secondary">
          ${[[0, 'Không giới hạn'], [1, '1 lần'], [2, '2 lần'], [3, '3 lần'], [4, '4 lần'], [5, '5 lần']]
            .map(([v, label]) => `<option value="${v}" ${Number(s.max_plays) === v ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <details ${s.transcript ? 'open' : ''}>
        <summary class="text-xs font-semibold text-on-surface-variant cursor-pointer">Transcript (không bắt buộc, học viên chỉ xem được sau khi nộp bài)</summary>
        <textarea data-field="transcript" rows="4" class="${INPUT_CLS} mt-2"
          placeholder="Lời thoại của đoạn nghe">${esc(s.transcript)}</textarea>
      </details>`;
  }

  function answerHtml(q) {
    if (q.question_type === 'mcq') {
      return `<div class="grid grid-cols-2 gap-1.5 text-xs mt-2">
        ${['A', 'B', 'C', 'D'].filter(k => q['option_' + k.toLowerCase()]).map(k => `
          <span class="${q.correct_answer === k ? 'bg-green-100 text-green-700 font-bold' : 'text-on-surface-variant'} px-2 py-1 rounded break-words">${k}. ${esc(q['option_' + k.toLowerCase()])}</span>`).join('')}
      </div>`;
    }
    if (q.question_type === 'tfng') {
      return `<p class="text-xs mt-1.5 text-on-surface-variant">Đáp án: <span class="font-bold text-green-700">${esc(TFNG_LABELS[q.correct_answer])}</span></p>`;
    }
    return `<p class="text-xs mt-1.5 text-on-surface-variant">Đáp án chấp nhận: ${(q.accepted_answers || [])
      .map(a => `<span class="font-bold text-green-700">${esc(a)}</span>`).join(' / ')}</p>`;
  }

  function renderQuestion(q, number) {
    const answer = answerHtml(q);
    return `
      <div class="bg-surface-low rounded-xl p-3">
        <div class="flex items-start gap-3">
          <span class="shrink-0 w-6 h-6 rounded-full bg-secondary/10 text-secondary text-xs font-bold flex items-center justify-center mt-0.5">${number}</span>
          <div class="flex-grow min-w-0">
            <p class="text-[11px] font-semibold text-on-surface-variant mb-0.5">${TYPE_LABELS[q.question_type]}</p>
            <p class="text-sm font-semibold text-on-surface whitespace-pre-line">${esc(q.question_text)}</p>
            ${answer}
          </div>
          <button data-action="delete-question" data-id="${q.id}" title="Xóa câu hỏi"
            class="shrink-0 p-1 text-on-surface-variant hover:text-error transition-colors">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      </div>`;
  }

  // ── Sự kiện trong danh sách ───────────────────────────────
  function bindListEvents(listEl) {
    listEl.dataset.bound = '1';

    listEl.addEventListener('input', e => {
      const field = e.target.dataset.field;
      const card = e.target.closest('[data-section]');
      if (!field || !card) return;
      const id = Number(card.dataset.section);
      drafts[id] = { ...(drafts[id] || {}), [field]: e.target.value };
      card.querySelector('[data-dirty]')?.classList.remove('hidden');
    });

    listEl.addEventListener('change', e => {
      if (e.target.matches('[data-file]')) onAudioPicked(e.target);
    });

    listEl.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const card = btn.closest('[data-section]');
      const sectionId = card ? Number(card.dataset.section) : null;
      const section = data.sections.find(s => s.id === sectionId);
      try {
        switch (btn.dataset.action) {
          case 'add-section': {
            const created = await api('POST', '/sections', { type: btn.dataset.type });
            await reload(true);
            const el = opts.listEl.querySelector(`[data-section="${created.id}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
          }
          case 'save-section': {
            const v = sectionValues(section);
            await api('PUT', `/sections/${sectionId}`, {
              title: v.title, instructions: v.instructions, passage: v.passage,
              transcript: v.transcript, max_plays: v.max_plays,
            });
            delete drafts[sectionId];
            toast('Đã lưu ' + (v.title || 'phần này'));
            await reload();
            break;
          }
          case 'delete-section': {
            const count = data.questions.filter(q => q.section_id === sectionId).length;
            if (!confirm(`Xóa "${sectionValues(section).title || 'phần này'}"${count ? ` và ${count} câu hỏi bên trong` : ''}?`)) return;
            await api('DELETE', `/sections/${sectionId}`);
            delete drafts[sectionId];
            toast('Đã xóa phần');
            await reload(true);
            break;
          }
          case 'pick-audio':
            card.querySelector('[data-file]').click();
            break;
          case 'delete-audio':
            if (!confirm('Gỡ file nghe khỏi phần này?')) return;
            await api('DELETE', `/sections/${sectionId}/audio`);
            toast('Đã gỡ audio');
            await reload();
            break;
          case 'delete-question':
            if (!confirm('Xóa câu hỏi này?')) return;
            await api('DELETE', `/questions/${btn.dataset.id}`);
            await reload(true);
            break;
          case 'target':
            setTarget(btn.dataset.targetSection);
            break;
          case 'import':
            openImport(btn.dataset.targetSection);
            break;
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function onAudioPicked(input) {
    const file = input.files[0];
    const card = input.closest('[data-section]');
    const sectionId = Number(card.dataset.section);
    input.value = '';
    if (!file) return;
    const checked = await EngProMedia.inspect(file, 'audio');
    if (checked.error) { toast(checked.error, 'error'); return; }

    const showProgress = pct => {
      uploads[sectionId] = pct;
      const box = opts.listEl.querySelector(`[data-section="${sectionId}"] [data-progress]`);
      if (!box) return;
      box.classList.remove('hidden');
      box.querySelector('[data-progress-text]').textContent = pct + '%';
      box.querySelector('[data-progress-bar]').style.width = pct + '%';
    };
    showProgress(0);
    try {
      await EngProMedia.upload(`${opts.base}/sections/${sectionId}/audio`, 'audio', file, checked.duration, showProgress);
      toast('Đã tải audio lên');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      delete uploads[sectionId];
      await reload();
    }
  }

  // ── Form thêm câu hỏi ─────────────────────────────────────
  function renderForm() {
    opts.formEl.innerHTML = `
      <div class="space-y-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" data-form="toggle"
            class="flex items-center gap-1 text-xs font-bold text-on-surface-variant uppercase tracking-wider hover:text-secondary">
            <span class="material-symbols-outlined text-base" data-form="toggle-icon">expand_less</span>Thêm câu hỏi vào
          </button>
          <select data-form="target" class="max-w-[14rem] px-2 py-1.5 text-xs border border-outline-variant rounded-lg bg-white focus:outline-none focus:border-secondary"></select>
          <div class="flex flex-wrap gap-1 sm:ml-auto">
            ${Object.entries(TYPE_LABELS).map(([type, label]) => `
              <button type="button" data-form-type="${type}"
                class="px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors">${label}</button>`).join('')}
          </div>
        </div>
        <div data-form="panel" class="space-y-2.5">
          <textarea data-form="text" rows="2" class="${INPUT_CLS} resize-none"></textarea>
          <div data-form="body" class="space-y-2"></div>
          <div data-form="error" class="hidden text-xs text-error bg-red-50 px-3 py-2 rounded-xl"></div>
          <div class="flex">
            <button type="button" data-form="submit"
              class="ml-auto px-4 py-2 bg-secondary text-white text-xs font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50">
              + Thêm câu
            </button>
          </div>
        </div>
      </div>`;
    opts.formEl.querySelectorAll('[data-form-type]').forEach(btn =>
      btn.addEventListener('click', () => { setFormType(btn.dataset.formType); setFormOpen(true); }));
    opts.formEl.querySelector('[data-form="toggle"]').addEventListener('click', () => setFormOpen(!formOpen));
    opts.formEl.querySelector('[data-form="submit"]').addEventListener('click', submitQuestion);
    setFormType(formType);
    setFormOpen(formOpen);
  }

  function setFormOpen(open) {
    formOpen = open;
    opts.formEl.querySelector('[data-form="panel"]').classList.toggle('hidden', !open);
    opts.formEl.querySelector('[data-form="toggle-icon"]').textContent = open ? 'expand_more' : 'expand_less';
  }

  function updateTargetOptions() {
    const select = opts.formEl.querySelector('[data-form="target"]');
    const current = select.value;
    select.innerHTML = '<option value="">Câu hỏi lẻ</option>' + data.sections
      .map(s => `<option value="${s.id}">${esc(sectionValues(s).title || 'Phần ' + s.order_num)}</option>`).join('');
    if ([...select.options].some(o => o.value === current)) select.value = current;
  }

  function setTarget(sectionId) {
    const select = opts.formEl.querySelector('[data-form="target"]');
    select.value = sectionId || '';
    setFormOpen(true);
    opts.formEl.querySelector('[data-form="text"]').focus();
  }

  function setFormType(type) {
    formType = type;
    opts.formEl.querySelectorAll('[data-form-type]').forEach(btn => {
      const active = btn.dataset.formType === type;
      btn.classList.toggle('bg-secondary', active);
      btn.classList.toggle('text-white', active);
      btn.classList.toggle('border-secondary', active);
      btn.classList.toggle('bg-white', !active);
      btn.classList.toggle('text-on-surface-variant', !active);
      btn.classList.toggle('border-outline-variant', !active);
    });
    opts.formEl.querySelector('[data-form="text"]').placeholder = TEXT_PLACEHOLDERS[type];
    const body = opts.formEl.querySelector('[data-form="body"]');
    const radio = (value, label) => `
      <label class="flex items-center gap-1 text-sm cursor-pointer">
        <input type="radio" name="te-answer" value="${value}" class="accent-secondary" /> ${label}
      </label>`;
    if (type === 'mcq') {
      body.innerHTML = `
        <div class="grid grid-cols-2 gap-2">
          <input data-option="a" type="text" placeholder="A. ..." class="${INPUT_CLS}" />
          <input data-option="b" type="text" placeholder="B. ..." class="${INPUT_CLS}" />
          <input data-option="c" type="text" placeholder="C. ... (có thể bỏ trống)" class="${INPUT_CLS}" />
          <input data-option="d" type="text" placeholder="D. ... (có thể bỏ trống)" class="${INPUT_CLS}" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-xs font-semibold text-on-surface-variant">Đáp án đúng:</span>
          ${['A', 'B', 'C', 'D'].map(k => radio(k, k)).join('')}
        </div>`;
    } else if (type === 'tfng') {
      body.innerHTML = `
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span class="text-xs font-semibold text-on-surface-variant">Đáp án đúng:</span>
          ${Object.entries(TFNG_LABELS).map(([k, label]) => radio(k, label)).join('')}
        </div>`;
    } else {
      body.innerHTML = `
        <textarea data-accepted rows="2" class="${INPUT_CLS} resize-none"
          placeholder="Đáp án được chấp nhận *, mỗi dòng một đáp án. Ví dụ:&#10;three&#10;3"></textarea>
        <p class="text-xs text-on-surface-variant">Gõ ___ (ba dấu gạch dưới) trong câu hỏi để đánh dấu chỗ trống. Chấm không phân biệt chữ hoa, chữ thường.</p>`;
    }
  }

  async function submitQuestion() {
    const form = opts.formEl;
    const errEl = form.querySelector('[data-form="error"]');
    const btn = form.querySelector('[data-form="submit"]');
    const showError = msg => { errEl.textContent = msg; errEl.classList.remove('hidden'); };
    const payload = {
      section_id: form.querySelector('[data-form="target"]').value || null,
      question_type: formType,
      question_text: form.querySelector('[data-form="text"]').value.trim(),
      correct_answer: form.querySelector('input[name="te-answer"]:checked')?.value || null,
    };
    if (!payload.question_text) return showError('Nhập nội dung câu hỏi');
    if (formType === 'mcq') {
      form.querySelectorAll('[data-option]').forEach(el => { payload['option_' + el.dataset.option] = el.value.trim(); });
      if (!payload.option_a || !payload.option_b) return showError('Câu trắc nghiệm cần ít nhất đáp án A và B');
      if (!payload.correct_answer) return showError('Chọn đáp án đúng');
    } else if (formType === 'tfng') {
      if (!payload.correct_answer) return showError('Chọn đáp án True, False hoặc Not Given');
    } else {
      payload.accepted_answers = form.querySelector('[data-accepted]').value;
      if (!payload.accepted_answers.trim()) return showError('Nhập ít nhất một đáp án được chấp nhận');
    }
    errEl.classList.add('hidden');
    btn.disabled = true;
    try {
      await api('POST', '/questions', payload);
      form.querySelector('[data-form="text"]').value = '';
      setFormType(formType); // xóa các ô đáp án, giữ nguyên dạng câu và nơi thêm
      toast('Đã thêm câu hỏi');
      await reload(true);
      form.querySelector('[data-form="text"]').focus();
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  }


  // ── Nhập nhiều câu hỏi (dán văn bản hoặc file Excel) vào câu hỏi lẻ hoặc một phần nghe/đọc ──
  const SAMPLES = {};
  SAMPLES.standalone = `Câu 1: She ___ to school every day.
A. go
B. goes
C. going
D. gone
Đáp án: B

Câu 2: What does "ubiquitous" mean?
A. Rare   *B. Present everywhere   C. Hidden   D. Ancient

Câu 3: Coffee was first grown in England.
Đáp án: False

Câu 4: The man will stay at ___ Hotel.
Đáp án: Grand | The Grand`;
  SAMPLES.listening = `Câu 1: The caller wants to book a room for ___ nights.
Đáp án: 3 | three

Câu 2: The guest's surname is ___.
Đáp án: Carter

Câu 3: Why is the man calling?
A. To cancel a booking   *B. To ask about prices   C. To complain about a room`;
  SAMPLES.reading = `Câu 1: Coffee was first grown in England.
Đáp án: False

Câu 2: The writer had visited Ethiopia before.
Đáp án: Not Given

Câu 3: According to paragraph B, coffee became popular because
A. it was cheap
*B. it helped people stay awake
C. it was used in medicine
D. it tasted sweet

Câu 4: London coffee houses were known as "penny ___".
Đáp án: universities`;

  let imp = null;     // trạng thái hộp nhập của đề đang mở
  let impEl = null;   // hộp thoại, tạo một lần rồi dùng lại
  let impTimer = null;

  function resetImport() {
    imp = {
      target: '', tab: 'text', text: '', fileItems: null, fileName: '', fileError: '', loadingFile: false, skipDuplicates: true, saveErrors: {},
      // Tab "Tạo bằng AI": câu AI soạn cũng đi qua bảng xem trước và kiểm tra trùng như câu dán vào
      ai: { topic: '', count: 5, level: 'Trung cấp', types: ['mcq'], items: null, itemsFor: '', error: '', loading: false },
    };
  }
  resetImport();

  const $imp = name => impEl.querySelector(`[data-imp="${name}"]`);
  const dupKey = q => [q.question_text, q.option_a, q.option_b, q.option_c, q.option_d]
    .map(v => EngProQuestionImport.normalizeText(v)).join('|');

  // Phần đang chọn để thêm câu; null = câu hỏi lẻ
  const targetSection = () => data.sections.find(sec => String(sec.id) === imp.target) || null;
  const sectionLabel = sec => {
    const v = sectionValues(sec);
    const kind = v.type === 'listening' ? 'Nghe' : 'Đọc';
    const title = v.title || `Phần ${v.order_num}`;
    // Tên mặc định đã có chữ "Nghe"/"Đọc" thì không ghi thêm
    return title.toLowerCase().includes(kind.toLowerCase()) ? title : `${kind}: ${title}`;
  };
  const targetLabel = () => (targetSection() ? sectionLabel(targetSection()) : 'Câu hỏi lẻ');

  let aiStatus = null; // { enabled, remaining } lấy một lần khi mở hộp nhập
  async function loadAiStatus() {
    try { aiStatus = (await (await fetch('/api/ai/status', { credentials: 'include' })).json()).data; } catch { aiStatus = { enabled: false }; }
    if (impEl && !impEl.classList.contains('hidden')) renderImport();
  }
  const AI_LEVELS = ['Cơ bản', 'Trung cấp', 'Nâng cao'];
  const TFNG_TEXT = { TRUE: 'True', FALSE: 'False', NOT_GIVEN: 'Not Given' };

  // Đổi câu AI tạo sang cách viết của ô dán văn bản để giảng viên sửa trước khi thêm
  function questionToText(q, n) {
    const lines = [`Câu ${n}: ${String(q.question_text).replace(/\n\s*\n+/g, '\n')}`];
    if (q.question_type === 'mcq') {
      ['A', 'B', 'C', 'D'].forEach(k => { if (q['option_' + k.toLowerCase()]) lines.push(`${k}. ${q['option_' + k.toLowerCase()]}`); });
      lines.push(`Đáp án: ${q.correct_answer}`);
    } else if (q.question_type === 'tfng') {
      lines.push(`Đáp án: ${TFNG_TEXT[q.correct_answer]}`);
    } else {
      lines.push(`Đáp án: ${(q.accepted_answers || []).join(' | ')}`);
    }
    return lines.join('\n');
  }

  function buildImportDialog() {
    impEl = document.createElement('div');
    impEl.className = 'hidden fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-2 sm:p-6';
    impEl.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="imp-title"
        class="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-full max-h-[52rem] flex flex-col overflow-hidden text-on-surface">
        <div class="flex items-start gap-3 px-5 py-4 border-b border-outline-variant/30 shrink-0">
          <div class="flex-grow min-w-0">
            <h3 id="imp-title" class="font-bold text-primary">Nhập nhiều câu hỏi</h3>
            <p class="text-xs text-on-surface-variant mt-0.5">Dán câu hỏi từ Word hoặc tải file Excel, kiểm tra phần xem trước rồi thêm vào đề một lần.</p>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5">
              <label for="imp-target" class="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Thêm vào</label>
              <select id="imp-target" data-imp="target"
                class="max-w-full sm:max-w-xs px-3 py-1.5 text-sm font-semibold border border-outline-variant rounded-lg bg-white focus:outline-none focus:border-secondary"></select>
              <p data-imp="target-info" class="text-xs text-on-surface-variant"></p>
            </div>
          </div>
          <button type="button" data-imp="close" aria-label="Đóng" class="p-1.5 hover:bg-surface-low rounded-lg">
            <span class="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        </div>

        <div class="flex-grow min-h-0 overflow-y-auto lg:overflow-hidden grid lg:grid-cols-2">
          <section class="lg:min-h-0 flex flex-col gap-3 p-5 border-b lg:border-b-0 lg:border-r border-outline-variant/30">
            <div class="flex gap-1 p-1 bg-surface-low rounded-xl w-fit shrink-0" role="tablist">
              <button type="button" data-imp-tab="text" role="tab" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold">
                <span class="material-symbols-outlined text-base">content_paste</span>Dán văn bản
              </button>
              <button type="button" data-imp-tab="file" role="tab" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold">
                <span class="material-symbols-outlined text-base">table_view</span>File Excel
              </button>
              <button type="button" data-imp-tab="ai" role="tab" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold">
                <span class="material-symbols-outlined text-base">auto_awesome</span>Tạo bằng AI
              </button>
            </div>

            <div data-imp-pane="text" class="lg:flex-grow lg:min-h-0 flex flex-col gap-3">
              <textarea data-imp="text" spellcheck="false"
                class="h-72 lg:h-auto lg:flex-grow w-full px-3 py-2.5 text-[13px] leading-relaxed font-mono border border-outline-variant rounded-xl focus:outline-none focus:border-secondary resize-none"
                placeholder="Dán câu hỏi vào đây, ví dụ:&#10;&#10;Câu 1: She ___ to school every day.&#10;A. go   B. goes   C. going   D. gone&#10;Đáp án: B"></textarea>
              <details data-imp="passage-box" class="hidden shrink-0 border border-emerald-200 bg-emerald-50/50 rounded-xl px-4 py-3 text-xs">
                <summary class="font-semibold text-emerald-800 cursor-pointer">Xem bài đọc của phần này</summary>
                <div data-imp="passage" class="mt-2 max-h-48 overflow-y-auto whitespace-pre-line leading-relaxed text-on-surface"></div>
              </details>
              <details class="shrink-0 bg-surface-low rounded-xl px-4 py-3 text-xs text-on-surface-variant">
                <summary class="font-semibold text-on-surface cursor-pointer">Cách viết để hệ thống nhận đúng</summary>
                <ul class="mt-2 space-y-1.5 list-disc pl-4 leading-relaxed">
                  <li>Mỗi câu bắt đầu bằng <b>Câu 1:</b> hoặc <b>1.</b>, hoặc cách câu trước một dòng trống.</li>
                  <li><b>Trắc nghiệm:</b> các dòng <b>A.</b> <b>B.</b> <b>C.</b> <b>D.</b> (viết chung một dòng cũng được), cần ít nhất A và B. Đáp án đúng ghi ở dòng <b>Đáp án: B</b> hoặc thêm dấu <b>*</b> trước chữ cái, ví dụ <b>*B. goes</b>.</li>
                  <li><b>Đúng/Sai/Không có thông tin:</b> không có A, B và ghi <b>Đáp án: True</b>, <b>False</b> hoặc <b>Not Given</b>.</li>
                  <li><b>Điền từ:</b> dùng ___ cho chỗ trống, các đáp án được chấp nhận cách nhau bằng <b>|</b>, ví dụ <b>Đáp án: 3 | three</b>.</li>
                  <li>Audio phần nghe và bài đọc vẫn thêm ở trình soạn đề; ở đây chỉ nhập câu hỏi của phần đó.</li>
                </ul>
                <button type="button" data-imp="sample" class="mt-2 font-semibold text-secondary hover:underline">Dán thử ví dụ mẫu</button>
              </details>
            </div>

            <div data-imp-pane="ai" class="hidden lg:flex-grow lg:min-h-0 lg:overflow-y-auto flex flex-col gap-3">
              <p data-imp="ai-off" class="hidden text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3">
                Trợ lý AI chưa được bật trên máy chủ. Quản trị viên cần thêm GEMINI_API_KEY vào file .env rồi khởi động lại.
              </p>
              <p data-imp="ai-source" class="text-xs rounded-xl px-4 py-3 leading-relaxed"></p>
              <div>
                <label for="imp-ai-topic" data-imp="ai-topic-label" class="block text-xs font-bold text-on-surface-variant mb-1"></label>
                <textarea id="imp-ai-topic" data-imp="ai-topic" rows="5" maxlength="6000"
                  class="w-full px-3 py-2.5 text-sm leading-relaxed border border-outline-variant rounded-xl focus:outline-none focus:border-secondary resize-y"></textarea>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="imp-ai-count" class="block text-xs font-bold text-on-surface-variant mb-1">Số câu</label>
                  <input id="imp-ai-count" data-imp="ai-count" type="number" min="1" max="15"
                    class="w-full px-3 py-2 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-secondary" />
                </div>
                <div>
                  <label for="imp-ai-level" class="block text-xs font-bold text-on-surface-variant mb-1">Trình độ</label>
                  <select id="imp-ai-level" data-imp="ai-level"
                    class="w-full px-3 py-2 text-sm border border-outline-variant rounded-xl bg-white focus:outline-none focus:border-secondary">
                    ${AI_LEVELS.map(l => `<option>${l}</option>`).join('')}
                  </select>
                </div>
              </div>
              <fieldset>
                <legend class="text-xs font-bold text-on-surface-variant mb-1.5">Dạng câu</legend>
                <div class="flex flex-wrap gap-2">
                  ${Object.entries(TYPE_LABELS).map(([type, label]) => `
                    <label class="inline-flex items-center gap-2 px-3 py-1.5 border border-outline-variant rounded-lg text-xs cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-blue-50">
                      <input type="checkbox" data-imp-ai-type="${type}" class="rounded accent-secondary" />${label}
                    </label>`).join('')}
                </div>
              </fieldset>
              <div class="flex flex-wrap items-center gap-3">
                <button type="button" data-imp="ai-run"
                  class="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span class="material-symbols-outlined text-base">auto_awesome</span><span data-imp="ai-run-label">Tạo câu hỏi</span>
                </button>
                <button type="button" data-imp="ai-edit" class="hidden text-xs font-semibold text-secondary hover:underline">Chuyển sang ô văn bản để sửa</button>
                <span data-imp="ai-remaining" class="text-xs text-on-surface-variant"></span>
              </div>
              <p class="text-xs text-on-surface-variant leading-relaxed">
                AI có thể soạn sai đáp án hoặc hỏi điều bài đọc không nhắc tới. Hãy đọc lại từng câu ở bảng xem trước, cần sửa thì chuyển sang ô văn bản.
              </p>
            </div>

            <div data-imp-pane="file" class="hidden lg:flex-grow flex flex-col gap-3">
              <label data-imp="drop"
                class="flex flex-col items-center justify-center gap-1 text-center px-6 py-10 border-2 border-dashed border-outline-variant rounded-2xl cursor-pointer hover:bg-surface-low transition-colors">
                <span class="material-symbols-outlined text-4xl text-secondary">upload_file</span>
                <span class="text-sm font-semibold text-on-surface">Kéo thả file vào đây hoặc bấm để chọn</span>
                <span class="text-xs text-on-surface-variant">.xlsx, .xls, .csv · tối đa 5 MB</span>
                <span data-imp="file-name" class="hidden mt-2 px-3 py-1 bg-blue-50 text-secondary text-xs font-semibold rounded-full"></span>
                <input type="file" data-imp="file" accept=".xlsx,.xls,.csv" class="hidden" />
              </label>
              <div class="bg-surface-low rounded-xl px-4 py-3 text-xs text-on-surface-variant leading-relaxed">
                <p class="font-semibold text-on-surface mb-1">File cần các cột</p>
                <p><b>Dạng câu</b> (Trắc nghiệm, Đúng/Sai, Điền từ, bỏ trống thì tự nhận) · <b>Câu hỏi</b> · <b>A</b> · <b>B</b> · <b>C</b> · <b>D</b> · <b>Đáp án</b></p>
                <a data-imp="template" href="#" class="inline-flex items-center gap-1 mt-2 font-semibold text-secondary hover:underline">
                  <span class="material-symbols-outlined text-sm">download</span>Tải file Excel mẫu
                </a>
              </div>
            </div>
          </section>

          <section class="lg:min-h-0 flex flex-col">
            <div data-imp="summary" class="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-outline-variant/30 shrink-0"></div>
            <div data-imp="preview" class="lg:flex-grow lg:min-h-0 lg:overflow-y-auto p-5 space-y-2"></div>
          </section>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 border-t border-outline-variant/30 bg-surface-low/60 shrink-0">
          <label data-imp="dup-wrap" class="hidden items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" data-imp="skip-dup" checked class="rounded accent-secondary" />
            <span>Bỏ qua <b data-imp="dup-count"></b> câu trùng</span>
          </label>
          <p data-imp="note" class="text-xs text-on-surface-variant"></p>
          <div class="ml-auto flex gap-2">
            <button type="button" data-imp="close" class="px-4 py-2 border border-outline-variant text-sm font-semibold rounded-xl hover:bg-white">Hủy</button>
            <button type="button" data-imp="save"
              class="px-5 py-2 bg-secondary text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
              Thêm vào đề
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(impEl);

    impEl.querySelectorAll('[data-imp="close"]').forEach(b => b.addEventListener('click', closeImport));
    $imp('target').addEventListener('change', e => { imp.target = e.target.value; imp.saveErrors = {}; renderImport(); });
    impEl.querySelectorAll('[data-imp-tab]').forEach(b => b.addEventListener('click', () => { imp.tab = b.dataset.impTab; renderImport(); }));
    $imp('text').addEventListener('input', e => {
      imp.text = e.target.value;
      imp.saveErrors = {};
      clearTimeout(impTimer);
      impTimer = setTimeout(renderImport, 150);
    });
    $imp('sample').addEventListener('click', () => {
      const box = $imp('text');
      const sample = SAMPLES[targetSection()?.type || 'standalone'];
      box.value = (box.value.trim() ? box.value.trimEnd() + '\n\n' : '') + sample;
      box.dispatchEvent(new Event('input'));
    });
    $imp('file').addEventListener('change', e => { readImportFile(e.target.files[0]); e.target.value = ''; });
    const drop = $imp('drop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('bg-blue-50', 'border-secondary'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('bg-blue-50', 'border-secondary'); }));
    drop.addEventListener('drop', e => readImportFile(e.dataTransfer.files[0]));
    $imp('skip-dup').addEventListener('change', e => { imp.skipDuplicates = e.target.checked; renderImport(); });
    $imp('ai-topic').addEventListener('input', e => { imp.ai.topic = e.target.value; renderAiPane(); });
    $imp('ai-count').addEventListener('input', e => { imp.ai.count = e.target.value; renderAiPane(); });
    $imp('ai-level').addEventListener('change', e => { imp.ai.level = e.target.value; });
    impEl.querySelectorAll('[data-imp-ai-type]').forEach(box => box.addEventListener('change', () => {
      imp.ai.types = [...impEl.querySelectorAll('[data-imp-ai-type]:checked')].map(b => b.dataset.impAiType);
      renderAiPane();
    }));
    $imp('ai-run').addEventListener('click', generateWithAi);
    $imp('ai-edit').addEventListener('click', () => {
      const questions = (imp.ai.items || []).filter(i => i.question).map(i => i.question);
      if (!questions.length) return;
      const box = $imp('text');
      box.value = (box.value.trim() ? box.value.trimEnd() + '\n\n' : '') + questions.map((q, i) => questionToText(q, i + 1)).join('\n\n');
      imp.text = box.value;
      imp.ai.items = null;
      imp.tab = 'text';
      imp.saveErrors = {};
      renderImport();
      box.focus();
    });
    $imp('save').addEventListener('click', saveImport);
    $imp('preview').addEventListener('click', e => {
      const item = e.target.closest('[data-jump]');
      if (item && imp.tab === 'text') jumpToLine(Number(item.dataset.jump));
    });
    impEl.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeImport(); } });
  }

  function openImport(sectionId) {
    if (!window.EngProQuestionImport) { toast('Thiếu js/question-import.js trên trang này', 'error'); return; }
    if (!impEl) buildImportDialog();
    if (sectionId !== undefined) {
      if (sectionId !== imp.target) imp.saveErrors = {};
      imp.target = String(sectionId || '');
    }
    $imp('text').value = imp.text;
    $imp('ai-topic').value = imp.ai.topic;
    $imp('ai-count').value = imp.ai.count;
    $imp('ai-level').value = imp.ai.level;
    impEl.querySelectorAll('[data-imp-ai-type]').forEach(b => { b.checked = imp.ai.types.includes(b.dataset.impAiType); });
    if (!aiStatus) loadAiStatus();
    $imp('template').href = opts.base + '/questions/import-template';
    impEl.classList.remove('hidden');
    renderImport();
    if (imp.tab === 'text') $imp('text').focus();
  }

  function closeImport() {
    impEl?.classList.add('hidden');
  }

  function jumpToLine(line) {
    const box = $imp('text');
    const lines = box.value.split('\n');
    // Đặt con trỏ cuối dòng, không bôi chọn để gõ tiếp không xóa mất dòng
    const end = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) - 1;
    box.focus();
    box.setSelectionRange(end, end);
    // Cuộn ô nhập tới dòng lỗi
    box.scrollTop = Math.max(0, (line - 3) * parseFloat(getComputedStyle(box).lineHeight || '20'));
  }

  async function readImportFile(file) {
    if (!file) return;
    imp.fileName = file.name;
    imp.fileItems = null;
    imp.fileError = '';
    imp.saveErrors = {};
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      imp.fileError = 'Chỉ nhận file .xlsx, .xls hoặc .csv';
      return renderImport();
    }
    imp.loadingFile = true;
    renderImport();
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(opts.base + '/questions/import-file', { method: 'POST', credentials: 'include', body: form });
      const json = await res.json().catch(() => ({ success: false, message: 'Phản hồi không hợp lệ' }));
      if (!json.success) throw new Error(json.message || 'Không đọc được file');
      imp.fileItems = json.data.items;
    } catch (e) {
      imp.fileError = e.message;
    } finally {
      imp.loadingFile = false;
      renderImport();
    }
  }

  // Gửi yêu cầu cho AI soạn câu hỏi của phần đang chọn (dùng bài đọc hoặc lời thoại của phần đó)
  async function generateWithAi() {
    if (imp.ai.loading) return;
    imp.ai.loading = true;
    imp.ai.error = '';
    imp.saveErrors = {};
    renderImport();
    try {
      const res = await fetch(opts.base + '/questions/generate', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section_id: targetSection()?.id ?? null, topic: imp.ai.topic, count: Number(imp.ai.count),
          types: imp.ai.types, level: imp.ai.level,
        }),
      });
      const json = await res.json().catch(() => ({ success: false, message: 'Phản hồi không hợp lệ' }));
      if (!json.success) throw new Error(json.message || 'Trợ lý AI chưa tạo được câu hỏi');
      imp.ai.items = json.data.items;
      imp.ai.itemsFor = imp.target;
    } catch (e) {
      imp.ai.error = e.message;
    } finally {
      imp.ai.loading = false;
      loadAiStatus(); // cập nhật số lượt còn lại
      renderImport();
    }
  }

  function renderAiPane() {
    const section = targetSection();
    // AI đọc bản đã lưu trên máy chủ, nên chỉ tính bài đọc hoặc lời thoại đã lưu
    const material = section ? String((section.type === 'listening' ? section.transcript : section.passage) || '').trim() : '';
    const source = $imp('ai-source');
    if (material) {
      source.className = 'text-xs rounded-xl px-4 py-3 leading-relaxed bg-emerald-50 border border-emerald-200 text-emerald-900';
      source.textContent = `AI sẽ đọc ${section.type === 'listening' ? 'lời thoại' : 'bài đọc'} của phần này (${material.split(/\s+/).length} từ) để soạn câu hỏi, câu nào cũng phải tìm được căn cứ trong đó.`;
    } else if (section) {
      source.className = 'text-xs rounded-xl px-4 py-3 leading-relaxed bg-amber-50 border border-amber-200 text-amber-900';
      source.textContent = section.type === 'listening'
        ? 'Phần nghe này chưa có lời thoại. Nhập transcript trong trình soạn đề để AI hỏi đúng nội dung audio, hoặc ghi chủ đề bên dưới.'
        : 'Phần đọc này chưa có bài đọc. Thêm bài đọc trong trình soạn đề, hoặc ghi chủ đề bên dưới.';
    } else {
      source.className = 'text-xs rounded-xl px-4 py-3 leading-relaxed bg-surface-low text-on-surface-variant';
      source.textContent = 'Câu hỏi lẻ không kèm bài đọc: ghi chủ điểm ngữ pháp, từ vựng hoặc dán một đoạn tài liệu để AI soạn câu.';
    }
    $imp('ai-topic-label').textContent = material ? 'Yêu cầu thêm (không bắt buộc)' : 'Chủ đề hoặc nội dung';
    $imp('ai-topic').placeholder = material
      ? 'Ví dụ: tập trung vào từ đồng nghĩa và chi tiết số liệu'
      : 'Ví dụ: thì hiện tại hoàn thành và quá khứ đơn, bối cảnh công sở';

    const enabled = !!aiStatus?.enabled;
    const remaining = aiStatus?.remaining?.generate;
    const count = Number(imp.ai.count);
    const needsTopic = !material && imp.ai.topic.trim().length < 5;
    $imp('ai-off').classList.toggle('hidden', !aiStatus || enabled);
    const run = $imp('ai-run');
    run.disabled = imp.ai.loading || !enabled || remaining === 0 || !imp.ai.types.length
      || !Number.isInteger(count) || count < 1 || count > 15 || needsTopic;
    run.title = !imp.ai.types.length ? 'Chọn ít nhất một dạng câu' : needsTopic ? 'Nhập chủ đề hoặc nội dung' : '';
    $imp('ai-run-label').textContent = imp.ai.loading ? 'AI đang soạn...' : imp.ai.items ? 'Tạo lại' : 'Tạo câu hỏi';
    run.querySelector('.material-symbols-outlined').classList.toggle('animate-spin', imp.ai.loading);
    run.querySelector('.material-symbols-outlined').textContent = imp.ai.loading ? 'progress_activity' : 'auto_awesome';
    $imp('ai-remaining').textContent = remaining === undefined || remaining === null ? '' : remaining > 0 ? `Còn ${remaining} lượt hôm nay` : 'Đã hết lượt tạo hôm nay';
    const hasItems = (imp.ai.items || []).some(i => i.question);
    $imp('ai-edit').classList.toggle('hidden', !hasItems || imp.ai.loading);
  }

  // Các câu của tab đang xem, kèm đánh dấu trùng
  function importItems() {
    const items = imp.tab === 'text' ? EngProQuestionImport.parseText(imp.text)
      : imp.tab === 'file' ? (imp.fileItems || []) : (imp.ai.items || []);
    const sectionId = targetSection()?.id ?? null;
    const existing = new Set(data.questions.filter(q => (q.section_id ?? null) === sectionId).map(dupKey));
    const seen = new Map();
    return items.map((item, index) => {
      const saveError = imp.saveErrors[index];
      if (!item.question || saveError) return { ...item, index, error: saveError || item.error };
      const k = dupKey(item.question);
      const duplicate = existing.has(k) ? (sectionId ? 'Trùng với câu đã có trong phần này' : 'Trùng với câu đã có trong đề')
        : seen.has(k) ? `Trùng với câu ở dòng ${seen.get(k)}` : '';
      if (!seen.has(k)) seen.set(k, item.line);
      return { ...item, index, duplicate };
    });
  }

  // Số thứ tự của câu mới: câu hỏi xếp theo từng phần rồi tới câu hỏi lẻ, câu mới nằm cuối nhóm được chọn
  function importStartNumber() {
    const section = targetSection();
    if (!section) return data.questions.length;
    const rank = new Map(data.sections.map((sec, i) => [sec.id, i]));
    const targetRank = rank.get(section.id);
    return data.questions.filter(q => q.section_id && rank.get(q.section_id) <= targetRank).length;
  }

  function renderImportTarget() {
    if (imp.target && !targetSection()) imp.target = ''; // phần đã bị xóa
    const select = $imp('target');
    select.innerHTML = '<option value="">Câu hỏi lẻ</option>' + data.sections
      .map(sec => `<option value="${sec.id}">${esc(sectionLabel(sec))}</option>`).join('');
    select.value = imp.target;

    const section = targetSection();
    const count = data.questions.filter(q => (q.section_id ?? null) === (section?.id ?? null)).length;
    const info = [`${count} câu hiện có`];
    if (section?.type === 'listening') {
      info.push(section.has_audio ? `audio ${EngProMedia.fmtDuration(section.audio_duration) || 'đã tải lên'}` : 'chưa có audio');
    }
    const passage = section?.type === 'reading' ? String(sectionValues(section).passage || '').trim() : '';
    if (section?.type === 'reading') {
      info.push(passage ? `bài đọc ${passage.split(/\s+/).length} từ` : 'chưa có bài đọc');
    }
    $imp('target-info').textContent = info.join(' · ');
    $imp('passage-box').classList.toggle('hidden', !passage);
    $imp('passage').textContent = passage;
  }

  function renderImport() {
    renderImportTarget();
    impEl.querySelectorAll('[data-imp-tab]').forEach(b => {
      const active = b.dataset.impTab === imp.tab;
      b.setAttribute('aria-selected', String(active));
      b.classList.toggle('bg-white', active);
      b.classList.toggle('shadow-sm', active);
      b.classList.toggle('text-primary', active);
      b.classList.toggle('text-on-surface-variant', !active);
    });
    impEl.querySelectorAll('[data-imp-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.impPane !== imp.tab));
    const fileName = $imp('file-name');
    fileName.textContent = imp.fileName;
    fileName.classList.toggle('hidden', !imp.fileName);
    renderAiPane();

    const items = importItems();
    const valid = items.filter(i => i.question && !i.error);
    const errors = items.filter(i => i.error);
    const duplicates = valid.filter(i => i.duplicate);
    const toSave = valid.filter(i => !(i.duplicate && imp.skipDuplicates));
    const where = imp.tab === 'text' ? 'Dòng' : imp.tab === 'file' ? 'Dòng trong file' : 'Câu';

    // Thanh tổng kết
    const chip = (cls, text) => `<span class="px-2.5 py-1 rounded-full text-xs font-semibold ${cls}">${text}</span>`;
    const byType = Object.entries(TYPE_SHORT)
      .map(([type, label]) => [label, valid.filter(i => i.question.question_type === type).length])
      .filter(([, n]) => n).map(([label, n]) => `${n} ${label}`).join(' · ');
    $imp('summary').innerHTML = items.length
      ? `<p class="text-sm font-bold text-primary mr-1">Xem trước</p>
         ${chip('bg-green-50 text-green-700', `${valid.length} câu hợp lệ`)}
         ${errors.length ? chip('bg-red-50 text-error', `${errors.length} câu lỗi`) : ''}
         ${duplicates.length ? chip('bg-amber-50 text-amber-700', `${duplicates.length} câu trùng`) : ''}
         <p class="w-full text-xs text-on-surface-variant">${byType}</p>`
      : '<p class="text-sm font-bold text-primary">Xem trước</p>';

    // Danh sách xem trước: câu lỗi hiện trước để sửa
    const preview = $imp('preview');
    if (imp.tab === 'file' && imp.loadingFile) {
      preview.innerHTML = '<p class="text-sm text-on-surface-variant text-center py-10">Đang đọc file...</p>';
    } else if (imp.tab === 'file' && imp.fileError) {
      preview.innerHTML = `<p class="text-sm text-error bg-red-50 rounded-xl px-4 py-3">${esc(imp.fileError)}</p>`;
    } else if (imp.tab === 'ai' && imp.ai.loading) {
      preview.innerHTML = `
        <div class="text-center py-12 text-on-surface-variant">
          <span class="material-symbols-outlined text-4xl text-secondary animate-spin">progress_activity</span>
          <p class="text-sm mt-2">AI đang soạn câu hỏi, thường mất 10 đến 40 giây...</p>
        </div>`;
    } else if (imp.tab === 'ai' && imp.ai.error) {
      preview.innerHTML = `<p class="text-sm text-error bg-red-50 rounded-xl px-4 py-3">${esc(imp.ai.error)}</p>`;
    } else if (!items.length) {
      preview.innerHTML = `
        <div class="text-center py-12 text-on-surface-variant">
          <span class="material-symbols-outlined text-4xl text-outline-variant">${{ text: 'content_paste', file: 'table_view', ai: 'auto_awesome' }[imp.tab]}</span>
          <p class="text-sm mt-1">${{
            text: 'Dán câu hỏi vào ô bên cạnh, từng câu sẽ hiện ở đây để bạn kiểm tra.',
            file: 'Chọn file Excel, từng câu sẽ hiện ở đây để bạn kiểm tra trước khi thêm.',
            ai: 'Chọn số câu, dạng câu rồi bấm Tạo câu hỏi. Câu AI soạn sẽ hiện ở đây để bạn kiểm tra trước khi thêm.',
          }[imp.tab]}</p>
        </div>`;
    } else {
      let number = importStartNumber();
      preview.innerHTML = [...errors, ...valid].map(item => {
        if (item.error) {
          return `
            <div ${imp.tab === 'text' ? `data-jump="${item.line}" title="Bấm để tới dòng này"` : ''}
              class="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 ${imp.tab === 'text' ? 'cursor-pointer hover:border-red-300' : ''}">
              <span class="material-symbols-outlined text-base text-error mt-px">error</span>
              <p class="text-xs text-error"><b>${where} ${item.line}:</b> ${esc(item.error)}</p>
            </div>`;
        }
        const skipped = item.duplicate && imp.skipDuplicates;
        return `
          <div class="bg-surface-low rounded-xl p-3 ${skipped ? 'opacity-50' : ''}">
            <div class="flex items-start gap-3">
              <span class="shrink-0 w-6 h-6 rounded-full ${skipped ? 'bg-outline-variant/40 text-on-surface-variant' : 'bg-secondary/10 text-secondary'} text-xs font-bold flex items-center justify-center mt-0.5">${skipped ? '–' : ++number}</span>
              <div class="flex-grow min-w-0">
                <p class="text-[11px] font-semibold text-on-surface-variant mb-0.5">
                  ${TYPE_LABELS[item.question.question_type]} · ${where.toLowerCase()} ${item.line}
                  ${item.duplicate ? `<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">${esc(item.duplicate)}</span>` : ''}
                </p>
                <p class="text-sm font-semibold text-on-surface whitespace-pre-line break-words">${esc(item.question.question_text)}</p>
                ${answerHtml(item.question)}
              </div>
            </div>
          </div>`;
      }).join('');
    }

    // Chân hộp thoại
    const dupWrap = $imp('dup-wrap');
    dupWrap.classList.toggle('hidden', !duplicates.length);
    dupWrap.classList.toggle('flex', !!duplicates.length);
    $imp('dup-count').textContent = duplicates.length;
    $imp('skip-dup').checked = imp.skipDuplicates;
    $imp('note').textContent = imp.tab === 'ai' && imp.ai.items && imp.ai.itemsFor !== imp.target && valid.length
      ? 'Các câu này được AI tạo cho phần khác, kiểm tra lại trước khi thêm vào phần đang chọn.'
      : errors.length && toSave.length ? `${errors.length} câu lỗi sẽ không được thêm, sửa lại nếu cần.` : '';
    const save = $imp('save');
    save.disabled = !toSave.length || imp.saving;
    const n = toSave.length ? `${toSave.length} ` : '';
    save.textContent = imp.saving ? 'Đang thêm...' : targetSection() ? `Thêm ${n}câu vào phần này` : `Thêm ${n}câu hỏi lẻ`;
    imp.pending = toSave;
  }

  async function saveImport() {
    const pending = imp.pending || [];
    if (!pending.length) return;
    imp.saving = true;
    renderImport();
    try {
      const res = await fetch(opts.base + '/questions/bulk', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: pending.map(i => i.question), section_id: targetSection()?.id ?? null }),
      });
      const json = await res.json().catch(() => ({ success: false, message: 'Phản hồi không hợp lệ' }));
      if (!json.success) {
        // Lỗi từng câu do server kiểm tra thêm: gắn vào đúng câu trong bảng xem trước
        (json.data?.errors || []).forEach(e => { imp.saveErrors[pending[e.index].index] = e.message; });
        throw new Error(json.message || 'Không thêm được câu hỏi');
      }
      toast(`Đã thêm ${json.data.imported} câu vào ${targetSection() ? targetLabel() : 'câu hỏi lẻ'}`);
      if (imp.tab === 'text') imp.text = '';
      else if (imp.tab === 'file') { imp.fileItems = null; imp.fileName = ''; }
      else imp.ai.items = null;
      imp.saveErrors = {};
      $imp('text').value = imp.text;
      closeImport();
      await reload(true);
    } catch (e) {
      toast(e.message, 'error');
      if (/đã bị xóa/.test(e.message)) await reload(true); // phần vừa bị xóa ở nơi khác
    } finally {
      imp.saving = false;
      if (!impEl.classList.contains('hidden')) renderImport();
    }
  }

  window.TestEditor = { open, reload: () => reload(true), close, stopMedia, openImport };
})();

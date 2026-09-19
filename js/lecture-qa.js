/**
 * EngPro – Hỏi đáp dưới bài giảng (dùng chung cho trang học bài và dashboard giảng viên)
 *
 *   const qa = EngProQA.mount(containerEl, {
 *     load: () => fetch(...).then(r => r.json()),  // trả { success, data: { items, can_ask } }
 *     lectureId,          // có thì hiện ô đặt câu hỏi (khi can_ask)
 *     showContext,        // true: ghi rõ khóa học / bài giảng của từng câu (dashboard giảng viên)
 *     video,              // { currentTime(): giây, seek(giây) } khi bài giảng có video
 *     onChange,           // gọi lại sau khi thêm / xóa / đổi trạng thái
 *     emptyText,
 *   });
 *   qa.reload(); qa.focus(questionId);
 */
(function () {
  const STATUS = {
    open:     { label: 'Chờ giảng viên trả lời', cls: 'bg-amber-50 text-amber-700' },
    answered: { label: 'Giảng viên đã trả lời',  cls: 'bg-blue-50 text-secondary' },
    resolved: { label: 'Đã hiểu',                cls: 'bg-green-50 text-green-700' },
  };
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const clock = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  function timeAgo(iso) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} giờ trước`;
    if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))} ngày trước`;
    return new Date(iso).toLocaleDateString('vi-VN');
  }

  function avatar(author, teacher) {
    if (author.avatar) return `<img src="/${esc(author.avatar)}" alt="" class="w-8 h-8 rounded-full object-cover shrink-0" />`;
    return `<span class="w-8 h-8 rounded-full ${teacher ? 'bg-secondary' : 'bg-primary'} text-white text-xs font-bold flex items-center justify-center shrink-0">${esc((author.name || '?').charAt(0).toUpperCase())}</span>`;
  }

  async function send(method, url, body) {
    const res = await fetch(url, {
      method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({ success: false, message: 'Phản hồi không hợp lệ' }));
    if (!json.success) throw new Error(json.message || 'Thao tác thất bại');
    return json.data;
  }

  function mount(root, opts) {
    // Gắn lại vào cùng khung (đổi bài giảng, đổi bộ lọc): gỡ các bộ xử lý sự kiện của lần gắn trước
    root._qaListeners?.abort();
    const listeners = new AbortController();
    root._qaListeners = listeners;
    const on = (type, handler) => root.addEventListener(type, handler, { signal: listeners.signal });
    let items = [];
    let canAsk = false;
    let loaded = false;
    let pendingFocus = null;

    function renderThread(q) {
      const status = STATUS[q.status] || STATUS.open;
      return `
        <article id="qa-${q.id}" data-qid="${q.id}" class="qa-item bg-white rounded-2xl border border-outline-variant/40 p-4 transition-shadow">
          ${opts.showContext ? `<p class="text-[11px] font-semibold text-on-surface-variant mb-2">${esc(q.course_title)} · ${esc(q.lecture_title)}</p>` : ''}
          <div class="flex items-start gap-3">
            ${avatar(q.author, false)}
            <div class="min-w-0 flex-grow">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-sm font-semibold text-on-surface">${esc(q.author.name)}${q.author.is_me ? ' <span class="text-xs font-normal text-on-surface-variant">(bạn)</span>' : ''}</span>
                <span class="text-xs text-on-surface-variant">${timeAgo(q.created_at)}</span>
                ${q.video_time !== null && q.video_time !== undefined
                  ? (opts.video
                    ? `<button type="button" data-seek="${q.video_time}" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-surface-low text-xs font-semibold text-secondary hover:bg-blue-50"><span class="material-symbols-outlined text-sm">play_arrow</span>${clock(q.video_time)}</button>`
                    : `<span class="px-1.5 py-0.5 rounded bg-surface-low text-xs font-semibold text-on-surface-variant">tại ${clock(q.video_time)}</span>`)
                  : ''}
                <span class="ml-auto px-2 py-0.5 rounded-full text-[11px] font-semibold ${status.cls}">${status.label}</span>
              </div>
              <p class="mt-1.5 text-sm text-on-surface whitespace-pre-line break-words">${esc(q.content)}</p>
            </div>
          </div>

          ${q.answers.length ? `
            <div class="mt-3 ml-11 space-y-3 border-l-2 border-outline-variant/40 pl-4">
              ${q.answers.map(a => `
                <div class="flex items-start gap-3" data-aid="${a.id}">
                  ${avatar(a.author, a.is_teacher)}
                  <div class="min-w-0 flex-grow ${a.is_teacher ? 'bg-blue-50/70 rounded-xl px-3 py-2' : ''}">
                    <div class="flex flex-wrap items-center gap-x-2">
                      <span class="text-sm font-semibold text-on-surface">${esc(a.author.name)}</span>
                      ${a.is_teacher ? '<span class="px-1.5 py-0.5 rounded bg-secondary text-white text-[10px] font-bold uppercase">Giảng viên</span>' : ''}
                      <span class="text-xs text-on-surface-variant">${timeAgo(a.created_at)}</span>
                      ${a.can_delete ? `<button type="button" data-action="delete-answer" data-id="${a.id}" class="ml-auto text-xs text-on-surface-variant hover:text-red-600">Xóa</button>` : ''}
                    </div>
                    <p class="mt-1 text-sm text-on-surface whitespace-pre-line break-words">${esc(a.content)}</p>
                  </div>
                </div>`).join('')}
            </div>` : ''}

          <div class="mt-3 ml-11 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold">
            ${q.can_reply ? `<button type="button" data-action="toggle-reply" class="text-secondary hover:underline">${q.author.is_me ? 'Hỏi thêm' : 'Trả lời'}</button>` : ''}
            ${q.can_resolve ? (q.status === 'resolved'
              ? '<button type="button" data-action="reopen" class="text-on-surface-variant hover:underline">Mở lại</button>'
              : '<button type="button" data-action="resolve" class="text-green-700 hover:underline">Đánh dấu đã hiểu</button>') : ''}
            ${q.can_delete ? '<button type="button" data-action="delete-question" class="text-on-surface-variant hover:text-red-600">Xóa câu hỏi</button>' : ''}
          </div>
          ${q.can_reply ? `
            <form data-reply-form class="hidden mt-3 ml-11 space-y-2">
              <textarea rows="3" maxlength="2000" required placeholder="${q.author.is_me ? 'Hỏi thêm để giảng viên giải thích rõ hơn...' : 'Viết câu trả lời...'}"
                class="w-full px-3 py-2 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-secondary resize-y"></textarea>
              <div class="flex justify-end gap-2">
                <button type="button" data-action="toggle-reply" class="px-3 py-1.5 text-xs font-semibold border border-outline-variant rounded-lg hover:bg-surface-low">Hủy</button>
                <button type="submit" class="px-3 py-1.5 text-xs font-semibold bg-secondary text-white rounded-lg hover:opacity-90 disabled:opacity-50">Gửi</button>
              </div>
            </form>` : ''}
        </article>`;
    }

    function render() {
      const askForm = opts.lectureId && canAsk ? `
        <form data-ask-form class="bg-white rounded-2xl border border-outline-variant/40 p-4 space-y-2">
          <label class="block text-sm font-semibold text-on-surface" for="qa-ask-${opts.lectureId}">Bạn chưa hiểu phần nào trong bài?</label>
          <textarea id="qa-ask-${opts.lectureId}" rows="3" maxlength="2000" required
            placeholder="Ví dụ: Vì sao câu này dùng thì hiện tại hoàn thành mà không dùng quá khứ đơn?"
            class="w-full px-3 py-2 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-secondary resize-y"></textarea>
          <div class="flex flex-wrap items-center gap-3">
            ${opts.video ? `
              <label class="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
                <input type="checkbox" data-attach-time class="rounded accent-secondary" />
                Gắn mốc video <b data-current-time>0:00</b>
              </label>` : ''}
            <p data-ask-error class="hidden text-xs text-red-600"></p>
            <button type="submit" class="ml-auto px-4 py-2 text-sm font-semibold bg-secondary text-white rounded-xl hover:opacity-90 disabled:opacity-50">Gửi câu hỏi</button>
          </div>
        </form>` : '';
      const list = items.length
        ? items.map(renderThread).join('')
        : `<p class="bg-white rounded-2xl border border-outline-variant/40 px-4 py-8 text-center text-sm text-on-surface-variant">${esc(opts.emptyText || 'Chưa có câu hỏi nào.')}</p>`;
      root.innerHTML = askForm + `<div class="space-y-3 ${askForm ? 'mt-3' : ''}">${list}</div>`;
      if (pendingFocus) focus(pendingFocus);
    }

    async function reload() {
      try {
        const json = await opts.load();
        if (listeners.signal.aborted) return; // đã gắn lại với bộ lọc khác
        if (!json.success) throw new Error(json.message);
        items = json.data.items;
        canAsk = !!json.data.can_ask;
        loaded = true;
        render();
        opts.onChange?.(items);
      } catch (e) {
        root.innerHTML = `<p class="bg-white rounded-2xl border border-outline-variant/40 px-4 py-8 text-center text-sm text-red-600">${esc(e.message || 'Không tải được hỏi đáp')}</p>`;
      }
    }

    // Cuộn tới một câu hỏi (mở từ thông báo) và làm nổi bật trong giây lát
    function focus(questionId) {
      const el = root.querySelector(`#qa-${questionId}`);
      if (!el) { pendingFocus = loaded ? null : questionId; return false; }
      pendingFocus = null;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-accent');
      setTimeout(() => el.classList.remove('ring-2', 'ring-accent'), 2500);
      return true;
    }

    on('focusin', e => {
      // Hiện mốc thời gian video hiện tại khi đang viết câu hỏi
      if (e.target.closest('[data-ask-form]') && opts.video) {
        const label = root.querySelector('[data-current-time]');
        if (label) label.textContent = clock(opts.video.currentTime());
      }
    });

    on('click', async e => {
      const seek = e.target.closest('[data-seek]');
      if (seek) { opts.video?.seek(Number(seek.dataset.seek)); return; }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const article = btn.closest('[data-qid]');
      const qid = article?.dataset.qid;
      try {
        switch (btn.dataset.action) {
          case 'toggle-reply': {
            const form = article.querySelector('[data-reply-form]');
            form.classList.toggle('hidden');
            if (!form.classList.contains('hidden')) form.querySelector('textarea').focus();
            return;
          }
          case 'resolve':
          case 'reopen':
            await send('PUT', `/api/lecture-questions/${qid}`, { status: btn.dataset.action === 'resolve' ? 'resolved' : 'open' });
            break;
          case 'delete-question':
            if (!confirm('Xóa câu hỏi này cùng các trả lời?')) return;
            await send('DELETE', `/api/lecture-questions/${qid}`);
            break;
          case 'delete-answer':
            if (!confirm('Xóa trả lời này?')) return;
            await send('DELETE', `/api/lecture-answers/${btn.dataset.id}`);
            break;
          default: return;
        }
        await reload();
      } catch (err) {
        alert(err.message);
      }
    });

    on('submit', async e => {
      e.preventDefault();
      const form = e.target;
      const button = form.querySelector('[type="submit"]');
      const textarea = form.querySelector('textarea');
      const content = textarea.value.trim();
      if (!content) return;
      button.disabled = true;
      try {
        if (form.matches('[data-ask-form]')) {
          const attach = form.querySelector('[data-attach-time]')?.checked;
          const created = await send('POST', `/api/lectures/${opts.lectureId}/questions`, {
            content, video_time: attach && opts.video ? Math.floor(opts.video.currentTime()) : null,
          });
          pendingFocus = created.id;
        } else {
          const qid = form.closest('[data-qid]').dataset.qid;
          await send('POST', `/api/lecture-questions/${qid}/answers`, { content });
        }
        await reload();
      } catch (err) {
        const errEl = form.querySelector('[data-ask-error]');
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
        else alert(err.message);
        button.disabled = false;
      }
    });

    root.innerHTML = '<p class="px-4 py-6 text-center text-sm text-on-surface-variant">Đang tải hỏi đáp...</p>';
    reload();
    return { reload, focus, get items() { return items; } };
  }

  window.EngProQA = { mount, STATUS };
})();

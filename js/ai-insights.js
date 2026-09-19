/**
 * EngPro – Khung "Trợ lý học tập AI": nhận xét quá trình học, điểm mạnh, điểm cần cải thiện,
 * kế hoạch 7 ngày và gợi ý bài giảng, đề luyện có thật trong hệ thống.
 *
 *   EngProInsights.mount(document.getElementById('ai-insights'))
 *
 * Dữ liệu lấy từ GET /api/ai/insights, bấm cập nhật thì gọi POST /api/ai/insights.
 */
(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const icon = (name, cls = '') => `<span class="material-symbols-outlined ${cls}" aria-hidden="true">${name}</span>`;
  const fmtTime = d => new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

  let root = null;
  let state = null;
  let busy = false;
  let error = '';

  async function mount(el) {
    root = el;
    if (!root) return;
    try {
      const res = await fetch('/api/ai/insights', { credentials: 'include' });
      if (!res.ok) { root.innerHTML = ''; return; } // chỉ học viên đã đăng nhập mới có trợ lý
      state = (await res.json()).data;
    } catch { root.innerHTML = ''; return; }
    if (!state.enabled && !state.report) { root.innerHTML = ''; return; }
    render();
  }

  async function generate() {
    if (busy) return;
    busy = true;
    error = '';
    render();
    try {
      const json = await (await fetch('/api/ai/insights', { method: 'POST', credentials: 'include' })).json();
      if (!json.success) throw new Error(json.message);
      state = { ...state, ...json.data };
    } catch (e) {
      error = e.message || 'Không kết nối được trợ lý AI';
    } finally {
      busy = false;
      render();
    }
  }

  function header() {
    const r = state.report;
    const canGenerate = state.enabled && state.remaining_today > 0;
    const label = r ? 'Cập nhật nhận xét' : 'Nhận xét quá trình học của tôi';
    return `
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <span class="shrink-0 w-10 h-10 rounded-xl bg-secondary text-white flex items-center justify-center">${icon('auto_awesome', 'text-xl')}</span>
          <div class="min-w-0">
            <h2 class="font-bold text-primary">Trợ lý học tập AI</h2>
            <p class="text-xs text-on-surface-variant mt-0.5">
              ${r ? `Nhận xét lúc ${fmtTime(state.created_at)}` : 'Đọc kết quả các bài bạn đã làm, chỉ ra điểm mạnh, điểm cần cải thiện và gợi ý kế hoạch 7 ngày.'}
              ${r && state.has_new_activity ? '<span class="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">Có bài làm mới</span>' : ''}
            </p>
          </div>
        </div>
        ${state.enabled ? `
          <div class="flex flex-col items-end gap-1">
            <button type="button" data-ai-generate ${busy || !canGenerate ? 'disabled' : ''}
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold ${r ? 'border border-secondary text-secondary hover:bg-blue-50' : 'bg-secondary text-white hover:opacity-90'} disabled:opacity-50 disabled:cursor-not-allowed">
              ${icon(busy ? 'progress_activity' : 'auto_awesome', 'text-base' + (busy ? ' animate-spin' : ''))}${busy ? 'Đang phân tích...' : label}
            </button>
            <span class="text-[11px] text-on-surface-variant">${state.remaining_today > 0 ? `Còn ${state.remaining_today} lượt hôm nay` : 'Đã hết lượt hôm nay'}</span>
          </div>` : ''}
      </div>`;
  }

  function reportHtml(r) {
    const list = (items, iconName, cls) => items.map(t => `<li class="flex gap-2 text-sm">${icon(iconName, `text-lg shrink-0 ${cls}`)}<span>${esc(t)}</span></li>`).join('');
    return `
      <p class="mt-4 text-sm leading-relaxed text-on-surface whitespace-pre-line">${esc(r.summary)}</p>
      <div class="grid md:grid-cols-2 gap-4 mt-4">
        <section class="rounded-xl bg-green-50/60 border border-green-200 p-4">
          <h3 class="text-sm font-bold text-green-800 mb-2">Điểm mạnh</h3>
          <ul class="space-y-1.5">${list(r.strengths, 'check_circle', 'text-green-600') || '<li class="text-sm text-on-surface-variant">Chưa đủ dữ liệu.</li>'}</ul>
        </section>
        <section class="rounded-xl bg-amber-50/60 border border-amber-200 p-4">
          <h3 class="text-sm font-bold text-amber-900 mb-2">Cần cải thiện</h3>
          <ul class="space-y-2.5">
            ${r.weaknesses.map(w => `
              <li class="text-sm">
                <p class="font-semibold text-on-surface">${esc(w.area)}</p>
                ${w.evidence ? `<p class="text-xs text-on-surface-variant">${esc(w.evidence)}</p>` : ''}
                <p class="mt-0.5">${esc(w.advice)}</p>
              </li>`).join('') || '<li class="text-sm text-on-surface-variant">Chưa thấy điểm yếu rõ rệt.</li>'}
          </ul>
        </section>
      </div>
      ${r.plan.length ? `
        <section class="mt-4">
          <h3 class="text-sm font-bold text-primary mb-2">Kế hoạch 7 ngày tới</h3>
          <ol class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${r.plan.map((p, i) => `
              <li class="rounded-xl border border-outline-variant/40 p-3">
                <p class="text-xs font-bold text-secondary">${i + 1}. ${esc(p.title)}</p>
                <ul class="mt-1.5 space-y-1 text-sm list-disc pl-4">${p.tasks.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
              </li>`).join('')}
          </ol>
        </section>` : ''}
      ${r.recommendations.length ? `
        <section class="mt-4">
          <h3 class="text-sm font-bold text-primary mb-2">Nên học tiếp</h3>
          <div class="grid sm:grid-cols-2 gap-3">
            ${r.recommendations.map(x => `
              <a href="${esc(x.link)}" class="flex items-start gap-3 rounded-xl border border-outline-variant/40 p-3 hover:border-secondary hover:bg-blue-50/40">
                ${icon(x.type === 'lecture' ? 'play_circle' : 'quiz', 'text-2xl text-secondary shrink-0')}
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-on-surface">${esc(x.title)}</span>
                  <span class="block text-xs text-on-surface-variant">${esc(x.subtitle)}</span>
                  <span class="block text-xs text-on-surface mt-1">${esc(x.reason)}</span>
                </span>
              </a>`).join('')}
          </div>
        </section>` : ''}
      ${r.encouragement ? `<p class="mt-4 text-sm font-semibold text-secondary">${esc(r.encouragement)}</p>` : ''}`;
  }

  function render() {
    const r = state.report;
    root.innerHTML = `
      <div class="bg-white rounded-2xl border border-secondary/30 p-5 md:p-6 shadow-sm" aria-live="polite">
        ${header()}
        ${error ? `<p class="mt-3 text-sm text-error bg-red-50 rounded-xl px-3 py-2">${esc(error)}</p>` : ''}
        ${busy ? `<p class="mt-4 text-sm text-on-surface-variant">Trợ lý đang đọc kết quả học tập của bạn, thường mất 10 đến 30 giây...</p>` : ''}
        ${r && !busy ? reportHtml(r) : ''}
        <p class="mt-4 text-[11px] text-on-surface-variant">
          Nhận xét do AI (Google Gemini) tạo từ điểm số, tỉ lệ đúng và thời gian học của bạn, không kèm họ tên hay email. Nội dung chỉ để tham khảo.
        </p>
      </div>`;
    root.querySelector('[data-ai-generate]')?.addEventListener('click', generate);
  }

  window.EngProInsights = { mount };
})();

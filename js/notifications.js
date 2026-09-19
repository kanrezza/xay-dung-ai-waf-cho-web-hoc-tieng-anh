/**
 * EngPro – Nút thông báo (chuông) cạnh ảnh đại diện
 * Tự gắn vào phần tử [data-notifications] nếu trang có (data-notifications="dark" cho thanh màu tối),
 * nếu không thì gắn vào đầu khối #auth-user của thanh điều hướng.
 * Thông báo: đăng ký/thanh toán, khóa học được kích hoạt, nhận xét của giảng viên, hạn nộp bài…
 */
(function () {
  if (window.EngProNotifications) return;

  const TYPES = {
    enroll_pending:   { icon: 'hourglass_top',     cls: 'bg-amber-50 text-amber-600' },
    enroll_active:    { icon: 'celebration',       cls: 'bg-green-50 text-green-600' },
    enroll_rejected:  { icon: 'block',             cls: 'bg-red-50 text-red-600' },
    course_completed: { icon: 'workspace_premium', cls: 'bg-green-50 text-green-600' },
    teacher_feedback: { icon: 'rate_review',       cls: 'bg-blue-50 text-secondary' },
    deadline_soon:    { icon: 'schedule',          cls: 'bg-amber-50 text-amber-600' },
    deadline_overdue: { icon: 'alarm',             cls: 'bg-red-50 text-red-600' },
    qa_question:      { icon: 'help',              cls: 'bg-amber-50 text-amber-600' },
    qa_followup:      { icon: 'chat',              cls: 'bg-amber-50 text-amber-600' },
    qa_answer:        { icon: 'question_answer',   cls: 'bg-blue-50 text-secondary' },
    course_submitted: { icon: 'fact_check',        cls: 'bg-amber-50 text-amber-600' },
    course_approved:  { icon: 'verified',          cls: 'bg-green-50 text-green-600' },
    course_rejected:  { icon: 'edit_note',         cls: 'bg-red-50 text-red-600' },
    course_review:    { icon: 'star',              cls: 'bg-amber-50 text-amber-600' },
    review_reply:     { icon: 'reply',             cls: 'bg-blue-50 text-secondary' },
    student_finished: { icon: 'military_tech',     cls: 'bg-green-50 text-green-600' },
    ai_answer_request:{ icon: 'gpp_maybe',         cls: 'bg-amber-50 text-amber-700' },
    ai_quota_warning: { icon: 'battery_alert',     cls: 'bg-amber-50 text-amber-700' },
    writing_graded:   { icon: 'edit_note',         cls: 'bg-blue-50 text-secondary' },
    contact_reply:    { icon: 'support_agent',     cls: 'bg-blue-50 text-secondary' },
    contact_new:      { icon: 'mail',              cls: 'bg-amber-50 text-amber-700' },
    contact_followup: { icon: 'forum',             cls: 'bg-amber-50 text-amber-700' },
  };
  const REFRESH_MS = 2 * 60 * 1000;
  // Liên kết trong thông báo tính từ thư mục pages/
  const prefix = location.pathname.includes('/pages/') ? '' : 'pages/';

  let root, button, badge, panel, list;
  let items = [];

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function timeAgo(iso) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'Vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} giờ trước`;
    if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))} ngày trước`;
    return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function mountPoint() {
    const explicit = document.querySelector('[data-notifications]');
    if (explicit) return { el: explicit, dark: explicit.dataset.notifications === 'dark' };
    const authUser = document.getElementById('auth-user');
    if (!authUser) return null;
    const el = document.createElement('div');
    el.className = 'mr-1';
    authUser.prepend(el);
    return { el, dark: false };
  }

  function mount() {
    const point = mountPoint();
    if (!point) return;
    root = point.el;
    root.classList.add('relative');
    root.innerHTML = `
      <button type="button" aria-label="Thông báo" aria-haspopup="true" aria-expanded="false"
        class="relative w-10 h-10 rounded-full flex items-center justify-center transition-colors
               ${point.dark ? 'text-white hover:bg-white/15' : 'text-on-surface-variant hover:bg-surface-low'}">
        <span class="material-symbols-outlined text-2xl">notifications</span>
        <span data-badge class="hidden absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white
                     text-[10px] font-bold leading-[18px] text-center ring-2 ${point.dark ? 'ring-primary' : 'ring-white'}"></span>
      </button>
      <div data-panel class="hidden absolute right-0 top-full mt-2 w-[22rem] bg-white rounded-2xl shadow-xl border border-outline-variant/30
                  z-50 overflow-hidden text-left text-on-surface
                  max-sm:fixed max-sm:left-3 max-sm:right-3 max-sm:top-16 max-sm:w-auto">
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-outline-variant/30">
          <p class="font-bold text-primary">Thông báo</p>
          <button type="button" data-read-all class="text-xs font-semibold text-secondary hover:underline">Đánh dấu tất cả đã đọc</button>
        </div>
        <div data-list class="max-h-[26rem] overflow-y-auto divide-y divide-outline-variant/20">
          <p class="px-4 py-8 text-center text-sm text-on-surface-variant">Đang tải...</p>
        </div>
      </div>`;
    button = root.querySelector('button');
    badge = root.querySelector('[data-badge]');
    panel = root.querySelector('[data-panel]');
    list = root.querySelector('[data-list]');

    button.addEventListener('click', () => setOpen(panel.classList.contains('hidden')));
    root.querySelector('[data-read-all]').addEventListener('click', markAllRead);
    list.addEventListener('click', onItemClick);
    document.addEventListener('click', e => { if (!root.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    document.getElementById('user-menu-btn')?.addEventListener('click', () => setOpen(false));

    refresh();
    setInterval(refresh, REFRESH_MS);
  }

  function setOpen(open) {
    panel.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    if (open) refresh();
  }

  async function refresh() {
    try {
      const res = await fetch('/api/notifications', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;
      items = json.data.items;
      renderBadge(json.data.unread);
      renderList();
    } catch {}
  }

  function renderBadge(unread) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.classList.toggle('hidden', !unread);
    button.setAttribute('aria-label', unread ? `Thông báo, ${unread} chưa đọc` : 'Thông báo');
  }

  function renderList() {
    if (!items.length) {
      list.innerHTML = `
        <div class="px-4 py-10 text-center">
          <span class="material-symbols-outlined text-4xl text-outline-variant">notifications_off</span>
          <p class="text-sm text-on-surface-variant mt-1">Chưa có thông báo nào.</p>
        </div>`;
      return;
    }
    list.innerHTML = items.map(n => {
      const type = TYPES[n.type] || { icon: 'notifications', cls: 'bg-surface-low text-on-surface-variant' };
      return `
        <a href="${n.link ? prefix + esc(n.link) : '#'}" data-id="${n.id}"
           class="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-low ${n.is_read ? '' : 'bg-blue-50/60'}">
          <span class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${type.cls}">
            <span class="material-symbols-outlined text-lg">${type.icon}</span>
          </span>
          <span class="min-w-0 flex-grow">
            <span class="block text-sm leading-snug ${n.is_read ? 'text-on-surface' : 'font-semibold text-primary'}">${esc(n.title)}</span>
            ${n.body ? `<span class="block text-xs text-on-surface-variant mt-0.5 line-clamp-2">${esc(n.body)}</span>` : ''}
            <span class="block text-[11px] text-outline mt-1">${timeAgo(n.created_at)}</span>
          </span>
          ${n.is_read ? '' : '<span class="w-2 h-2 rounded-full bg-secondary mt-1.5 shrink-0" aria-label="Chưa đọc"></span>'}
        </a>`;
    }).join('');
  }

  function markRead(body) {
    return fetch('/api/notifications/read', {
      method: 'POST', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  async function onItemClick(e) {
    const link = e.target.closest('a[data-id]');
    if (!link) return;
    e.preventDefault();
    const item = items.find(n => String(n.id) === link.dataset.id);
    if (item && !item.is_read) await markRead({ id: item.id });
    if (item?.link) location.href = link.getAttribute('href');
    else refresh();
  }

  async function markAllRead() {
    await markRead({ all: true });
    refresh();
  }

  window.EngProNotifications = { refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

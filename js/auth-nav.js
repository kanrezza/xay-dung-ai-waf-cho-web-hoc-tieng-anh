/**
 * auth-nav.js – dùng chung cho tất cả trang public
 * Kiểm tra session, ẩn/hiện nút Đăng nhập/Đăng ký tự động,
 * và dựng menu tài khoản (dropdown) khi bấm vào ảnh đại diện.
 */
(function () {
  // Đường dẫn của chính file này, dùng để nạp js/notifications.js cùng thư mục
  const SCRIPT_SRC = document.currentScript?.src || '';
  const DASH = {
    admin: 'dashboard-admin.html',
    gv:    'dashboard-gv.html',
    user:  'my-learning.html',
  };

  function elShow(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('flex');
  }
  function elHide(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('flex');
  }
  function elText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  // Có ảnh đại diện thì thay chữ cái đầu trong vòng tròn bằng ảnh
  function elAvatar(id, avatar) {
    const circle = document.getElementById(id)?.parentElement;
    if (!circle || !avatar) return;
    const img = document.createElement('img');
    img.src = '/' + avatar;
    img.alt = '';
    img.className = 'w-full h-full object-cover';
    circle.classList.add('overflow-hidden');
    circle.replaceChildren(img);
  }

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Nhóm Hỗ trợ trong menu tài khoản
  const support = prefix => [
    { heading: 'Hỗ trợ' },
    { icon: 'help',          label: 'Trung tâm trợ giúp', href: prefix + 'help.html' },
    { icon: 'support_agent', label: 'Liên hệ trung tâm',  href: prefix + 'contact.html' },
  ];

  // Các mục trong menu tài khoản. Học viên: các phần trong trang hồ sơ; GV/admin: bảng điều khiển
  function menuItems(user, prefix) {
    if (user.role === 'user') {
      return [
        { icon: 'school',       label: 'Học tập của tôi',   href: prefix + 'my-learning.html' },
        { icon: 'insights',     label: 'Kết quả học tập',   href: prefix + 'results.html' },
        { icon: 'receipt_long', label: 'Thanh toán',        href: prefix + 'purchases.html' },
        { icon: 'settings',     label: 'Cài đặt tài khoản', href: prefix + 'profile.html' },
        ...support(prefix),
      ];
    }
    const items = [{ icon: 'dashboard', label: 'Bảng điều khiển', href: prefix + DASH[user.role] }];
    // Giảng viên cũng cần kênh hỗ trợ; quản trị viên chính là người trả lời nên không cần
    if (user.role === 'gv') items.push(...support(prefix));
    return items;
  }

  function menuHtml(items) {
    const link = it => `
      <a href="${it.href}" role="menuitem"
         class="flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-low transition-colors">
        <span class="material-symbols-outlined text-lg text-on-surface-variant">${it.icon}</span>${it.label}
      </a>`;
    const heading = it => `
      <div class="my-1 border-t border-outline-variant/30"></div>
      <p class="px-4 pt-1.5 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">${it.heading}</p>`;
    return items.map(it => (it.heading ? heading(it) : link(it))).join('') + `
      <div class="my-1 border-t border-outline-variant/30"></div>
      <button type="button" role="menuitem" data-logout
        class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
        <span class="material-symbols-outlined text-lg">logout</span>Đăng xuất
      </button>`;
  }

  function setupMenu(user, prefix) {
    const items = menuItems(user, prefix);
    const menu = document.getElementById('user-menu');
    const btn  = document.getElementById('user-menu-btn');
    const mobileMenu = document.getElementById('user-menu-mobile');

    if (mobileMenu) mobileMenu.innerHTML = menuHtml(items);
    if (!menu || !btn) return;
    menu.innerHTML = `
      <div class="px-4 pt-1 pb-3 mb-1 border-b border-outline-variant/30">
        <p class="text-sm font-bold text-primary truncate">${esc(user.name)}</p>
        <p class="text-xs text-on-surface-variant truncate">${esc(user.email)}</p>
      </div>` + menuHtml(items);

    const setOpen = open => {
      menu.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', e => {
      e.stopPropagation();
      setOpen(menu.classList.contains('hidden'));
    });
    // Bấm ra ngoài hoặc nhấn Esc thì đóng menu
    document.addEventListener('click', e => { if (!menu.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  }

  // Học viên đã đăng nhập: thêm mục "Học tập của tôi" lên thanh điều hướng (giống "My Learning")
  function addLearningLink(prefix) {
    const href = prefix + 'my-learning.html';
    const current = window.location.pathname.endsWith('/my-learning.html');
    const nav = document.querySelector('header nav');
    if (nav && !nav.querySelector('[data-my-learning]')) {
      const link = document.createElement('a');
      link.href = href;
      link.dataset.myLearning = '';
      link.textContent = 'Học tập của tôi';
      link.className = current
        ? 'text-secondary font-bold border-b-2 border-secondary pb-0.5 text-sm'
        : 'text-on-surface-variant hover:text-secondary transition-colors text-sm font-medium';
      nav.appendChild(link);
    }
    const mobileLinks = document.querySelector('#mobile-menu hr');
    if (mobileLinks && !document.querySelector('#mobile-menu [data-my-learning]')) {
      const link = document.createElement('a');
      link.href = href;
      link.dataset.myLearning = '';
      link.textContent = 'Học tập của tôi';
      link.className = current ? 'text-secondary font-bold text-base py-1' : 'text-on-surface-variant text-base py-1';
      mobileLinks.before(link);
    }
  }

  function showLoggedIn(user) {
    const initial = (user.name || '?').charAt(0).toUpperCase();

    // Phát hiện prefix (pages/ dùng tương đối pages/, index.html dùng pages/)
    const isRoot   = !window.location.pathname.includes('/pages/');
    const prefix   = isRoot ? 'pages/' : '';

    elHide('auth-guest');        elShow('auth-user');
    elHide('auth-guest-mobile'); elShow('auth-user-mobile');

    elText('user-initial',          initial);
    elText('user-name-display',     user.name);
    // Màn hình nhỏ: chỉ hiện ảnh đại diện để thanh điều hướng đủ chỗ cho nút thông báo
    document.getElementById('user-name-display')?.classList.add('hidden', 'sm:inline');
    elText('user-initial-mobile',   initial);
    elText('user-name-mobile',      user.name);
    elText('user-email-mobile',     user.email);
    elAvatar('user-initial',        user.avatar);
    elAvatar('user-initial-mobile', user.avatar);
    setupMenu(user, prefix);
    if (user.role === 'user') {
      addLearningLink(prefix);
      loadNotifications();
    }
  }

  // Nút thông báo (chuông) cạnh ảnh đại diện — chỉ dành cho học viên
  function loadNotifications() {
    if (!SCRIPT_SRC || window.EngProNotifications || document.querySelector('script[data-engpro-notifications]')) return;
    const script = document.createElement('script');
    script.src = SCRIPT_SRC.replace(/auth-nav\.js(\?.*)?$/, 'notifications.js');
    script.dataset.engproNotifications = '';
    document.body.appendChild(script);
  }

  function showGuest() {
    elShow('auth-guest');        elHide('auth-user');
    elShow('auth-guest-mobile'); elHide('auth-user-mobile');
  }

  async function initAuth() {
    try {
      const res  = await fetch('/api/auth/me', { credentials: 'include' });
      const json = await res.json();
      if (json.success && json.data) {
        window.__engproUser = json.data;
        window.EngProI18n?.syncAccount(json.data.ui_language);
        showLoggedIn(json.data);
      } else {
        window.__engproUser = null;
        showGuest();
      }
    } catch {
      showGuest();
    }
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-logout]')) window.doLogout();
  });

  // Expose doLogout globally để các trang gọi được
  window.doLogout = async function () {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    sessionStorage.removeItem('engpro_user');
    window.location.reload();
  };

  // Tự chạy khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }
})();

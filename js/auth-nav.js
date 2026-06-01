/**
 * auth-nav.js – dùng chung cho tất cả trang public
 * Kiểm tra session, ẩn/hiện nút Đăng nhập/Đăng ký tự động.
 */
(function () {
  const DASH = {
    admin: 'dashboard-admin.html',
    gv:    'dashboard-gv.html',
    user:  'profile.html',
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
  function elHref(id, val) {
    const el = document.getElementById(id);
    if (el) el.href = val;
  }

  function showLoggedIn(user) {
    const initial = (user.name || '?').charAt(0).toUpperCase();

    // Phát hiện prefix (pages/ dùng tương đối pages/, index.html dùng pages/)
    const isRoot   = !window.location.pathname.includes('/pages/');
    const prefix   = isRoot ? 'pages/' : '';
    const dashUrl  = prefix + (DASH[user.role] ?? 'my-courses.html');

    elHide('auth-guest');        elShow('auth-user');
    elHide('auth-guest-mobile'); elShow('auth-user-mobile');

    elText('user-initial',          initial);
    elText('user-name-display',     user.name);
    elHref('dash-link',             dashUrl);
    elText('user-initial-mobile',   initial);
    elText('user-name-mobile',      user.name);
    elHref('dash-link-mobile',      dashUrl);
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
        showLoggedIn(json.data);
      } else {
        window.__engproUser = null;
        showGuest();
      }
    } catch {
      showGuest();
    }
  }

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

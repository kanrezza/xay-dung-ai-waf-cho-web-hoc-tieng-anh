/**
 * EngPro – Hộp thoại đăng ký khóa học và thanh toán học phí
 * Dùng chung cho trang Khóa học và trang Chi tiết khóa học. Cần nạp js/payment-info.js trước file này.
 *
 *   EngProEnroll.open({ id, title, price, category_type }, { onDone(result) { ... } })
 *
 * Khóa miễn phí: gửi đăng ký ngay. Khóa có phí: thanh toán qua VNPay (nếu server đã cấu hình, vào học ngay)
 * hoặc chuyển khoản theo mã QR rồi chờ admin xác nhận.
 */
(function () {
  const formatPrice = price => (Number(price) > 0 ? Number(price).toLocaleString('vi-VN') + 'đ' : 'Miễn phí');

  let modal = null;
  let course = null;
  let options = {};
  let vnpayEnabled = false;
  fetch('/api/payments/config').then(r => r.json()).then(json => { vnpayEnabled = !!json.data?.vnpay; }).catch(() => {});

  const $ = selector => modal.querySelector(selector);

  function build() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'hidden fixed inset-0 bg-primary/50 z-[60] flex items-center justify-center p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'enroll-title');
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8 max-h-[92vh] overflow-y-auto">
        <div data-step="1">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div class="min-w-0">
              <p class="text-xs font-bold uppercase tracking-widest text-secondary" data-field="type"></p>
              <h3 id="enroll-title" class="text-xl font-bold text-primary mt-1" data-field="title"></h3>
            </div>
            <button type="button" data-close class="text-on-surface-variant hover:text-primary" aria-label="Đóng">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="bg-surface-low rounded-xl p-4 mb-5">
            <p class="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Học phí</p>
            <p class="text-2xl font-bold text-primary" data-field="price"></p>
          </div>
          <div class="space-y-2 mb-5 text-sm text-on-surface-variant">
            <div class="flex items-center gap-2"><span class="material-symbols-outlined text-secondary text-base">check_circle</span>Video bài giảng xem lại không giới hạn</div>
            <div class="flex items-center gap-2"><span class="material-symbols-outlined text-secondary text-base">check_circle</span>Bài kiểm tra sau mỗi bài giảng</div>
            <div class="flex items-center gap-2"><span class="material-symbols-outlined text-secondary text-base">check_circle</span>Tài liệu học đính kèm</div>
          </div>
          <div data-field="error" class="hidden mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"></div>
          <button type="button" data-action="vnpay"
            class="hidden w-full mb-3 bg-[#005baa] text-white font-semibold py-3 rounded-lg hover:opacity-90 transition-opacity text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            <span class="material-symbols-outlined text-base">credit_card</span>Thanh toán qua VNPay
            <span class="text-xs font-normal text-blue-100">(thẻ ATM, QR, ví) · vào học ngay</span>
          </button>
          <div class="flex gap-3">
            <button type="button" data-close class="flex-1 border border-outline-variant text-on-surface-variant font-semibold py-3 rounded-lg hover:bg-surface-low transition-colors text-sm">Hủy</button>
            <button type="button" data-action="next"
              class="flex-1 bg-primary text-white font-semibold py-3 rounded-lg hover:opacity-90 transition-opacity text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              <span class="material-symbols-outlined text-base" data-field="next-icon">payments</span><span data-field="next-label">Chuyển khoản</span>
            </button>
          </div>
        </div>

        <div data-step="2" class="hidden">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-bold text-primary">Chuyển khoản học phí</h3>
            <button type="button" data-close class="text-on-surface-variant hover:text-primary" aria-label="Đóng">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="flex justify-center mb-4">
            <img data-field="qr" src="" alt="Mã QR chuyển khoản" class="w-52 h-52 rounded-xl border border-outline-variant object-contain" />
          </div>
          <div class="bg-surface-low rounded-xl p-4 mb-4 space-y-2.5 text-sm">
            <div class="flex justify-between items-center gap-2"><span class="text-on-surface-variant">Ngân hàng</span><span class="font-semibold text-on-surface" data-field="bank"></span></div>
            <div class="flex justify-between items-center gap-2"><span class="text-on-surface-variant">Số tài khoản</span>
              <span class="flex items-center gap-2"><span class="font-semibold text-on-surface" data-field="account"></span><button type="button" data-copy="account" class="text-xs text-secondary hover:underline">Sao chép</button></span></div>
            <div class="flex justify-between items-center gap-2"><span class="text-on-surface-variant">Số tiền</span>
              <span class="flex items-center gap-2"><span class="font-bold text-on-surface" data-field="amount"></span><button type="button" data-copy="amount" class="text-xs text-secondary hover:underline">Sao chép</button></span></div>
            <div class="flex justify-between items-start gap-2"><span class="text-on-surface-variant shrink-0">Nội dung CK</span>
              <span class="flex items-center gap-2 min-w-0"><span class="font-semibold text-on-surface break-all text-right" data-field="note"></span><button type="button" data-copy="note" class="text-xs text-secondary hover:underline shrink-0">Sao chép</button></span></div>
          </div>
          <p class="text-xs text-on-surface-variant text-center mb-5">Sau khi chuyển khoản, trung tâm sẽ xác nhận và kích hoạt khóa học trong vòng 24 giờ.</p>
          <div data-field="error2" class="hidden mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"></div>
          <button type="button" data-action="confirm" class="w-full bg-primary text-white font-semibold py-3 rounded-lg hover:opacity-90 transition-opacity text-sm disabled:opacity-50">
            Tôi đã chuyển khoản
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    $('[data-action="vnpay"]').addEventListener('click', payWithVnpay);
    $('[data-action="next"]').addEventListener('click', () => (Number(course.price) > 0 ? showTransfer() : submitEnroll($('[data-action="next"]'), 'error')));
    $('[data-action="confirm"]').addEventListener('click', () => submitEnroll($('[data-action="confirm"]'), 'error2'));
    modal.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => {
      navigator.clipboard?.writeText($(`[data-field="${btn.dataset.copy}"]`).textContent).then(() => {
        btn.textContent = 'Đã sao chép!';
        setTimeout(() => { btn.textContent = 'Sao chép'; }, 1500);
      });
    }));
  }

  function showStep(step) {
    modal.querySelectorAll('[data-step]').forEach(el => el.classList.toggle('hidden', el.dataset.step !== String(step)));
  }

  function showError(field, message) {
    const el = $(`[data-field="${field}"]`);
    el.textContent = message;
    el.classList.toggle('hidden', !message);
  }

  function open(target, opts = {}) {
    if (!target) return;
    if (!window.__engproUser) {
      // Đăng nhập xong quay lại đúng trang đang xem (login.html đọc tham số next)
      location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
      return;
    }
    build();
    course = target;
    options = opts;
    const paid = Number(course.price) > 0;
    const online = vnpayEnabled && paid;
    $('[data-field="type"]').textContent = String(course.category_type || '').toUpperCase();
    $('[data-field="title"]').textContent = course.title;
    $('[data-field="price"]').textContent = formatPrice(course.price);
    $('[data-action="vnpay"]').classList.toggle('hidden', !online);
    $('[data-action="vnpay"]').disabled = false;
    $('[data-field="next-icon"]').textContent = paid ? 'account_balance' : 'how_to_reg';
    $('[data-field="next-label"]').textContent = paid ? 'Chuyển khoản' : 'Đăng ký miễn phí';
    ['error', 'error2'].forEach(field => showError(field, ''));
    showStep(1);
    modal.classList.remove('hidden');
  }

  function close() {
    modal?.classList.add('hidden');
  }

  function showTransfer() {
    const email = window.__engproUser?.email || '';
    const note = EngProPayment.transferNote(email, course.title);
    $('[data-field="qr"]').src = EngProPayment.qrUrl(Number(course.price) || 0, note);
    $('[data-field="bank"]').textContent = EngProPayment.BANK.name;
    $('[data-field="account"]').textContent = EngProPayment.BANK.account;
    $('[data-field="amount"]').textContent = formatPrice(course.price);
    $('[data-field="note"]').textContent = note;
    showStep(2);
  }

  async function payWithVnpay() {
    const btn = $('[data-action="vnpay"]');
    btn.disabled = true;
    showError('error', '');
    try {
      const json = await (await fetch('/api/payments/vnpay/create', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: course.id }),
      })).json();
      if (!json.success) throw new Error(json.message);
      location.href = json.data.payment_url;
    } catch (e) {
      showError('error', e.message || 'Không tạo được giao dịch VNPay, vui lòng thử lại');
      btn.disabled = false;
    }
  }

  async function submitEnroll(btn, errorField) {
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Đang gửi...';
    showError(errorField, '');
    try {
      const json = await (await fetch('/api/user/enroll/' + course.id, { method: 'POST', credentials: 'include' })).json();
      if (!json.success) throw new Error(json.message || 'Có lỗi xảy ra, vui lòng thử lại');
      if (json.data.already && ['active', 'completed'].includes(json.data.status)) {
        location.href = 'course-learn.html?id=' + course.id;
        return;
      }
      close();
      options.onDone?.(json.data);
    } catch (e) {
      showError(errorField, e.message || 'Không thể kết nối server');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  window.EngProEnroll = { open, close };
})();

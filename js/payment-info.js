/**
 * EngPro – Thông tin chuyển khoản học phí
 * Dùng chung cho trang Khóa học (lúc đăng ký) và trang Thanh toán (khoản đang chờ xác nhận).
 */
(function () {
  const BANK = { code: 'VCB', name: 'VCB (Vietcombank)', account: '1040615283', accountName: 'EngPro' };

  // Nội dung chuyển khoản: email + tên khóa học viết liền, để admin đối chiếu khi xác nhận
  function transferNote(email, courseTitle) {
    return (email || 'user@mail.com') + '_' + String(courseTitle || '').replace(/\s+/g, '');
  }

  // Ảnh QR VietQR đã điền sẵn số tiền và nội dung chuyển khoản
  function qrUrl(amount, note) {
    return `https://img.vietqr.io/image/${BANK.code}-${BANK.account}-qr_only.jpg`
      + `?amount=${encodeURIComponent(amount)}&addInfo=${encodeURIComponent(note)}&accountName=${BANK.accountName}`;
  }

  window.EngProPayment = { BANK, transferNote, qrUrl };
})();

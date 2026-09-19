/**
 * EngPro – Thanh toán học phí qua VNPay (cổng thanh toán, phiên bản API 2.1.0)
 *
 * Cấu hình trong .env (đăng ký tài khoản thử nghiệm miễn phí tại https://sandbox.vnpayment.vn/devreg/):
 *   VNP_TMN_CODE=MÃ_WEBSITE           (vnp_TmnCode VNPay gửi qua email)
 *   VNP_HASH_SECRET=CHUỖI_BÍ_MẬT      (vnp_HashSecret)
 *   VNP_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html   (mặc định là môi trường thử nghiệm)
 *
 * Luồng: server tạo đường dẫn thanh toán có chữ ký → học viên thanh toán trên trang VNPay →
 * VNPay chuyển về vnp_ReturnUrl (và gọi IPN khi web chạy trên địa chỉ công khai) → server kiểm tra chữ ký,
 * số tiền rồi kích hoạt khóa học.
 */
const crypto = require('crypto');

const TMN_CODE = process.env.VNP_TMN_CODE || '';
const HASH_SECRET = process.env.VNP_HASH_SECRET || '';
const PAY_URL = process.env.VNP_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

const isConfigured = () => !!(TMN_CODE && HASH_SECRET);

// Thời gian theo múi giờ GMT+7, định dạng yyyyMMddHHmmss
function vnpDate(date) {
  const vn = new Date(date.getTime() + 7 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${vn.getUTCFullYear()}${pad(vn.getUTCMonth() + 1)}${pad(vn.getUTCDate())}`
    + `${pad(vn.getUTCHours())}${pad(vn.getUTCMinutes())}${pad(vn.getUTCSeconds())}`;
}

// Chuỗi ký: tham số xếp theo tên, mã hóa URL (dấu cách thành +), nối bằng &
function signData(params) {
  return Object.keys(params)
    // Giống mã mẫu của VNPay: giữ cả tham số rỗng, chỉ bỏ chính chữ ký
    .filter(key => key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType' && params[key] !== undefined && params[key] !== null)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key])).replace(/%20/g, '+')}`)
    .join('&');
}

const hmac = (data, secret = HASH_SECRET) => crypto.createHmac('sha512', secret).update(Buffer.from(data, 'utf-8')).digest('hex');

// Tên đơn hàng VNPay chỉ nhận chữ không dấu
const ascii = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[^A-Za-z0-9 .,:_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);

function buildPaymentUrl({ txnRef, amount, orderInfo, returnUrl, ipAddr, now = new Date(), expireMinutes = 15 }) {
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: TMN_CODE,
    vnp_Locale: 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: ascii(orderInfo),
    vnp_OrderType: 'other',
    vnp_Amount: Math.round(Number(amount)) * 100, // VNPay tính theo đơn vị nhỏ nhất (x100)
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr && !ipAddr.includes(':') ? ipAddr : '127.0.0.1',
    vnp_CreateDate: vnpDate(now),
    vnp_ExpireDate: vnpDate(new Date(now.getTime() + expireMinutes * 60 * 1000)),
  };
  const data = signData(params);
  return `${PAY_URL}?${data}&vnp_SecureHash=${hmac(data)}`;
}

// Kiểm tra chữ ký của dữ liệu VNPay gửi về (query của Return URL hoặc IPN)
function verify(query) {
  const received = String(query.vnp_SecureHash || '').toLowerCase();
  if (!HASH_SECRET || !received) return false;
  const expected = hmac(signData(query));
  return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

// Ý nghĩa một số mã phản hồi thường gặp (vnp_ResponseCode)
const RESPONSE_MESSAGES = {
  '00': 'Giao dịch thành công',
  '07': 'Giao dịch bị nghi ngờ gian lận',
  '09': 'Thẻ/tài khoản chưa đăng ký dịch vụ Internet Banking',
  '10': 'Xác thực thông tin thẻ/tài khoản không đúng quá 3 lần',
  '11': 'Đã hết thời gian chờ thanh toán',
  '12': 'Thẻ/tài khoản bị khóa',
  '13': 'Nhập sai mật khẩu xác thực giao dịch (OTP)',
  '24': 'Bạn đã hủy giao dịch',
  '51': 'Tài khoản không đủ số dư',
  '65': 'Tài khoản đã vượt quá hạn mức giao dịch trong ngày',
  '75': 'Ngân hàng thanh toán đang bảo trì',
  '79': 'Nhập sai mật khẩu thanh toán quá số lần quy định',
  '99': 'Lỗi không xác định',
};

module.exports = { isConfigured, buildPaymentUrl, verify, signData, hmac, vnpDate, RESPONSE_MESSAGES, PAY_URL };

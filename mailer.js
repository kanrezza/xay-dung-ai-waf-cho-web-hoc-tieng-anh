/**
 * EngPro – Gửi email (mã đặt lại mật khẩu, mã xác nhận email, nhắc hạn nộp bài, tin nhắn liên hệ, chúc mừng hoàn thành khóa học)
 *
 * Cấu hình trong .env, ví dụ với Gmail (cần bật xác minh 2 bước và tạo "Mật khẩu ứng dụng"):
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_USER=tencuaban@gmail.com
 *   SMTP_PASS=mat-khau-ung-dung-16-ky-tu
 *   MAIL_FROM="EngPro <tencuaban@gmail.com>"
 *   CONTACT_EMAIL=hopthu-nhan-lien-he@gmail.com   (không bắt buộc, mặc định là SMTP_USER)
 *
 * Chưa cấu hình SMTP thì email được in ra cửa sổ chạy server để vẫn thử được khi phát triển.
 */
const nodemailer = require('nodemailer');

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, CONTACT_EMAIL,
} = process.env;

const port = Number(SMTP_PORT) || 465;
const transporter = SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NO_REPLY_FOOTER = 'Email tự động từ hệ thống EngPro, vui lòng không trả lời email này.';

// Khung HTML chung cho mọi email
function layout(title, bodyHtml, footer = NO_REPLY_FOOTER) {
  return `<!DOCTYPE html><html lang="vi"><body style="margin:0;background:#f1f4f6;font-family:Arial,Helvetica,sans-serif;color:#181c1e">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
        <tr><td style="background:#002045;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold">EngPro</td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px;font-size:18px;color:#002045">${esc(title)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:14px 24px;background:#f7fafc;color:#74777f;font-size:12px">${esc(footer)}</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function codeBlock(code) {
  return `<p style="margin:18px 0;text-align:center"><span style="display:inline-block;padding:12px 22px;background:#f1f4f6;border-radius:12px;font-size:30px;font-weight:bold;letter-spacing:8px;color:#002045">${esc(code)}</span></p>`;
}

// MAIL_REDIRECT_TO: khi phát triển, chuyển email về một hộp thư thử và ghi rõ người nhận gốc.
// MAIL_REDIRECT_ONLY (danh sách cách nhau dấu phẩy): chỉ chuyển hướng thư gửi tới các địa chỉ này,
// ví dụ các tài khoản mẫu là hộp thư thật của người khác; thư tới địa chỉ khác vẫn gửi thẳng.
// Không đặt MAIL_REDIRECT_ONLY thì mọi thư đều chuyển về MAIL_REDIRECT_TO.
const REDIRECT_TO = (process.env.MAIL_REDIRECT_TO || '').trim();
const REDIRECT_ONLY = (process.env.MAIL_REDIRECT_ONLY || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const redirected = to => REDIRECT_TO && to !== REDIRECT_TO && (!REDIRECT_ONLY.length || REDIRECT_ONLY.includes(String(to).toLowerCase()));
if (REDIRECT_TO) {
  console.warn(REDIRECT_ONLY.length
    ? `📧 Thư gửi tới ${REDIRECT_ONLY.join(', ')} được chuyển về ${REDIRECT_TO}; thư tới địa chỉ khác gửi thẳng.`
    : `📧 Đang ở chế độ thử email: mọi thư đều gửi về ${REDIRECT_TO}. Khi chạy thật cho học viên, xóa MAIL_REDIRECT_TO trong .env.`);
}

async function sendMail({ to, subject, text, html, replyTo }) {
  if (redirected(to)) {
    subject = `[Thử nghiệm, gửi cho ${to}] ${subject}`;
    text = `(Chế độ thử nghiệm: thư này lẽ ra gửi cho ${to})\n\n${text}`;
    to = REDIRECT_TO;
  }
  if (!transporter) {
    console.log(`\n📧 [Email chưa cấu hình SMTP, chỉ in ra đây]\n   Tới: ${to}\n   Tiêu đề: ${subject}\n   ${String(text).replace(/\n/g, '\n   ')}\n`);
    return { logged: true };
  }
  return transporter.sendMail({ from: MAIL_FROM || `EngPro <${SMTP_USER}>`, to, subject, text, html, replyTo });
}

// ── Các mẫu email ─────────────────────────────────────────────
function sendResetCode(to, name, code, minutes) {
  return sendMail({
    to,
    subject: `${code} là mã đặt lại mật khẩu EngPro`,
    text: `Chào ${name},\n\nMã đặt lại mật khẩu của bạn là: ${code}\nMã có hiệu lực trong ${minutes} phút.\n\nNếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này; mật khẩu của bạn vẫn giữ nguyên.`,
    html: layout('Đặt lại mật khẩu', `
      <p style="margin:0 0 8px">Chào ${esc(name)},</p>
      <p style="margin:0">Dùng mã dưới đây để đặt lại mật khẩu tài khoản EngPro. Mã có hiệu lực trong ${minutes} phút.</p>
      ${codeBlock(code)}
      <p style="margin:0;color:#43474e;font-size:13px">Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này; mật khẩu của bạn vẫn giữ nguyên.</p>`),
  });
}

// Mã xác nhận khi đổi mật khẩu trong Cài đặt tài khoản: người đang dùng máy mà không vào được hộp thư thì không đổi được
function sendChangePasswordCode(to, name, code, minutes) {
  return sendMail({
    to,
    subject: `${code} là mã xác nhận đổi mật khẩu EngPro`,
    text: `Chào ${name},\n\nMã xác nhận đổi mật khẩu của bạn là: ${code}\nMã có hiệu lực trong ${minutes} phút. Nhập mã trong mục Đổi mật khẩu ở trang Cài đặt tài khoản.\n\nNếu bạn không yêu cầu đổi mật khẩu, đừng đưa mã này cho ai và hãy đăng xuất các thiết bị lạ trong Cài đặt tài khoản.`,
    html: layout('Xác nhận đổi mật khẩu', `
      <p style="margin:0 0 8px">Chào ${esc(name)},</p>
      <p style="margin:0">Nhập mã dưới đây trong mục Đổi mật khẩu ở trang Cài đặt tài khoản. Mã có hiệu lực trong ${minutes} phút.</p>
      ${codeBlock(code)}
      <p style="margin:0;color:#43474e;font-size:13px">Nếu bạn không yêu cầu đổi mật khẩu, đừng đưa mã này cho ai và hãy đăng xuất các thiết bị lạ trong Cài đặt tài khoản.</p>`),
  });
}
function sendVerifyCode(to, name, code, minutes) {
  return sendMail({
    to,
    subject: `${code} là mã xác nhận email EngPro`,
    text: `Chào ${name},\n\nMã xác nhận email của bạn là: ${code}\nMã có hiệu lực trong ${minutes} phút. Nhập mã trong trang Cài đặt tài khoản để hoàn tất.`,
    html: layout('Xác nhận địa chỉ email', `
      <p style="margin:0 0 8px">Chào ${esc(name)},</p>
      <p style="margin:0">Nhập mã dưới đây trong trang Cài đặt tài khoản để xác nhận email. Mã có hiệu lực trong ${minutes} phút.</p>
      ${codeBlock(code)}
      <p style="margin:0;color:#43474e;font-size:13px">Email đã xác nhận giúp bạn lấy lại tài khoản khi quên mật khẩu.</p>`),
  });
}

function sendPasswordChanged(to, name) {
  const time = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return sendMail({
    to,
    subject: 'Mật khẩu EngPro của bạn vừa được đặt lại',
    text: `Chào ${name},\n\nMật khẩu tài khoản EngPro của bạn vừa được đặt lại lúc ${time}.\nNếu không phải bạn, hãy đặt lại mật khẩu ngay và liên hệ trung tâm.`,
    html: layout('Mật khẩu đã được đặt lại', `
      <p style="margin:0 0 8px">Chào ${esc(name)},</p>
      <p style="margin:0">Mật khẩu tài khoản EngPro của bạn vừa được đặt lại lúc <b>${esc(time)}</b>.</p>
      <p style="margin:12px 0 0;color:#43474e;font-size:13px">Nếu không phải bạn, hãy đặt lại mật khẩu ngay và liên hệ trung tâm.</p>`),
  });
}

// items: [{ test_title, course_title, due_text, left_text, link }]
function sendDeadlineReminder(to, name, items) {
  const lines = items.map(i => `- ${i.test_title} (khóa ${i.course_title}): hạn ${i.due_text}, ${i.left_text}${i.link ? `\n  ${i.link}` : ''}`).join('\n');
  const rows = items.map(i => `
    <tr><td style="padding:10px 0;border-top:1px solid #e5e7eb">
      <p style="margin:0;font-weight:bold;color:#002045">${esc(i.test_title)}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#43474e">Khóa ${esc(i.course_title)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#b45309">Hạn ${esc(i.due_text)} · ${esc(i.left_text)}</p>
      ${i.link ? `<p style="margin:8px 0 0"><a href="${esc(i.link)}" style="display:inline-block;padding:8px 14px;background:#0061a5;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:bold">Làm bài ngay</a></p>` : ''}
    </td></tr>`).join('');
  return sendMail({
    to,
    subject: items.length === 1 ? `Sắp đến hạn nộp: ${items[0].test_title}` : `Bạn có ${items.length} bài sắp đến hạn nộp`,
    text: `Chào ${name},\n\nCác bài kiểm tra sau sắp đến hạn nộp:\n${lines}\n\nQuá hạn bạn vẫn nộp được nhưng bài sẽ được ghi nhận là nộp muộn.\nKhông muốn nhận email này? Tắt trong Cài đặt tài khoản.`,
    html: layout('Sắp đến hạn nộp bài', `
      <p style="margin:0 0 8px">Chào ${esc(name)},</p>
      <p style="margin:0">Các bài kiểm tra sau sắp đến hạn nộp. Quá hạn bạn vẫn nộp được nhưng bài sẽ được ghi nhận là nộp muộn.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${rows}</table>
      <p style="margin:14px 0 0;color:#74777f;font-size:12px">Không muốn nhận email này? Tắt mục "Email nhắc hạn nộp bài" trong Cài đặt tài khoản.</p>`),
  });
}

function sendContactNotice(message) {
  const to = CONTACT_EMAIL || SMTP_USER;
  if (!to) return Promise.resolve({ skipped: true });
  return sendMail({
    to,
    replyTo: message.email,
    subject: `[Liên hệ EngPro] ${message.topicLabel} – ${message.name}`,
    text: `Người gửi: ${message.name} <${message.email}>\nChủ đề: ${message.topicLabel}\n\n${message.message}`,
    html: layout('Tin nhắn liên hệ mới', `
      <p style="margin:0 0 6px"><b>Người gửi:</b> ${esc(message.name)} &lt;${esc(message.email)}&gt;</p>
      <p style="margin:0 0 12px"><b>Chủ đề:</b> ${esc(message.topicLabel)}</p>
      <p style="margin:0;white-space:pre-line;background:#f7fafc;border-radius:12px;padding:12px">${esc(message.message)}</p>`,
      'Bấm Trả lời để phản hồi thẳng cho người gửi. Tin nhắn cũng được lưu ở mục Liên hệ trong trang quản trị để đánh dấu đã xử lý.'),
  });
}

// Báo cho người gửi liên hệ biết trung tâm đã trả lời, kèm nội dung trả lời và tin nhắn gốc
// info: { reply, original, link, hasAccount }
function sendContactReply(to, name, info) {
  return sendMail({
    to,
    subject: 'EngPro đã trả lời tin nhắn của bạn',
    text: `Chào ${name},\n\nTrung tâm EngPro đã trả lời tin nhắn của bạn:\n\n${info.reply}\n\n---\nTin nhắn của bạn: ${info.original}\n\n${info.hasAccount ? `Xem và hỏi thêm tại: ${info.link}` : 'Bạn có thể trả lời thẳng email này nếu cần hỏi thêm.'}`,
    html: layout('Trung tâm đã trả lời tin nhắn của bạn', `
      <p style="margin:0 0 8px">Chào ${esc(name)},</p>
      <p style="margin:0 0 12px">Trung tâm EngPro đã trả lời tin nhắn liên hệ của bạn:</p>
      <p style="margin:0;white-space:pre-line;background:#eef6ff;border-left:4px solid #0061a5;border-radius:8px;padding:12px">${esc(info.reply)}</p>
      <p style="margin:16px 0 4px;font-size:12px;color:#74777f">Tin nhắn bạn đã gửi</p>
      <p style="margin:0;white-space:pre-line;font-size:13px;color:#43474e;background:#f7fafc;border-radius:8px;padding:10px">${esc(info.original)}</p>
      ${info.hasAccount && info.link ? `<p style="margin:16px 0 0"><a href="${esc(info.link)}" style="display:inline-block;padding:10px 16px;background:#0061a5;color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:bold">Xem và hỏi thêm trên EngPro</a></p>` : ''}`,
      info.hasAccount
        ? 'Bạn cũng xem được cuộc trao đổi này ở mục Liên hệ trung tâm trong menu tài khoản.'
        : 'Cần hỏi thêm, bạn trả lời thẳng email này là trung tâm nhận được.'),
  });
}

// Chúc mừng học viên khi giảng viên xác nhận hoàn thành khóa học
// info: { courseTitle, teacherName, lectures, testsPassed, avgScore, resultsLink, reviewLink }
function sendCourseCompleted(to, name, info) {
  const date = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const stats = [
    ['Bài giảng đã học', `${info.lectures}`],
    info.testsPassed !== null ? ['Bài kiểm tra đã đạt', `${info.testsPassed}`] : null,
    info.avgScore !== null ? ['Điểm trung bình', `${info.avgScore}%`] : null,
    ['Ngày hoàn thành', date],
  ].filter(Boolean);
  const statCells = stats.map(([label, value]) => `
    <td style="padding:10px 6px;text-align:center;background:#f1f4f6;border-radius:10px">
      <div style="font-size:18px;font-weight:bold;color:#002045">${esc(value)}</div>
      <div style="font-size:11px;color:#43474e;margin-top:2px">${esc(label)}</div>
    </td>`).join('<td style="width:6px"></td>');
  const button = (href, text, primary) => href ? `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:bold;${primary ? 'background:#0061a5;color:#ffffff' : 'background:#ffffff;color:#0061a5;border:1px solid #0061a5'}">${esc(text)}</a>` : '';
  return sendMail({
    to,
    subject: `Chúc mừng bạn đã hoàn thành khóa ${info.courseTitle}!`,
    text: `Chào ${name},

Chúc mừng bạn đã hoàn thành khóa ${info.courseTitle}. Giảng viên ${info.teacherName} đã xác nhận kết quả học tập của bạn vào ngày ${date}.

Bạn đã học ${info.lectures} bài giảng${info.testsPassed !== null ? `, đạt ${info.testsPassed} bài kiểm tra` : ''}${info.avgScore !== null ? `, điểm trung bình ${info.avgScore}%` : ''}.

Xem lại kết quả: ${info.resultsLink || ''}
Đánh giá khóa học: ${info.reviewLink || ''}`,
    html: layout('Chúc mừng bạn đã hoàn thành khóa học!', `
      <p style="margin:0 0 8px">Chào ${esc(name)},</p>
      <p style="margin:0">Chúc mừng bạn đã hoàn thành khóa <b>${esc(info.courseTitle)}</b>. Giảng viên <b>${esc(info.teacherName)}</b> đã xác nhận kết quả học tập của bạn. Đây là thành quả của cả một chặng kiên trì, cảm ơn bạn đã học cùng EngPro.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr>${statCells}</tr></table>
      <p style="margin:0 0 12px">Bạn có thể xem lại toàn bộ kết quả, và nếu thấy khóa học hữu ích, hãy dành một phút đánh giá để giúp những học viên sau chọn khóa phù hợp.</p>
      <p style="margin:0">${button(info.resultsLink, 'Xem kết quả học tập', true)}${button(info.reviewLink, 'Đánh giá khóa học', false)}</p>
      <p style="margin:16px 0 0;color:#43474e;font-size:13px">Muốn học tiếp? Ghé mục Khóa học để chọn chặng tiếp theo cho mục tiêu của bạn.</p>`),
  });
}

module.exports = {
  isConfigured: () => !!transporter,
  sendMail, sendResetCode, sendVerifyCode, sendChangePasswordCode, sendPasswordChanged, sendContactNotice, sendContactReply, sendDeadlineReminder, sendCourseCompleted,
};

/**
 * EngPro – Hiển thị hạn nộp bài (luôn theo giờ Việt Nam)
 *   EngProDeadline.format(dueAt)    → "Thứ 7, 26/09 lúc 21:00"
 *   EngProDeadline.relative(dueAt)  → "còn 3 ngày" | "còn 5 giờ" | "quá hạn 2 ngày"
 *   EngProDeadline.state(dueAt)     → 'overdue' | 'soon' (dưới 48 giờ) | 'upcoming'
 *   EngProDeadline.WEEKDAYS[1..7]   → "Thứ 2" … "Chủ nhật"
 */
(function () {
  const WEEKDAYS = [null, 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
  const HOUR = 3600 * 1000;
  const TZ = 'Asia/Ho_Chi_Minh';

  function parts(dueAt) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return Object.fromEntries(fmt.formatToParts(new Date(dueAt)).map(p => [p.type, p.value]));
  }

  function format(dueAt) {
    const p = parts(dueAt);
    const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return `${WEEKDAYS[weekday]}, ${p.day}/${p.month} lúc ${p.hour}:${p.minute}`;
  }

  function relative(dueAt, now = Date.now()) {
    const diff = new Date(dueAt).getTime() - now;
    const abs = Math.abs(diff);
    const text = abs >= 24 * HOUR ? `${Math.floor(abs / (24 * HOUR))} ngày`
      : abs >= HOUR ? `${Math.floor(abs / HOUR)} giờ`
      : `${Math.max(1, Math.floor(abs / 60000))} phút`;
    return diff < 0 ? `quá hạn ${text}` : `còn ${text}`;
  }

  function state(dueAt, now = Date.now()) {
    const diff = new Date(dueAt).getTime() - now;
    return diff < 0 ? 'overdue' : diff < 48 * HOUR ? 'soon' : 'upcoming';
  }

  // Lớp màu Tailwind theo trạng thái (chữ và nền nhạt)
  const COLORS = {
    overdue:  { text: 'text-error',     bg: 'bg-red-50',   border: 'border-red-200' },
    soon:     { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    upcoming: { text: 'text-on-surface-variant', bg: 'bg-surface-low', border: 'border-outline-variant/40' },
  };

  window.EngProDeadline = { WEEKDAYS, format, relative, state, COLORS };
})();

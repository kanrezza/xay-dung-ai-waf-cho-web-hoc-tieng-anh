/**
 * EngPro – Âm thanh chúc mừng khi hoàn thành bài giảng hoặc đạt bài kiểm tra
 * Tạo âm bằng Web Audio (không cần file âm thanh). Tôn trọng cài đặt "Âm thanh chúc mừng" của tài khoản.
 *   EngProSound.celebrate()   — phát nếu người dùng đang bật âm thanh
 *   EngProSound.preview()     — phát thử (dùng ở trang cài đặt)
 *   EngProSound.setEnabled(b) — cập nhật cài đặt ngay trên trang hiện tại
 */
(function () {
  let enabledPromise = null;

  function isEnabled() {
    if (!enabledPromise) {
      enabledPromise = fetch('/api/auth/me', { credentials: 'include' })
        .then(res => res.json())
        .then(json => !!json.data && json.data.sound_effects !== 0)
        .catch(() => false);
    }
    return enabledPromise;
  }

  // Hợp âm rải Đô – Mi – Sol – Đô, mỗi nốt ngắn và nhỏ dần
  function play() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (i === notes.length - 1 ? 0.6 : 0.25));
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  }

  async function celebrate() {
    if (await isEnabled()) play();
  }

  window.EngProSound = {
    celebrate,
    preview: play,
    setEnabled: value => { enabledPromise = Promise.resolve(!!value); },
  };
})();

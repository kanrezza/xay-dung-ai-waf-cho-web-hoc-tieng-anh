/**
 * EngPro – Tiện ích media dùng chung cho dashboard giảng viên và admin
 * Kiểm tra file video/audio ngay trên trình duyệt trước khi upload,
 * và upload có hiển thị % tiến trình.
 */
(function () {
  const FALLBACK_CONFIG = {
    video: { max_mb: 500, extensions: ['.mp4', '.webm'] },
    audio: { max_mb: 100, extensions: ['.mp3', '.m4a', '.wav', '.ogg'] },
  };
  let configPromise = null;
  let uploadingCount = 0;

  // Giới hạn dung lượng và định dạng lấy từ server (GET /api/media-config)
  function getConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/media-config', { credentials: 'include' })
        .then(res => res.json())
        .then(json => (json.success ? json.data : FALLBACK_CONFIG))
        .catch(() => FALLBACK_CONFIG);
    }
    return configPromise;
  }

  function fmtSize(bytes) {
    if (!bytes) return '';
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB';
  }

  function fmtDuration(sec) {
    if (!sec) return '';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    const mmss = String(m).padStart(h ? 2 : 1, '0') + ':' + String(s).padStart(2, '0');
    return h ? h + ':' + mmss : mmss;
  }

  // Đọc thời lượng file ngay trên trình duyệt. Trả về null nếu trình duyệt không phát được file
  // (ví dụ video mã hóa HEVC) — khi đó học viên cũng sẽ không xem/nghe được.
  function readDuration(file, kind) {
    return new Promise(resolve => {
      const media = document.createElement(kind);
      const url   = URL.createObjectURL(file);
      let settled = false;
      const done = duration => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(duration);
      };
      const finish = () => { if (Number.isFinite(media.duration) && media.duration > 0) done(media.duration); };
      media.preload = 'metadata';
      media.muted = true;
      media.onloadedmetadata = () => {
        // File quay màn hình/ghi âm thường không ghi thời lượng (Infinity):
        // tua tới cuối để trình duyệt tự tính ra thời lượng thật
        if (media.duration === Infinity) media.currentTime = Number.MAX_SAFE_INTEGER;
        else done(media.duration > 0 ? media.duration : null);
      };
      media.ondurationchange = finish;
      media.ontimeupdate = finish;
      media.onerror = () => done(null);
      setTimeout(() => done(null), 15000);
      media.src = url;
    });
  }

  // Kiểm tra file trước khi upload. kind: 'video' | 'audio'. Trả về { file, duration } hoặc { file, error }
  async function inspect(file, kind) {
    const cfg = (await getConfig())[kind];
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    if (!cfg.extensions.includes(ext)) {
      return { file, error: `Chỉ chấp nhận ${kind} ${cfg.extensions.join(', ')}` };
    }
    if (file.size > cfg.max_mb * 1024 * 1024) {
      return { file, error: `File nặng ${fmtSize(file.size)}, vượt quá giới hạn ${cfg.max_mb} MB` };
    }
    const duration = await readDuration(file, kind);
    if (!duration) {
      return {
        file,
        error: kind === 'video'
          ? 'Trình duyệt không đọc được video này. Hãy xuất lại video dạng MP4 (H.264).'
          : 'Trình duyệt không đọc được file audio này. Hãy chuyển sang MP3.',
      };
    }
    return { file, duration };
  }

  // Upload bằng XMLHttpRequest để có % tiến trình (fetch không báo tiến trình upload)
  function upload(url, field, file, durationSec, onProgress) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      if (durationSec) form.append('duration_seconds', Math.round(durationSec)); // field phải đứng trước file
      form.append(field, file);
      const xhr = new XMLHttpRequest();
      const finish = () => { uploadingCount--; };
      xhr.open('POST', url);
      xhr.withCredentials = true;
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = () => {
        finish();
        let json = null;
        try { json = JSON.parse(xhr.responseText); } catch {}
        if (json?.success) resolve(json.data);
        else reject(new Error(json?.message || 'Upload thất bại (mã ' + xhr.status + ')'));
      };
      xhr.onerror = () => { finish(); reject(new Error('Mất kết nối khi đang tải file lên')); };
      uploadingCount++;
      xhr.send(form);
    });
  }

  window.addEventListener('beforeunload', e => {
    if (uploadingCount > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  window.EngProMedia = { getConfig, fmtSize, fmtDuration, readDuration, inspect, upload };
})();

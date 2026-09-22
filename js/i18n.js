/**
 * EngPro – Chuyển ngôn ngữ giao diện (tiếng Việt / English)
 *
 * Các trang viết sẵn bằng tiếng Việt. Khi người dùng chọn English, file này thay chữ tiếng Việt
 * trên trang bằng bản dịch trong js/i18n-en.js, kể cả chữ do JavaScript thêm vào sau (danh sách
 * khóa học, thông báo, hộp thoại alert/confirm...). Chuyển về tiếng Việt thì tải lại trang.
 *
 * Cách dùng: đặt hai thẻ script ĐỒNG BỘ trong <head> để dịch trước khi trang hiện ra
 *   <script src="../js/i18n-en.js"></script>
 *   <script src="../js/i18n.js"></script>
 * Chỗ nào cần nút đổi ngôn ngữ thì thêm <div data-lang-switch></div>; chân trang (footer) tự có sẵn.
 * Phần tử có translate="no" (tên người, bài viết, tin nhắn...) được giữ nguyên.
 *
 * Ngôn ngữ lưu trong localStorage của trình duyệt. Người đã đăng nhập thì lưu thêm vào tài khoản
 * (cột users.ui_language) để đăng nhập máy khác vẫn giữ. Ngôn ngữ trợ lý AI trả lời là cài đặt riêng
 * (users.ai_language), chỉnh trong Cài đặt tài khoản.
 */
(function () {
  const STORAGE_KEY = 'engpro_lang';
  const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'svg', 'SVG', 'IFRAME']);
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  // Trang chưa có bản dịch (bảng điều khiển giảng viên, admin) đặt <html data-i18n="off"> để luôn hiện tiếng Việt
  const pageOff = document.documentElement.dataset.i18n === 'off';
  let lang = stored === 'en' && !pageOff ? 'en' : 'vi';
  document.documentElement.lang = lang;

  // ── Từ điển ─────────────────────────────────────────────────
  // text:   'chữ tiếng Việt' → 'English'. Khóa có {0}, {1}... là mẫu cho chữ ghép số liệu, ví dụ '{0} phút' → '{0} min'.
  // blocks: câu bị thẻ <a>, <strong>, <br>... chia thành nhiều đoạn. Khóa là các đoạn chữ nối bằng ' | ',
  //         giá trị là mảng bản dịch cho từng đoạn theo đúng thứ tự, thẻ HTML giữ nguyên vị trí.
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const dict = window.ENGPRO_I18N_EN || {};
  const TEXT = new Map();
  const PATTERNS = [];
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // {0} chỉ khớp con số (3, 1.490.000, 20:00, 27/9) để mẫu ngắn như '{0} từ' không dịch nhầm chữ của người dùng
  // ("chia động từ"); {*0} khớp chữ bất kỳ, dùng cho tên khóa học, ngày trong tuần, email...
  const PLACEHOLDER = /^\{\*?\d\}$/;
  for (const [vi, en] of Object.entries(dict.text || {})) {
    const key = norm(vi);
    if (!/\{\*?\d\}/.test(key)) { TEXT.set(key, en); continue; }
    const parts = key.split(/(\{\*?\d\})/);
    PATTERNS.push({
      re: new RegExp('^' + parts.map(p => (!PLACEHOLDER.test(p) ? escapeRe(p) : p[1] === '*' ? '(.+?)' : '(\\d[\\d.,:/]*)')).join('') + '$'),
      order: parts.filter(p => PLACEHOLDER.test(p)).map(p => Number(p.replace(/\D/g, ''))),
      en,
      weight: key.replace(/\{\*?\d\}/g, '').length,   // mẫu nhiều chữ cố định hơn thì thử trước
    });
  }
  PATTERNS.sort((a, b) => b.weight - a.weight);
  const BLOCKS = new Map(Object.entries(dict.blocks || {}).map(([k, v]) => [k.split('|').map(norm).join(' | '), v]));

  function translate(text) {
    const key = norm(text);
    if (!key) return null;
    if (TEXT.has(key)) return TEXT.get(key);   // có cả chữ không dấu như "Nghe"
    if (!VI.test(key)) return null;
    for (const p of PATTERNS) {
      const m = key.match(p.re);
      if (!m) continue;
      return p.en.replace(/\{(\d)\}/g, (_, n) => {
        const value = m[p.order.indexOf(Number(n)) + 1] ?? '';
        return TEXT.has(norm(value)) ? TEXT.get(norm(value)) : (translate(value) ?? value);
      });
    }
    return null;
  }

  // Thông báo nhiều dòng (alert, confirm): dịch cả câu, không được thì dịch từng dòng
  function translateMessage(message) {
    if (lang !== 'en' || typeof message !== 'string') return message;
    const whole = translate(message);
    if (whole !== null) return whole;
    return message.split('\n').map(line => translate(line) ?? line).join('\n');
  }

  // ── Dịch trên trang ─────────────────────────────────────────
  const isIcon = el => el.classList?.contains('material-symbols-outlined') || el.classList?.contains('material-icons');
  const isSkipped = el => SKIP_TAGS.has(el.tagName) || isIcon(el) || el.getAttribute('translate') === 'no' || el.isContentEditable;
  const insideSkipped = node => {
    for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
      if (isSkipped(el)) return true;
    }
    return false;
  };

  // Nhớ chữ do chính file này viết vào để không dịch lại lần nữa (tránh vòng lặp khi bản dịch trùng chữ gốc,
  // ví dụ 'Listening'); trang tự đổi chữ khác đi thì vẫn dịch như thường
  const written = new WeakMap();
  const writtenAttrs = new WeakMap();

  function setText(node, en) {
    const value = node.nodeValue;
    const next = value.match(/^\s*/)[0] + en + value.match(/\s*$/)[0];
    written.set(node, next);
    if (next !== value) node.nodeValue = next;
  }

  function translateTextNode(node) {
    if (written.get(node) === node.nodeValue) return;
    const en = translate(node.nodeValue);
    if (en !== null) setText(node, en);
  }

  function translateAttrs(el) {
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (!value || writtenAttrs.get(el)?.[name] === value) continue;
      const en = translate(value);
      if (en === null) continue;
      writtenAttrs.set(el, { ...writtenAttrs.get(el), [name]: en });
      if (en !== value) el.setAttribute(name, en);
    }
  }

  // Các đoạn chữ của một câu có thẻ HTML xen giữa (bỏ qua biểu tượng)
  function segments(el) {
    const nodes = [];
    const walk = parent => {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) { if (child.nodeValue.trim()) nodes.push(child); }
        else if (child.nodeType === 1 && !isSkipped(child)) walk(child);
      }
    };
    walk(el);
    return nodes;
  }

  function hasMixedContent(el) {
    let text = false;
    let element = false;
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.nodeValue.trim()) text = true;
      else if (child.nodeType === 1 && !isIcon(child)) element = true;
    }
    return text && element;
  }

  function translateBlock(el) {
    const nodes = segments(el);
    const parts = BLOCKS.get(nodes.map(n => norm(n.nodeValue)).join(' | '));
    if (!parts || parts.length !== nodes.length) return false;
    nodes.forEach((node, i) => setText(node, parts[i]));
    return true;
  }

  function translateElement(el) {
    // Ô nhập văn bản: giữ nguyên chữ người dùng gõ, chỉ dịch placeholder và title
    if (el.tagName === 'TEXTAREA') { if (el.getAttribute('translate') !== 'no') translateAttrs(el); return; }
    if (isSkipped(el)) return;
    translateAttrs(el);
    if (hasMixedContent(el) && translateBlock(el)) return;
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 3) translateTextNode(child);
      else if (child.nodeType === 1) translateElement(child);
    }
  }

  function handleMutations(records) {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) { if (!insideSkipped(node.parentElement || node)) translateElement(node); }
          else if (node.nodeType === 3 && node.nodeValue.trim() && !insideSkipped(node)) {
            // Chữ thêm vào giữa một câu có thẻ HTML: thử dịch cả câu trước
            const parent = node.parentElement;
            if (!(parent && hasMixedContent(parent) && translateBlock(parent))) translateTextNode(node);
          }
        }
      } else if (record.type === 'characterData') {
        if (record.target.nodeValue.trim() && !insideSkipped(record.target)) translateTextNode(record.target);
      } else if (record.type === 'attributes') {
        const el = record.target;
        if (el.getAttribute('translate') !== 'no' && !(el.parentElement && insideSkipped(el.parentElement))
            && (el.tagName === 'TEXTAREA' || !isSkipped(el))) translateAttrs(el);
      }
    }
  }

  let observer = null;
  function startTranslating() {
    if (observer) return;
    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS,
    });
    translateElement(document.documentElement);
    // Lượt quét cuối khi trang tải xong: các câu nhiều đoạn có thể được trình duyệt dựng thành nhiều đợt
    const finish = () => translateElement(document.body || document.documentElement);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', finish, { once: true });
    else finish();
  }

  // alert / confirm / prompt dùng chung từ điển
  for (const name of ['alert', 'confirm', 'prompt']) {
    const original = window[name];
    if (typeof original !== 'function') continue;
    window[name] = function (message, ...rest) { return original.call(window, translateMessage(message), ...rest); };
  }

  // ── Đổi ngôn ngữ ────────────────────────────────────────────
  function saveToAccount(next) {
    return fetch('/api/user/settings', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui_language: next }),
    }).catch(() => {});
  }

  async function setLang(next, { persist = true } = {}) {
    if (next !== 'vi' && next !== 'en') return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    stored = next;
    if (persist) await saveToAccount(next);   // chưa đăng nhập thì máy chủ trả 401, bỏ qua
    if (next === lang) return;
    if (next === 'en') {   // dịch ngay trên trang, không cần tải lại
      lang = 'en';
      document.documentElement.lang = 'en';
      renderSwitchers();
      startTranslating();
    } else {
      location.reload();   // chữ gốc tiếng Việt chỉ lấy lại được bằng cách tải lại trang
    }
  }

  // Gọi sau khi biết người dùng đã đăng nhập (truyền users.ui_language). Máy này chưa từng chọn ngôn ngữ
  // thì theo tài khoản; đã chọn rồi thì ghi lựa chọn đó vào tài khoản.
  function syncAccount(accountLang) {
    if (accountLang !== 'vi' && accountLang !== 'en') return;
    if (stored === null) { if (accountLang === 'en') setLang('en', { persist: false }); }
    else if (stored !== accountLang) saveToAccount(stored);
  }

  // ── Nút đổi ngôn ngữ ────────────────────────────────────────
  function switcherHtml() {
    const option = (code, label) => code === lang
      ? `<span class="font-bold underline underline-offset-4" aria-current="true">${label}</span>`
      : `<button type="button" data-set-lang="${code}" class="hover:underline underline-offset-4 opacity-80 hover:opacity-100">${label}</button>`;
    return `<span class="material-symbols-outlined text-base" aria-hidden="true">language</span>`
      + option('vi', 'Tiếng Việt') + '<span aria-hidden="true" class="opacity-50">|</span>' + option('en', 'English');
  }

  function renderSwitchers() {
    // Chân trang của các trang công khai: thêm vào dòng bản quyền
    const footer = document.querySelector('footer');
    if (footer && !footer.querySelector('[data-lang-switch]')) {
      const row = footer.lastElementChild?.lastElementChild || footer;
      const line = document.createElement('div');
      line.className = 'mt-3';
      const holder = document.createElement('span');
      holder.dataset.langSwitch = 'footer';
      line.appendChild(holder);
      row.appendChild(line);
    }
    document.querySelectorAll('[data-lang-switch]').forEach(el => {
      el.setAttribute('translate', 'no');
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', lang === 'en' ? 'Language' : 'Ngôn ngữ');
      el.classList.add('inline-flex', 'items-center', 'gap-2', 'text-xs');
      el.innerHTML = switcherHtml();
    });
  }

  document.addEventListener('click', e => {
    const button = e.target.closest('[data-set-lang]');
    if (button) setLang(button.dataset.setLang);
  });

  window.EngProI18n = {
    get lang() { return lang; },
    setLang, syncAccount, translate: text => (lang === 'en' ? translate(text) ?? text : text),
    // Dò chữ tiếng Việt còn sót trên trang (dùng khi bổ sung từ điển): trả về các đoạn và các câu nhiều đoạn chưa dịch
    missing() {
      const texts = new Set();
      const blocks = new Set();
      const walk = el => {
        if (el.tagName === 'TEXTAREA') { const v = el.getAttribute('placeholder'); if (v && VI.test(v)) texts.add(`[placeholder] ${norm(v)}`); return; }
        if (isSkipped(el)) return;
        if (hasMixedContent(el)) {
          const nodes = segments(el);
          if (nodes.some(n => VI.test(n.nodeValue))) blocks.add(nodes.map(n => norm(n.nodeValue)).join(' | '));
        }
        for (const child of el.childNodes) {
          if (child.nodeType === 3 && VI.test(child.nodeValue)) texts.add(norm(child.nodeValue));
          else if (child.nodeType === 1) walk(child);
        }
        for (const name of ATTRS) { const v = el.getAttribute(name); if (v && VI.test(v)) texts.add(`[${name}] ${norm(v)}`); }
      };
      walk(document.documentElement);
      return { texts: [...texts], blocks: [...blocks] };
    },
  };

  if (lang === 'en') startTranslating();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderSwitchers, { once: true });
  else renderSwitchers();
})();

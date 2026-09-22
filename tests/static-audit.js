// Rà tĩnh giao diện: lỗi cú pháp JS, link tới trang .html không tồn tại, gọi API mà máy chủ không có,
// getElementById tới id không có trong trang. Chạy: node tests/static-audit.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pages = ['index.html', ...fs.readdirSync(path.join(ROOT, 'pages')).filter(f => f.endsWith('.html')).map(f => 'pages/' + f)];
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
const server = read('server.js');
const problems = [];

// Route máy chủ, đổi :tham_số và ${...} thành mẫu để so khớp
const routes = [];
for (const m of server.matchAll(/app\.(get|post|put|delete|patch)\(\s*['`]([^'`]+)['`]/g)) routes.push(m[2]);
for (const m of server.matchAll(/app\.route\(\s*'([^']+)'\s*\)/g)) routes.push(m[1]);
for (const m of server.matchAll(/register(?:TestContent|Take)Routes\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) {
  const base = m[1].startsWith('/') ? m[1] : m[2];
  for (const sub of ['', '/:id', '/:id/start', '/:id/submit', '/content', '/sections', '/sections/:sid', '/sections/:sid/audio',
    '/questions', '/questions/import-template', '/questions/import-file', '/questions/generate', '/questions/bulk']) routes.push(base + sub);
}
const routeRe = routes.map(r => new RegExp('^' + r.replace(/\$\{[^}]+\}/g, '[^/]+').replace(/:[a-zA-Z_]+/g, '[^/]+').replace(/\//g, '\\/') + '$'));
const apiExists = p => routeRe.some(re => re.test(p));

function checkJsSyntax(code, where) {
  try { new Function(code); } catch (e) { problems.push(`${where}: lỗi cú pháp JS: ${e.message}`); }
}

function checkApiCalls(code, where) {
  for (const m of code.matchAll(/['"`](\/api\/[^'"`?\s]*)/g)) {
    let p = m[1].replace(/\$\{[^}]+\}/g, 'X').replace(/\/$/, '');
    if (!p || p.endsWith('/X') === false && /\/$/.test(m[1])) continue;
    if (!apiExists(p) && !apiExists(p + '/X') && !routes.some(r => r.startsWith(p + '/'))) problems.push(`${where}: gọi API không có trên máy chủ: ${m[1]}`);
  }
}

for (const f of pages) {
  const html = read(f);
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.forEach((code, i) => checkJsSyntax(code, `${f} (script ${i + 1})`));
  const allCode = scripts.join('\n');
  checkApiCalls(allCode, f);
  // Link tới trang .html trong cùng site
  for (const m of html.matchAll(/href="([^"#?]+\.html)(?:[?#][^"]*)?"/g)) {
    if (/^(https?:|mailto:)/.test(m[1]) || m[1].includes('${')) continue;
    const target = path.normalize(path.join(path.dirname(f), m[1]));
    if (!fs.existsSync(path.join(ROOT, target))) problems.push(`${f}: link hỏng tới ${m[1]}`);
  }
  // Script và file tĩnh cục bộ
  for (const m of html.matchAll(/src="([^"]+)"/g)) {
    const src = m[1].split('?')[0];
    if (/^(https?:|data:|\/api\/|\/uploads\/)/.test(src) || src.includes('${')) continue;
    const target = src.startsWith('/') ? src.slice(1) : path.normalize(path.join(path.dirname(f), src));
    if (!fs.existsSync(path.join(ROOT, target))) problems.push(`${f}: file không tồn tại: ${m[1]}`);
  }
  // getElementById tới id không có: tìm id trong HTML, trong chuỗi mẫu của JS và id do JS gán
  const ids = new Set([...html.matchAll(/\bid=["'`]([^"'`$]+)["'`]/g)].map(m => m[1]));
  for (const m of allCode.matchAll(/\.id\s*=\s*['"`]([^'"`]+)['"`]/g)) ids.add(m[1]);
  const idPrefixes = [...html.matchAll(/\bid=["'`]([^"'`$]*)\$\{/g)].map(m => m[1]);
  for (const m of allCode.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!ids.has(m[1]) && !idPrefixes.some(p => p && m[1].startsWith(p))) problems.push(`${f}: getElementById('${m[1]}') không có phần tử nào mang id này`);
  }
}
for (const f of jsFiles) {
  const code = read(f);
  checkJsSyntax(code, f);
  checkApiCalls(code, f);
}

console.log(`Đã rà ${pages.length} trang, ${jsFiles.length} file JS, ${routes.length} route máy chủ.`);
if (!problems.length) console.log('Không thấy vấn đề nào.');
else { console.log(`${problems.length} vấn đề:`); [...new Set(problems)].forEach(p => console.log(' -', p)); }

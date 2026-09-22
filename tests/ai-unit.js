// Kiểm thử cơ chế đổi model dự phòng của ai.js bằng thư viện Gemini giả, không gọi mạng
const ROOT = require('path').join(__dirname, '..');
const genaiPath = require.resolve('@google/genai', { paths: [ROOT] });

let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

let calls = [];           // các lần gọi: { model, apiKey }
let quotaExhausted = [];  // model nào đang báo hết lượt
let retrySeconds = 12;    // Google bảo chờ bao lâu
let serverBusy = [];      // model nào đang quá tải phía máy chủ Google (lỗi 500/503)

function installFakeSdk() {
  const exports = {
    GoogleGenAI: class {
      constructor({ apiKey }) { this.apiKey = apiKey; }
      get interactions() {
        const self = this;
        return {
          async create({ model }) {
            calls.push({ model, apiKey: self.apiKey });
            if (serverBusy.includes(model)) {
              const e = new Error('This model is currently experiencing high demand. Please try again later.');
              e.status = model.includes('lite') ? 503 : 500;
              throw e;
            }
            if (quotaExhausted.includes(model)) {
              const e = new Error(`429 You exceeded your current quota. Please retry in ${retrySeconds}s.`);
              e.status = 429;
              throw e;
            }
            return {
              status: 'completed',
              output_text: JSON.stringify({ tra_loi: 'trả lời từ ' + model }),
              usage: { total_input_tokens: 10, total_output_tokens: 20 },
            };
          },
        };
      }
    },
  };
  require.cache[genaiPath] = { id: genaiPath, filename: genaiPath, loaded: true, exports };
}

function loadAi(env) {
  Object.assign(process.env, env);
  delete require.cache[require.resolve(ROOT + '/ai.js')];
  installFakeSdk();
  return require(ROOT + '/ai.js');
}

const ask = ai => ai.generateJson({
  system: 'x', prompt: 'y',
  schema: { type: 'object', properties: { tra_loi: { type: 'string' } }, required: ['tra_loi'] },
});

(async () => {
  console.log('\n[Model chính còn lượt]');
  calls = []; quotaExhausted = [];
  let ai = loadAi({ GEMINI_API_KEY: 'key1', GEMINI_API_KEYS: '', GEMINI_MODEL: 'gemini-3.6-flash', GEMINI_MODEL_FALLBACKS: 'gemini-3.1-flash-lite,gemini-3.5-flash', AI_PROVIDER: '' });
  let r = await ask(ai);
  check('gọi đúng model chính, không đụng tới model dự phòng', r.model === 'gemini-3.6-flash' && calls.length === 1, calls);

  console.log('\n[Model chính hết lượt]');
  calls = []; quotaExhausted = ['gemini-3.6-flash'];
  r = await ask(ai);
  check('tự xuống model dự phòng thứ nhất', r.model === 'gemini-3.1-flash-lite' && calls.length === 2, calls);
  check('kết quả vẫn đúng định dạng JSON', r.data.tra_loi === 'trả lời từ gemini-3.1-flash-lite', r.data);

  console.log('\n[Hai model đầu đều hết lượt]');
  calls = []; quotaExhausted = ['gemini-3.6-flash', 'gemini-3.1-flash-lite'];
  r = await ask(ai);
  check('xuống tiếp model dự phòng thứ hai', r.model === 'gemini-3.5-flash' && calls.length === 3, calls.map(c => c.model));

  console.log('\n[Mọi model đều hết lượt, Google báo chờ 12 giây]');
  calls = []; quotaExhausted = ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash']; retrySeconds = 12;
  let t = Date.now();
  try {
    await ask(ai);
    check('phải báo lỗi', false);
  } catch (e) {
    const waited = (Date.now() - t) / 1000;
    check('có chờ rồi thử lại model chính một lần', waited >= 12 && calls.length === 4, { waited: waited.toFixed(1), calls: calls.length });
    check('báo lỗi quota kèm số giây cần chờ', e.code === 'quota' && /12|13 giây/.test(e.message), e.message);
  }

  console.log('\n[Chờ quá lâu thì không bắt người dùng đợi]');
  calls = []; retrySeconds = 90;
  t = Date.now();
  try { await ask(ai); } catch (e) {
    check('trả lời ngay, không chờ 90 giây', (Date.now() - t) / 1000 < 3 && calls.length === 3, calls.length);
    check('thông báo nói rõ thử lại sau khoảng 91 giây', /91 giây/.test(e.message), e.message);
  }

  console.log('\n[Máy chủ Google quá tải ở model chính, lỗi 500 "high demand"]');
  calls = []; quotaExhausted = []; serverBusy = ['gemini-3.6-flash'];
  r = await ask(ai);
  check('tự chuyển sang model dự phòng thay vì báo lỗi', r.model === 'gemini-3.1-flash-lite' && calls.length === 2, calls.map(c => c.model));

  console.log('\n[Mọi model đều quá tải phía Google]');
  calls = []; serverBusy = ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
  t = Date.now();
  try { await ask(ai); check('phải báo lỗi', false); } catch (e) {
    const waited = (Date.now() - t) / 1000;
    check('chờ khoảng 2 giây rồi thử lại model chính một lần', waited >= 2 && waited < 5 && calls.length === 4, { waited: waited.toFixed(1), calls: calls.length });
    check('báo máy chủ AI đang quá tải, mã 503', e.code === 'unavailable' && e.status === 503 && /quá tải/.test(e.message), { code: e.code, status: e.status, msg: e.message });
  }

  console.log('\n[Hết quá tải sau khi chờ]');
  calls = []; serverBusy = ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
  setTimeout(() => { serverBusy = []; }, 500);
  r = await ask(ai);
  check('lần thử lại sau 2 giây thành công bằng model chính', r.model === 'gemini-3.6-flash' && calls.length === 4, calls.map(c => c.model));

  console.log('\n[Model chính quá tải, model dự phòng hết lượt trong phút]');
  calls = []; serverBusy = ['gemini-3.6-flash']; quotaExhausted = ['gemini-3.1-flash-lite', 'gemini-3.5-flash']; retrySeconds = 4;
  t = Date.now();
  try { await ask(ai); } catch (e) {
    check('chờ theo số giây Google báo (4 giây) chứ không chỉ 2 giây', (Date.now() - t) / 1000 >= 4 && calls.length === 4, { waited: ((Date.now() - t) / 1000).toFixed(1) });
  }
  serverBusy = []; retrySeconds = 90;   // trả lại như ca trước để ca nhiều key không phải chờ

  console.log('\n[Nhiều key của các project khác nhau]');
  calls = []; quotaExhausted = ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
  ai = loadAi({ GEMINI_API_KEY: 'key1', GEMINI_API_KEYS: 'key2', GEMINI_MODEL: 'gemini-3.6-flash', GEMINI_MODEL_FALLBACKS: 'gemini-3.1-flash-lite' });
  try { await ask(ai); } catch {}
  check('thử đủ 2 key, mỗi key 2 model', calls.length === 4 && new Set(calls.map(c => c.apiKey)).size === 2, calls);
  calls = []; quotaExhausted = ['gemini-3.6-flash'];
  r = await ask(ai);
  check('key thứ hai vẫn dùng được model dự phòng khi key đầu bị chặn', r.model === 'gemini-3.1-flash-lite', calls);
  calls = []; quotaExhausted = []; serverBusy = ['gemini-3.6-flash', 'gemini-3.1-flash-lite'];
  try { await ask(ai); } catch {}
  check('model quá tải phía Google thì không gọi lại bằng key khác (2 lượt + 1 lần thử lại)', calls.length === 3, calls);
  serverBusy = [];

  console.log('\n[Model trả lời sai định dạng]');
  calls = []; quotaExhausted = [];
  const badPath = require.resolve(ROOT + '/ai.js');
  delete require.cache[badPath];
  require.cache[genaiPath] = { id: genaiPath, filename: genaiPath, loaded: true, exports: {
    GoogleGenAI: class {
      constructor({ apiKey }) { this.apiKey = apiKey; }
      get interactions() {
        return { async create({ model }) {
          calls.push({ model });
          return model === 'gemini-3.6-flash'
            ? { status: 'completed', output_text: 'đây là văn bản thường, không phải JSON', usage: {} }
            : { status: 'completed', output_text: '```json\n{"tra_loi":"ok"}\n```', usage: {} };
        } };
      }
    },
  } };
  ai = require(ROOT + '/ai.js');
  r = await ask(ai);
  check('model trả lời không phải JSON → tự thử model kế tiếp', r.model === 'gemini-3.1-flash-lite' && calls.length === 2, calls.map(c => c.model));
  check('đọc được JSON bị bọc trong khối mã ```json', r.data.tra_loi === 'ok', r.data);

  console.log('\n[Hàng đợi khi nhiều người bấm cùng lúc]');
  calls = []; quotaExhausted = [];
  let concurrent = 0, peak = 0;
  require.cache[genaiPath] = { id: genaiPath, filename: genaiPath, loaded: true, exports: {
    GoogleGenAI: class {
      constructor({ apiKey }) { this.apiKey = apiKey; }
      get interactions() {
        return { async create({ model }) {
          concurrent++; peak = Math.max(peak, concurrent);
          await new Promise(r => setTimeout(r, 60));
          concurrent--;
          return { status: 'completed', output_text: JSON.stringify({ tra_loi: 'ok' }), usage: {} };
        } };
      }
    },
  } };
  delete require.cache[require.resolve(ROOT + '/ai.js')];
  process.env.AI_MAX_CONCURRENT = '3';
  process.env.AI_QUEUE_MAX = '5';
  ai = require(ROOT + '/ai.js');
  let results = await Promise.allSettled(Array.from({ length: 8 }, () => ask(ai)));
  check('8 người bấm cùng lúc: tối đa 3 lượt chạy song song', peak === 3, { peak });
  check('3 lượt chạy + 5 lượt xếp hàng đều xong', results.filter(r => r.status === 'fulfilled').length === 8, results.map(r => r.status));
  check('hàng đợi trống sau khi xong', ai.queueStatus().running === 0 && ai.queueStatus().waiting === 0, ai.queueStatus());
  results = await Promise.allSettled(Array.from({ length: 12 }, () => ask(ai)));
  const busy = results.filter(r => r.status === 'rejected' && r.reason.code === 'busy');
  check('quá đông thì báo bận thay vì chờ mãi', busy.length === 4 && busy[0].reason.status === 429, { busy: busy.length });

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
})();

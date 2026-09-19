/**
 * EngPro – Gọi mô hình AI (Google Gemini qua thư viện chính thức @google/genai)
 *
 * Cấu hình trong .env (tạo key miễn phí tại https://aistudio.google.com/apikey):
 *   GEMINI_API_KEY=...                 bắt buộc để bật AI
 *   GEMINI_API_KEYS=key1,key2          tùy chọn: nhiều key của các project khác nhau, hết lượt key này thì xoay sang key kia
 *   GEMINI_MODEL=gemini-3.6-flash      tùy chọn, model chính
 *   GEMINI_MODEL_FALLBACKS=a,b         tùy chọn: model dự phòng khi model chính báo quá tải
 *   AI_MAX_CONCURRENT=4                tùy chọn: số lượt gọi Google chạy song song tối đa
 *   AI_QUEUE_MAX=20                    tùy chọn: số lượt được xếp hàng chờ, quá số này thì báo bận
 *   AI_PROVIDER=mock                   chỉ dùng khi chạy thử hoặc kiểm thử tự động: trả dữ liệu mẫu, không gọi Google
 *
 * Gói miễn phí giới hạn số lượt mỗi phút cho TỪNG model, nên khi model chính báo 429 thì
 * hàm gọi tự chuyển sang model dự phòng, rồi mới chờ đúng số giây Google báo và thử lại một lần.
 * Khi máy chủ Google quá tải ở một model (lỗi 500 đến 504, thường kèm câu "high demand")
 * thì cũng chuyển sang model dự phòng, nếu model nào cũng vậy thì chờ 2 giây rồi thử lại một lần.
 *
 * Mọi tính năng AI đều yêu cầu mô hình trả về JSON theo schema, rồi server kiểm tra lại từng trường
 * trước khi lưu hay hiển thị, nên nội dung AI không bao giờ được chèn thẳng vào trang.
 */
const { GoogleGenAI } = require('@google/genai');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MOCK = process.env.AI_PROVIDER === 'mock';
const REQUEST_TIMEOUT_MS = 90 * 1000;
const THINKING_LEVELS = ['low', 'medium', 'high'];
const MAX_WAIT_MS = 25 * 1000;   // chờ tối đa bấy nhiêu rồi thử lại, lâu hơn thì báo người dùng thử lại sau
const SERVER_RETRY_MS = 2000;    // lỗi phía máy chủ Google thường qua nhanh nên chỉ chờ ngắn
// Máy chủ Google quá tải hoặc trục trặc tạm thời ở model đó, đổi model khác thường qua được
const isServerBusy = e => e.status >= 500 && e.status <= 504;

const splitList = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean);
// Model chính rồi tới các model dự phòng, bỏ trùng
// Chỉ dùng model dòng 3.x làm dự phòng: dòng 2.5 bỏ qua schema JSON nên trả về văn bản thường
const models = () => [...new Set([MODEL, ...splitList(process.env.GEMINI_MODEL_FALLBACKS
  || 'gemini-3.1-flash-lite,gemini-3.5-flash')])];
const apiKeys = () => {
  const keys = splitList(process.env.GEMINI_API_KEYS);
  if (process.env.GEMINI_API_KEY) keys.unshift(process.env.GEMINI_API_KEY.trim());
  return [...new Set(keys)];
};

const clients = new Map();
let keyIndex = 0;   // xoay vòng key để chia đều lượt giữa các project

// Hàng đợi: nhiều người bấm cùng lúc thì chỉ cho vài lượt gọi Google chạy song song,
// phần còn lại xếp hàng. Nhờ vậy không bắn hàng loạt yêu cầu để rồi cùng dính lỗi quá tải.
const MAX_CONCURRENT = Math.max(1, Number(process.env.AI_MAX_CONCURRENT) || 4);
const QUEUE_MAX = Math.max(0, Number(process.env.AI_QUEUE_MAX) || 20);
let running = 0;
const waiting = [];

function acquireSlot() {
  if (running < MAX_CONCURRENT) { running++; return Promise.resolve(); }
  if (waiting.length >= QUEUE_MAX) {
    return Promise.reject(new AiError('busy', 'Trợ lý AI đang phục vụ nhiều người cùng lúc, bạn thử lại sau khoảng một phút nhé.', 429));
  }
  return new Promise(resolve => waiting.push(resolve));
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) next();        // nhường chỗ cho người đang xếp hàng
  else running = Math.max(0, running - 1);
}

const queueStatus = () => ({ running, waiting: waiting.length, max_concurrent: MAX_CONCURRENT });

class AiError extends Error {
  // code: not_configured | invalid_key | quota | blocked | incomplete | bad_output | unavailable
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const isConfigured = () => MOCK || apiKeys().length > 0;
const modelName = () => (MOCK ? 'mock' : MODEL);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getClient(apiKey) {
  if (!clients.has(apiKey)) clients.set(apiKey, new GoogleGenAI({ apiKey }));
  return clients.get(apiKey);
}

// Google báo chờ bao lâu rồi hãy gọi lại (trong phần RetryInfo của lỗi 429)
function retryAfterMs(e) {
  const match = String(e.body || e.message || '').match(/retry[^0-9]{0,40}?(\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) + 500 : 0;
}

// Đổi lỗi của Gemini thành thông báo tiếng Việt cho người dùng (không lộ chi tiết kỹ thuật)
function translateError(e, { waitSeconds = 0 } = {}) {
  const body = String(e.body || e.message || '');
  // In lỗi gốc ra cửa sổ chạy server để quản trị viên biết nguyên nhân, người dùng chỉ thấy câu tiếng Việt
  console.error('[AI] lỗi Gemini:', e.name, '| status:', e.status, '|', String(e.message).slice(0, 300), '|', body.slice(0, 300));
  if (e.status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) {
    return new AiError('invalid_key', 'Khóa Gemini API không hợp lệ. Quản trị viên cần kiểm tra GEMINI_API_KEY.', 503);
  }
  if (e.status === 401 || e.status === 403) {
    return new AiError('invalid_key', 'Khóa Gemini API không có quyền dùng mô hình này.', 503);
  }
  if (e.status === 429) {
    return new AiError('quota', waitSeconds
      ? `Trợ lý AI đang bận vì gói miễn phí giới hạn số lượt mỗi phút. Bạn thử lại sau khoảng ${waitSeconds} giây nhé.`
      : 'Trợ lý AI đang quá tải hoặc đã hết lượt miễn phí trong ngày. Vui lòng thử lại sau ít phút.', 429);
  }
  if (e.status === 404) {
    return new AiError('unavailable', `Không tìm thấy mô hình ${MODEL}. Quản trị viên cần kiểm tra GEMINI_MODEL.`, 503);
  }
  if (e.name === 'AbortError' || /timeout|timed out/i.test(String(e.message))) {
    return new AiError('unavailable', 'Trợ lý AI phản hồi quá lâu, vui lòng thử lại.', 504);
  }
  if (isServerBusy(e)) {
    return new AiError('unavailable', 'Máy chủ AI của Google đang quá tải, bạn thử lại sau ít phút nhé.', 503);
  }
  return new AiError('unavailable', 'Chưa kết nối được tới trợ lý AI, vui lòng thử lại sau.', 502);
}

// Đọc kết quả một lần gọi: kiểm tra trạng thái rồi parse JSON
function readInteraction(interaction, model) {
  const usage = {
    input_tokens: interaction.usage?.total_input_tokens ?? null,
    output_tokens: interaction.usage?.total_output_tokens ?? null,
  };
  if (interaction.status === 'incomplete' || interaction.status === 'budget_exceeded') {
    throw Object.assign(new AiError('incomplete', 'Câu trả lời của AI bị cắt ngang, vui lòng thử lại.', 502), { usage });
  }
  if (interaction.status && interaction.status !== 'completed') {
    throw Object.assign(new AiError('blocked', 'Trợ lý AI không trả lời được yêu cầu này.', 502), { usage });
  }
  const text = String(interaction.output_text || '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();   // vài model bọc JSON trong khối mã
  try {
    return { data: JSON.parse(text), usage, model };
  } catch {
    throw Object.assign(new AiError('bad_output', 'Trợ lý AI trả về dữ liệu không đúng định dạng, vui lòng thử lại.', 502), { usage });
  }
}

/**
 * Gọi mô hình và nhận về object JSON theo schema.
 *   system: chỉ dẫn vai trò và quy tắc (tiếng Việt)
 *   prompt: nội dung cần xử lý
 *   schema: JSON Schema của kết quả
 *   thinking: low | medium | high (Gemini không nhận mức minimal)
 *   mock: object hoặc hàm trả object, dùng khi AI_PROVIDER=mock
 * Trả về { data, usage: { input_tokens, output_tokens }, model } — model là model thực sự đã trả lời
 */
async function generateJson({ system, prompt, schema, thinking = 'low', maxOutputTokens = 8192, tools, mock }) {
  if (MOCK) {
    const data = typeof mock === 'function' ? mock({ system, prompt }) : mock;
    if (!data) throw new AiError('bad_output', 'Chưa có dữ liệu mẫu cho tính năng này', 500);
    return { data: JSON.parse(JSON.stringify(data)), usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock' };
  }
  const keys = apiKeys();
  if (!keys.length) {
    throw new AiError('not_configured', 'Trung tâm chưa bật trợ lý AI (chưa cấu hình GEMINI_API_KEY).', 503);
  }
  await acquireSlot();
  try {
    return await callGemini({ system, prompt, schema, thinking, maxOutputTokens, tools, keys });
  } finally {
    releaseSlot();
  }
}

// Gọi Gemini thật, tự đổi key và model khi gặp lỗi quá tải
async function callGemini({ system, prompt, schema, thinking, maxOutputTokens, tools, keys }) {
  const request = {
    system_instruction: system,
    input: prompt,
    response_format: { type: 'text', mime_type: 'application/json', schema },
    generation_config: { thinking_level: THINKING_LEVELS.includes(thinking) ? thinking : 'low', max_output_tokens: maxOutputTokens },
    ...(tools ? { tools } : {}),   // ví dụ công cụ tìm kiếm của Google khi kiểm tra đạo văn
    store: false, // không lưu hội thoại phía Google để truy xuất lại
  };

  // Thứ tự thử: mỗi key lần lượt với model chính rồi tới model dự phòng.
  // Lỗi 429 là hết lượt trong phút của riêng cặp key và model đó nên chuyển tiếp.
  // Lỗi 5xx là model đó quá tải phía Google, key nào gọi cũng vậy nên bỏ qua model đó luôn.
  // Lỗi khác (sai key, sai model, quá thời gian...) thì dừng ngay.
  const start = keyIndex++ % keys.length;
  const attempts = [];
  for (let i = 0; i < keys.length; i++) {
    for (const model of models()) attempts.push({ apiKey: keys[(start + i) % keys.length], model });
  }

  let waitMs = 0;
  let serverBusy = false;
  const busyModels = new Set();
  let lastError = null;
  let lastAiError = null;
  for (const attempt of attempts) {
    if (busyModels.has(attempt.model)) continue;
    try {
      const interaction = await getClient(attempt.apiKey).interactions
        .create({ model: attempt.model, ...request }, { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
      if (attempt.model !== MODEL) console.warn(`[AI] ${MODEL} đang quá tải, đã trả lời bằng ${attempt.model}`);
      return readInteraction(interaction, attempt.model);
    } catch (e) {
      // Model trả về không đúng JSON thì thử model kế tiếp thay vì báo lỗi ngay
      if (e instanceof AiError) {
        if (e.code !== 'bad_output' && e.code !== 'incomplete') throw e;
        console.warn(`[AI] ${attempt.model} trả lời không đúng định dạng, thử model khác`);
        lastAiError = e;
        continue;
      }
      if (isServerBusy(e)) {
        console.warn(`[AI] ${attempt.model} đang quá tải phía Google (lỗi ${e.status}), thử model khác`);
        busyModels.add(attempt.model);
        serverBusy = true;
        lastError = e;
        continue;
      }
      if (e.status !== 429) throw translateError(e);   // sai key, sai model, quá thời gian...
      waitMs = Math.max(waitMs, retryAfterMs(e));
      lastError = e;
    }
  }

  // Mọi cặp key và model đều đang bận: chờ đúng số giây Google báo (hoặc chờ ngắn khi máy chủ Google
  // quá tải) rồi thử lại model chính một lần
  if ((waitMs || serverBusy) && waitMs <= MAX_WAIT_MS) {
    const delay = Math.max(waitMs, serverBusy ? SERVER_RETRY_MS : 0);
    console.warn(`[AI] mọi model đều quá tải, chờ ${Math.round(delay / 1000)}s rồi thử lại`);
    await sleep(delay);
    try {
      const interaction = await getClient(keys[start]).interactions
        .create({ model: MODEL, ...request }, { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
      return readInteraction(interaction, MODEL);
    } catch (e) {
      if (e instanceof AiError) throw e;
      lastError = e;
      if (e.status !== 429) throw translateError(e);
    }
  }
  if (lastAiError && !lastError) throw lastAiError;   // không phải quá tải, mà mọi model đều trả lời sai định dạng
  throw translateError(lastError, { waitSeconds: waitMs ? Math.ceil(waitMs / 1000) : 0 });
}

module.exports = { generateJson, isConfigured, modelName, queueStatus, AiError, MOCK };

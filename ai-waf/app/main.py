"""
AI WAF cho EngPro – reverse proxy chính (FastAPI).

Luồng xử lý mỗi request:
    1. Đọc request của khách.
    2. waf.evaluate() chấm qua 3 lớp.
    3. Nếu chặn: trả 403 kèm mã sự cố, ghi log.  (chế độ DETECTION_ONLY thì chỉ ghi log)
    4. Nếu cho qua: httpx chuyển tiếp sang EngPro, trả nguyên phản hồi về khách.

Ngoài ra WAF tự phục vụ /waf/dashboard và /waf/api/* để giám sát.
"""
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse

from . import config
from . import waf, model, logstore, rules, anomaly

# Client dùng lại kết nối tới backend cho nhanh
_client: httpx.AsyncClient | None = None

# Header không được chuyển tiếp nguyên trạng (do proxy/độ dài tự tính lại)
_HOP_BY_HOP = {
    "content-length", "transfer-encoding", "connection", "keep-alive",
    "proxy-authenticate", "proxy-authorization", "te", "trailers", "upgrade",
    "host",
}

_STATIC_DIR = os.path.join(config.BASE_DIR, "static")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Khởi tạo khi WAF bật (nạp mô hình, mở log, tạo client) và dọn khi tắt."""
    global _client
    logstore.init()
    trained = model.load(config.MODEL_PATH)
    _client = httpx.AsyncClient(base_url=config.BACKEND_URL, timeout=30.0)
    print("─" * 60)
    print(f"[WAF] Nghe tại   : http://{config.WAF_HOST}:{config.WAF_PORT}")
    print(f"[WAF] Bảo vệ     : {config.BACKEND_URL}")
    print(f"[WAF] Số luật    : {rules.rule_count()}")
    print(f"[WAF] Mô hình ML : {'đã huấn luyện' if trained else 'CHƯA (dùng heuristic) – chạy ml/train.py'}")
    print(f"[WAF] Chế độ     : {'CHỈ GHI LOG' if config.DETECTION_ONLY else 'CHẶN'}")
    print(f"[WAF] Dashboard  : http://127.0.0.1:{config.WAF_PORT}/waf/dashboard")
    print("─" * 60)
    yield
    await _client.aclose()


app = FastAPI(title="AI WAF – EngPro", docs_url=None, redoc_url=None,
              lifespan=lifespan)


def _client_ip(request: Request) -> str:
    # Trên localhost lấy IP peer là đủ; sau proxy thật thì đọc X-Forwarded-For
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "?"


# ─────────────────────────────────────────────────────────────
#  API giám sát của chính WAF (đặt trước route bắt-tất-cả)
# ─────────────────────────────────────────────────────────────
@app.get("/waf/dashboard", response_class=HTMLResponse)
async def dashboard():
    path = os.path.join(_STATIC_DIR, "dashboard.html")
    # no-store: sửa dashboard.html xong là F5 thấy ngay, không dính cache trình duyệt
    return FileResponse(path, headers={"Cache-Control": "no-store"})


@app.get("/waf/api/status")
async def api_status():
    return {
        "backend": config.BACKEND_URL,
        "target": config.TARGET_NAME,
        "rules": rules.rule_count(),
        "model": model.status(),
        "detection_only": config.DETECTION_ONLY,
        "layers": {
            "rules": config.ENABLE_RULES,
            "ml": config.ENABLE_ML,
            "anomaly": config.ENABLE_ANOMALY,
        },
        "ml_threshold": config.ML_THRESHOLD,
    }


@app.get("/waf/api/stats")
async def api_stats():
    return logstore.stats()


@app.get("/waf/api/events")
async def api_events(limit: int = 100):
    return logstore.recent(limit)


@app.post("/waf/api/clear")
async def api_clear():
    logstore.clear()
    return {"ok": True}


@app.get("/waf/api/flagged")
async def api_flagged():
    """IP đang bị lớp hành vi đánh dấu (dò mật khẩu)."""
    return anomaly.flagged_ips()


@app.post("/waf/api/unban")
async def api_unban(ip: str | None = None):
    """
    Gỡ chặn lớp hành vi. Sau khi demo dò mật khẩu, chính máy đang demo bị khóa
    đăng nhập 1 phút – bấm nút này để tiếp tục trình bày ngay.
    """
    anomaly.reset(ip)
    return {"ok": True, "unbanned": ip or "tất cả"}


def _blocked_response(decision: waf.Decision, ip: str) -> Response:
    incident = f"WAF-{int(time.time())}"
    return JSONResponse(
        status_code=403,
        content={
            "success": False,
            "message": "Yêu cầu bị tường lửa ứng dụng (WAF) chặn.",
            "waf": {
                "blocked": True,
                "attack": decision.attack,
                "layer": decision.layer,
                "rule_id": decision.rule_id,
                "score": round(decision.score, 3),
                "incident": incident,
            },
        },
    )


# ─────────────────────────────────────────────────────────────
#  Route bắt-tất-cả: kiểm tra rồi chuyển tiếp sang EngPro
# ─────────────────────────────────────────────────────────────
@app.api_route("/{full_path:path}",
               methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(request: Request, full_path: str):
    ip = _client_ip(request)
    method = request.method
    path = "/" + full_path
    query = request.url.query
    raw_body = await request.body()
    body_text = raw_body.decode("utf-8", "ignore") if raw_body else ""
    headers_lower = {k.lower(): v for k, v in request.headers.items()}

    decision = waf.evaluate(ip, method, path, query, headers_lower, body_text)

    # Ghi log (mọi request, kể cả cho qua – để tính tỉ lệ và xem lưu lượng)
    will_block = decision.block and not config.DETECTION_ONLY
    logstore.record(
        ip=ip, method=method, path=path,
        decision="block" if will_block else "allow",
        layer=decision.layer if decision.block else "-",
        attack=decision.attack or None,
        rule_id=decision.rule_id or None,
        score=decision.score,
        status=403 if will_block else 0,   # cập nhật lại status thật khi forward
        snippet=decision.snippet,
    )

    if will_block:
        return _blocked_response(decision, ip)

    # ── Chuyển tiếp sang EngPro ──
    fwd_headers = {k: v for k, v in request.headers.items()
                   if k.lower() not in _HOP_BY_HOP}
    fwd_headers["X-Forwarded-For"] = ip
    fwd_headers["X-Forwarded-Host"] = request.headers.get("host", "")
    fwd_headers["X-WAF"] = "EngPro-AI-WAF"

    try:
        upstream = await _client.request(
            method, request.url.path,
            params=dict(request.query_params),
            content=raw_body,
            headers=fwd_headers,
            cookies=request.cookies,
        )
    except httpx.ConnectError:
        return JSONResponse(
            status_code=502,
            content={"success": False,
                     "message": f"WAF không kết nối được EngPro ({config.BACKEND_URL}). "
                                f"EngPro đã chạy chưa?"},
        )

    # Theo dõi đăng nhập thất bại để phát hiện dò mật khẩu (lớp 3)
    if path.startswith("/api/auth/login") and upstream.status_code in (401, 429):
        anomaly.note_login_failure(ip)

    resp_headers = {k: v for k, v in upstream.headers.items()
                    if k.lower() not in _HOP_BY_HOP}
    resp_headers["X-Protected-By"] = "EngPro-AI-WAF"
    return Response(content=upstream.content,
                    status_code=upstream.status_code,
                    headers=resp_headers)

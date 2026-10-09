"""
AI WAF cho EngPro – reverse proxy chính (FastAPI).

Luồng xử lý mỗi request:
    1. Đọc request của khách.
    2. waf.evaluate() chấm qua 3 lớp.
    3. Nếu chặn: trả 403 kèm mã sự cố, ghi log.  (chế độ DETECTION_ONLY thì chỉ ghi log)
    4. Nếu cho qua: httpx chuyển tiếp sang EngPro, trả nguyên phản hồi về khách.

Ngoài ra WAF tự phục vụ /waf/dashboard và /waf/api/* để giám sát (cần mật khẩu).

Chạy bằng `python -m app` (xem app/__main__.py), KHÔNG chạy uvicorn trần: mặc định
uvicorn tin X-Forwarded-For từ 127.0.0.1, khiến kẻ tấn công giả được IP.
"""
import os
import secrets
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from . import config
from . import waf, model, logstore, rules, anomaly

# Client dùng lại kết nối tới backend cho nhanh
_client: httpx.AsyncClient | None = None

# Header gắn với từng chặng kết nối, không chuyển tiếp nguyên trạng
_HOP_BY_HOP = {
    "content-length", "transfer-encoding", "connection", "keep-alive",
    "proxy-authenticate", "proxy-authorization", "te", "trailers", "upgrade",
}

# Header mô tả "request đi qua proxy nào" mà client tự gửi được. Xóa hết rồi WAF
# tự đặt lại, nếu không kẻ tấn công giả được IP ngay cả với EngPro phía sau.
_CLIENT_FORWARDING_HEADERS = {
    "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
    "x-forwarded-port", "x-real-ip", "forwarded",
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
    print(f"[WAF] Bảo vệ     : {config.BACKEND_URL}  ({config.TARGET_NAME})")
    print(f"[WAF] Số luật    : {rules.rule_count()}")
    print(f"[WAF] Mô hình ML : {'đã huấn luyện' if trained else 'CHƯA (dùng heuristic) – chạy ml/train.py'}")
    print(f"[WAF] Chế độ     : {'CHỈ GHI LOG' if config.DETECTION_ONLY else 'CHẶN'}")
    print(f"[WAF] Dashboard  : http://127.0.0.1:{config.WAF_PORT}/waf/dashboard")
    if config.ADMIN_PASSWORD_GENERATED:
        print(f"[WAF] Chưa đặt WAF_ADMIN_PASSWORD, dùng mật khẩu tạm cho lần chạy này:")
        print(f"[WAF]   tài khoản {config.ADMIN_USER} / mật khẩu {config.ADMIN_PASSWORD}")
    print("─" * 60)
    yield
    await _client.aclose()


app = FastAPI(title="AI WAF – EngPro", docs_url=None, redoc_url=None,
              openapi_url=None, lifespan=lifespan)


def _client_ip(request: Request) -> str:
    """
    IP thật của người gửi. Mặc định là IP của kết nối TCP – thứ không giả được.
    Chỉ khi kết nối đến từ một proxy tin cậy (WAF_TRUSTED_PROXIES) mới đọc
    X-Forwarded-For, và lấy giá trị CUỐI (do proxy đó gắn), không lấy giá trị
    đầu (do client tự khai).
    """
    peer = request.client.host if request.client else "?"
    if peer in config.TRUSTED_PROXIES:
        hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
        if hops:
            return hops[-1]
    return peer


# ─────────────────────────────────────────────────────────────
#  Xác thực quản trị cho dashboard và API /waf/api/*
# ─────────────────────────────────────────────────────────────
_basic = HTTPBasic(realm="AI WAF")


def require_admin(request: Request, creds: HTTPBasicCredentials = Depends(_basic)):
    ip = _client_ip(request)
    if anomaly.is_admin_locked(ip):
        raise HTTPException(429, "Sai mật khẩu quá nhiều lần, thử lại sau 5 phút")
    # compare_digest: so sánh thời gian cố định, không lộ mật khẩu qua thời gian phản hồi.
    # Dùng & thay vì and để luôn so cả hai, kể cả khi tên đăng nhập đã sai.
    ok = (secrets.compare_digest(creds.username.encode(), config.ADMIN_USER.encode())
          & secrets.compare_digest(creds.password.encode(), config.ADMIN_PASSWORD.encode()))
    if not ok:
        anomaly.note_admin_failure(ip)
        raise HTTPException(401, "Sai tài khoản quản trị WAF",
                            headers={"WWW-Authenticate": 'Basic realm="AI WAF"'})


def require_admin_write(request: Request, _=Depends(require_admin)):
    """
    Thao tác thay đổi trạng thái (xóa log, gỡ chặn) cần thêm header X-WAF-Admin.
    Trình duyệt tự gửi kèm mật khẩu Basic đã nhớ, nên một trang web độc hại có
    thể lừa trình duyệt của quản trị viên gửi POST tới đây (CSRF). Trang khác
    không đặt được header tự định nghĩa nếu WAF không bật CORS, nên chặn được.
    """
    if request.headers.get("x-waf-admin") != "1":
        raise HTTPException(403, "Thiếu header X-WAF-Admin")


_admin = [Depends(require_admin)]
_admin_write = [Depends(require_admin_write)]


@app.get("/waf/dashboard", response_class=HTMLResponse, dependencies=_admin)
async def dashboard():
    path = os.path.join(_STATIC_DIR, "dashboard.html")
    # no-store: sửa dashboard.html xong là F5 thấy ngay, không dính cache trình duyệt
    return FileResponse(path, headers={"Cache-Control": "no-store"})


@app.get("/waf/api/status", dependencies=_admin)
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


@app.get("/waf/api/stats", dependencies=_admin)
async def api_stats():
    return logstore.stats()


@app.get("/waf/api/events", dependencies=_admin)
async def api_events(limit: int = 100):
    return logstore.recent(limit)


@app.post("/waf/api/clear", dependencies=_admin_write)
async def api_clear():
    logstore.clear()
    return {"ok": True}


@app.get("/waf/api/flagged", dependencies=_admin)
async def api_flagged():
    """IP đang bị lớp hành vi đánh dấu (dò mật khẩu)."""
    return anomaly.flagged_ips()


@app.post("/waf/api/unban", dependencies=_admin_write)
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
    # Query string GỐC. Không dùng request.url.query: Starlette dựng nó từ đường
    # dẫn đã giải mã, nên "/a%3Fx=1" bị hiểu nhầm thành query "x=1".
    query = request.scope.get("query_string", b"").decode("latin-1")
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
    # Giữ nguyên Host của khách để EngPro dựng đường link (VD: link trả về của
    # VNPay) trỏ về WAF chứ không trỏ thẳng cổng 8080 – vốn đã bị khóa từ ngoài.
    fwd_headers = {k: v for k, v in headers_lower.items()
                   if k not in _HOP_BY_HOP and k not in _CLIENT_FORWARDING_HEADERS}
    fwd_headers["x-forwarded-for"] = ip
    fwd_headers["x-forwarded-host"] = request.headers.get("host", "")
    fwd_headers["x-forwarded-proto"] = request.url.scheme
    fwd_headers["x-waf"] = "EngPro-AI-WAF"

    # Gửi đường dẫn GỐC client gửi (raw_path), không gửi bản đã giải mã: giải mã
    # rồi gửi lại thì "%3F" thành "?" và backend hiểu khác thứ WAF vừa kiểm tra.
    raw_path = request.scope.get("raw_path") or request.url.path.encode()
    target = raw_path.decode("latin-1") + (f"?{query}" if query else "")
    try:
        upstream = await _client.send(
            _client.build_request(method, target, content=raw_body, headers=fwd_headers),
            stream=True,
        )
    except httpx.ConnectError:
        return JSONResponse(
            status_code=502,
            content={"success": False,
                     "message": f"WAF không kết nối được {config.TARGET_NAME} ({config.BACKEND_URL}). "
                                f"Ứng dụng đã chạy chưa?"},
        )
    try:
        # Lấy thân phản hồi ĐÚNG NHƯ BACKEND GỬI (còn nén gzip nếu có). Đọc qua
        # .content thì httpx tự giải nén, nhưng header vẫn báo gzip → trình
        # duyệt giải nén lần nữa và hỏng trang.
        body = b"".join([chunk async for chunk in upstream.aiter_raw()])
    finally:
        await upstream.aclose()

    # Theo dõi đăng nhập thất bại để phát hiện dò mật khẩu (lớp 3)
    if path.startswith("/api/auth/login") and upstream.status_code in (401, 429):
        anomaly.note_login_failure(ip)

    response = Response(content=body, status_code=upstream.status_code)
    # Giữ header lặp lại (nhiều Set-Cookie) thành nhiều dòng riêng. Gộp vào dict
    # sẽ nối chúng bằng dấu phẩy, trình duyệt chỉ nhận cookie đầu và mất phiên.
    response.raw_headers.extend(
        (k, v) for k, v in upstream.headers.raw
        if k.decode("latin-1").lower() not in _HOP_BY_HOP
    )
    response.raw_headers.append((b"x-protected-by", b"EngPro-AI-WAF"))
    return response

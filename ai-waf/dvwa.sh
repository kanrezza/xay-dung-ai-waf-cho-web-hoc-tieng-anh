#!/usr/bin/env bash
# Quản lý bia tập DVWA cho demo WAF. Cần Docker (OrbStack/Docker Desktop).
#
#   ./dvwa.sh up      # tạo MariaDB + DVWA, thiết lập sẵn (đăng nhập, tạo DB, security=low)
#   ./dvwa.sh down    # xóa hai container và mạng
#   ./dvwa.sh status  # xem trạng thái
#
# Sau khi 'up': DVWA ở http://127.0.0.1:4280  (admin / password)
set -e

NET=dvwa-net
DB=dvwa-db
APP=dvwa
PORT=4280
DB_PASS='p@ssw0rd'

case "${1:-up}" in
up)
  docker network create $NET 2>/dev/null || true
  if ! docker ps -a --format '{{.Names}}' | grep -q "^$DB$"; then
    echo "▶ Khởi động MariaDB..."
    docker run -d --name $DB --network $NET \
      -e MYSQL_ROOT_PASSWORD=rootpass -e MYSQL_DATABASE=dvwa \
      -e MYSQL_USER=dvwa -e MYSQL_PASSWORD="$DB_PASS" mariadb:10 >/dev/null
  else
    docker start $DB >/dev/null 2>&1 || true
  fi
  echo "▶ Chờ MariaDB sẵn sàng..."
  until docker exec $DB mariadb -udvwa -p"$DB_PASS" -e "SELECT 1" dvwa >/dev/null 2>&1; do sleep 2; done

  if ! docker ps -a --format '{{.Names}}' | grep -q "^$APP$"; then
    echo "▶ Khởi động DVWA..."
    docker run -d --name $APP --network $NET -p 127.0.0.1:$PORT:80 \
      -e DB_SERVER=$DB -e DB_USER=dvwa -e DB_PASSWORD="$DB_PASS" -e DB_DATABASE=dvwa \
      ghcr.io/digininja/dvwa:latest >/dev/null
  else
    docker start $APP >/dev/null 2>&1 || true
  fi
  echo "▶ Chờ DVWA phản hồi..."
  until curl -s -o /dev/null "http://127.0.0.1:$PORT/login.php"; do sleep 2; done

  echo "▶ Thiết lập DVWA (đăng nhập, tạo CSDL, security=low)..."
  python3 - <<'PY'
import re, urllib.request, urllib.parse, http.cookiejar
B="http://127.0.0.1:4280"
cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
g=lambda p: op.open(B+p,timeout=10).read().decode("utf-8","ignore")
tok=lambda h: (re.search(r"user_token'\s*value='([a-f0-9]{32})",h) or [None,""])[1]
pp=lambda p,d: op.open(urllib.request.Request(B+p,urllib.parse.urlencode(d).encode()),timeout=10).read()
pp("/login.php",{"username":"admin","password":"password","user_token":tok(g("/login.php")),"Login":"Login"})
pp("/setup.php",{"create_db":"Create / Reset Database","user_token":tok(g("/setup.php"))})
pp("/security.php",{"security":"low","seclev_submit":"Submit","user_token":tok(g("/security.php"))})
print("   ✓ DVWA sẵn sàng" if "Logout" in g("/index.php") else "   ✗ Thiết lập lỗi")
PY
  echo
  echo "✅ DVWA: http://127.0.0.1:$PORT  (admin / password)"
  echo "   Bật WAF bảo vệ DVWA:"
  echo "   WAF_TARGET_NAME=DVWA BACKEND_URL=http://127.0.0.1:$PORT \\"
  echo "     .venv/bin/python -m uvicorn app.main:app --app-dir . --port 8001"
  ;;
down)
  docker rm -f $APP $DB 2>/dev/null || true
  docker network rm $NET 2>/dev/null || true
  echo "đã xóa DVWA"
  ;;
status)
  docker ps --filter "name=$APP" --filter "name=$DB" \
    --format "  {{.Names}}  {{.Status}}  {{.Ports}}"
  ;;
*)
  echo "Dùng: ./dvwa.sh [up|down|status]"; exit 1;;
esac

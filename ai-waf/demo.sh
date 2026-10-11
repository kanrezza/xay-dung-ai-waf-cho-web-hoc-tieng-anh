#!/usr/bin/env bash
# Bật / tắt TOÀN BỘ hệ thống demo bằng một lệnh. Chạy trong thư mục ai-waf/.
#
#   ./demo.sh start    # bật EngPro, 2 WAF, DVWA, ModSecurity
#   ./demo.sh status   # xem cái nào đang chạy
#   ./demo.sh stop     # tắt hết
#
# Cần: Docker (OrbStack) đang mở, Postgres của EngPro (container engpro-postgres).
set -e
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"          # thư mục EngPro
LOGS="data/demo-logs"; mkdir -p "$LOGS"

up() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/" ; }

wait_port() {   # wait_port <cổng> <tên>
  for _ in $(seq 1 60); do up "$1" && { echo "   ✓ $2 (cổng $1)"; return 0; }; sleep 1; done
  echo "   ✗ $2 (cổng $1) chưa lên – xem $LOGS/"; return 1
}

start_bg() {    # start_bg <tên> <cổng> <lệnh...>
  local name=$1 port=$2; shift 2
  if up "$port"; then echo "   • $name đã chạy sẵn ở cổng $port"; return; fi
  nohup "$@" > "$LOGS/$name.log" 2>&1 &
  echo $! > "$LOGS/$name.pid"
}

case "${1:-start}" in
start)
  echo "▶ Docker"
  docker info >/dev/null 2>&1 || { echo "   ✗ Docker chưa chạy, mở OrbStack trước"; exit 1; }
  docker start engpro-postgres >/dev/null 2>&1 || true

  echo "▶ DVWA (bia tập)"
  ./dvwa.sh up >/dev/null && echo "   ✓ DVWA (cổng 4280)"

  echo "▶ EngPro và hai AI WAF"
  start_bg engpro   8080 bash -c "cd '$ROOT' && npm run dev"
  start_bg waf      8000 ./.venv/bin/python -m app
  start_bg waf-dvwa 8001 env WAF_TARGET_NAME=DVWA BACKEND_URL=http://127.0.0.1:4280 \
                         WAF_PORT=8001 ./.venv/bin/python -m app
  wait_port 8080 "EngPro"
  wait_port 8000 "AI WAF bảo vệ EngPro"
  wait_port 8001 "AI WAF bảo vệ DVWA"

  # ModSecurity chuyển tiếp sang EngPro, nên phải dựng SAU khi EngPro đã chạy
  echo "▶ ModSecurity (đối chứng)"
  ./modsec.sh up >/dev/null && echo "   ✓ ModSecurity PL1/PL2 (cổng 8002/8003)"

  cat <<EOF

✅ Sẵn sàng demo. Mở trình duyệt:
   EngPro qua WAF ......... http://localhost:8000
   Dashboard WAF .......... http://localhost:8000/waf/dashboard   (admin / mật khẩu trong ai-waf/.env)
   DVWA KHÔNG có WAF ...... http://localhost:4280                 (admin / password)
   DVWA CÓ WAF ............ http://localhost:8001
EOF
  ;;
status)
  for p in "8080 EngPro" "8000 WAF-EngPro" "8001 WAF-DVWA" "4280 DVWA" "8002 ModSec-PL1" "8003 ModSec-PL2"; do
    set -- $p; printf "  %-12s cổng %-5s %s\n" "$2" "$1" "$(up "$1" && echo chạy || echo tắt)"
  done
  ;;
stop)
  for name in waf-dvwa waf engpro; do
    if [ -f "$LOGS/$name.pid" ]; then
      pid=$(cat "$LOGS/$name.pid")
      pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true
      rm -f "$LOGS/$name.pid"; echo "   đã tắt $name"
    fi
  done
  docker stop dvwa dvwa-db modsec-pl1 modsec-pl2 >/dev/null 2>&1 || true
  echo "   đã dừng DVWA và ModSecurity"
  ;;
*)
  echo "Dùng: ./demo.sh [start|status|stop]"; exit 1;;
esac

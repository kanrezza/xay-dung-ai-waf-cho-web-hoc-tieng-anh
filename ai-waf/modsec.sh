#!/usr/bin/env bash
# Dựng ModSecurity + OWASP CRS làm mốc đối chứng, đứng trước EngPro giống AI WAF.
# Cần Docker (OrbStack/Docker Desktop) và EngPro đang chạy ở cổng 8080.
#
#   ./modsec.sh up      # hai container: Paranoia Level 1 (8002) và 2 (8003)
#   ./modsec.sh down    # xóa hai container
#   ./modsec.sh status
#
# Sau khi up, so sánh:  python -m tests.compare_modsec
set -e

IMAGE=owasp/modsecurity-crs:nginx
# EngPro bind 127.0.0.1; từ trong container gọi host qua host.docker.internal.
BACKEND=http://host.docker.internal:8080

case "${1:-up}" in
up)
  for pl in 1 2; do
    name=modsec-pl$pl
    port=$((8001 + pl))   # PL1 -> 8002, PL2 -> 8003
    docker rm -f $name >/dev/null 2>&1 || true
    docker run -d --name $name -p 127.0.0.1:$port:8080 \
      -e BACKEND="$BACKEND" \
      -e BLOCKING_PARANOIA=$pl \
      -e MODSEC_RULE_ENGINE=on \
      $IMAGE >/dev/null
    echo "▶ $name (Paranoia Level $pl) -> http://127.0.0.1:$port"
  done
  echo "▶ Chờ ModSecurity sẵn sàng..."
  for port in 8002 8003; do
    until curl -s -o /dev/null "http://127.0.0.1:$port/api/public/home"; do sleep 1; done
  done
  echo "✅ Xong. So sánh:  python -m tests.compare_modsec"
  ;;
down)
  docker rm -f modsec-pl1 modsec-pl2 >/dev/null 2>&1 || true
  echo "đã xóa hai container ModSecurity"
  ;;
status)
  docker ps --filter "name=modsec-pl" --format "  {{.Names}}  {{.Status}}  {{.Ports}}"
  ;;
*)
  echo "Dùng: ./modsec.sh [up|down|status]"; exit 1;;
esac

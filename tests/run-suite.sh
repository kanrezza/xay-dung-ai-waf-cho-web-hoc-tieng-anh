#!/bin/zsh
# Dùng: tests/run-suite.sh e2e-xxx.js — reset DB test, khởi động lại server 8099, chạy suite
# Cần sẵn container PostgreSQL thử nghiệm (dữ liệu bị xóa sạch mỗi lần chạy, KHÔNG trỏ vào CSDL thật):
#   docker run -d --name engpro-pg-test -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=engpro -p 127.0.0.1:55432:5432 postgres:16
# Bộ AI chạy với dữ liệu mẫu: AI_PROVIDER=mock AI_LIMIT_EXPLAIN=4 AI_LIMIT_INSIGHTS=2 AI_LIMIT_ASK=3 tests/run-suite.sh e2e-ai.js
SP="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SP/.." && pwd)"
pkill -f "PORT=8099" 2>/dev/null
lsof -tiTCP:8099 -sTCP:LISTEN | xargs kill 2>/dev/null
sleep 1
docker exec -i engpro-pg-test psql -q -U postgres -d engpro -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1
docker exec -i engpro-pg-test psql -q -U postgres -d engpro -v ON_ERROR_STOP=1 < "$ROOT/db/engpro.sql" > $SP/schema.log 2>&1 || { echo SCHEMA_FAIL; tail $SP/schema.log; exit 1; }
cd "$ROOT"
(env -u SMTP_USER -u SMTP_PASS -u SMTP_HOST -u CONTACT_EMAIL PORT=8099 PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=testpass PGDATABASE=engpro nohup node server.js > $SP/server.log 2>&1 &)
for i in {1..30}; do curl -s -o /dev/null http://127.0.0.1:8099/api/auth/me && break; sleep 0.5; done
node $SP/$1 2>&1 | tee $SP/out-$1.log | grep -E "✗|Kết quả"

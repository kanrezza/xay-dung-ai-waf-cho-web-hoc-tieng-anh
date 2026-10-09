#!/usr/bin/env bash
# Khởi động AI WAF. Chạy từ thư mục ai-waf/:  ./run.sh
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "▶ Tạo môi trường ảo và cài thư viện (lần đầu)..."
  python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q -r requirements.txt
fi

if [ ! -f ml/model.joblib ]; then
  echo "▶ Chưa có mô hình, huấn luyện lần đầu..."
  ./.venv/bin/python -m ml.train
fi

echo "▶ Khởi động WAF tại http://127.0.0.1:${WAF_PORT:-8000}"
echo "  Dashboard: http://127.0.0.1:${WAF_PORT:-8000}/waf/dashboard"
exec ./.venv/bin/python -m uvicorn app.main:app \
  --host "${WAF_HOST:-0.0.0.0}" --port "${WAF_PORT:-8000}"

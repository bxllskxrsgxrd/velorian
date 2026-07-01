#!/usr/bin/env bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

BACKEND_URL="http://127.0.0.1:8000/docs"
FRONTEND_URL="http://localhost:5173"

cleanup() {
  echo ""
  echo "Останавливаю backend и frontend..."
  kill "$BACKEND_PID" "$FRONTEND_PID" "$OPEN_TABS_PID" 2>/dev/null || true
}

wait_for_url() {
  local url="$1"
  local name="$2"
  local attempts="${3:-40}"

  echo "Жду запуск $name..."

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name запущен: $url"
      return 0
    fi

    sleep 1
  done

  echo "$name не успел запуститься: $url"
  return 1
}

trap cleanup EXIT INT TERM

echo "Запускаю backend..."

(
  cd "$ROOT_DIR/backend"

  if [ ! -d ".venv" ]; then
    echo "Создаю виртуальное окружение..."
    python3 -m venv .venv
  fi

  source .venv/bin/activate

  if [ ! -s "requirements.txt" ]; then
    echo "requirements.txt пустой. Устанавливаю базовые зависимости..."
    python -m pip install fastapi "uvicorn[standard]" python-dotenv groq pydantic
    python -m pip freeze > requirements.txt
  else
    echo "Устанавливаю зависимости backend..."
    python -m pip install -r requirements.txt
  fi

  echo "Запускаю backend..."
  python -m uvicorn app.main:app --reload
) &

BACKEND_PID=$!

echo "Запускаю frontend..."

(
  cd "$ROOT_DIR/frontend"

  if [ ! -d "node_modules" ]; then
    echo "Устанавливаю зависимости frontend..."
    npm install
  else
    echo "Зависимости frontend уже установлены"
  fi

  echo "Запускаю frontend..."
  npm run dev
) &

FRONTEND_PID=$!

(
  wait_for_url "$BACKEND_URL" "backend" 40 && open "$BACKEND_URL" || true
  wait_for_url "$FRONTEND_URL" "frontend" 40 && open "$FRONTEND_URL" || true
) &

OPEN_TABS_PID=$!

wait

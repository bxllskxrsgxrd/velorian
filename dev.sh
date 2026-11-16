#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_URL="http://127.0.0.1:8000/docs"
FRONTEND_URL="http://127.0.0.1:5173"

BACKEND_PID=""
FRONTEND_PID=""
OPEN_TABS_PID=""
VENV_PYTHON=""

cleanup() {
    echo ""
    echo "Останавливаю backend и frontend..."

    if [ -n "$OPEN_TABS_PID" ]; then
        kill "$OPEN_TABS_PID" 2>/dev/null || true
    fi

    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi

    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
}

get_venv_python() {
    if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
        VENV_PYTHON="$BACKEND_DIR/.venv/bin/python"
    elif [ -f "$BACKEND_DIR/.venv/Scripts/python.exe" ]; then
        VENV_PYTHON="$BACKEND_DIR/.venv/Scripts/python.exe"
    else
        echo "Ошибка: backend/.venv не найден."
        echo "Сначала выполни:"
        echo "./setup.sh"
        exit 1
    fi
}

check_environment() {
    if [ ! -d "$BACKEND_DIR/.venv" ]; then
        echo "Ошибка: виртуальное окружение backend не создано."
        echo "Сначала выполни:"
        echo "./setup.sh"
        exit 1
    fi

    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        echo "Ошибка: frontend/node_modules не найден."
        echo "Сначала выполни:"
        echo "./setup.sh"
        exit 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        echo "Ошибка: npm не найден."
        exit 1
    fi

    get_venv_python
}

wait_for_url() {
    local url="$1"
    local name="$2"
    local attempts="${3:-30}"

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

open_url() {
    local url="$1"

    if command -v open >/dev/null 2>&1; then
        open "$url"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url"
    elif command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile -Command "Start-Process '$url'" >/dev/null 2>&1
    elif command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe /c start "" "$url" >/dev/null 2>&1
    else
        echo "Не удалось открыть браузер автоматически: $url"
    fi
}

trap cleanup EXIT INT TERM

check_environment

# -------------------------
# VS Code
# -------------------------

if command -v code >/dev/null 2>&1; then
    code "$ROOT_DIR"
fi

# -------------------------
# Backend
# -------------------------

echo "Запускаю backend..."

(
    cd "$BACKEND_DIR"

    exec "$VENV_PYTHON" -m uvicorn app.main:app \
        --reload \
        --host 127.0.0.1 \
        --port 8000
) &

BACKEND_PID=$!

# -------------------------
# Frontend
# -------------------------

echo "Запускаю frontend..."

(
    cd "$FRONTEND_DIR"

    exec npm run dev -- \
        --host 127.0.0.1 \
        --port 5173 \
        --strictPort
) &

FRONTEND_PID=$!

# -------------------------
# Browser
# -------------------------

(
    if wait_for_url "$BACKEND_URL" "backend" 30; then
        open_url "$BACKEND_URL"
    fi

    if wait_for_url "$FRONTEND_URL" "frontend" 30; then
        open_url "$FRONTEND_URL"
    fi
) &

OPEN_TABS_PID=$!

wait
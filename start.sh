#!/usr/bin/env bash
set -e
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_URL="http://127.0.0.1:8000/docs"
FRONTEND_URL="http://localhost:5173"
BACKEND_PID=""
FRONTEND_PID=""
OPEN_TABS_PID=""

cleanup() {
    echo ""
    echo "Останавливаю backend и frontend..."
    if [ -n "$BACKEND_PID" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
    if [ -n "$FRONTEND_PID" ]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
    if [ -n "$OPEN_TABS_PID" ]; then kill "$OPEN_TABS_PID" 2>/dev/null || true; fi
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

open_url() {
    local url="$1"
    if command -v open >/dev/null 2>&1; then open "$url"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"
    elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile -Command "Start-Process '$url'" >/dev/null 2>&1
    elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$url" >/dev/null 2>&1
    else echo "Не удалось открыть браузер автоматически: $url"; fi
}

detect_python() {
    if command -v py >/dev/null 2>&1; then PYTHON_CMD=(py -3)
    elif command -v python3 >/dev/null 2>&1 && python3 --version >/dev/null 2>&1; then PYTHON_CMD=(python3)
    elif command -v python >/dev/null 2>&1 && python --version >/dev/null 2>&1; then PYTHON_CMD=(python)
    else
        echo "Python не найден. Установи Python 3 и добавь его в PATH."
        echo "Для Windows: установи Python с python.org и включи Add python.exe to PATH."
        exit 1
    fi
}

trap cleanup EXIT INT TERM

if command -v code >/dev/null 2>&1; then code "$ROOT_DIR"; else echo "VS Code CLI 'code' не найден. Открой VS Code вручную или добавь команду code в PATH."; fi

echo "Запускаю backend..."
(
    cd "$ROOT_DIR/backend"
    detect_python
    if [ ! -d ".venv" ]; then
        echo "Создаю виртуальное окружение..."
        "${PYTHON_CMD[@]}" -m venv .venv
    fi
    if [ -f ".venv/Scripts/activate" ]; then source .venv/Scripts/activate
    elif [ -f ".venv/bin/activate" ]; then source .venv/bin/activate
    else
        echo "Не найден файл активации виртуального окружения."
        exit 1
    fi
    python -m pip install --upgrade pip
    if [ ! -s "requirements.txt" ]; then
        echo "requirements.txt пустой. Устанавливаю базовые зависимости..."
        python -m pip install fastapi "uvicorn[standard]" python-dotenv groq pydantic python-multipart
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
    echo "Проверяю и обновляю зависимости frontend..."
    npm install
    echo "Запускаю frontend..."
    npm run dev
) &
FRONTEND_PID=$!

(
    wait_for_url "$BACKEND_URL" "backend" 40 && open_url "$BACKEND_URL" || true
    wait_for_url "$FRONTEND_URL" "frontend" 40 && open_url "$FRONTEND_URL" || true
) &
OPEN_TABS_PID=$!

wait

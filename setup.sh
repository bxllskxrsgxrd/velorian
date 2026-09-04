#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

PYTHON_CMD=()

detect_python() {
    if command -v py >/dev/null 2>&1; then
        PYTHON_CMD=(py -3)
    elif command -v python3 >/dev/null 2>&1; then
        PYTHON_CMD=(python3)
    elif command -v python >/dev/null 2>&1; then
        PYTHON_CMD=(python)
    else
        echo "Ошибка: Python 3 не найден."
        echo "Установи Python 3 и добавь его в PATH."
        exit 1
    fi
}

detect_node() {
    if ! command -v node >/dev/null 2>&1; then
        echo "Ошибка: Node.js не найден."
        echo "Установи Node.js и добавь его в PATH."
        exit 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        echo "Ошибка: npm не найден."
        exit 1
    fi
}

get_venv_python() {
    if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
        VENV_PYTHON="$BACKEND_DIR/.venv/bin/python"
    elif [ -f "$BACKEND_DIR/.venv/Scripts/python.exe" ]; then
        VENV_PYTHON="$BACKEND_DIR/.venv/Scripts/python.exe"
    else
        echo "Ошибка: Python внутри .venv не найден."
        exit 1
    fi
}

echo "========================================"
echo "Настройка проекта"
echo "========================================"

detect_python
detect_node

echo ""
echo "Python:"
"${PYTHON_CMD[@]}" --version

echo "Node.js:"
node --version

echo "npm:"
npm --version

# -------------------------
# Backend
# -------------------------

echo ""
echo "Настраиваю backend..."

if [ ! -d "$BACKEND_DIR" ]; then
    echo "Ошибка: директория backend не найдена."
    exit 1
fi

cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
    echo "Создаю виртуальное окружение..."
    "${PYTHON_CMD[@]}" -m venv .venv
else
    echo "Виртуальное окружение уже существует."
fi

get_venv_python

echo "Обновляю pip..."
"$VENV_PYTHON" -m pip install --upgrade pip

if [ ! -s "requirements.txt" ]; then
    echo "Ошибка: backend/requirements.txt отсутствует или пуст."
    exit 1
fi

echo "Устанавливаю зависимости backend..."
"$VENV_PYTHON" -m pip install -r requirements.txt

if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    echo "Создаю backend/.env из .env.example..."
    cp .env.example .env
fi

# -------------------------
# Frontend
# -------------------------

echo ""
echo "Настраиваю frontend..."

if [ ! -d "$FRONTEND_DIR" ]; then
    echo "Ошибка: директория frontend не найдена."
    exit 1
fi

cd "$FRONTEND_DIR"

if [ ! -f "package.json" ]; then
    echo "Ошибка: frontend/package.json не найден."
    exit 1
fi

if [ -f "package-lock.json" ]; then
    echo "Устанавливаю зависимости через npm ci..."
    npm ci
else
    echo "package-lock.json не найден. Использую npm install..."
    npm install
fi

if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    echo "Создаю frontend/.env из .env.example..."
    cp .env.example .env
fi

echo ""
echo "========================================"
echo "Настройка завершена."
echo "========================================"
echo ""
echo "Теперь запусти:"
echo "./dev.sh"
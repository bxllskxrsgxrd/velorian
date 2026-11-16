# Velorian Backend

Backend приложения реализован на FastAPI. Общие инструкции по настройке, запуску и production-развёртыванию находятся в [корневом README](../README.md).

## Локальная настройка

Из корня проекта выполните:

```bash
./setup.sh
./dev.sh
```

Настройки backend загружаются из `backend/.env`. Шаблон доступен в `backend/.env.example`.

После запуска документация API доступна на `http://127.0.0.1:8000/docs`.

## Тесты

```bash
cd backend
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

В Windows используйте `.venv/Scripts/python.exe` вместо `.venv/bin/python`.

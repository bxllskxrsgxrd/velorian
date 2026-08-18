# Velorian

Локальный AI-чат на React, FastAPI и Groq. Дополнительные платные API не нужны: документы индексируются локально, OCR работает через Tesseract, веб-поиск использует встроенный инструмент выбранной модели Groq.

## Локальный запуск

1. Скопируйте `backend/.env.example` в `backend/.env` и укажите существующий `GROQ_API_KEY`.
2. Запустите `./start.sh` из корня проекта.
3. Откройте `http://localhost:5173`. При первом входе создайте локальную учётную запись.

Для OCR установите Tesseract с языками `rus` и `eng`. Без него изображения сохраняются и показываются, но текст с них не извлекается.

## Проверки

```bash
cd backend && .venv/bin/pytest -q
cd frontend && npm test && npm run lint && npm run build
```

## Production через Docker Compose

1. Скопируйте `.env.production.example` в `.env.production` и замените секреты.
2. Выполните `docker compose --env-file .env.production up --build -d`.
3. Приложение доступно на `http://localhost:8080` или порту `APP_PORT`.

При размещении за HTTPS-прокси установите `COOKIE_SECURE=true`. Метрики Prometheus доступны по `/metrics`, проверки — `/health/live` и `/health/ready`. Для нескольких экземпляров приложения in-memory rate limiter следует заменить на Redis.

## Файлы и AI

- PDF, DOCX и текстовые форматы извлекаются локально и попадают в лексический RAG текущего диалога.
- Изображения сначала обрабатываются локальным OCR, затем — vision-моделью `qwen/qwen3.6-27b` через уже существующий Groq-ключ. Если модель недоступна, чат автоматически использует OCR; vision можно отключить через `ENABLE_VISION=false`.
- Веб-поиск включается для отдельного запроса переключателем у поля ввода и доступен при модели Groq, поддерживающей `browser_search`.

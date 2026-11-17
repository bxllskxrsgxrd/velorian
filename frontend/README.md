# Velorian Frontend

Frontend приложения реализован на React, TypeScript и Vite. Общие инструкции по настройке, запуску и production-развёртыванию находятся в [корневом README](../README.md).

## Локальный запуск

Для запуска всего приложения из корня проекта выполните:

```bash
./setup.sh
./dev.sh
```

Только frontend:

```bash
cd frontend
npm ci
npm run dev
```

Frontend будет доступен на `http://localhost:5173`.

## Проверки

```bash
npm test
npm run lint
npm run build
```

E2E-тесты запускаются отдельно:

```bash
npm run test:e2e
```

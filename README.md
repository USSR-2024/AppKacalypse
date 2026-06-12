# AppKacalypse

**AI-диспетчер задач, заметок, напоминаний и календарных событий.**

Пользователь пишет обычным текстом в Telegram / email → локальный LLM (Qwen через
Ollama на GPU) извлекает структуру → n8n создаёт задачи в Vikunja и события в
календаре. Одно-серверная, полностью автономная архитектура. **Только локальный
LLM, без внешних API.**

Полное ТЗ: [`docs/ТЗ-appkacalypse.md`](docs/ТЗ-appkacalypse.md)
Онбординг для разработчика: [`docs/ONBOARDING.md`](docs/ONBOARDING.md)
Текущий статус: [`docs/СТАТУС.md`](docs/СТАТУС.md)

## Стек

Caddy · PostgreSQL · Valkey · Vikunja · n8n · LLM Gateway (FastAPI) · Ollama/Qwen

## Быстрый старт (dev, mock-LLM, без GPU)

```bash
cp .env.example .env          # заполнить секреты
docker compose up -d postgres valkey llm-gateway
curl localhost:8000/health    # LLM Gateway
```

Полное развёртывание на GPU-сервере — см. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Структура

| Каталог | Что |
|---|---|
| `docs/` | ТЗ, архитектура, деплой, безопасность, тест-кейсы |
| `infra/` | Caddyfile + bootstrap/deploy/backup/restore/healthcheck |
| `services/llm-gateway/` | FastAPI: выбор провайдера, JSON-валидация, нормализация |
| `n8n/workflows/` | Экспортированные воркфлоу n8n |
| `vikunja/seed/` | Справочники: проекты, пользователи, labels |
| `test-data/messages/` | Тестовый набор сообщений |

# ARCHITECTURE — AppKacalypse

## Обзор
Одно-серверная автономная система. Все компоненты — в Docker Compose на GPU-сервере.
Внешних зависимостей по LLM нет.

```
Пользователи: Telegram / Email / Webhook
        │
        ▼
   ┌─────────────────────────────────────────────┐
   │ RU GPU-сервер 158.255.0.82                   │
   │                                              │
   │  Caddy (HTTPS, reverse proxy)                │
   │    ├── tasks.* → Vikunja                      │
   │    └── n8n.*   → n8n                           │
   │                                              │
   │  n8n ──► LLM Gateway ──► Ollama/Qwen (GPU)    │
   │   │         │ validate JSON, normalize date   │
   │   │         │ confidence, redaction           │
   │   ▼         ▼                                 │
   │  Vikunja   Valkey (queue/cache/confirm-state) │
   │   │                                          │
   │  PostgreSQL (Vikunja + n8n)                   │
   │                                              │
   │  Calendar Provider (disabled по умолчанию)    │
   │  Backup · Healthcheck                         │
   └─────────────────────────────────────────────┘
```

## Поток: создание задачи
```
Telegram webhook → n8n (allowlist) → LLM Gateway → Qwen
→ JSON Schema validation → confidence ≥ threshold?
   ├ да  → Vikunja API → задача → бот шлёт подтверждение
   └ нет → бот задаёт уточняющий вопрос → ответ → создание
```

## Поток: календарное событие
```
сообщение → n8n → Gateway → Qwen → intent=create_calendar_event
→ есть дата+время+confidence ≥ 0.80? → Calendar Provider → событие
→ при linked task → Vikunja task ↔ event связываются ссылками
```

## Компоненты
| Компонент | Роль |
|---|---|
| Caddy | HTTPS (ACME), reverse proxy, маршрутизация доменов |
| PostgreSQL | БД Vikunja и n8n |
| Valkey | Очередь (fallback при недоступности Qwen), кэш, confirmation state |
| Vikunja | Task tracker (основной объект) |
| n8n | Webhook intake, оркестрация, вызовы API |
| LLM Gateway | FastAPI: выбор провайдера, JSON-валидация, нормализация даты/TZ, confidence, redaction |
| Ollama | Локальный запуск Qwen на GPU |
| calendar-adapter | Опц. FastAPI-слой календаря (в MVP — n8n workflow) |

## Принцип надёжности
- LLM недоступен → сообщение в очередь Valkey, не теряется; пользователю «обработаю позже».
- Календарь `disabled` → задачи всё равно создаются в Vikunja.
- LLM только извлекает данные; решение о создании — за валидацией и confirmation flow.

## Точка расширения
`LLM_PROVIDER` абстрагирован (`mock`/`ollama`/резерв `eu_relay`). Внешний LLM можно
добавить одной переменной, не переписывая систему. В MVP `eu_relay` не реализуется.

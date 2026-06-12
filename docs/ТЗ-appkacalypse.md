# Техническое задание — Hermes Task Dispatcher

**AI-диспетчер задач, заметок, напоминаний и календарных событий.**
Одно-серверная архитектура, локальный LLM (Qwen через Ollama), без внешних API.

Версия: 2.0 (single-server). Дата: 10.06.2026.

---

## 0. Ключевые решения

Эта версия заменяет прежнюю РФ/EU-архитектуру. Весь стек живёт на **одном RU GPU-сервере**; запросы обрабатывает **локальный Qwen**; внешние LLM-API (GPT, Claude и т.п.) **не используются для работы приложения**. За счёт этого из проекта убраны EU VPS, LLM Relay, межсерверный контур и слой анонимизации перед отправкой наружу.

| Вопрос | Решение |
|---|---|
| Где работает система? | Один RU GPU-сервер: Vikunja, n8n, PostgreSQL, LLM Gateway, Ollama/Qwen, bot webhooks, календарь, бэкапы. |
| Какой LLM? | Только локальный — `LLM_PROVIDER=ollama`, модель `qwen3:8b` (опц. `qwen3:14b` для качества). `mock` — для тестов без LLM. |
| Внешние API? | Не нужны. Сервер работает автономно, наружу за обработкой запросов не ходит. |
| Календарь в MVP? | Да, как модуль MVP+: provider по умолчанию `disabled`, но intent-extraction, правила, env и smoke-test входят в ТЗ. |
| Как предотвращаем ошибки LLM? | LLM только извлекает JSON; создание задач/событий делает n8n/backend после JSON Schema validation, confidence threshold и confirmation flow. |

> **Точка расширения на будущее.** Абстракция `LLM_PROVIDER` в LLM Gateway сохраняется (`mock` / `ollama` / `eu_relay`). Провайдер `eu_relay` **не реализуется сейчас**, но архитектурно оставлен: если локального Qwen где-то не хватит, внешний LLM добавляется одной переменной без переписывания системы.

---

## 1. Назначение

Собственный AI-диспетчер: пользователь пишет обычным языком в Telegram / MAX / email / webhook, система распознаёт намерение, извлекает структуру и создаёт управляемые объекты в Vikunja и календаре:

- распознавать задачи, напоминания, заметки и календарные события;
- определять исполнителя, проект, срок, приоритет и ограничения;
- создавать задачи в Vikunja;
- создавать календарные события/напоминания при включённом calendar provider;
- связывать задачи Vikunja с календарными событиями;
- задавать уточняющий вопрос при неполных данных;
- отправлять подтверждение автору;
- работать полностью локально через Qwen на GPU-сервере.

---

## 2. Область работ и границы MVP

### 2.1. MVP Core
- Telegram intake: пользователь пишет боту, n8n принимает webhook.
- LLM Gateway: единый слой выбора `mock`/`ollama`, JSON validation, нормализация.
- Локальный Qwen через Ollama как основной (и единственный) LLM-режим.
- Vikunja: проекты, задачи, исполнители, сроки, приоритеты, labels.
- Confirmation flow для неоднозначных задач.
- Бэкапы PostgreSQL и healthcheck-скрипты.

### 2.2. MVP+ Calendar
- Intent extraction для `create_reminder`, `create_calendar_event`, `create_task_with_calendar_event`.
- Calendar provider: `disabled`, `google`, `caldav` или `nextcloud`.
- Создание события при наличии даты и времени.
- Уточнение времени/участников/проекта при нехватке данных.
- Связь Vikunja task ↔ calendar event через ссылки в описаниях.

### 2.3. Не входит в MVP
- внешние LLM-API и любой межсерверный/EU-контур;
- сложная IAM/SSO-модель;
- мобильное приложение;
- голос, STT/TTS, аудиоассистент;
- сложный RAG по документам;
- автоматическое выполнение shell-команд;
- доступ LLM к серверу или базе данных;
- автоудаление/автоизменение задач без подтверждения;
- интеграция со всеми мессенджерами сразу;
- аналитика производительности команды.

---

## 3. Архитектура

```
Пользователи: Telegram / MAX / Email / Webhook
        ↓
RU GPU-сервер
  Caddy/Nginx + n8n + Vikunja + PostgreSQL
  + LLM Gateway + Ollama/Qwen + Calendar Provider
  + Backup / Healthcheck
        ↓
Vikunja / Calendar / уведомления
```

Система полностью автономна: всё (приём сообщений, разбор, создание объектов, хранение) происходит на одном сервере. Внешних зависимостей по LLM нет.

---

## 4. Целевая конфигурация сервера

| Параметр | Значение |
|---|---|
| ОС | Ubuntu Server 22.04 LTS |
| CPU / RAM | 8 vCPU / 32 GB |
| Диск | SSD 240 GB |
| GPU | RTX A4000 16 GB (vGPU) |
| Сеть | 1 Gbps, 1 IPv4 |
| Предустановлено | Ollama |

Назначение: основной и единственный стек — Vikunja, n8n, PostgreSQL, Ollama/Qwen, LLM Gateway, календарь.

> A4000 16 GB тянет `qwen3:8b` с запасом и `qwen3:14b` в Q4-квантовании (~9–10 GB) — есть резерв на повышение качества локально.

---

## 5. Компоненты

| Компонент | Роль | Статус |
|---|---|---|
| Docker / Docker Compose | Повторяемое развёртывание и изоляция сервисов. | обязательно |
| Caddy или Nginx | HTTPS, reverse proxy, маршрутизация доменов. | обязательно |
| PostgreSQL | База Vikunja/n8n и служебных данных. | обязательно |
| Valkey или Redis | Очереди, кэш, состояния подтверждений. | обязательно |
| Vikunja | Основной task tracker. | обязательно |
| n8n | Workflow automation: webhook, email, calendar, API-вызовы. | обязательно |
| LLM Gateway | Выбор провайдера, JSON validation, нормализация. | обязательно |
| Ollama | Локальный запуск Qwen. | обязательно (предустановлено) |
| Qwen3-8B | Основная локальная модель. | обязательно |
| Qwen3-14B | Тестовая модель для сравнения качества. | опционально |
| calendar-adapter | Календарный слой; в MVP может быть заменён n8n workflow. | опционально |

---

## 6. Потоки данных

### 6.1. Создание задачи
```
Пользователь → Telegram webhook → n8n → LLM Gateway → Ollama/Qwen
→ JSON Schema validation → Vikunja API → задача создана → бот шлёт подтверждение
```
Пример: «Завтра Ивану проверить VPN сервер».

### 6.2. Создание календарного события
```
Пользователь → Telegram/MAX/Email → n8n → LLM Gateway → Qwen
→ intent=create_calendar_event → Calendar Provider → событие (+ при необходимости задача Vikunja)
→ бот шлёт ссылку и подтверждение
```
Пример: «В пятницу в 15:00 созвон с Иваном по Hermes Avatar».

---

## 7. LLM Gateway

Единый слой на сервере:
- принимает запрос от n8n;
- выбирает `LLM_PROVIDER`: `mock` или `ollama`;
- передаёт текст в локальный Qwen;
- выполняет JSON Schema validation;
- нормализует дату/время и timezone;
- сопоставляет исполнителей, проекты и календарь;
- проверяет confidence threshold;
- решает, нужен ли confirmation flow;
- возвращает n8n готовый валидированный результат.

### Режимы LLM
| Режим | Переменная | Назначение |
|---|---|---|
| Локальный Qwen | `LLM_PROVIDER=ollama` | Основной рабочий режим. Данные никуда не уходят. |
| Mock | `LLM_PROVIDER=mock` | Тесты n8n/Vikunja/webhook без LLM. |
| (резерв) EU Relay | `LLM_PROVIDER=eu_relay` | Не реализуется в MVP. Точка расширения. |

---

## 8. Intent model и JSON-схемы

### 8.1. Поддерживаемые intent
| Intent | Назначение | Объект |
|---|---|---|
| create_task | Одна задача. | Vikunja task |
| create_tasks | Несколько задач из одного сообщения. | Vikunja tasks |
| create_reminder | Напоминание без встречи. | Calendar reminder или Vikunja task с reminder label |
| create_calendar_event | Встреча/созвон/событие с датой и временем. | Calendar event |
| create_task_with_calendar_event | И встреча, и задача. | Calendar event + Vikunja task |
| save_note | Заметка без действия. | Note storage; в MVP — Inbox/description |
| no_action | Нет задачи/события. | ничего |

### 8.2. Схема задачи
```json
{
  "intent": "create_tasks",
  "tasks": [
    {
      "title": "Проверить VPN сервер",
      "description": "",
      "project": "VPN",
      "assignee": "Иван",
      "due_text": "завтра",
      "due_iso": null,
      "priority": "medium",
      "constraints": [],
      "confidence": 0.90,
      "needs_confirmation": false
    }
  ],
  "questions": []
}
```

### 8.3. Схема календарного события
```json
{
  "intent": "create_calendar_event",
  "calendar_event": {
    "title": "Созвон с Иваном по Hermes Avatar",
    "description": "",
    "project": "Hermes",
    "start_text": "в пятницу в 15:00",
    "start_iso": "2026-06-12T15:00:00+03:00",
    "end_iso": "2026-06-12T16:00:00+03:00",
    "timezone": "Europe/Moscow",
    "participants": ["Иван"],
    "calendar": "default",
    "location": "",
    "meeting_url": "",
    "linked_task_required": false,
    "confidence": 0.88,
    "needs_confirmation": false
  },
  "questions": []
}
```

### 8.4. Confirmation rules
Автосоздание разрешено только при достаточной уверенности и полноте данных.

| Объект | Минимальные условия автосоздания |
|---|---|
| Задача | Есть title/действие, проект определён или Inbox, исполнитель определён или автор, confidence ≥ 0.75, needs_confirmation=false. |
| Напоминание | Есть title, дата/период понятны, проект определён или Inbox, confidence ≥ 0.80. |
| Календарное событие | Понятно, что это событие; есть title, дата, время начала, календарь; confidence ≥ 0.80; needs_confirmation=false. |
| Задача + событие | Обе части валидны; при неясности одной — уточняется только она. |

---

## 9. Calendar module

### 9.1. Provider
| Provider | Переменная | Когда |
|---|---|---|
| disabled | `CALENDAR_PROVIDER=disabled` | По умолчанию для первичного запуска. |
| google | `CALENDAR_PROVIDER=google` | Быстрый тест через Google Calendar и n8n. |
| caldav | `CALENDAR_PROVIDER=caldav` | Универсальный стандарт для self-hosted. |
| nextcloud | `CALENDAR_PROVIDER=nextcloud` | Предпочтительный self-hosted, если поднят Nextcloud Calendar. |

Для MVP можно реализовать через n8n; при усложнении логики — вынести в отдельный FastAPI `calendar-adapter`.

### 9.2. Правила связи с Vikunja
- Только дедлайн задачи → создаётся задача, событие не создаётся.
- Встреча/созвон/событие с датой/временем → создаётся календарное событие.
- И событие, и задача → создаются оба и связываются ссылками.
- Vikunja task description содержит ссылку на событие; calendar event description — ссылку на задачу.

### 9.3. Примеры
- «Завтра в 11:00 созвон с Петром по VPN» → `create_calendar_event`
- «Завтра вечером напомни проверить статус задач по Hermes» → `create_reminder`
- «Ивану до пятницы подготовить список моделей для Qwen» → `create_task` (срок в Vikunja, события нет)
- «В понедельник в 14:00 встреча по AletheiaOps Sprint 7, и после поставить мне задачу обновить roadmap» → `create_task_with_calendar_event`

---

## 10. Безопасность и данные

Поскольку сервер один и наружу за обработкой не ходит, модель безопасности проще:

1. Все рабочие данные (задачи, календарь, токены) хранятся только на этом сервере.
2. Внешние LLM-API не используются → пользовательский текст никуда не уходит.
3. Все секреты — только в `.env` или Docker secrets; `.env` не коммитится, `.env.example` коммитится.
4. Webhook закрываются allowlist/token.
5. LLM не получает секреты, пароли, ключи, приватные конфиги.
6. Логи не содержат API-ключей, токенов, паролей (regex-фильтр в LLM Gateway как fail-safe).
7. Для неоднозначных задач — confirmation flow.
8. Автоудаление и автоизменение задач без подтверждения запрещены в MVP.
9. Доступ к серверу — по SSH-ключу, нестандартный порт, пароль отключён, fail2ban.

---

## 11. Структура репозитория

```
hermes-task-dispatcher/
  README.md
  CLAUDE.md
  .env.example
  docker-compose.yml

  docs/
    ТЗ-hermes.md
    ARCHITECTURE.md
    DEPLOYMENT.md
    SECURITY.md
    LLM_LOCAL.md          # Ollama/Qwen
    CALENDAR.md
    TEST_CASES.md
    ONBOARDING.md

  infra/
    Caddyfile
    bootstrap.sh
    deploy.sh
    backup.sh
    restore.sh
    healthcheck.sh

  services/
    llm-gateway/
      Dockerfile
      app/
        main.py
        schemas.py
        config.py
        providers/
          mock_provider.py
          ollama_provider.py
        prompts/
          task_extraction_system.md
          task_extraction_user_template.md
        tests/
          test_task_extraction.py
    calendar-adapter/        # опционально
      Dockerfile
      app/
        main.py
        schemas.py
        providers/
          google_provider.py
          caldav_provider.py
          nextcloud_provider.py

  n8n/
    workflows/
      telegram-task-intake.json
      email-task-intake.json
      confirmation-flow.json
      calendar-event-intake.json

  vikunja/
    seed/
      projects.json
      users.json
      labels.json

  test-data/
    messages/
      ru-basic.json
      ru-ambiguous.json
      ru-multi-task.json
      ru-calendar.json
      ru-security-redaction.json
```

> Убраны: `llm-relay/`, `infra/eu/`, `wireguard/`, `docker-compose.eu.yml`, `.env.eu.example`, EU-документация.

---

## 12. Docker Compose (один файл)

| Сервис | Назначение | MVP |
|---|---|---|
| caddy | HTTPS и reverse proxy. | да |
| postgres | База Vikunja/n8n и служебных данных. | да |
| valkey | Очереди, кэш, confirmation state. | да |
| vikunja | Task tracker. | да |
| n8n | Workflow automation. | да |
| llm-gateway | Выбор LLM, validation, нормализация. | да |
| ollama | Локальный Qwen (GPU). | да |
| calendar-adapter | Календарный слой; в MVP — n8n workflow. | опционально |
| backup | Регулярные бэкапы. | да |
| prometheus/grafana/loki/promtail | Мониторинг и логи. | после MVP |

> `ollama` подключается к GPU через `nvidia-container-toolkit` (`deploy.resources.reservations.devices` / `--gpus all`).

---

## 13. Переменные окружения (.env.example)

```
# Common
TZ=Europe/Moscow
DOMAIN_TASKS=tasks.example.ru
DOMAIN_N8N=n8n.example.ru

# PostgreSQL
POSTGRES_DB=task_dispatcher
POSTGRES_USER=task_dispatcher
POSTGRES_PASSWORD=change_me

# Vikunja
VIKUNJA_JWT_SECRET=change_me
VIKUNJA_SERVICE_PUBLICURL=https://tasks.example.ru

# n8n
N8N_HOST=n8n.example.ru
N8N_PROTOCOL=https
N8N_ENCRYPTION_KEY=change_me
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=change_me

# Telegram
TELEGRAM_BOT_TOKEN=change_me
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321

# LLM
LLM_PROVIDER=ollama
LLM_CONFIDENCE_THRESHOLD=0.75
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen3:8b

# Calendar
CALENDAR_PROVIDER=disabled
CALENDAR_DEFAULT_DURATION_MINUTES=60
CALENDAR_DEFAULT_TIMEZONE=Europe/Moscow
CALENDAR_REQUIRE_CONFIRMATION=true

# Google Calendar
GOOGLE_CALENDAR_ENABLED=false
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_CREDENTIALS_FILE=/run/secrets/google-calendar-credentials.json

# CalDAV / Nextcloud
CALDAV_ENABLED=false
CALDAV_BASE_URL=https://calendar.example.ru/remote.php/dav
CALDAV_USERNAME=change_me
CALDAV_PASSWORD=change_me
CALDAV_DEFAULT_CALENDAR=personal
```

> Убраны все `EU_RELAY_*` и `.env.eu`.

---

## 14. Workflow-логика

### 14.1. Telegram → Vikunja task
1. Пользователь пишет боту.
2. n8n принимает webhook, проверяет allowlist.
3. n8n → LLM Gateway → Qwen → structured JSON.
4. LLM Gateway валидирует JSON, нормализует due_iso/timezone.
5. Если подтверждение не нужно — n8n создаёт задачу.
6. Если нужно — бот задаёт уточняющий вопрос, после ответа создаёт.
7. Бот отправляет ссылку на задачу.

### 14.2. Email → Vikunja task
1. n8n проверяет входящую почту/папку.
2. Письма-задачи → LLM Gateway → intent + структура.
3. n8n создаёт задачу или отправляет на подтверждение.
4. В description — тема письма, источник, безопасная выдержка.

### 14.3. Message → Calendar event
1. LLM Gateway определяет `create_calendar_event`.
2. Проверка даты/времени/календаря и confidence ≥ 0.80.
3. Не хватает данных — бот уточняет.
4. n8n/calendar-adapter создаёт событие.
5. При связанной задаче — создаётся/обновляется Vikunja task.
6. Бот шлёт ссылку.

### 14.4. Fallback и очередь
1. Используем локальный Qwen.
2. Если Qwen недоступен — сообщение кладётся в очередь (Valkey), не теряется.
3. Пользователю — «принято, обработаю позже».
4. По восстановлении Qwen очередь разбирается.

---

## 15. Справочники

### 15.1. Пользователи
```json
[
  {"name":"Я","aliases":["мне","себе","меня"],"telegram_id":"123456789","email":"owner@example.com","vikunja_user_id":1,"calendar_id":"primary"},
  {"name":"Иван","aliases":["иван","ивану","ваня","ване"],"telegram_id":"222222222","email":"ivan@example.com","vikunja_user_id":2,"calendar_id":"ivan@example.com"}
]
```

### 15.2. Проекты
```json
[
  {"name":"VPN","aliases":["vpn","впн","sing-box","xray","hysteria"]},
  {"name":"Hermes","aliases":["hermes","гермес","avatar","live2d"]},
  {"name":"AletheiaOps","aliases":["aletheia","алетея","платформа"]}
]
```

---

## 16. Дорожная карта (спринты)

| Спринт | Тема | Результат |
|---|---|---|
| Sprint 0 | Репозиторий и базовая документация | Repo создан; структура; `CLAUDE.md`; `.env.example`; `docker-compose.yml`; ТЗ в `docs/`. |
| Sprint 1 | Базовый стек | Docker/Compose, PostgreSQL, Vikunja, n8n, Caddy/Nginx, HTTPS, healthcheck. (Ollama уже предустановлена.) |
| Sprint 2 | Telegram intake | Бот создан; webhook подключён; allowlist работает; сообщение доходит до n8n. |
| Sprint 3 | Локальный Qwen + LLM Gateway | `qwen3:8b` отвечает на GPU; Gateway подключён; `mock`→`ollama`; тестовый JSON валиден. |
| Sprint 4 | Создание задач в Vikunja | n8n → Gateway → задача с проектом, исполнителем, сроком, source label. |
| Sprint 5 | Confirmation flow | Неоднозначные задачи не создаются автоматически; бот уточняет; после подтверждения создаёт. |
| Sprint 5.5 | Calendar Provider Decision | Выбран provider: disabled/google/caldav/nextcloud; описаны токены. |
| Sprint 5.6 | Calendar Intent Extraction | LLM различает task/reminder/calendar_event/task_with_event; timezone нормализуется. |
| Sprint 5.7 | Calendar Event Creation | n8n/calendar-adapter создаёт событие; ссылка возвращается; неполные события требуют подтверждения. |
| Sprint 5.8 | Calendar + Vikunja Linking | Задача и событие связываются ссылками; дедлайн не путается с событием; smoke-test проходит. |
| Sprint 6 | Качество Qwen | 50+ тестовых сообщений; прогон через Qwen; ошибки классифицированы; промпт улучшен; при необходимости проба `qwen3:14b`. |
| Sprint 7 | Fallback и очередь | При сбое Qwen сообщение уходит в очередь; пользователь получает понятный ответ; очередь разбирается после восстановления. |
| Sprint 8 | Production deploy scripts | bootstrap/deploy/backup/restore/healthcheck; инструкции; smoke-test после установки. |

> Убраны прежние Sprint 6 (EU Relay) и часть Sprint 7 (сравнение с GPT). EU-сервер из плана исключён.

---

## 17. Тестовый набор

Минимум 50 сообщений. Категории: простая задача; несколько задач; явный исполнитель; «мне/себе»; срок «завтра/вечером/до пятницы/на следующей неделе»; проект явно; проект из контекста; непонятный проект; непонятный исполнитель; задача с ограничением; заметка; напоминание; календарное событие; задача + событие; сообщение без действия; сообщение с секретом (redaction test).

**Redaction test.** Вход: «Завтра проверить сервер root@1.2.3.4, токен sk-... не отправлять наружу». Ожидание: текст обрабатывается локально; в логах секреты замаскированы (`[SERVER_LOGIN]`, `[API_KEY]`); задача создаётся после validation/confirmation. (Поскольку внешних LLM нет, утечки наружу в принципе не происходит — redaction нужен только для логов.)

---

## 18. Smoke-tests

### 18.1. Базовые
1. Открыть Vikunja. 2. Открыть n8n. 3. `ollama list`. 4. Проверить `qwen3:8b` на GPU. 5. Написать боту «Завтра Ивану проверить VPN сервер». 6. Задача создана в Vikunja. 7. Бот прислал подтверждение. 8. В логах нет секретов.

### 18.2. Calendar
1. Включить `CALENDAR_PROVIDER`. 2. Проверить подключение. 3. «Завтра в 15:00 созвон с Иваном по VPN» → событие создано. 4. «Ивану до пятницы проверить VPN сервер» → создана задача, не событие. 5. «В понедельник встреча по Hermes» → бот запросил время.

---

## 19. Критерии готовности MVP

1. Сервер разворачивается из репозитория. 2. Vikunja работает. 3. n8n работает. 4. Telegram-бот принимает сообщения. 5. LLM Gateway работает. 6. Ollama/Qwen работает на GPU. 7. Задачи создаются в Vikunja. 8. Confirmation flow работает. 9. Календарь отключается через `CALENDAR_PROVIDER=disabled`. 10. Система различает задачу, напоминание и событие. 11. При включённом календаре событие создаётся из сообщения с датой/временем. 12. Без времени события бот уточняет. 13. Задачи и события связываются ссылками. 14. Переключение `LLM_PROVIDER=ollama/mock` работает. 15. Есть backup script. 16. Есть healthcheck script. 17. Есть тестовый набор сообщений. 18. Есть документация развёртывания. 19. Секреты не в Git. 20. Логи без токенов и ключей.

---

## 20. Эксплуатация и бэкапы

**Backup (ежедневно):** PostgreSQL dump; export n8n workflows; backup Vikunja files/config; backup calendar-adapter config без секретов.
**Хранение:** daily 7 дней, weekly 4 недели, monthly 3 месяца. `.env` и ключи — вне Git, отдельным защищённым процессом.
**Healthchecks:** Vikunja HTTP, n8n HTTP, PostgreSQL connection, Ollama model availability, LLM Gateway health, Calendar Provider health (если включён).

---

## 21. Финальный принцип

- Если Qwen недоступен — сообщения не теряются, уходят в очередь.
- Если calendar provider отключён — задачи продолжают создаваться в Vikunja.
- Система автономна: один сервер, локальный LLM, без внешних API.

---

## Приложение A. Среда разработки

Продакшн-сервер **не требует** доступа к внешним LLM-API и работает в RU автономно. Разработку же ведёт связка «джуниор + Claude Code»; **Claude Code запускается не на этом сервере**, а с машины разработчика, имеющей доступ к Anthropic, и подключается к серверу по SSH (правки локально → деплой по SSH). Это разделение: продакшн локально-автономен; инструмент разработки живёт на стороне разработчика.

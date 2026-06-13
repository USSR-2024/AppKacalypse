# CLAUDE.md — AppKacalypse

Гайд для Claude Code и разработчика. Читать перед работой.

## Что это
AI-диспетчер задач для личной и командной работы. Задачи ставятся обычным языком
(PWA-приложение / встроенный чат-ассистент / Telegram-бот) → локальный Qwen разбирает
в структуру → задача создаётся в своей БД → система напоминает о сроках.
**Свой бэкенд + PWA на своём GPU-сервере. Без внешних LLM-API.** Единственная внешняя
зависимость — Telegram-бот (вход + интейк + дайджесты).

> **Разворот (2026-06-12):** изначально строили на Vikunja+n8n — отказались (UI «не вкусный»,
> слабый API). Пишем своё, переиспользуя AI-ядро (Gateway+Qwen), сервер, Caddy, HTTPS.

Продуктовое ТЗ: `docs/ТЗ-app.md`. Инфра/Gateway ТЗ: `docs/ТЗ-appkacalypse.md`. Статус: `docs/СТАТУС.md`.

## Инфраструктура и доступы
- **Control `89.125.2.39`** (вне РФ): тут Claude Code + git. Правки → commit → push.
  Anthropic из РФ заблокирован → Claude НЕ запускается на 158, только тут.
- **GPU-сервер `158.255.0.82`** (RU, A4000 16GB, Ubuntu 24.04; SSH порт **19949**):
  рантайм. `ssh -i ~/.ssh/hermes_key2 -p 19949 root@158.255.0.82`
- **GitHub** `USSR-2024/AppKacalypse`, ветка `main`, SSH-over-443 (host-alias `github-appkacalypse`, deploy key с write).
- **Домен:** `appkacalypse.baassist.ru` → приложение (фронт + `/api`→бэк). HTTPS Caddy+LE.
- **Бот:** `@appKACAlypse_bot`.

## Стек
- **Backend:** Node+TS+Hono+Postgres+Drizzle+Zod+JWT. `backend/`. Контейнер `akc-backend:8081`.
- **Frontend:** Next.js 16 PWA (App Router, Tailwind v4, SWR+Zustand). `frontend/`. Контейнер `akc-frontend:3000`.
- **LLM Gateway:** FastAPI + `qwen3:14b` (Ollama, GPU). `services/llm-gateway/`. `think:false` → ~5с.
- **БД приложения:** отдельная база `akc` в `appkacalypse-postgres-1` (НЕ task_dispatcher — там Vikunja).

## Деплой (вручную; rsync на 158 НЕТ)
1. Код на 158: `tar czf - --exclude=node_modules --exclude=.next --exclude=dist --exclude='.env*' backend frontend services/llm-gateway | ssh ... 'tar xzf - -C /root/appkacalypse'`
2. Пересборка: бэк/фронт — `docker compose -p akcapp -f /root/appkacalypse/docker-compose.app.yml up -d --build backend frontend`; gateway — `docker compose -p appkacalypse -f /root/appkacalypse/docker-compose.yml up -d --build llm-gateway`. **Абсолютные пути обязательны** (ssh-команды стартуют в /root, не в проекте).
3. Бэк мигрирует БД на старте (CMD: `migrate.js && index.js`).
4. Caddy: правка `infra/Caddyfile` → `docker restart appkacalypse-caddy-1` (reload через exec НЕ применяется).

## Архитектурные правила
1. **LLM только извлекает JSON.** Создание/изменение делает бэкенд после валидации.
2. **LLM не имеет доступа** к серверу, БД, секретам.
3. **Секреты только в `.env`** (gitignored). `backend/.env`, `frontend/.env.local` — на 158, не в git.
4. **`users.id` = внутренний UUID**, способы входа в `auth_identities` (отвязаны от id).
5. Только Drizzle ORM, Zod-валидация, JWT на защищённых эндпоинтах. Без лишних комментариев/абстракций.
6. **Прод-безопасность:** `ALLOW_DEV_AUTH=0`, `NEXT_PUBLIC_ALLOW_DEV=0` (dev-вход только локально).

## Готово (S2–S5, всё задеплоено)
CRUD задач/проектов/юзеров · Telegram-авторизация · PWA (Сегодня/Входящие/Проекты+канбан/Календарь/Профиль/Выполненные/правка задачи) · AI-ассистент в приложении (создание + Q&A) · Telegram-бот (интейк + доспрос + Q&A) · напоминания утро/вечер в Telegram.

## Бэклог
Ассистент внутри проекта (контекстный Q&A) · push-канал (VAPID готов, нужен SW+подписка) · email-канал · календарь-сетка · свайпы · иконка · уборка Vikunja/n8n/AppFlowy из стека.

## Рабочий процесс
- Ветка `main`. Коммиты атомарные, по-русски, без секретов.
- Перед коммитом: `npm run typecheck` (backend), `npm run build` (frontend).
- Общение с владельцем: по-русски, коротко.
- Бот может писать юзеру только после того, как тот сделал `/start` (ограничение Telegram).

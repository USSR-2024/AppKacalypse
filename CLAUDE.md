# CLAUDE.md — AppKacalypse

Гайд для Claude Code и разработчика. Читать перед работой.

## Что это
AI-диспетчер задач/заметок/напоминаний/календаря. Текст из Telegram/email →
локальный Qwen (Ollama, GPU) извлекает JSON → n8n создаёт объекты в Vikunja и
календаре. Одно-серверная автономная система, **без внешних LLM-API**.

Полное ТЗ: `docs/ТЗ-appkacalypse.md`. Статус: `docs/СТАТУС.md`.

## Инфраструктура и доступы
- **Control-сервер `89.125.2.39`** (вне РФ): здесь работает Claude Code, тут git-копия.
  Правки → commit → push в GitHub.
- **GPU-сервер `158.255.0.82`** (RU, Hostkey; SSH порт **19949**, root по ключу):
  рантайм-копия, тут крутится весь docker-стек. Деплой = `git pull` + `docker compose up`.
  - A4000 16GB · 8 vCPU · 31GB RAM · Ubuntu 24.04.
  - SSH: `ssh -i ~/.ssh/hermes_key2 -p 19949 root@158.255.0.82`
- **GitHub** `git@github.com:USSR-2024/AppKacalypse.git` — доступ через SSH-over-443
  (порт 22 заблокирован на обеих машинах). Конфиг в `~/.ssh/config`.
- Anthropic заблокирован из РФ → Claude НЕ запускается на 158, только на control.

## Архитектурные правила (из ТЗ)
1. **LLM только извлекает JSON.** Создание задач/событий делает n8n/backend ПОСЛЕ
   JSON Schema validation + confidence threshold + confirmation flow.
2. **LLM не имеет доступа** к серверу, БД, секретам.
3. **Никаких внешних API** для работы приложения. Провайдер `eu_relay` — только
   зарезервированная точка расширения, не реализуется.
4. `LLM_PROVIDER`: `mock` (тесты без GPU) | `ollama` (рабочий режим).
5. **Секреты только в `.env`** (не коммитится) или Docker secrets. `.env.example` — коммитится.
6. **Redaction**: логи без токенов/паролей/ключей (regex-фильтр в Gateway).
7. **Автоудаление/автоизменение задач без подтверждения запрещено.**

## Границы MVP
- В MVP: Telegram (текст + forward) и email intake, Vikunja, Gateway, Qwen,
  confirmation flow, бэкапы, healthcheck. Календарь — MVP+ (по умолчанию `disabled`).
- НЕ в MVP: голос/Whisper/STT, мобильное приложение, RAG, SSO, авто-выполнение shell.

## Рабочий процесс
- Ветка `main`. Фичи — через ветки `sprintN-*`, PR в `main`.
- Коммиты атомарные, по-русски, без секретов.
- Перед коммитом: тесты Gateway (`pytest services/llm-gateway`), `docker compose config`.
- Деплой на 158: `infra/deploy.sh` (pull + build + up + smoke).

## Модель
Основная — `qwen3:14b` (Q4 ~9-10GB, A4000 тянет). Тестовая для сравнения — `qwen3:8b`.

## Спринты (см. ТЗ §16)
S0 репо/скаффолд · S1 базовый стек · S2 Telegram intake · S3 Qwen+Gateway ·
S4 задачи в Vikunja · S5 confirmation · S5.5-5.8 календарь · S6 качество ·
S7 fallback/очередь · S8 deploy-скрипты.

**Сейчас: Sprint 0.**

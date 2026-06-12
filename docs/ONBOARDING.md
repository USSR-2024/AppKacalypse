# ONBOARDING — AppKacalypse

Для джуниора, работающего в связке с Claude Code.

## 1. Что за проект
AI-диспетчер: текст из Telegram/email → локальный Qwen извлекает JSON → n8n
создаёт задачи в Vikunja. Всё на одном GPU-сервере, без внешних API.
Сначала прочитай `README.md`, `CLAUDE.md`, затем `docs/ТЗ-appkacalypse.md`.

## 2. Две машины
| Машина | Роль |
|---|---|
| Control `89.125.2.39` (вне РФ) | Здесь Claude Code и git-разработка. |
| GPU `158.255.0.82` (RU, SSH :19949) | Рантайм: docker-стек, Ollama, Qwen. |

Anthropic заблокирован из РФ → код пишем на control, деплоим на 158 по SSH.

## 3. Локальная разработка без GPU
```bash
cp .env.example .env          # заполнить change_me
# выставить LLM_PROVIDER=mock
docker compose up -d postgres valkey llm-gateway
curl localhost:8000/health
pytest services/llm-gateway   # тесты на mock-провайдере
```
`mock` отдаёт детерминированный JSON — можно гонять n8n/Vikunja без модели.

## 4. Деплой на 158
```bash
ssh -i ~/.ssh/hermes_key2 -p 19949 root@158.255.0.82
cd /root/appkacalypse && git pull && docker compose up -d --build
infra/healthcheck.sh
```
Или одной командой с control: `infra/deploy.sh`.

## 5. Git
- Доступ к GitHub — через SSH-over-443 (`~/.ssh/config` уже настроен).
- Ветка `main`. Фичи: `git checkout -b sprintN-кратко`.
- Коммиты по-русски, атомарные, **без секретов** (проверь `git diff` перед commit).

## 6. Куда смотреть
| Хочешь… | Файл |
|---|---|
| Понять архитектуру | `docs/ARCHITECTURE.md` |
| Развернуть стек | `docs/DEPLOYMENT.md` |
| Правила безопасности | `docs/SECURITY.md` |
| Настроить Ollama/Qwen | `docs/LLM_LOCAL.md` |
| Календарь | `docs/CALENDAR.md` |
| Тест-кейсы | `docs/TEST_CASES.md` |
| Промпт извлечения | `services/llm-gateway/app/prompts/` |

## 7. Главные «нельзя»
- Не коммить `.env` и ключи.
- LLM не трогает БД/секреты/shell.
- Никаких внешних LLM-API.
- Не создавать/менять/удалять задачи без confirmation flow для неоднозначных.

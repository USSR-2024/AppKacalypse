# LLM_LOCAL — Ollama / Qwen

## Модель
- **Основная:** `qwen3:14b` (Q4 ~9-10GB VRAM — A4000 16GB тянет с запасом).
- **Тестовая:** `qwen3:8b` (легче/быстрее, для сравнения качества на Sprint 6).
- Переключение через `OLLAMA_MODEL` в `.env`.

## Установка модели
```bash
docker compose up -d ollama
docker compose exec ollama ollama pull qwen3:14b
docker compose exec ollama ollama list
```

## Проверка GPU
```bash
nvidia-smi                                   # драйвер хоста
docker compose exec ollama nvidia-smi        # GPU виден в контейнере
# тестовый прогон:
docker compose exec ollama ollama run qwen3:14b "Ответь одним словом: работает?"
```

## Роль LLM (строго)
LLM **только извлекает структурированный JSON** из текста. Он НЕ:
- создаёт/меняет/удаляет задачи (это делает n8n/backend после валидации);
- имеет доступ к БД, серверу, секретам;
- ходит наружу.

## Промпт
- System prompt: `services/llm-gateway/app/prompts/task_extraction_system.md`
- User template: `services/llm-gateway/app/prompts/task_extraction_user_template.md`
- Подставляются текущая дата/день недели/timezone (Europe/Moscow).
- Требуется СТРОГО JSON по схеме из `app/schemas.py` (intent-модель ТЗ §8).

## Режимы провайдера
| Режим | Когда |
|---|---|
| `LLM_PROVIDER=ollama` | Рабочий. Запрос идёт в Qwen на GPU. |
| `LLM_PROVIDER=mock` | Тесты без GPU. Детерминированный JSON. |
| `LLM_PROVIDER=eu_relay` | Резерв, не реализуется в MVP. |

## Тюнинг качества (Sprint 6)
- 50+ тестовых сообщений (`test-data/messages/`), прогон через Qwen, классификация ошибок.
- Правка system-промпта; при нехватке качества — проба `qwen3:14b` против `8b`.
- Контроль confidence threshold (`LLM_CONFIDENCE_THRESHOLD`, по умолчанию 0.75).

## Fallback
Qwen недоступен → сообщение в очередь Valkey, пользователю «принято, обработаю позже»,
по восстановлении очередь разбирается. Сообщения не теряются.

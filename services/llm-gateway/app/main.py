"""
LLM Gateway — единый слой (ТЗ §7).
Принимает текст от n8n → провайдер (mock|ollama) → JSON Schema validation →
нормализация → confidence/confirmation → отдаёт n8n валидированный результат.
"""
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from app.config import config
from app.providers import get_provider
from app.redaction import redact
from app.schemas import ExtractRequest, ExtractResult, Intent

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("llm-gateway")

app = FastAPI(title="AppKacalypse LLM Gateway", version="0.1.0")
provider = get_provider()

# intent → требуется ли календарное событие в результате
_CALENDAR_INTENTS = {Intent.create_calendar_event, Intent.create_task_with_calendar_event}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "provider": provider.name, "model": config.OLLAMA_MODEL}


@app.get("/health/llm")
async def health_llm() -> dict:
    ok = await provider.health()
    return {"provider": provider.name, "healthy": ok}


def _apply_confirmation(result: ExtractResult) -> ExtractResult:
    """Confidence threshold + правила автосоздания (ТЗ §8.4).
    Ставит needs_confirmation, если уверенность ниже порога или есть вопросы."""
    thr = config.CONFIDENCE_THRESHOLD
    need = bool(result.questions)

    for t in result.tasks:
        if t.confidence < thr or not t.title:
            t.needs_confirmation = True
        need = need or t.needs_confirmation

    ev = result.calendar_event
    if ev is not None:
        if ev.confidence < max(thr, 0.80) or not (ev.title and (ev.start_iso or ev.start_text)):
            ev.needs_confirmation = True
        need = need or ev.needs_confirmation

    result.needs_confirmation = need
    return result


@app.post("/extract", response_model=ExtractResult)
async def extract(req: ExtractRequest) -> ExtractResult:
    now_iso = req.now_iso or datetime.now(timezone.utc).astimezone().isoformat()
    # Тело сообщения НЕ логируем (приватность) — только метаданные.
    log.info("extract source=%s len=%d", req.source, len(req.text))

    try:
        raw = await provider.extract(req, now_iso)
    except Exception as e:  # noqa: BLE001 — отдать n8n понятную ошибку для fallback-очереди
        log.error("provider error: %s", redact(str(e)))
        raise HTTPException(status_code=502, detail="llm_unavailable")

    try:
        result = ExtractResult(**raw)
    except ValidationError as e:
        # Без input-значений в логе — там могут быть куски сообщения пользователя.
        errs = [f"{'.'.join(map(str, x['loc']))}: {x['type']}" for x in e.errors(include_input=False)]
        log.error("invalid LLM JSON: %s", "; ".join(errs))
        raise HTTPException(status_code=422, detail="invalid_llm_output")

    # sanity: календарный intent без события / задачный без задач
    if result.intent in _CALENDAR_INTENTS and result.calendar_event is None:
        raise HTTPException(status_code=422, detail="missing_calendar_event")
    if result.intent in (Intent.create_task, Intent.create_tasks) and not result.tasks:
        raise HTTPException(status_code=422, detail="missing_tasks")

    return _apply_confirmation(result)

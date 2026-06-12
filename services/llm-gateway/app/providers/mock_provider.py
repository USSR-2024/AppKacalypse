"""
Mock-провайдер — детерминированный ответ без LLM (ТЗ §7).
Нужен для тестов n8n/Vikunja/webhook без GPU. Простая эвристика по ключевым словам,
НЕ претендует на качество — только валидная структура.
"""
from app.providers.base import LLMProvider
from app.schemas import ExtractRequest


class MockProvider(LLMProvider):
    name = "mock"

    async def extract(self, req: ExtractRequest, now_iso: str) -> dict:
        text = req.text.strip()
        low = text.lower()

        if not low or any(w in low for w in ("спасибо", "ок", "понятно")):
            return {"intent": "no_action", "questions": []}

        if any(w in low for w in ("созвон", "встреч", "совещан", "в ", ":00")) and any(
            w in low for w in (":", "час", "утра", "вечера", "00")
        ):
            return {
                "intent": "create_calendar_event",
                "calendar_event": {
                    "title": text[:80],
                    "description": "",
                    "project": None,
                    "start_text": text,
                    "start_iso": None,
                    "timezone": "Europe/Moscow",
                    "participants": [],
                    "calendar": "default",
                    "confidence": 0.5,
                    "needs_confirmation": True,
                },
                "questions": ["Уточните дату и время события."],
            }

        if any(w in low for w in ("напомни", "напоминание")):
            return {
                "intent": "create_reminder",
                "tasks": [{
                    "title": text[:80], "description": "", "due_text": None,
                    "priority": "medium", "confidence": 0.6, "needs_confirmation": True,
                }],
                "questions": [],
            }

        # по умолчанию — задача
        return {
            "intent": "create_task",
            "tasks": [{
                "title": text[:80],
                "description": "",
                "project": None,
                "assignee": req.author,
                "due_text": "завтра" if "завтра" in low else None,
                "due_iso": None,
                "priority": "high" if any(w in low for w in ("срочно", "горит")) else "medium",
                "constraints": [],
                "confidence": 0.7,
                "needs_confirmation": True,
            }],
            "questions": [],
        }

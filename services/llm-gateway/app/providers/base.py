"""Базовый интерфейс провайдера. Провайдер возвращает СЫРОЙ dict от LLM;
валидацию/нормализацию делает main.py."""
from abc import ABC, abstractmethod

from app.schemas import ExtractRequest


class LLMProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def extract(self, req: ExtractRequest, now_iso: str) -> dict:
        """Вернуть сырой JSON-dict ответа модели по intent-схеме."""
        raise NotImplementedError

    async def announce(self, changes: list[str]) -> dict:
        """Краткое уведомление об обновлении из списка изменений. По умолчанию — без LLM."""
        return {"title": "🚀 Обновление", "body": "\n".join(f"• {c}" for c in changes)}

    async def health(self) -> bool:
        return True

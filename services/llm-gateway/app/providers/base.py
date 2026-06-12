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

    async def health(self) -> bool:
        return True

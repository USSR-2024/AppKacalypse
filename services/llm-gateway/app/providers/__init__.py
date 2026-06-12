"""Выбор LLM-провайдера по конфигу."""
from app.config import config
from app.providers.base import LLMProvider
from app.providers.mock_provider import MockProvider
from app.providers.ollama_provider import OllamaProvider


def get_provider() -> LLMProvider:
    provider = config.PROVIDER.lower()
    if provider == "ollama":
        return OllamaProvider()
    if provider == "mock":
        return MockProvider()
    # eu_relay — зарезервирован, не реализуется в MVP
    raise ValueError(f"Неизвестный LLM_PROVIDER: {config.PROVIDER!r} (ожидается mock|ollama)")

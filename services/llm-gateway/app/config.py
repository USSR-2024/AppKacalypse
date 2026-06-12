"""Конфигурация LLM Gateway из окружения."""
import os


class Config:
    PROVIDER: str = os.getenv("LLM_PROVIDER", "mock")  # mock | ollama
    CONFIDENCE_THRESHOLD: float = float(os.getenv("LLM_CONFIDENCE_THRESHOLD", "0.75"))
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen3:14b")
    TIMEZONE: str = os.getenv("CALENDAR_DEFAULT_TIMEZONE", "Europe/Moscow")
    REQUEST_TIMEOUT: float = float(os.getenv("LLM_REQUEST_TIMEOUT", "120"))


config = Config()

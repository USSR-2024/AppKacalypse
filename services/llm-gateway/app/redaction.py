"""
Redaction для логов (ТЗ §10.6). Маскирует секреты ПЕРЕД записью в лог.
Не влияет на обработку — внешних LLM нет, утечки наружу не происходит,
это fail-safe для логов.
"""
import re

_PATTERNS = [
    # логины user@host / root@1.2.3.4
    (re.compile(r"\b[\w.+-]+@(?:\d{1,3}(?:\.\d{1,3}){3}|[\w.-]+\.\w+)\b"), "[SERVER_LOGIN]"),
    # API-ключи sk-..., Bearer ...
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"), "[API_KEY]"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._-]{8,}\b", re.IGNORECASE), "Bearer [API_KEY]"),
    # password=... / token=...
    (re.compile(r"(?i)\b(password|passwd|pwd|token|secret)\s*[=:]\s*\S+"), r"\1=[REDACTED]"),
    # длинные hex/base64 (≥32) — вероятные ключи
    (re.compile(r"\b[A-Fa-f0-9]{32,}\b"), "[API_KEY]"),
]


def redact(text: str) -> str:
    if not text:
        return text
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text

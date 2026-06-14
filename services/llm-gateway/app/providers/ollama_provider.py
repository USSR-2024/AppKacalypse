"""
Ollama-провайдер — рабочий режим (ТЗ §7). Шлёт текст в локальный Qwen и просит
строго JSON (format=json). Парсинг/валидация — в main.py.
"""
import json
from pathlib import Path

import httpx

from app.config import config
from app.providers.base import LLMProvider
from app.schemas import ExtractRequest

_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


def _load(name: str) -> str:
    return (_PROMPTS / name).read_text(encoding="utf-8")


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self) -> None:
        self.system = _load("task_extraction_system.md")
        self.user_template = _load("task_extraction_user_template.md")
        self.announce_system = _load("announce_system.md")

    def _build_prev(self, req: ExtractRequest) -> str:
        p = req.prev
        if not p:
            return ""
        fields = [
            ("title", p.title), ("project", p.project), ("assignee", p.assignee),
            ("due_text", p.due_text), ("priority", p.priority),
        ]
        lines = [f"- {k}: {v}" for k, v in fields if v]
        if not lines:
            return ""
        return "Текущий черновик задачи (применяй правки из сообщения к нему):\n" + "\n".join(lines) + "\n"

    def _build_user(self, req: ExtractRequest, now_iso: str) -> str:
        return (
            self.user_template
            .replace("{{NOW_ISO}}", now_iso)
            .replace("{{TIMEZONE}}", config.TIMEZONE)
            .replace("{{AUTHOR}}", req.author or "автор")
            .replace("{{SOURCE}}", req.source)
            .replace("{{TEXT}}", req.text)
            .replace("{{PREV}}", self._build_prev(req))
        )

    async def extract(self, req: ExtractRequest, now_iso: str) -> dict:
        payload = {
            "model": config.OLLAMA_MODEL,
            "stream": False,
            "format": "json",
            "think": False,                 # qwen3 — thinking-модель; рассуждения нам не нужны, только JSON
            "keep_alive": config.KEEP_ALIVE,  # держим модель в VRAM между сообщениями
            "options": {"temperature": 0.1},
            "messages": [
                {"role": "system", "content": self.system},
                {"role": "user", "content": self._build_user(req, now_iso)},
            ],
        }
        async with httpx.AsyncClient(timeout=config.REQUEST_TIMEOUT) as client:
            resp = await client.post(f"{config.OLLAMA_BASE_URL}/api/chat", json=payload)
            resp.raise_for_status()
            content = resp.json()["message"]["content"]
        return json.loads(content)

    async def announce(self, changes: list[str]) -> dict:
        user = "Изменения:\n" + "\n".join(f"- {c}" for c in changes)
        payload = {
            "model": config.OLLAMA_MODEL,
            "stream": False,
            "format": "json",
            "think": False,
            "keep_alive": config.KEEP_ALIVE,
            "options": {"temperature": 0.3},
            "messages": [
                {"role": "system", "content": self.announce_system},
                {"role": "user", "content": user},
            ],
        }
        async with httpx.AsyncClient(timeout=config.REQUEST_TIMEOUT) as client:
            resp = await client.post(f"{config.OLLAMA_BASE_URL}/api/chat", json=payload)
            resp.raise_for_status()
            content = resp.json()["message"]["content"]
        return json.loads(content)

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{config.OLLAMA_BASE_URL}/api/tags")
                return r.status_code == 200
        except Exception:
            return False

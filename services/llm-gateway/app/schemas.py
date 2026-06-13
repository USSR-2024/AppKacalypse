"""
Pydantic-схемы intent-модели (ТЗ §8).
Gateway валидирует ответ LLM по этим схемам ПЕРЕД тем, как n8n что-либо создаёт.
"""
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class Intent(str, Enum):
    create_task = "create_task"
    create_tasks = "create_tasks"
    create_reminder = "create_reminder"
    create_calendar_event = "create_calendar_event"
    create_task_with_calendar_event = "create_task_with_calendar_event"
    save_note = "save_note"
    query_tasks = "query_tasks"
    no_action = "no_action"


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Task(BaseModel):
    title: str
    description: str = ""
    project: Optional[str] = None
    assignee: Optional[str] = None
    due_text: Optional[str] = None
    due_iso: Optional[str] = None
    priority: Priority = Priority.medium
    constraints: List[str] = Field(default_factory=list)
    confidence: float = 0.0
    needs_confirmation: bool = True


class CalendarEvent(BaseModel):
    title: str
    description: str = ""
    project: Optional[str] = None
    start_text: Optional[str] = None
    start_iso: Optional[str] = None
    end_iso: Optional[str] = None
    timezone: str = "Europe/Moscow"
    participants: List[str] = Field(default_factory=list)
    calendar: str = "default"
    location: str = ""
    meeting_url: str = ""
    linked_task_required: bool = False
    confidence: float = 0.0
    needs_confirmation: bool = True


class TaskQuery(BaseModel):
    """Фильтр для intent=query_tasks (вопрос о существующих задачах)."""
    scope: str = "all"                 # today | overdue | week | important | all
    assignee: Optional[str] = None     # имя | "me" (про себя) | null
    project: Optional[str] = None      # имя проекта | null
    important_only: bool = False
    include_done: bool = False         # включать выполненные


class ExtractRequest(BaseModel):
    text: str
    source: str = "telegram"          # telegram | email | webhook
    author: Optional[str] = None      # имя/алиас автора (для «мне/себе»)
    now_iso: Optional[str] = None     # текущее время от n8n; иначе берём серверное


class ExtractResult(BaseModel):
    """Нормализованный результат, который Gateway отдаёт n8n."""
    intent: Intent
    tasks: List[Task] = Field(default_factory=list)
    calendar_event: Optional[CalendarEvent] = None
    query: Optional[TaskQuery] = None
    note: Optional[str] = None
    questions: List[str] = Field(default_factory=list)
    needs_confirmation: bool = True

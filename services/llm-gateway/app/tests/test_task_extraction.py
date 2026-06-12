"""
Тесты Gateway на mock-провайдере (без GPU). Запуск:
    LLM_PROVIDER=mock pytest services/llm-gateway
"""
import os

os.environ.setdefault("LLM_PROVIDER", "mock")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["provider"] == "mock"


def test_basic_task():
    r = client.post("/extract", json={"text": "Завтра проверить VPN сервер", "author": "Я"})
    assert r.status_code == 200
    data = r.json()
    assert data["intent"] == "create_task"
    assert data["tasks"][0]["title"]
    assert data["tasks"][0]["due_text"] == "завтра"


def test_urgent_priority():
    r = client.post("/extract", json={"text": "Срочно перезапустить сервер"})
    assert r.json()["tasks"][0]["priority"] == "high"


def test_no_action():
    r = client.post("/extract", json={"text": "Спасибо, понятно"})
    assert r.json()["intent"] == "no_action"


def test_reminder():
    r = client.post("/extract", json={"text": "Напомни проверить статус задач"})
    assert r.json()["intent"] == "create_reminder"


def test_low_confidence_needs_confirmation():
    # mock отдаёт confidence 0.5 для события → должно требовать подтверждение
    r = client.post("/extract", json={"text": "Созвон в 15:00 с Иваном"})
    data = r.json()
    assert data["needs_confirmation"] is True

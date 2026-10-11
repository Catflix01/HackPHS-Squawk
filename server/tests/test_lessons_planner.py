"""Lessons + study planner endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.delenv("MONGODB_URI", raising=False)
    with TestClient(app) as test_client:
        yield test_client


def by_date(items: list[dict]) -> dict[str, dict]:
    return {item["date"]: item for item in items}


def test_lessons_list_and_detail(client):
    lessons = client.get("/lessons").json()["lessons"]
    unit1 = next(lesson for lesson in lessons if lesson["id"] == "unit1")
    assert unit1["title"] == "Radio basics"
    assert unit1["scenarioId"] == "vfr_pattern"
    assert unit1["flashcardCount"] == 5

    detail = client.get("/lessons/unit1").json()
    assert len(detail["flashcards"]) == 5
    assert all({"id", "front", "back"} <= set(card) for card in detail["flashcards"])
    text = " ".join(card["front"] + card["back"] for card in detail["flashcards"]).lower()
    assert "wilco" in text and "say again" in text

    assert client.get("/lessons/nope").status_code == 404


def test_planner_rules_and_ics(client):
    response = client.post("/planner", json={
        "startDate": "2026-11-01",
        "lessonDates": ["2026-11-05"],
        "examDates": ["2026-11-12"],
        "minutesPerDay": 20,
    })
    assert response.status_code == 200
    body = response.json()
    items = body["planItems"]
    assert 14 <= len(items) <= 30
    assert all(set(item) == {"date", "type", "title", "minutes"} for item in items)
    days = by_date(items)

    assert days["2026-11-05"]["type"] == "flight"
    assert days["2026-11-04"]["type"] == "light"            # light day before the flight lesson
    assert days["2026-11-04"]["minutes"] < 20
    assert days["2026-11-12"]["type"] == "exam"
    for review_day in ("2026-11-09", "2026-11-10", "2026-11-11"):
        assert days[review_day]["type"] == "review"         # more review before the exam
        assert days[review_day]["minutes"] > 20

    ics = client.get(f"/planner/{body['planId']}.ics")
    assert ics.status_code == 200
    assert ics.headers["content-type"].startswith("text/calendar")
    assert ics.text.startswith("BEGIN:VCALENDAR\r\n")
    assert ics.text.count("BEGIN:VEVENT") == len(items)
    assert "DTSTART;VALUE=DATE:20261105" in ics.text


def test_planner_length_bounds(client):
    short = client.post("/planner", json={"startDate": "2026-11-01", "minutesPerDay": 15}).json()
    assert len(short["planItems"]) == 14
    far = client.post("/planner", json={"startDate": "2026-11-01", "examDates": ["2027-03-01"]}).json()
    assert len(far["planItems"]) == 30


def test_planner_validation_and_missing_plan(client):
    assert client.post("/planner", json={"lessonDates": ["not-a-date"]}).status_code == 422
    assert client.get("/planner/doesnotexist.ics").status_code == 404

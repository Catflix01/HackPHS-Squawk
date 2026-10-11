"""Your call vs correct call: expectedCall, tip, ATIS rule, debrief summary."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.services.llm import grade_transmission

GOOD_TAXI = "Squawk Tower, Cessna one two three Sierra Quebec, at the main ramp with information Alpha, request taxi for closed traffic."
NO_ATIS_TAXI = "Squawk Tower, Cessna one two three Sierra Quebec, at the main ramp, request taxi for closed traffic."


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.delenv("MONGODB_URI", raising=False)


def test_expected_call_and_tip_for_pilot_call():
    grade = grade_transmission(GOOD_TAXI, "taxi", "pilot")
    assert "information Alpha" in grade["expectedCall"]
    assert grade["tip"]
    assert grade["score"] == 100


def test_missing_atis_gets_minor_deduction_and_tip():
    good = grade_transmission(GOOD_TAXI, "taxi", "pilot")
    missing = grade_transmission(NO_ATIS_TAXI, "taxi", "pilot")
    assert 0 < good["score"] - missing["score"] <= 10
    assert any("ATIS" in issue for issue in missing["issues"])
    assert "information Alpha" in missing["tip"]
    # "with Alpha" also counts, and later phases don't need the ATIS
    assert grade_transmission(NO_ATIS_TAXI.replace("ramp,", "ramp with Alpha,"), "taxi", "pilot")["score"] == 100
    assert not any("ATIS" in i for i in grade_transmission(
        "Squawk Tower, Cessna three Sierra Quebec, left base runway two seven, full stop.", "landing", "pilot")["issues"])


def test_debrief_cards_have_expected_call_tip_and_summary(monkeypatch):
    calls = iter([GOOD_TAXI, "Tower, request taxi."])
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)  # keyword fallback grader, offline
    monkeypatch.setattr(main, "transcribe_audio", lambda *_a, **_k: next(calls))
    monkeypatch.setattr(main, "synthesize_speech", lambda *_a, **_k: None)
    with TestClient(main.app) as client:
        for _ in range(2):
            client.post("/transmit", data={"sessionId": "DBRF", "role": "pilot", "phase": "taxi"},
                        files={"audio": ("a.webm", b"x", "audio/webm")})
        body = client.get("/debrief/DBRF").json()
    pilot = [tx for tx in body["transmissions"] if tx["speaker"] == "pilot"]
    assert len(pilot) == 2
    assert all(tx["expectedCall"] and tx["tip"] for tx in pilot)
    assert body["bestCall"]["id"] == pilot[0]["id"]
    assert body["needsWork"]["id"] == pilot[1]["id"]
    assert body["needsWork"]["score"] < body["bestCall"]["score"]

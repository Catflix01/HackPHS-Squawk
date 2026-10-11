"""API smoke tests. Run from server/:  pytest"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(monkeypatch):
    # Offline and deterministic: no AI calls, no Mongo (overrides whatever server/.env set).
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.delenv("MONGODB_URI", raising=False)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def session_id() -> str:
    return f"test-{uuid.uuid4().hex[:8]}"


def recv_until(ws, message_type: str) -> dict:
    """Skip other messages (session.state updates etc.) until message_type arrives."""
    for _ in range(20):
        message = ws.receive_json()
        if message["type"] == message_type:
            return message
    raise AssertionError(f"never received {message_type}")


def post_audio(client, session_id: str, role: str = "pilot", phase: str = "takeoff"):
    return client.post(
        "/transmit",
        data={"sessionId": session_id, "role": role, "phase": phase},
        files={"audio": ("call.webm", b"fake-webm-bytes", "audio/webm")},
    )


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["demoMode"] is True
    assert isinstance(body["missingEnv"], list)


def test_transmit_ai_mode_demo(client, session_id):
    with client.websocket_connect(f"/ws/session/{session_id}?role=pilot") as pilot:
        state = recv_until(pilot, "session.state")
        assert state["mode"] == "ai"
        assert state["peers"] == ["pilot"]

        response = post_audio(client, session_id)
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True

        own = recv_until(pilot, "transmission")
        assert own["id"] == body["transmissionId"]
        assert own["speaker"] == "pilot"
        assert own["phase"] == "takeoff"
        assert isinstance(own["score"], int)
        assert own["audioBase64"] is None  # AI mode: nobody needs the pilot's own audio

        tower = recv_until(pilot, "transmission")
        assert tower["speaker"] == "ai_atc"
        assert tower["mimeType"] == "audio/mpeg"
        assert "Sierra Quebec" in tower["transcript"]

    debrief = client.get(f"/debrief/{session_id}").json()
    assert [tx["speaker"] for tx in debrief["transmissions"]] == ["pilot", "ai_atc"]
    assert debrief["averageScore"] == own["score"]
    assert debrief["cfiAlerts"] == []


def test_transmit_human_mode_relays_original_audio(client, session_id):
    with client.websocket_connect(f"/ws/session/{session_id}?role=pilot") as pilot, \
         client.websocket_connect(f"/ws/session/{session_id}?role=atc") as atc:
        assert recv_until(pilot, "session.state")["mode"] in ("ai", "human")
        post_audio(client, session_id, role="atc", phase="taxi")
        heard = recv_until(pilot, "transmission")
        assert heard["speaker"] == "atc"
        assert heard["audioBase64"]  # original recording relayed
        assert heard["mimeType"] == "audio/webm"
        assert recv_until(atc, "transmission")["id"] == heard["id"]


def test_frequency_lock(client, session_id):
    with client.websocket_connect(f"/ws/session/{session_id}?role=pilot") as pilot, \
         client.websocket_connect(f"/ws/session/{session_id}?role=atc") as atc, \
         client.websocket_connect(f"/ws/session/{session_id}?role=device") as device:
        state = recv_until(device, "session.state")
        assert state["peers"] == ["pilot", "atc", "device"]
        assert state["mode"] == "human"

        # The Pi button keys the mic for the pilot.
        device.send_json({"type": "ptt.down"})
        assert recv_until(atc, "freq.busy")["holder"] == "pilot"
        assert recv_until(pilot, "device.ptt")["state"] == "down"

        # Controller is locked out while the pilot transmits; only the requester is told.
        atc.send_json({"type": "ptt.down"})
        assert recv_until(atc, "ptt.denied")["reason"] == "freq_busy"

        device.send_json({"type": "ptt.up"})
        assert recv_until(pilot, "device.ptt")["state"] == "up"
        recv_until(atc, "freq.clear")

        # Frequency is free again: now the controller gets it, and the pilot is denied.
        atc.send_json({"type": "ptt.down"})
        assert recv_until(pilot, "freq.busy")["holder"] == "atc"
        pilot.send_json({"type": "ptt.down"})
        assert recv_until(pilot, "ptt.denied")["reason"] == "freq_busy"


def test_phase_and_rx_forwarding(client, session_id):
    with client.websocket_connect(f"/ws/session/{session_id}?role=pilot") as pilot, \
         client.websocket_connect(f"/ws/session/{session_id}?role=device") as device:
        pilot.send_json({"type": "phase.set", "phase": "landing"})
        assert recv_until(device, "phase.changed")["phase"] == "landing"
        pilot.send_json({"type": "rx", "state": "started"})
        assert recv_until(device, "rx")["state"] == "started"

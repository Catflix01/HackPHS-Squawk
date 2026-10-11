"""POST /tts: cached MP3, 204 when TTS is unavailable."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.delenv("MONGODB_URI", raising=False)
    main._tts_cache.clear()
    with TestClient(main.app) as test_client:
        yield test_client


def test_tts_returns_mpeg_and_caches(client, monkeypatch):
    calls = []

    def fake_tts(text, voice="atc"):
        calls.append((text, voice))
        return b"ID3fake-mp3"

    monkeypatch.setattr(main, "synthesize_speech", fake_tts)
    for _ in range(2):
        response = client.post("/tts", json={"text": "Check your fuel.", "voice": "cfi"})
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mpeg"
        assert response.content == b"ID3fake-mp3"
    assert calls == [("Check your fuel.", "cfi")]  # second request served from cache

    client.post("/tts", json={"text": "Check your fuel.", "voice": "atc"})
    assert len(calls) == 2  # cache key includes the voice


def test_tts_unavailable_returns_204_and_is_not_cached(client, monkeypatch):
    calls = []

    def failing_tts(text, voice="atc"):
        calls.append(text)
        return None

    monkeypatch.setattr(main, "synthesize_speech", failing_tts)
    assert client.post("/tts", json={"text": "Hello", "voice": "cfi"}).status_code == 204
    assert client.post("/tts", json={"text": "Hello", "voice": "cfi"}).status_code == 204
    assert len(calls) == 2


def test_tts_demo_mode_and_validation(client, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.setattr(main, "synthesize_speech", lambda *a, **k: pytest.fail("no AI calls in DEMO_MODE"))
    assert client.post("/tts", json={"text": "Hello"}).status_code == 204
    assert client.post("/tts", json={"text": "", "voice": "cfi"}).status_code == 422
    assert client.post("/tts", json={"text": "Hi", "voice": "pilot"}).status_code == 422

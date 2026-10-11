"""GET /atis: live METAR -> ATIS script -> cached audio, with canned fallbacks."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.services import atis as atis_service

KTTN = {  # real aviationweather.gov sample
    "rawOb": "METAR KTTN 111053Z 05008KT 10SM FEW070 OVC110 14/13 A3033 RMK AO2",
    "wdir": 50, "wspd": 8, "visib": "10+", "altim": 1027.2, "temp": 14.4, "dewp": 13.3,
    "clouds": [{"cover": "FEW", "base": 7000}, {"cover": "OVC", "base": 11000}],
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.delenv("MONGODB_URI", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)  # template script, offline
    main._atis_cache.clear()
    main._tts_cache.clear()
    with TestClient(main.app) as test_client:
        yield test_client


def test_metar_facts_are_spoken_atc_style():
    facts = atis_service.metar_facts(KTTN)
    assert facts["time"] == "one zero five three"
    assert facts["wind"] == "zero five zero at eight"
    assert facts["altimeter"] == "three zero three three"
    assert facts["sky"] == "Few clouds at seven thousand, ceiling one one thousand overcast"
    assert facts["temperature"] == "one four" and facts["dewpoint"] == "one three"
    script = atis_service.template_script(KTTN)
    assert script.startswith("Squawk Regional information Alpha, time one zero five three zulu.")
    assert "Runway two seven in use." in script
    assert script.endswith("Advise on initial contact you have information Alpha.")


def test_live_atis_is_voiced_and_cached(client, monkeypatch):
    fetches, tts_calls = [], []
    monkeypatch.setattr(atis_service, "_fetch_metar", lambda icao: fetches.append(icao) or KTTN)
    monkeypatch.setattr(main, "synthesize_speech", lambda text, voice="atc": tts_calls.append(voice) or b"ID3atis")
    first = client.get("/atis").json()
    assert first["icao"] == "KTTN" and first["source"] == "live" and first["letter"] == "Alpha"
    assert first["metar"].startswith("METAR KTTN")
    assert "altimeter three zero three three" in first["script"].lower()
    assert first["audioBase64"] and first["mimeType"] == "audio/mpeg"
    second = client.get("/atis?icao=kttn").json()
    assert second == first
    assert fetches == ["KTTN"] and tts_calls == ["atc"]  # served from cache


def test_metar_failure_falls_back_to_canned(client, monkeypatch):
    def boom(icao):
        raise RuntimeError("aviationweather down")
    monkeypatch.setattr(atis_service, "_fetch_metar", boom)
    monkeypatch.setattr(main, "synthesize_speech", lambda *a, **k: None)
    body = client.get("/atis?icao=KABC").json()
    assert body["source"] == "canned"
    assert body["metar"] == atis_service.CANNED_METAR["rawOb"]
    assert body["audioBase64"] is None
    assert "information Alpha" in body["script"]


def test_demo_mode_and_validation(client, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.setattr(atis_service, "_fetch_metar", lambda icao: pytest.fail("no network in DEMO_MODE"))
    body = client.get("/atis").json()
    assert body["source"] == "canned" and body["audioBase64"] is None
    assert client.get("/atis?icao=not-an-airport").status_code == 422

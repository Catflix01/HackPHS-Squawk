"""Speech-to-text service wrapper for ElevenLabs."""

from __future__ import annotations

import requests

from ..config import AI_TIMEOUT_SECONDS, env
from .timeouts import call_with_timeout

ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"


def _transcribe(audio_bytes: bytes, content_type: str) -> str | None:
    api_key = env("ELEVENLABS_API_KEY")
    if not api_key:
        return None

    response = requests.post(
        ELEVENLABS_STT_URL,
        headers={"xi-api-key": api_key},
        data={"model_id": "scribe_v1", "language_code": "en"},
        files={"file": ("transmission.webm", audio_bytes, content_type)},
        timeout=AI_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    transcript = (payload.get("text") or payload.get("transcript") or "").strip()
    return transcript or None


def transcribe_audio(audio_bytes: bytes, content_type: str = "audio/webm") -> str | None:
    """Return the transcript, or None if STT is unconfigured, failed, or too slow."""
    if not audio_bytes:
        return None
    return call_with_timeout("STT", _transcribe, audio_bytes, content_type)

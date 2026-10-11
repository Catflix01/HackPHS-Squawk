"""Speech-to-text service wrapper for ElevenLabs."""

from __future__ import annotations

import requests

from ..config import AI_TIMEOUT_SECONDS, env
from .timeouts import call_with_timeout, logger

ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"


def _transcribe(audio_bytes: bytes, content_type: str) -> str | None:
    api_key = env("ELEVENLABS_API_KEY")
    if not api_key:
        logger.warning("STT skipped: ELEVENLABS_API_KEY is not set")
        return None

    response = requests.post(
        ELEVENLABS_STT_URL,
        headers={"xi-api-key": api_key},
        data={"model_id": "scribe_v1", "language_code": "en"},
        files={"file": ("transmission.webm", audio_bytes, content_type)},
        timeout=AI_TIMEOUT_SECONDS,
    )
    if not response.ok:
        raise RuntimeError(f"ElevenLabs STT HTTP {response.status_code}: {response.text[:300]}")
    payload = response.json()
    transcript = (payload.get("text") or payload.get("transcript") or "").strip()
    if not transcript:
        logger.warning("STT returned an empty transcript (silent or too-short recording, %d bytes)",
                       len(audio_bytes))
    return transcript or None


def transcribe_audio(audio_bytes: bytes, content_type: str = "audio/webm") -> str | None:
    """Return the transcript, or None if STT is unconfigured, failed, or too slow."""
    if not audio_bytes:
        return None
    return call_with_timeout("STT", _transcribe, audio_bytes, content_type)

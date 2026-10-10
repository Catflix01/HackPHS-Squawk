"""Speech-to-text service wrapper for ElevenLabs."""

from __future__ import annotations

import os
from typing import Optional

import requests

ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"


def transcribe_audio(audio_bytes: bytes, content_type: str = "audio/webm") -> str:
    """Transcribe pilot audio with ElevenLabs STT.

    Falls back to a clear warning text when credentials are missing or the
    provider call fails, so the app can still run for demo purposes.
    """
    api_key: Optional[str] = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        return "[Missing ELEVENLABS_API_KEY: unable to transcribe audio.]"

    files = {"file": ("pilot_call.webm", audio_bytes, content_type)}
    data = {"model_id": "scribe_v1"}
    headers = {"xi-api-key": api_key}

    try:
        response = requests.post(
            ELEVENLABS_STT_URL,
            headers=headers,
            data=data,
            files=files,
            timeout=45,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        return f"[STT request failed: {exc}]"

    transcript = payload.get("text") or payload.get("transcript")
    if not transcript:
        return "[STT returned no transcript text.]"
    return transcript.strip()

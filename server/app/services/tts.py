"""Text-to-speech service wrapper for ElevenLabs."""

from __future__ import annotations

import os
from typing import Optional

import requests


def synthesize_speech(text: str) -> bytes:
    """Convert ATC text into MP3 bytes.

    Returns empty bytes if configuration is missing or provider call fails.
    """
    api_key: Optional[str] = os.getenv("ELEVENLABS_API_KEY")
    voice_id: Optional[str] = os.getenv("ELEVENLABS_ATC_VOICE_ID")

    if not api_key or not voice_id:
        return b""

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
    }
    payload = {
        "text": text,
        "model_id": "eleven_flash_v2_5",
        "voice_settings": {"stability": 0.45, "similarity_boost": 0.65},
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=45)
        response.raise_for_status()
    except requests.RequestException:
        return b""

    return response.content

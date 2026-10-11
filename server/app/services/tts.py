"""Text-to-speech service wrapper for ElevenLabs."""

from __future__ import annotations

import requests

from ..config import AI_TIMEOUT_SECONDS, env
from .timeouts import call_with_timeout, logger


def _synthesize(text: str, voice_id: str) -> bytes | None:
    api_key = env("ELEVENLABS_API_KEY")
    if not api_key or not voice_id:
        logger.warning("TTS skipped: %s is not set, reply will be text-only",
                       "ELEVENLABS_API_KEY" if not api_key else "ELEVENLABS_ATC_VOICE_ID")
        return None
    if not text:
        return None

    response = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={
            "xi-api-key": api_key,
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
        },
        json={
            "text": text,
            "model_id": "eleven_flash_v2_5",
            "voice_settings": {"stability": 0.45, "similarity_boost": 0.65},
        },
        timeout=AI_TIMEOUT_SECONDS,
    )
    if not response.ok:
        # Surface ElevenLabs' reason (quota_exceeded, missing_permissions, voice_not_found, ...)
        raise RuntimeError(f"ElevenLabs TTS HTTP {response.status_code}: {response.text[:300]}")
    if not response.content:
        raise RuntimeError("ElevenLabs TTS returned no audio")
    return response.content


def synthesize_speech(text: str, voice: str = "atc") -> bytes | None:
    """Return MP3 bytes, or None if TTS is unconfigured, failed, or too slow.

    voice="cfi" uses ELEVENLABS_CFI_VOICE_ID, falling back to the ATC voice.
    """
    voice_id = env("ELEVENLABS_ATC_VOICE_ID")
    if voice == "cfi":
        voice_id = env("ELEVENLABS_CFI_VOICE_ID") or voice_id
    return call_with_timeout(f"TTS[{voice}]", _synthesize, text, voice_id)

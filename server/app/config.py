"""Environment loading and shared settings.

Importing this module loads ``server/.env`` (if present). Values are read
lazily through the helpers below so tests can override them at runtime.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent.parent
load_dotenv(SERVER_DIR / ".env")

# Any single AI call (STT, Gemini, TTS) slower than this falls back to canned output.
AI_TIMEOUT_SECONDS = 5.0

REQUIRED_ENV_VARS = [
    "GEMINI_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_ATC_VOICE_ID",
]


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def demo_mode() -> bool:
    return env("DEMO_MODE").lower() in {"1", "true", "yes", "on"}


def missing_env() -> list[str]:
    return [key for key in REQUIRED_ENV_VARS if not env(key)]


def cors_origins() -> list[str]:
    raw = env("CORS_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]

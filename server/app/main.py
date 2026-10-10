"""Squawk FastAPI backend for radio loop simulation."""

from __future__ import annotations

import base64
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Set

from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient

from .services.llm import generate_atc_reply
from .services.stt import transcribe_audio
from .services.tts import synthesize_speech

logger = logging.getLogger("squawk.server")


def _split_origins() -> list[str]:
    origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in origins.split(",") if origin.strip()]


REQUIRED_ENV_VARS = [
    "GEMINI_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_ATC_VOICE_ID",
    "MONGODB_URI",
]


class SessionHub:
    """In-memory fan-out for session-scoped websocket messages."""

    def __init__(self) -> None:
        self._connections: Dict[str, Set[WebSocket]] = defaultdict(set)

    async def connect(self, session_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[session_id].add(ws)

    def disconnect(self, session_id: str, ws: WebSocket) -> None:
        peers = self._connections.get(session_id)
        if not peers:
            return
        peers.discard(ws)
        if not peers:
            self._connections.pop(session_id, None)

    async def broadcast(self, session_id: str, payload: dict[str, Any]) -> None:
        for peer in list(self._connections.get(session_id, set())):
            try:
                await peer.send_json(payload)
            except Exception:
                self.disconnect(session_id, peer)


hub = SessionHub()
app = FastAPI(title="Squawk API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_split_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_transmission_collection():
    uri = os.getenv("MONGODB_URI")
    if not uri:
        return None

    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=1500)
        db_name = os.getenv("MONGODB_DB", "squawk")
        db = client[db_name]
        return db["transmissions"]
    except Exception as exc:
        logger.warning("Mongo unavailable: %s", exc)
        return None


@app.get("/health")
def health() -> dict[str, Any]:
    missing = [key for key in REQUIRED_ENV_VARS if not os.getenv(key)]
    return {
        "status": "ok",
        "missingEnv": missing,
    }


@app.post("/transmit")
async def transmit(
    audio: UploadFile = File(...),
    sessionId: str = Form(...),
    phase: str = Form(...),
) -> dict[str, Any]:
    audio_bytes = await audio.read()
    transcript = transcribe_audio(audio_bytes, audio.content_type or "audio/webm")

    llm_result = generate_atc_reply(transcript, phase.lower())
    atc_reply = llm_result["atcReply"]
    score = llm_result["score"]
    issues = llm_result["issues"]

    atc_audio = synthesize_speech(atc_reply)
    atc_audio_b64 = base64.b64encode(atc_audio).decode("utf-8") if atc_audio else ""

    doc = {
        "sessionId": sessionId,
        "phase": phase,
        "transcript": transcript,
        "atcReply": atc_reply,
        "score": score,
        "issues": issues,
        "createdAt": datetime.now(timezone.utc),
    }
    collection = _get_transmission_collection()
    if collection is not None:
        try:
            collection.insert_one(doc)
        except Exception as exc:
            logger.warning("Failed to save transmission: %s", exc)

    await hub.broadcast(sessionId, {"type": "atc.talking", "state": "started"})

    return {
        "transcript": transcript,
        "atcReply": atc_reply,
        "expectedCall": llm_result.get("expectedCall", ""),
        "score": score,
        "issues": issues,
        "audioBase64": atc_audio_b64,
    }


@app.websocket("/ws/session/{session_id}")
async def session_socket(ws: WebSocket, session_id: str) -> None:
    await hub.connect(session_id, ws)
    try:
        while True:
            message = await ws.receive_json()
            event_type = message.get("type")
            if event_type in {"ptt.down", "ptt.up", "atc.talking"}:
                await hub.broadcast(session_id, message)
    except WebSocketDisconnect:
        hub.disconnect(session_id, ws)
    except Exception:
        hub.disconnect(session_id, ws)

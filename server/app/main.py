"""Squawk FastAPI backend. See docs/api-contract.md for the wire format."""

from __future__ import annotations

import base64
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import anyio
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .scenario import normalize_phase
from .services.llm import expected_call, grade_transmission
from .services.stt import transcribe_audio
from .services.tts import synthesize_speech
from .sessions import ROLES, hub
from .store import store

logger = logging.getLogger("squawk.server")

# Make squawk.* warnings (TTS/STT/Gemini failures, fallbacks) stand out in the uvicorn output.
_squawk_logger = logging.getLogger("squawk")
if not _squawk_logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)-9s [%(name)s] %(message)s"))
    _squawk_logger.addHandler(_handler)
    _squawk_logger.setLevel(logging.INFO)
    _squawk_logger.propagate = False

TRANSCRIPT_UNAVAILABLE = "(transcription unavailable)"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    uri = config.env("MONGODB_URI")
    if uri:
        store.connect_mongo(uri, config.env("MONGODB_DB", "squawk"))
    else:
        logger.warning("MONGODB_URI not set: transmissions are kept in memory only")
    if config.demo_mode():
        logger.warning("DEMO_MODE is on: using canned transcripts, replies and scores")
    yield
    store.close()


app = FastAPI(title="Squawk API", lifespan=lifespan)

_origins = config.cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials="*" not in _origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _b64(data: bytes | None) -> str | None:
    return base64.b64encode(data).decode("ascii") if data else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _transmission_message(doc: dict[str, Any], audio_b64: str | None, mime_type: str) -> dict[str, Any]:
    return {
        "type": "transmission",
        "id": doc["id"],
        "speaker": doc["speaker"],
        "phase": doc["phase"],
        "transcript": doc["transcript"],
        "expectedCall": doc["expectedCall"],
        "score": doc["score"],
        "issues": doc["issues"],
        "audioBase64": audio_b64,
        "mimeType": mime_type,
    }


def _save_transmission(session_id: str, speaker: str, phase: str, transcript: str,
                       expected_call: str, score: int | None, issues: list[str]) -> dict[str, Any]:
    doc = {
        "id": uuid.uuid4().hex,
        "sessionId": session_id,
        "speaker": speaker,
        "phase": phase,
        "transcript": transcript,
        "expectedCall": expected_call,
        "score": score,
        "issues": issues,
        "createdAt": _now(),
    }
    store.add_transmission(doc)
    return doc


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "missingEnv": config.missing_env(),
        "demoMode": config.demo_mode(),
    }


def _follow_up(session_id: str, phase: str, pilot_tx_id: str, grade: dict[str, Any]) -> None:
    """Runs after /transmit has responded: AI tower reply, then CFI alert."""
    demo = config.demo_mode()

    reply = grade.get("atcReply")
    if reply:
        audio = None if demo else synthesize_speech(reply, voice="atc")
        if audio is None:
            logger.warning("Tower reply in %s sent WITHOUT audio (%s)", session_id,
                           "DEMO_MODE is on" if demo else "TTS failed, see the TTS warning above")
        doc = _save_transmission(session_id, "ai_atc", phase, reply, "", None, [])
        anyio.from_thread.run(
            hub.broadcast, session_id, _transmission_message(doc, _b64(audio), "audio/mpeg")
        )

    alert = grade.get("cfiAlert")
    if alert:
        audio = None if demo else synthesize_speech(alert, voice="cfi")
        store.add_cfi_alert({
            "id": uuid.uuid4().hex,
            "sessionId": session_id,
            "transmissionId": pilot_tx_id,
            "phase": phase,
            "text": alert,
            "createdAt": _now(),
        })
        anyio.from_thread.run(
            hub.send_to_roles,
            session_id,
            ["pilot"],
            {"type": "cfi.alert", "text": alert, "audioBase64": _b64(audio), "mimeType": "audio/mpeg"},
        )


# Plain `def` on purpose: FastAPI runs it in a worker thread, so the blocking
# STT/Gemini/TTS calls never stall the event loop that serves the WebSockets.
@app.post("/transmit")
def transmit(
    background: BackgroundTasks,
    audio: UploadFile = File(...),
    sessionId: str = Form(...),
    role: str = Form("pilot"),
    phase: str = Form("taxi"),
) -> dict[str, Any]:
    role = role.strip().lower()
    if role not in ("pilot", "atc"):
        raise HTTPException(status_code=422, detail="role must be 'pilot' or 'atc'")

    phase = normalize_phase(phase)
    audio_bytes = audio.file.read()
    mime_type = (audio.content_type or "").split(";")[0].strip().lower()
    if not mime_type.startswith("audio/"):
        mime_type = "audio/webm"  # MediaRecorder blobs sometimes arrive as video/webm or octet-stream

    mode = hub.mode(sessionId)
    want_reply = mode == "ai" and role == "pilot"

    history = store.recent(sessionId)
    if config.demo_mode():
        transcript: str | None = expected_call(phase, role, history)
    else:
        transcript = transcribe_audio(audio_bytes, mime_type)

    grade = grade_transmission(transcript, phase, role, want_reply=want_reply, history=history)

    doc = _save_transmission(
        sessionId, role, phase, transcript or TRANSCRIPT_UNAVAILABLE,
        grade["expectedCall"], grade["score"], grade["issues"],
    )
    # Human mode: relay the original audio so the other side hears the real voice.
    audio_b64 = _b64(audio_bytes) if mode == "human" else None
    anyio.from_thread.run(hub.broadcast, sessionId, _transmission_message(doc, audio_b64, mime_type))

    if grade.get("atcReply") or grade.get("cfiAlert"):
        background.add_task(_follow_up, sessionId, phase, doc["id"], grade)

    return {"ok": True, "transmissionId": doc["id"]}


@app.get("/debrief/{session_id}")
def debrief(session_id: str) -> dict[str, Any]:
    transmissions, alerts = store.session_history(session_id)

    def iso(value: Any) -> str:
        return value.isoformat() if isinstance(value, datetime) else str(value)

    pilot_scores = [
        tx["score"] for tx in transmissions
        if tx.get("speaker") == "pilot" and isinstance(tx.get("score"), (int, float))
    ]
    return {
        "sessionId": session_id,
        "averageScore": round(sum(pilot_scores) / len(pilot_scores)) if pilot_scores else 0,
        "transmissions": [
            {
                "id": tx["id"],
                "speaker": tx["speaker"],
                "phase": tx["phase"],
                "transcript": tx["transcript"],
                "expectedCall": tx["expectedCall"],
                "score": tx["score"],
                "issues": tx["issues"],
                "createdAt": iso(tx["createdAt"]),
            }
            for tx in transmissions
        ],
        "cfiAlerts": [
            {
                "id": alert["id"],
                "transmissionId": alert["transmissionId"],
                "phase": alert["phase"],
                "text": alert["text"],
                "createdAt": iso(alert["createdAt"]),
            }
            for alert in alerts
        ],
    }


@app.websocket("/ws/session/{session_id}")
async def session_socket(ws: WebSocket, session_id: str, role: str = "pilot") -> None:
    role = role.strip().lower()
    if role not in ROLES:
        await ws.close(code=1008, reason="role must be pilot, atc or device")
        return

    await hub.connect(session_id, ws, role)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict):
                await hub.handle(session_id, ws, role, message)
    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        # Client closed during the handshake (React dev double-mount, fast reloads): harmless.
        logger.debug("WebSocket in %s (%s) closed early: %s", session_id, role, exc)
    except Exception as exc:
        logger.warning("WebSocket error in %s (%s): %s", session_id, role, exc)
    finally:
        await hub.disconnect(session_id, ws)

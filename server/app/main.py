"""Squawk FastAPI backend. See docs/api-contract.md for the wire format."""

from __future__ import annotations

import base64
import json
import logging
import threading
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from typing import Any, Literal

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
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from . import config
from .lessons import lesson_summary, load_lessons
from .planner import build_plan, plan_to_ics
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
    if not config.env("ELEVENLABS_CFI_VOICE_ID"):
        logger.warning(
            "ELEVENLABS_CFI_VOICE_ID not set: the CFI will speak with the ATC voice "
            "(ELEVENLABS_ATC_VOICE_ID). Set ELEVENLABS_CFI_VOICE_ID for a distinct instructor voice."
        )
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
        "tip": doc.get("tip", ""),
        "audioBase64": audio_b64,
        "mimeType": mime_type,
    }


def _save_transmission(session_id: str, speaker: str, phase: str, transcript: str,
                       expected_call: str, score: int | None, issues: list[str],
                       tip: str = "") -> dict[str, Any]:
    doc = {
        "id": uuid.uuid4().hex,
        "sessionId": session_id,
        "speaker": speaker,
        "phase": phase,
        "transcript": transcript,
        "expectedCall": expected_call,
        "score": score,
        "issues": issues,
        "tip": tip,
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
        grade["expectedCall"], grade["score"], grade["issues"], grade.get("tip", ""),
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

    scored = [
        tx for tx in transmissions
        if tx.get("speaker") == "pilot" and isinstance(tx.get("score"), (int, float))
    ]
    pilot_scores = [tx["score"] for tx in scored]

    def highlight(tx: dict[str, Any] | None) -> dict[str, Any] | None:
        if tx is None:
            return None
        return {"id": tx["id"], "phase": tx["phase"], "score": tx["score"],
                "transcript": tx["transcript"], "tip": tx.get("tip", "")}

    best = max(scored, key=lambda tx: tx["score"], default=None)
    worst = min(scored, key=lambda tx: tx["score"], default=None)
    needs_work = worst if worst is not None and worst is not best and worst["score"] < 85 else None
    return {
        "sessionId": session_id,
        "averageScore": round(sum(pilot_scores) / len(pilot_scores)) if pilot_scores else 0,
        "bestCall": highlight(best),
        "needsWork": highlight(needs_work),
        "transmissions": [
            {
                "id": tx["id"],
                "speaker": tx["speaker"],
                "phase": tx["phase"],
                "transcript": tx["transcript"],
                "expectedCall": tx["expectedCall"],
                "score": tx["score"],
                "issues": tx["issues"],
                "tip": tx.get("tip", ""),
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


@app.get("/lessons")
def list_lessons() -> dict[str, Any]:
    return {"lessons": [lesson_summary(lesson) for lesson in load_lessons().values()]}


@app.get("/lessons/{lesson_id}")
def get_lesson(lesson_id: str) -> dict[str, Any]:
    lesson = load_lessons().get(lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="lesson not found")
    return lesson


class PlannerRequest(BaseModel):
    lessonDates: list[date] = Field(default_factory=list)
    examDates: list[date] = Field(default_factory=list)
    minutesPerDay: int = Field(default=20, ge=5, le=240)
    startDate: date | None = None
    # Single-date aliases sent by the /planner page (merged into the lists above).
    flightDate: date | None = None
    examDate: date | None = None
    minutes: int | None = Field(default=None, ge=5, le=240)

    @field_validator("startDate", "flightDate", "examDate", mode="before")
    @classmethod
    def _blank_is_none(cls, value: Any) -> Any:
        return None if value == "" else value  # empty <input type="date"> sends ""


@app.post("/planner")
def create_plan(request: PlannerRequest) -> dict[str, Any]:
    start = request.startDate or _now().date()
    lesson_dates = request.lessonDates + ([request.flightDate] if request.flightDate else [])
    exam_dates = request.examDates + ([request.examDate] if request.examDate else [])
    minutes = request.minutes if request.minutes is not None else request.minutesPerDay
    items = build_plan(lesson_dates, exam_dates, minutes, start)
    plan_id = uuid.uuid4().hex[:12]
    store.add_plan({
        "planId": plan_id,
        "request": request.model_dump(mode="json"),
        "planItems": items,
        "createdAt": _now(),
    })
    return {"planId": plan_id, "planItems": items}


TTS_CACHE_SIZE = 200
_tts_cache: OrderedDict[tuple[str, str], bytes] = OrderedDict()
_tts_cache_lock = threading.Lock()


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    voice: Literal["cfi", "atc"] = "cfi"


# Plain `def`: synthesize_speech blocks (bounded by the 5 s AI timeout) in a worker thread.
@app.post("/tts")
def tts(request: TtsRequest) -> Response:
    key = (request.voice, request.text.strip())
    with _tts_cache_lock:
        audio = _tts_cache.get(key)
        if audio is not None:
            _tts_cache.move_to_end(key)
    if audio is None:
        if config.demo_mode():
            return Response(status_code=204)  # DEMO_MODE: no AI calls; client falls back
        audio = synthesize_speech(key[1], voice=request.voice)
        if not audio:
            return Response(status_code=204)  # TTS unavailable/failed/slow (logged); not cached
        with _tts_cache_lock:
            _tts_cache[key] = audio
            while len(_tts_cache) > TTS_CACHE_SIZE:
                _tts_cache.popitem(last=False)
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/planner/{plan_id}.ics")
def plan_calendar(plan_id: str) -> Response:
    plan = store.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="plan not found")
    return Response(
        content=plan_to_ics(plan_id, plan["planItems"]),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="squawk-plan-{plan_id}.ics"'},
    )


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

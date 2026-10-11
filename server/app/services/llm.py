"""Gemini wrapper: grades a radio call and (in AI mode) plays the tower."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from google import genai
from google.genai import types

from ..config import demo_mode, env
from ..scenario import load_scenario, normalize_phase, phase_info
from .timeouts import call_with_timeout

CALLSIGN_PATTERNS = ("n123sq", "123sq", "sierra quebec", "three sierra quebec")
RUNWAY_PATTERNS = ("two seven", "27", "two-seven")
DEFAULT_MODELS = "gemini-3.5-flash-lite,gemini-3.8-flash"
# A readback comes right after the instruction. Older tower traffic (e.g. from before a
# page reload in the same session) must not make a fresh request count as a readback.
READBACK_WINDOW_SECONDS = 60

SYSTEM_PROMPT = """You are two people at once for a student pilot radio-practice app:
1. A strict but fair FAA-style radio phraseology GRADER.
2. (Only when asked) the TOWER CONTROLLER replying on frequency.

The training scenario (airport, runway, frequency, callsign, expected calls per phase) is:
{scenario}

Grading rules:
- Grade the transmission against "gradeAgainst" in the request (already chosen for you: the
  initial call, the readback of the last tower instruction, or the controller's expected
  instruction). Use "recentRadioTraffic" only as context. For speaker "atc" (a human controller)
  also consider the phase's "atcExpected".
- score: integer 0-100. Correct content with minor wording differences should still score 85+.
- issues: short, specific strings (max 4), e.g. "Missing callsign", "Did not read back hold short".
  Empty list if the call is good. Only list real mistakes in THIS transmission; never penalize
  for instructions that have not been given yet or for natural pauses.
- cfiAlert: ONLY for speaker "pilot" and ONLY for safety-relevant mistakes (see each phase's
  "safetyCritical" list: missing hold-short readback, wrong runway, taking off or landing or
  crossing a runway without a clearance, wrong pattern direction). Write one or two calm
  sentences, spoken by a flight instructor sitting next to the student. Otherwise null.
  Do NOT raise cfiAlert for style, brevity, or missing ATIS.
- correctCall: the ideal call the speaker should have made in THIS exact situation, in standard
  FAA phraseology using the scenario's facility, callsign and runway (based on "gradeAgainst",
  adjusted to what the pilot was actually trying to do). One transmission, no quotes.
- tip: ONE short sentence of coaching from a flight instructor about the most important fix
  (or brief praise if the call was good). Max 120 characters.
- Do not deduct or comment on a missing ATIS code; the app checks that separately.

Tower rules (only when wantReply is true):
- atcReply: what {tower} says next on frequency, short real-world FAA phraseology, using the
  scenario's runway and callsign. If the pilot's call was unreadable or wrong, respond like a real
  controller would (e.g. "...say again" or correct the error). If the transmission is a correct
  readback, atcReply is null (towers do not answer correct readbacks). When wantReply is false,
  atcReply is null.

Respond with JSON only:
{{"score": int, "issues": [string], "correctCall": string, "tip": string, "cfiAlert": string|null, "atcReply": string|null}}"""


ATIS_PATTERN = re.compile(r"\b(information|with)\s+alpha\b", re.IGNORECASE)
ATIS_DEDUCTION = 5
ATIS_TIP = "On initial contact, tell them you have the ATIS: \"...with information Alpha.\""


def default_tip(issues: list[str]) -> str:
    return f"Focus on this: {issues[0].rstrip('.')}." if issues else "Nice call: clear, complete, standard phraseology."


def needs_atis(transcript: str | None, phase: str, role: str, history: list[dict[str, Any]]) -> bool:
    """Initial pilot call to ground/tower before taxi that doesn't report the ATIS code."""
    return (
        role == "pilot"
        and phase == "taxi"
        and bool(transcript)
        and not is_readback(phase, role, history, transcript)
        and not ATIS_PATTERN.search(transcript or "")
    )


def apply_atis_rule(result: dict[str, Any], transcript: str | None, phase: str, role: str,
                    history: list[dict[str, Any]]) -> dict[str, Any]:
    """Minor deduction + CFI tip when the initial call omits "information Alpha"."""
    if not needs_atis(transcript, phase, role, history):
        return result
    others = [issue for issue in result["issues"] if "atis" not in issue.lower()]  # no duplicates
    issues = others + ["Missing ATIS: say \"with information Alpha\"."]
    clean_otherwise = not others
    return {
        **result,
        "score": max(0, result["score"] - ATIS_DEDUCTION),
        "issues": issues[:5],
        "tip": ATIS_TIP if clean_otherwise or not result.get("tip") else result["tip"],
    }


def _mentions(text: str, patterns: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(pattern in lowered for pattern in patterns)


def is_readback(phase: str, role: str, history: list[dict[str, Any]],
                transcript: str | None = None) -> bool:
    """Is this pilot call a readback of the tower's last instruction?

    Only if the tower spoke last, in the same phase, within READBACK_WINDOW_SECONDS, and the
    transcript is known and does not address the facility ("Squawk Tower, ..."): readbacks
    never start that way, new requests always do.
    """
    if role != "pilot" or not history:
        return False
    last = history[-1]
    if last.get("speaker") not in ("atc", "ai_atc") or last.get("phase") != phase:
        return False
    created = last.get("createdAt")
    if isinstance(created, datetime):
        age = (datetime.now(timezone.utc) - created).total_seconds()
        if age > READBACK_WINDOW_SECONDS:
            return False
    if not transcript or "tower" in transcript.lower():
        # Unknown transcript (STT failed): answer rather than risk a silent tower.
        return False
    return True


def expected_call(phase: str, role: str, history: list[dict[str, Any]],
                  transcript: str | None = None) -> str:
    info = phase_info(phase)
    if role == "atc":
        return info["atcReply"]
    readback = is_readback(phase, role, history, transcript)
    return info["expectedReadback"] if readback else info["expectedCall"]


def fallback_grade(transcript: str | None, phase: str, role: str, want_reply: bool,
                   history: list[dict[str, Any]]) -> dict[str, Any]:
    """Canned reply plus a rough keyword-based placeholder score."""
    info = phase_info(phase)
    readback = is_readback(phase, role, history, transcript)
    issues: list[str] = []

    if transcript is None:
        issues.append("Transcription unavailable; score is a placeholder.")
        score = 75
    else:
        if not _mentions(transcript, CALLSIGN_PATTERNS):
            issues.append("Missing callsign (Cessna one two three Sierra Quebec).")
        if (phase != "taxi" or readback) and not _mentions(transcript, RUNWAY_PATTERNS):
            issues.append("Missing runway (two seven).")
        score = max(40, 100 - 20 * len(issues))

    return {
        "score": score,
        "issues": issues,
        "expectedCall": expected_call(phase, role, history, transcript),
        "tip": default_tip(issues),
        "cfiAlert": None,
        "atcReply": info["atcReply"] if want_reply and not readback else None,
    }


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    return json.loads(cleaned)


def _call_gemini(transcript: str, phase: str, role: str, want_reply: bool,
                 history: list[dict[str, Any]], grade_against: str) -> dict[str, Any]:
    scenario = load_scenario()
    system_prompt = SYSTEM_PROMPT.format(
        scenario=json.dumps(scenario, indent=2),
        tower=scenario["airport"]["towerName"],
    )
    user_prompt = json.dumps({
        "phase": phase,
        "speaker": role,
        "transcript": transcript,
        "gradeAgainst": grade_against,
        "wantReply": want_reply,
        "recentRadioTraffic": [
            {"speaker": tx.get("speaker"), "phase": tx.get("phase"), "transcript": tx.get("transcript")}
            for tx in history
        ],
    })
    return generate_json(system_prompt, user_prompt)


def generate_json(system_prompt: str, user_prompt: str, temperature: float = 0.3) -> dict[str, Any]:
    """One Gemini JSON call. Blocking and may raise: wrap it in call_with_timeout.

    GEMINI_MODEL may be a comma-separated chain: busy (503) or retired (404) models are
    skipped, all within the caller's single timeout budget.
    """
    client = genai.Client(api_key=env("GEMINI_API_KEY"))
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        temperature=temperature,
    )
    models = [m.strip() for m in env("GEMINI_MODEL", DEFAULT_MODELS).split(",") if m.strip()]
    last_error: Exception | None = None
    for model in models:
        try:
            response = client.models.generate_content(model=model, contents=user_prompt, config=config)
            return _extract_json(response.text or "")
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"all Gemini models failed: {last_error}")


def _clean(raw: dict[str, Any], fallback: dict[str, Any], role: str, want_reply: bool) -> dict[str, Any]:
    try:
        score = int(max(0, min(100, int(raw.get("score")))))
    except (TypeError, ValueError):
        score = fallback["score"]
    cfi = raw.get("cfiAlert")
    reply = str(raw.get("atcReply") or "").strip()
    issues = [str(item) for item in raw.get("issues") or []][:4]
    correct = str(raw.get("correctCall") or "").strip().strip('"')
    tip = str(raw.get("tip") or "").strip()
    return {
        "score": score,
        "issues": issues,
        "expectedCall": correct or fallback["expectedCall"],
        "tip": tip[:160] or default_tip(issues),
        "cfiAlert": str(cfi).strip() if cfi and role == "pilot" else None,
        "atcReply": (reply or fallback["atcReply"]) if want_reply else None,  # None after a readback
    }


def grade_transmission(
    transcript: str | None,
    phase: str,
    role: str,
    want_reply: bool = False,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Grade one transmission. Never raises; falls back to canned output.

    Returns {"score", "issues", "expectedCall", "tip", "cfiAlert", "atcReply"}. For pilot calls
    expectedCall is the ideal call for this situation (Gemini's correctCall, else the scenario's).
    """
    phase = normalize_phase(phase)
    history = history or []
    fallback = fallback_grade(transcript, phase, role, want_reply, history)
    if demo_mode() or transcript is None or not env("GEMINI_API_KEY"):
        result = fallback
    else:
        raw = call_with_timeout(
            "Gemini", _call_gemini, transcript, phase, role, want_reply, history, fallback["expectedCall"]
        )
        result = _clean(raw, fallback, role, want_reply) if isinstance(raw, dict) else fallback
    return apply_atis_rule(result, transcript, phase, role, history)

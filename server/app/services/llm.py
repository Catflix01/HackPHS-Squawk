"""Gemini wrapper: grades a radio call and (in AI mode) plays the tower."""

from __future__ import annotations

import json
import re
from typing import Any

from google import genai
from google.genai import types

from ..config import demo_mode, env
from ..scenario import load_scenario, normalize_phase, phase_info
from .timeouts import call_with_timeout

CALLSIGN_PATTERNS = ("n123sq", "123sq", "sierra quebec", "three sierra quebec")
RUNWAY_PATTERNS = ("two seven", "27", "two-seven")

SYSTEM_PROMPT = """You are two people at once for a student pilot radio-practice app:
1. A strict but fair FAA-style radio phraseology GRADER.
2. (Only when asked) the TOWER CONTROLLER replying on frequency.

The training scenario (airport, runway, frequency, callsign, expected calls per phase) is:
{scenario}

Grading rules:
- Grade the given transmission against the scenario's expected call for the current phase.
  If the previous transmission was a tower instruction, the pilot should be reading it back:
  grade against the expected readback instead.
- For speaker "atc" (a human controller), grade against "atcExpected" for the phase.
- score: integer 0-100. Correct content with minor wording differences should still score 85+.
- issues: short, specific strings (max 4), e.g. "Missing callsign", "Did not read back hold short".
  Empty list if the call is good.
- expectedCall: the exact call you graded against, in standard phraseology.
- cfiAlert: ONLY for speaker "pilot" and ONLY for safety-relevant mistakes (see each phase's
  "safetyCritical" list: missing hold-short readback, wrong runway, taking off or landing or
  crossing a runway without a clearance, wrong pattern direction). Write one or two calm
  sentences, spoken by a flight instructor sitting next to the student. Otherwise null.
  Do NOT raise cfiAlert for style, brevity, or missing ATIS.

Tower rules (only when wantReply is true):
- atcReply: what {tower} says next on frequency, short real-world FAA phraseology, using the
  scenario's runway and callsign. If the pilot's call was unreadable or wrong, respond like a real
  controller would (e.g. "...say again" or correct the error). When wantReply is false, atcReply is null.

Respond with JSON only:
{{"score": int, "issues": [string], "expectedCall": string, "cfiAlert": string|null, "atcReply": string|null}}"""


def _mentions(text: str, patterns: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(pattern in lowered for pattern in patterns)


def fallback_grade(transcript: str | None, phase: str, role: str, want_reply: bool) -> dict[str, Any]:
    """Canned reply plus a rough keyword-based placeholder score."""
    info = phase_info(phase)
    expected = info["atcReply"] if role == "atc" else info["expectedCall"]
    issues: list[str] = []

    if transcript is None:
        issues.append("Transcription unavailable; score is a placeholder.")
        score = 75
    else:
        if not _mentions(transcript, CALLSIGN_PATTERNS):
            issues.append("Missing callsign (Cessna one two three Sierra Quebec).")
        if phase != "taxi" and not _mentions(transcript, RUNWAY_PATTERNS):
            issues.append("Missing runway (two seven).")
        score = max(40, 100 - 20 * len(issues))

    return {
        "score": score,
        "issues": issues,
        "expectedCall": expected,
        "cfiAlert": None,
        "atcReply": info["atcReply"] if want_reply else None,
    }


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    return json.loads(cleaned)


def _call_gemini(transcript: str, phase: str, role: str, want_reply: bool,
                 history: list[dict[str, Any]]) -> dict[str, Any]:
    scenario = load_scenario()
    client = genai.Client(api_key=env("GEMINI_API_KEY"))
    system_prompt = SYSTEM_PROMPT.format(
        scenario=json.dumps(scenario, indent=2),
        tower=scenario["airport"]["towerName"],
    )
    user_prompt = json.dumps({
        "phase": phase,
        "speaker": role,
        "transcript": transcript,
        "wantReply": want_reply,
        "recentRadioTraffic": history,
    })
    response = client.models.generate_content(
        model=env("GEMINI_MODEL", "gemini-2.5-flash"),
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
            temperature=0.3,
        ),
    )
    return _extract_json(response.text or "")


def _clean(raw: dict[str, Any], fallback: dict[str, Any], role: str, want_reply: bool) -> dict[str, Any]:
    try:
        score = int(max(0, min(100, int(raw.get("score")))))
    except (TypeError, ValueError):
        score = fallback["score"]
    cfi = raw.get("cfiAlert")
    reply = str(raw.get("atcReply") or "").strip()
    return {
        "score": score,
        "issues": [str(item) for item in raw.get("issues") or []][:4],
        "expectedCall": str(raw.get("expectedCall") or "").strip() or fallback["expectedCall"],
        "cfiAlert": str(cfi).strip() if cfi and role == "pilot" else None,
        "atcReply": (reply or fallback["atcReply"]) if want_reply else None,
    }


def grade_transmission(
    transcript: str | None,
    phase: str,
    role: str,
    want_reply: bool = False,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Grade one transmission. Never raises; falls back to canned output.

    Returns {"score", "issues", "expectedCall", "cfiAlert", "atcReply"}.
    """
    phase = normalize_phase(phase)
    fallback = fallback_grade(transcript, phase, role, want_reply)
    if demo_mode() or transcript is None or not env("GEMINI_API_KEY"):
        return fallback

    raw = call_with_timeout("Gemini", _call_gemini, transcript, phase, role, want_reply, history or [])
    if not isinstance(raw, dict):
        return fallback
    return _clean(raw, fallback, role, want_reply)

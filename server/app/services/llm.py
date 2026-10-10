"""LLM service wrapper for generating realistic ATC responses."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List

from google import genai


def _fallback_result(transcript: str, phase: str) -> Dict[str, Any]:
    expected_by_phase = {
        "taxi": "Include callsign, position, ATIS, and taxi request.",
        "takeoff": "Include callsign, runway, and ready-for-departure call.",
        "pattern": "Include callsign, position in pattern, and intentions.",
        "landing": "Include callsign, position, and full-stop or touch-and-go intent.",
    }

    issues: List[str] = []
    transcript_lower = transcript.lower()
    if "n123sq" not in transcript_lower:
        issues.append("Missing callsign N123SQ.")

    score = max(0, 100 - (25 * len(issues)))
    fallback_reply = {
        "taxi": "Cessna N123SQ, taxi to Runway Two-Seven via Alpha, hold short Runway Two-Seven.",
        "takeoff": "Cessna N123SQ, Runway Two-Seven, cleared for takeoff, make left traffic.",
        "pattern": "Cessna N123SQ, report midfield left downwind Runway Two-Seven.",
        "landing": "Cessna N123SQ, Runway Two-Seven, cleared to land.",
    }

    return {
        "atcReply": fallback_reply.get(phase, fallback_reply["pattern"]),
        "expectedCall": expected_by_phase.get(
            phase, "State callsign, position, and request clearly."
        ),
        "score": score,
        "issues": issues,
    }


def _extract_json(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    code_fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if code_fence_match:
        cleaned = code_fence_match.group(1).strip()

    data = json.loads(cleaned)
    return {
        "atcReply": str(data.get("atcReply", "")).strip(),
        "expectedCall": str(data.get("expectedCall", "")).strip(),
        "score": int(max(0, min(100, int(data.get("score", 0))))),
        "issues": [str(item) for item in data.get("issues", [])],
    }


def generate_atc_reply(transcript: str, phase: str) -> Dict[str, Any]:
    """Generate structured ATC feedback using Gemini Flash."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return _fallback_result(transcript, phase)

    client = genai.Client(api_key=api_key)
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    system_prompt = (
        "You are an airport tower controller. The pilot callsign is Cessna N123SQ. "
        "Reply in short, realistic FAA-style phraseology for the given flight phase "
        "(taxi, takeoff, pattern, landing). Return strict JSON with keys: "
        "atcReply (string), expectedCall (string), score (0-100 integer), "
        "issues (array of strings). Include issues such as missing callsign, missing "
        "readback items, and phase-inappropriate requests."
    )

    user_prompt = json.dumps({"phase": phase, "pilotTranscript": transcript})

    try:
        response = client.models.generate_content(
            model=model,
            contents=[
                {"role": "user", "parts": [{"text": f"{system_prompt}\n\n{user_prompt}"}]}
            ],
        )
        text = response.text or ""
        parsed = _extract_json(text)
    except Exception:
        return _fallback_result(transcript, phase)

    if not parsed.get("atcReply"):
        return _fallback_result(transcript, phase)

    return parsed

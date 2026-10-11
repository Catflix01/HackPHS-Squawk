"""Readback detection decides whether the AI tower answers, so it must not go silent wrongly."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.llm import fallback_grade, is_readback

TOWER_TAXI = "Cessna one two three Sierra Quebec, Squawk Tower, runway two seven, taxi via Alpha, hold short runway two seven."


def tower(seconds_ago: float = 2, phase: str = "taxi") -> dict:
    return {
        "speaker": "ai_atc",
        "phase": phase,
        "transcript": TOWER_TAXI,
        "createdAt": datetime.now(timezone.utc) - timedelta(seconds=seconds_ago),
    }


def test_readback_right_after_tower_instruction():
    assert is_readback("taxi", "pilot", [tower()], "Runway two seven, taxi via Alpha, hold short, three Sierra Quebec")


def test_new_request_addressing_tower_is_not_a_readback():
    call = "Squawk Tower, Cessna one two three Sierra Quebec, at the main ramp, request taxi"
    assert not is_readback("taxi", "pilot", [tower()], call)


def test_stale_tower_traffic_is_not_a_readback():
    # e.g. the page was reloaded and the same session/phase is flown again
    assert not is_readback("taxi", "pilot", [tower(seconds_ago=300)], None)


def test_other_phase_or_role_is_not_a_readback():
    assert not is_readback("takeoff", "pilot", [tower()], None)
    assert not is_readback("taxi", "atc", [tower()], None)


def test_tower_replies_again_after_reload_even_without_stt():
    # STT failed (transcript None) and old tower traffic exists: the AI tower must still answer.
    grade = fallback_grade(None, "taxi", "pilot", True, [tower(seconds_ago=300)])
    assert grade["atcReply"]

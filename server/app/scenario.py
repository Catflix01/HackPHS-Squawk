"""Loads the training scenario that drives prompts and canned fallbacks."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .config import SERVER_DIR, env

PHASES = ("taxi", "takeoff", "pattern", "landing")
DEFAULT_PHASE = "taxi"


@lru_cache(maxsize=None)
def load_scenario(name: str | None = None) -> dict[str, Any]:
    scenario_name = name or env("SCENARIO", "vfr_pattern")
    path = SERVER_DIR / "scenarios" / f"{scenario_name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_phase(phase: str | None) -> str:
    value = (phase or "").strip().lower()
    return value if value in PHASES else DEFAULT_PHASE


def phase_info(phase: str) -> dict[str, Any]:
    return load_scenario()["phases"][normalize_phase(phase)]

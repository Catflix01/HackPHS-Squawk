"""Static lessons loaded from server/lessons/*.json."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from .config import SERVER_DIR

LESSONS_DIR = SERVER_DIR / "lessons"


@lru_cache(maxsize=None)
def load_lessons() -> dict[str, dict[str, Any]]:
    lessons = {}
    for path in sorted(LESSONS_DIR.glob("*.json")):
        lesson = json.loads(path.read_text(encoding="utf-8"))
        lessons[lesson["id"]] = lesson
    return lessons


def lesson_summary(lesson: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": lesson["id"],
        "title": lesson["title"],
        "brief": lesson["brief"],
        "scenarioId": lesson["scenarioId"],
        "flashcardCount": len(lesson["flashcards"]),
    }

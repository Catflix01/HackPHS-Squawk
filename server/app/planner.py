"""Study planner: turns flight lesson and exam dates into a day-by-day plan + .ics file."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

MIN_DAYS = 14
MAX_DAYS = 30
EXAM_REVIEW_DAYS = 3  # days before an exam that get extra review
MAX_MINUTES = 240

# Rotation for ordinary days.
ROUTINE = [
    ("practice", "Radio practice: fly the VFR pattern with the AI tower"),
    ("flashcards", "Flashcards: Radio basics"),
    ("lesson", "Lesson: Radio basics (phraseology, readbacks, callsigns)"),
]


def _clamp_minutes(value: float) -> int:
    return int(max(5, min(MAX_MINUTES, round(value))))


def build_plan(lesson_dates: list[date], exam_dates: list[date], minutes_per_day: int,
               start: date) -> list[dict[str, Any]]:
    """One item per day for 14-30 days.

    Priority per day: exam > flight lesson > light day before a flight lesson >
    exam review (the 3 days before an exam, 1.5x minutes) > routine rotation.
    """
    events = [d for d in lesson_dates + exam_dates if d >= start]
    last_event = max(events, default=start)
    days = min(MAX_DAYS, max(MIN_DAYS, (last_event - start).days + 1))

    lessons = set(lesson_dates)
    exams = set(exam_dates)
    items: list[dict[str, Any]] = []
    routine_index = 0

    for offset in range(days):
        day = start + timedelta(days=offset)
        upcoming_exams = [e for e in exams if 0 < (e - day).days <= EXAM_REVIEW_DAYS]

        if day in exams:
            item = ("exam", "Exam day: 10-minute warm-up on readbacks, then good luck!",
                    min(minutes_per_day, 10))
        elif day in lessons:
            item = ("flight", "Flight lesson: quick radio warm-up before you fly",
                    min(minutes_per_day, 10))
        elif day + timedelta(days=1) in lessons:
            item = ("light", "Light day: skim the Radio basics flashcards before tomorrow's flight",
                    minutes_per_day * 0.5)
        elif upcoming_exams:
            days_left = min((e - day).days for e in upcoming_exams)
            item = ("review",
                    f"Exam review: phraseology, readbacks and callsigns ({days_left} day"
                    f"{'' if days_left == 1 else 's'} to exam)",
                    minutes_per_day * 1.5)
        else:
            kind, title = ROUTINE[routine_index % len(ROUTINE)]
            routine_index += 1
            item = (kind, title, minutes_per_day)

        kind, title, minutes = item
        items.append({
            "date": day.isoformat(),
            "type": kind,
            "title": title,
            "minutes": _clamp_minutes(minutes),
        })
    return items


def _ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def plan_to_ics(plan_id: str, items: list[dict[str, Any]]) -> str:
    """All-day events, one per plan item (RFC 5545, CRLF line endings)."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Squawk//Study Planner//EN",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:Squawk study plan",
    ]
    for index, item in enumerate(items):
        day = date.fromisoformat(item["date"])
        lines += [
            "BEGIN:VEVENT",
            f"UID:{plan_id}-{index}@squawk",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{(day + timedelta(days=1)).strftime('%Y%m%d')}",
            f"SUMMARY:{_ics_escape(item['title'])} ({item['minutes']} min)",
            f"CATEGORIES:{item['type'].upper()}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"

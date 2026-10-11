"""ATIS for the practice airport, built from a real METAR.

aviationweather.gov METAR (5 s timeout) -> Gemini writes the ATIS script -> the caller voices it.
DEMO_MODE or any failure falls back to a canned METAR and/or a template script.
"""

from __future__ import annotations

import json
import re
from typing import Any

import requests

from ..config import AI_TIMEOUT_SECONDS, demo_mode, env
from ..scenario import load_scenario
from .llm import generate_json
from .timeouts import call_with_timeout, logger

METAR_URL = "https://aviationweather.gov/api/data/metar"
ATIS_LETTER = "Alpha"
DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"]

CANNED_METAR: dict[str, Any] = {
    "rawOb": "METAR KTTN 111253Z 27008KT 10SM FEW045 BKN080 18/09 A3002",
    "wdir": 270, "wspd": 8, "visib": "10+", "temp": 18, "dewp": 9,
    "clouds": [{"cover": "FEW", "base": 4500}, {"cover": "BKN", "base": 8000}],
}

ATIS_PROMPT = """You write the ATIS broadcast for {facility}. Turn the METAR into ONE spoken ATIS script in
exactly this order and style (FAA phraseology, numbers spoken digit by digit as words, e.g. "two seven
zero at eight", "altimeter three zero three three"; altitudes like "seven thousand", "one one thousand"):
"{facility} information {letter}, time <hhmm> zulu. Wind <dir> at <speed>[, gusts <g>]. Visibility <vis>.
<cloud layers and ceiling, or sky clear>. Temperature <t>, dew point <d>. Altimeter <altimeter>.
Runway {runway} in use. Advise on initial contact you have information {letter}."
Use only the METAR facts given. Respond with JSON only: {{"script": string}}"""


def spoken_digits(value: str | int) -> str:
    return " ".join(DIGIT_WORDS[int(ch)] for ch in str(value) if ch.isdigit())


def spoken_altitude(feet: int) -> str:
    thousands, hundreds = divmod(int(feet) // 100 * 100, 1000)
    parts = []
    if thousands:
        parts.append(f"{spoken_digits(thousands)} thousand")
    if hundreds:
        parts.append(f"{DIGIT_WORDS[hundreds // 100]} hundred")
    return " ".join(parts) or "zero"


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def metar_facts(metar: dict[str, Any]) -> dict[str, str]:
    """Spoken-form facts from the aviationweather.gov JSON (rawOb is the source of truth for time/altimeter)."""
    raw = str(metar.get("rawOb", ""))
    time_match = re.search(r"\b\d{2}(\d{4})Z\b", raw)
    alt_match = re.search(r"\bA(\d{4})\b", raw)
    altim = alt_match.group(1) if alt_match else None
    if altim is None and _number(metar.get("altim")):
        altim = f"{round(float(metar['altim']) * 0.02953 * 100):04d}"  # hPa -> inHg

    wdir, wspd, wgst = metar.get("wdir"), _number(metar.get("wspd")), _number(metar.get("wgst"))
    if not wspd:
        wind = "calm"
    else:
        direction = "variable" if str(wdir).upper() == "VRB" else spoken_digits(f"{int(_number(wdir) or 0):03d}")
        wind = f"{direction} at {spoken_digits(int(wspd))}"
        if wgst:
            wind += f", gusts {spoken_digits(int(wgst))}"

    visib = str(metar.get("visib", "10")).replace("+", "")
    visibility = spoken_digits(visib) if visib.replace(".", "").isdigit() else visib
    if str(metar.get("visib", "")).endswith("+"):
        visibility += " or more"

    layers, ceiling_done = [], False
    names = {"FEW": "few clouds", "SCT": "scattered", "BKN": "broken", "OVC": "overcast", "OVX": "obscured"}
    for cloud in metar.get("clouds") or []:
        cover, base = str(cloud.get("cover", "")).upper(), cloud.get("base")
        if cover in ("CLR", "SKC", "CAVOK") or base is None:
            continue
        altitude = spoken_altitude(int(base))
        if cover in ("BKN", "OVC", "OVX") and not ceiling_done:
            layers.append(f"ceiling {altitude} {names[cover]}")
            ceiling_done = True
        else:
            layers.append(f"{names.get(cover, cover.lower())} at {altitude}")
    sky = ", ".join(layers) if layers else "sky clear"

    def temperature(value: Any) -> str:
        number = _number(value)
        if number is None:
            return "missing"
        rounded = round(number)
        return ("minus " if rounded < 0 else "") + spoken_digits(abs(rounded))

    return {
        "time": spoken_digits(time_match.group(1)) if time_match else "zero zero zero zero",
        "wind": wind,
        "visibility": visibility,
        "sky": sky[:1].upper() + sky[1:],
        "temperature": temperature(metar.get("temp")),
        "dewpoint": temperature(metar.get("dewp")),
        "altimeter": spoken_digits(altim) if altim else "missing",
    }


def _context() -> dict[str, str]:
    airport = load_scenario()["airport"]
    return {
        "facility": airport["name"].replace(" Airport", ""),  # "Squawk Regional"
        "runway": airport.get("runwaySpoken", "two seven"),
        "letter": ATIS_LETTER,
    }


def template_script(metar: dict[str, Any]) -> str:
    f, c = metar_facts(metar), _context()
    return (
        f"{c['facility']} information {c['letter']}, time {f['time']} zulu. Wind {f['wind']}. "
        f"Visibility {f['visibility']}. {f['sky']}. Temperature {f['temperature']}, "
        f"dew point {f['dewpoint']}. Altimeter {f['altimeter']}. Runway {c['runway']} in use. "
        f"Advise on initial contact you have information {c['letter']}."
    )


def _fetch_metar(icao: str) -> dict[str, Any] | None:
    response = requests.get(METAR_URL, params={"ids": icao, "format": "json"}, timeout=AI_TIMEOUT_SECONDS)
    if not response.ok:
        raise RuntimeError(f"aviationweather.gov HTTP {response.status_code}")
    data = response.json()
    return data[0] if isinstance(data, list) and data else None


def get_metar(icao: str) -> tuple[dict[str, Any], str]:
    """(metar, "live"|"canned")."""
    if demo_mode():
        return CANNED_METAR, "canned"
    metar = call_with_timeout("METAR", _fetch_metar, icao)
    if not metar:
        logger.warning("No METAR for %s, using the canned METAR", icao)
        return CANNED_METAR, "canned"
    return metar, "live"


def build_script(metar: dict[str, Any]) -> str:
    """Gemini ATIS script; the template if DEMO_MODE, no key, failure, or an off-format answer."""
    fallback = template_script(metar)
    if demo_mode() or not env("GEMINI_API_KEY"):
        return fallback
    context = _context()
    raw = call_with_timeout(
        "Gemini ATIS", generate_json,
        ATIS_PROMPT.format(**context),
        json.dumps({"metar": metar.get("rawOb"), "facts": metar_facts(metar)}),
        0.2,
    )
    script = str((raw or {}).get("script") or "").strip()
    if f"information {ATIS_LETTER}".lower() not in script.lower() or len(script) > 700:
        return fallback
    return script

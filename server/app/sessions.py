"""In-memory session state: peers, phase, and the half-duplex frequency lock.

All methods here run on the event loop. Sync endpoints reach them through
anyio.from_thread.run so state is only ever mutated from one thread.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

from fastapi import WebSocket

from .scenario import DEFAULT_PHASE, PHASES

logger = logging.getLogger("squawk.sessions")

ROLES = ("pilot", "atc", "device")
# A PTT held longer than this (e.g. a browser tab that died mid-transmission)
# can be taken over so a stuck mic never blocks the frequency for good.
STALE_PTT_SECONDS = 60.0


def frequency_role(role: str) -> str:
    """The Pi button is the pilot's PTT, so device counts as pilot on frequency."""
    return "pilot" if role == "device" else role


@dataclass
class Session:
    id: str
    phase: str = DEFAULT_PHASE
    clients: dict[WebSocket, str] = field(default_factory=dict)
    freq_holder: str | None = None
    freq_holder_ws: WebSocket | None = None
    freq_since: float = 0.0

    @property
    def peers(self) -> list[str]:
        present = set(self.clients.values())
        return [role for role in ROLES if role in present]

    @property
    def mode(self) -> str:
        return "human" if "atc" in self.clients.values() else "ai"

    def state_message(self) -> dict[str, Any]:
        return {
            "type": "session.state",
            "phase": self.phase,
            "mode": self.mode,
            "peers": self.peers,
            "freqHolder": self.freq_holder,
        }


class SessionHub:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str) -> Session:
        session = self._sessions.get(session_id)
        if session is None:
            session = self._sessions[session_id] = Session(id=session_id)
        return session

    def mode(self, session_id: str) -> str:
        session = self._sessions.get(session_id)
        return session.mode if session else "ai"

    def phase(self, session_id: str) -> str:
        session = self._sessions.get(session_id)
        return session.phase if session else DEFAULT_PHASE

    # -- sending ---------------------------------------------------------
    async def _send(self, session: Session, ws: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await ws.send_json(payload)
        except Exception:
            session.clients.pop(ws, None)

    async def send_to_roles(self, session_id: str, roles: Iterable[str], payload: dict[str, Any]) -> None:
        session = self.get(session_id)
        wanted = set(roles)
        for ws, role in list(session.clients.items()):
            if role in wanted:
                await self._send(session, ws, payload)

    async def broadcast(self, session_id: str, payload: dict[str, Any]) -> None:
        await self.send_to_roles(session_id, ROLES, payload)

    async def broadcast_state(self, session_id: str) -> None:
        await self.broadcast(session_id, self.get(session_id).state_message())

    # -- connection lifecycle -------------------------------------------
    async def connect(self, session_id: str, ws: WebSocket, role: str) -> None:
        await ws.accept()
        self.get(session_id).clients[ws] = role
        await self.broadcast_state(session_id)

    async def disconnect(self, session_id: str, ws: WebSocket) -> None:
        session = self.get(session_id)
        session.clients.pop(ws, None)
        if session.freq_holder_ws is ws:
            await self._release(session)
        await self.broadcast_state(session_id)

    # -- frequency lock --------------------------------------------------
    async def _release(self, session: Session) -> None:
        session.freq_holder = None
        session.freq_holder_ws = None
        await self.broadcast(session.id, {"type": "freq.clear"})

    async def _ptt_down(self, session: Session, ws: WebSocket, role: str) -> None:
        holder_role = frequency_role(role)
        if (
            session.freq_holder not in (None, holder_role)
            and time.monotonic() - session.freq_since > STALE_PTT_SECONDS
        ):
            logger.warning("Releasing stale PTT held by %s in %s", session.freq_holder, session.id)
            session.freq_holder = None
            session.freq_holder_ws = None

        if session.freq_holder not in (None, holder_role):
            await self._send(session, ws, {"type": "ptt.denied", "reason": "freq_busy"})
            return

        if session.freq_holder is None:
            session.freq_holder = holder_role
            session.freq_holder_ws = ws
            session.freq_since = time.monotonic()
            await self.broadcast(session.id, {"type": "freq.busy", "holder": holder_role})
            await self.broadcast_state(session.id)

        if role == "device":
            await self.send_to_roles(session.id, ["pilot"], {"type": "device.ptt", "state": "down"})

    async def _ptt_up(self, session: Session, role: str) -> None:
        if session.freq_holder != frequency_role(role):
            return  # not holding (e.g. was denied): nothing to release
        await self._release(session)
        await self.broadcast_state(session.id)
        if role == "device":
            await self.send_to_roles(session.id, ["pilot"], {"type": "device.ptt", "state": "up"})

    # -- inbound messages ------------------------------------------------
    async def handle(self, session_id: str, ws: WebSocket, role: str, message: dict[str, Any]) -> None:
        session = self.get(session_id)
        kind = message.get("type")

        if kind == "ptt.down":
            await self._ptt_down(session, ws, role)
        elif kind == "ptt.up":
            await self._ptt_up(session, role)
        elif kind == "phase.set":
            phase = str(message.get("phase", "")).lower()
            if phase in PHASES:
                session.phase = phase
                await self.broadcast(session_id, {"type": "phase.changed", "phase": phase})
                await self.broadcast_state(session_id)
        elif kind == "rx":
            state = message.get("state")
            if state in ("started", "stopped"):
                await self.send_to_roles(session_id, ["device"], {"type": "rx", "state": state})


hub = SessionHub()

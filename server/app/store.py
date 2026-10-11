"""Transmission + CFI alert storage.

Memory is always the source of truth for live sessions. If MONGODB_URI is set,
documents are also written to MongoDB in a background thread (so a slow or
unreachable cluster never blocks the radio), and /debrief falls back to Mongo
for sessions that are no longer in memory (e.g. after a server restart).
"""

from __future__ import annotations

import logging
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from pymongo import MongoClient

logger = logging.getLogger("squawk.store")


class Store:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._transmissions: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self._alerts: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self._client: MongoClient | None = None
        self._db = None
        self._writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="squawk-mongo")

    # -- lifecycle -------------------------------------------------------
    def connect_mongo(self, uri: str, db_name: str) -> None:
        try:
            self._client = MongoClient(uri, serverSelectionTimeoutMS=1500)
            self._db = self._client[db_name]
            logger.info("MongoDB enabled (db=%s)", db_name)
        except Exception as exc:
            logger.warning("MongoDB unavailable, using memory only: %s", exc)
            self._client = None
            self._db = None

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
        self._client = None
        self._db = None

    @property
    def mongo_enabled(self) -> bool:
        return self._db is not None

    # -- writes ----------------------------------------------------------
    def _persist(self, collection: str, doc: dict[str, Any]) -> None:
        if self._db is None:
            return
        db = self._db

        def write() -> None:
            try:
                db[collection].insert_one(dict(doc))
            except Exception as exc:
                logger.warning("Mongo write to %s failed: %s", collection, exc)

        self._writer.submit(write)

    def add_transmission(self, doc: dict[str, Any]) -> None:
        with self._lock:
            self._transmissions[doc["sessionId"]].append(doc)
        self._persist("transmissions", doc)

    def add_cfi_alert(self, doc: dict[str, Any]) -> None:
        with self._lock:
            self._alerts[doc["sessionId"]].append(doc)
        self._persist("cfi_alerts", doc)

    # -- reads -----------------------------------------------------------
    def recent(self, session_id: str, limit: int = 6) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._transmissions.get(session_id, [])[-limit:])

    def session_history(self, session_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        with self._lock:
            transmissions = list(self._transmissions.get(session_id, []))
            alerts = list(self._alerts.get(session_id, []))
        if transmissions or self._db is None:
            return transmissions, alerts

        try:
            query = {"sessionId": session_id}
            transmissions = list(self._db["transmissions"].find(query, {"_id": 0}).sort("createdAt", 1))
            alerts = list(self._db["cfi_alerts"].find(query, {"_id": 0}).sort("createdAt", 1))
        except Exception as exc:
            logger.warning("Mongo read failed: %s", exc)
        return transmissions, alerts


store = Store()

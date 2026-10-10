"""Hard wall-clock limit for blocking AI calls."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

from ..config import AI_TIMEOUT_SECONDS

logger = logging.getLogger("squawk.ai")
T = TypeVar("T")

# requests/Gemini timeouts only bound individual socket operations, so the
# total call runs in a worker and we stop waiting after AI_TIMEOUT_SECONDS.
_executor = ThreadPoolExecutor(max_workers=16, thread_name_prefix="squawk-ai")


def call_with_timeout(label: str, fn: Callable[..., T], *args, **kwargs) -> T | None:
    """Run fn in a worker; return None if it raises or exceeds the AI timeout."""
    future = _executor.submit(fn, *args, **kwargs)
    try:
        return future.result(timeout=AI_TIMEOUT_SECONDS)
    except TimeoutError:
        logger.warning("%s timed out after %.0fs, using fallback", label, AI_TIMEOUT_SECONDS)
    except Exception as exc:
        logger.warning("%s failed (%s), using fallback", label, exc)
    return None

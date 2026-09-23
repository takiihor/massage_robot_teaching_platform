"""Pure STT WebSocket budget/limit helpers.

These guard functions are deliberately free of FastAPI / Azure imports so the
admission-control rules (concurrent session cap, per-chunk size ceiling,
cumulative session byte budget and max session duration) can be unit-tested
directly. ``main.py`` constructs a :class:`SttLimits` from the environment and
uses these methods instead of scattering inline comparisons.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class SttLimits:
    max_concurrent_sessions: int
    max_chunk_b64_chars: int
    max_session_bytes: int
    max_session_seconds: float
    idle_timeout_seconds: float

    def can_accept_new_session(self, active_sessions: int) -> bool:
        """Admission control for concurrent STT sessions (fail closed at cap)."""
        return active_sessions < self.max_concurrent_sessions

    def chunk_too_large(self, b64_len: int) -> bool:
        return b64_len > self.max_chunk_b64_chars

    def session_expired(self, now: float, started: float) -> bool:
        return (now - started) > self.max_session_seconds

    def add_chunk(self, session_bytes: int, b64_len: int) -> Tuple[int, bool]:
        """Return ``(new_total, within_budget)``.

        ``within_budget`` is False when accumulating this chunk would exceed the
        session byte ceiling, so callers can stop before overrunning the buffer.
        """
        new_total = session_bytes + b64_len
        return new_total, new_total <= self.max_session_bytes

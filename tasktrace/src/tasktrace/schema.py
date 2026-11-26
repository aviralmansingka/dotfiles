"""Canonical span event shape.

One event is one JSON object, one line.  Every row records:

    ts      wall clock, ISO 8601 with the local offset
    mono     monotonic clock in seconds (survives wall clock jumps)
    kind    what changed: app, ws, rex, monitor, mode, window, boot, bind, ...
    app     application display name, when known
    bundle  bundle identifier, when known
    ws      AeroSpace workspace, when known
    idle_s  seconds since the last user input, when known
    source  which emitter produced the row
    detail  free-form extras (window id, rex block, previous workspace, ...)
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping

KINDS = (
    "app",
    "ws",
    "rex",
    "monitor",
    "mode",
    "window",
    "boot",
    "bind",
    "idle",
    "notify",
    "agent_done",
    "done",
)

FIELDS = ("ts", "mono", "kind", "app", "bundle", "ws", "idle_s", "source", "detail")


class SchemaError(ValueError):
    """A line that does not describe a span event."""


def now_ts() -> str:
    return datetime.now().astimezone().isoformat(timespec="microseconds")


def now_mono() -> float:
    return round(time.monotonic(), 6)


@dataclass(frozen=True)
class Event:
    kind: str
    ts: str
    mono: float
    app: str | None = None
    bundle: str | None = None
    ws: str | None = None
    idle_s: float | None = None
    source: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    def row(self) -> dict[str, Any]:
        return {
            "ts": self.ts,
            "mono": self.mono,
            "kind": self.kind,
            "app": self.app,
            "bundle": self.bundle,
            "ws": self.ws,
            "idle_s": self.idle_s,
            "source": self.source,
            "detail": self.detail,
        }

    def line(self) -> str:
        return json.dumps(self.row(), separators=(",", ":"), ensure_ascii=False)


def _text(value: Any, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SchemaError(f"{name} must be a string, got {type(value).__name__}")
    value = value.strip()
    return value or None


def _number(value: Any, name: str) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SchemaError(f"{name} must be a number, got {type(value).__name__}")
    return float(value)


def _detail(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise SchemaError("detail must be an object")
    return dict(value)


def build(payload: Mapping[str, Any], *, ts: str | None = None, mono: float | None = None) -> Event:
    """Validate a loose mapping and fill ts/mono when the emitter left them out."""
    if not isinstance(payload, Mapping):
        raise SchemaError("an event must be a JSON object")

    kind = payload.get("kind")
    if not isinstance(kind, str) or not kind.strip():
        raise SchemaError("kind is required")
    kind = kind.strip()
    if kind not in KINDS:
        raise SchemaError(f"unknown kind {kind!r}; known kinds: {', '.join(KINDS)}")

    stamp = _text(payload.get("ts"), "ts") or ts or now_ts()
    try:
        datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SchemaError(f"ts is not ISO 8601: {stamp!r}") from exc

    monotonic = _number(payload.get("mono"), "mono")
    if monotonic is None:
        monotonic = mono if mono is not None else now_mono()

    return Event(
        kind=kind,
        ts=stamp,
        mono=round(monotonic, 6),
        app=_text(payload.get("app"), "app"),
        bundle=_text(payload.get("bundle"), "bundle"),
        ws=_text(payload.get("ws"), "ws"),
        idle_s=_number(payload.get("idle_s"), "idle_s"),
        source=_text(payload.get("source"), "source"),
        detail=_detail(payload.get("detail")),
    )


def parse_line(line: str) -> Event:
    line = line.strip()
    if not line:
        raise SchemaError("empty line")
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        raise SchemaError(f"not JSON: {exc}") from exc
    if isinstance(payload, list):
        raise SchemaError("one event per line, got a JSON array")
    return build(payload)

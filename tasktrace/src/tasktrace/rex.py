"""Bridge over `rex events --json`.

`rex events` writes one JSON object per line, either a server level event or a
`session_event` wrapping the session's own event.  The bridge keeps block
lifecycle changes (a block appearing, closing, changing hands or state) and
drops the client connect/disconnect noise that would otherwise swamp the trace.

The bridge is also usable as a replay filter (`tasktrace rex --stdin < capture`),
which is how the recorded sample is produced without a live server.
"""

from __future__ import annotations

import json
from typing import Any, Iterable, Iterator

from .schema import Event, build

BLOCK_EVENTS = frozenset(
    {
        "block_created",
        "block_closed",
        "block_removed",
        "block_exited",
        "block_owner_changed",
        "block_renamed",
        "block_focused",
        "block_state_changed",
        "block_title_changed",
        "custom",
    }
)

SESSION_EVENTS = frozenset({"session_created", "session_removed", "session_closed"})

# Detail keys worth carrying over from the rex payload, in output order.
PASSTHROUGH = ("block_id", "reason", "owner", "previous", "title", "name", "status", "kind")


def _short(value: Any) -> Any:
    if isinstance(value, str) and ":" in value:
        return value.split(":", 1)[1]
    return value


def _detail(payload: dict[str, Any]) -> dict[str, Any]:
    detail = {}
    for key in PASSTHROUGH:
        if key in payload and isinstance(payload[key], (str, int, float, bool)):
            name = "block" if key == "block_id" else key
            value = _short(payload[key]) if key.endswith("_id") else payload[key]
            detail[name] = value
    return detail


def event_from_rex(line: str, *, idle_s: float | None = None) -> Event | None:
    """Map one rex event line to a span event, or None when it is noise."""
    line = line.strip()
    if not line:
        return None
    try:
        outer = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(outer, dict):
        return None

    kind = outer.get("type")
    payload = outer.get("payload") if isinstance(outer.get("payload"), dict) else {}

    if kind == "session_event":
        inner = payload.get("event") if isinstance(payload.get("event"), dict) else {}
        rex_type = inner.get("type")
        inner_payload = inner.get("payload") if isinstance(inner.get("payload"), dict) else {}
        if rex_type not in BLOCK_EVENTS:
            return None
        detail = {"rex_type": rex_type, "session": _short(payload.get("session_id"))}
        detail.update(_detail(inner_payload))
        # A custom event names itself in payload.name; keep it addressable.
        return build(
            {
                "kind": "rex",
                "app": inner_payload.get("app"),
                "idle_s": idle_s,
                "source": "rex",
                "detail": {k: v for k, v in detail.items() if v is not None},
            }
        )

    if kind in SESSION_EVENTS:
        detail = {"rex_type": kind, "session": _short(payload.get("session_id") or payload.get("session"))}
        return build(
            {
                "kind": "rex",
                "idle_s": idle_s,
                "source": "rex",
                "detail": {k: v for k, v in detail.items() if v is not None},
            }
        )

    return None


def events_from_lines(lines: Iterable[str], *, idle_s: float | None = None) -> Iterator[Event]:
    for line in lines:
        event = event_from_rex(line, idle_s=idle_s)
        if event is not None:
            yield event


def bridge(argv: list[str], *, idle_s: float | None = None) -> Iterator[Event]:
    """Run `rex events --json` and yield span events until rex exits."""
    import subprocess

    process = subprocess.Popen(
        ["rex", "events", "--json", *argv],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    try:
        for line in process.stdout:
            for event in events_from_lines([line], idle_s=idle_s):
                yield event
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:  # pragma: no cover - stubborn child
            process.kill()

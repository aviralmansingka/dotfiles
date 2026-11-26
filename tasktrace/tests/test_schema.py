"""Schema: the one event shape every emitter must produce."""

from __future__ import annotations

import json
from datetime import datetime

import pytest

from tasktrace.schema import KINDS, SchemaError, build, now_mono, now_ts, parse_line


def test_build_fills_ts_and_mono():
    event = build({"kind": "app", "app": "Ghostty"})
    assert event.kind == "app"
    assert event.app == "Ghostty"
    assert event.mono > 0
    datetime.fromisoformat(event.ts)


def test_build_keeps_emitter_timestamps():
    event = build({"kind": "ws", "ts": "2026-11-25T18:00:00.000000+05:30", "mono": 12.5})
    assert event.ts == "2026-11-25T18:00:00.000000+05:30"
    assert event.mono == 12.5


def test_row_has_every_recorded_field():
    row = build({"kind": "ws", "ws": "A", "idle_s": 3}).row()
    assert set(row) == {"ts", "mono", "kind", "app", "bundle", "ws", "idle_s", "source", "detail"}
    assert row["idle_s"] == 3.0
    assert row["detail"] == {}


def test_all_documented_kinds_are_accepted():
    for kind in KINDS:
        assert build({"kind": kind}).kind == kind


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"kind": ""},
        {"kind": "focus_change"},
        {"kind": 7},
        {"kind": "app", "idle_s": "soon"},
        {"kind": "app", "idle_s": True},
        {"kind": "app", "detail": ["not", "an", "object"]},
        {"kind": "app", "ts": "yesterday"},
        {"kind": "app", "app": 12},
    ],
)
def test_bad_payloads_are_rejected(payload):
    with pytest.raises(SchemaError):
        build(payload)


def test_blank_strings_become_null():
    event = build({"kind": "app", "app": "  ", "bundle": "\t", "ws": ""})
    assert (event.app, event.bundle, event.ws) == (None, None, None)


def test_line_round_trips_through_parse_line():
    event = build({"kind": "rex", "source": "rex", "detail": {"rex_type": "block_created"}})
    again = parse_line(event.line())
    assert again.row() == event.row()
    assert json.loads(event.line())["detail"] == {"rex_type": "block_created"}


@pytest.mark.parametrize("line", ["", "   ", "{", "[]", '"app"', "42"])
def test_parse_line_rejects_non_events(line):
    with pytest.raises(SchemaError):
        parse_line(line)


def test_clocks_are_usable(datetime_now=None):
    before = now_mono()
    after = now_mono()
    assert before <= after
    datetime.fromisoformat(now_ts())

"""Bridge over `rex events --json`, tested on a real captured stream."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from tasktrace.client import Client
from tasktrace.rex import BLOCK_EVENTS, event_from_rex, events_from_lines
from tasktrace.server import Collector

FIXTURE = Path(__file__).parent / "fixtures" / "rex-events.jsonl"
CAPTURE = FIXTURE.read_text().splitlines()


def test_fixture_is_a_real_capture():
    lines = [json.loads(line) for line in CAPTURE]
    assert lines
    assert all(isinstance(line, dict) for line in lines)
    assert {line["type"] for line in lines} <= {"session_event", "session_created"}


def test_block_created_becomes_a_rex_span():
    event = event_from_rex(CAPTURE[0], idle_s=4.5)
    assert event is not None
    assert event.kind == "rex"
    assert event.source == "rex"
    assert event.idle_s == 4.5
    assert event.detail["rex_type"] == "block_created"
    assert event.detail["session"].startswith("01a2")
    assert ":" not in event.detail["block"]


def test_owner_change_keeps_the_reason():
    events = [event for event in events_from_lines(CAPTURE) if event is not None]
    reasons = [event.detail.get("reason") for event in events if event.detail["rex_type"] == "block_owner_changed"]
    assert "create" in reasons
    assert "disconnect" in reasons


def test_view_and_client_noise_is_dropped():
    noise = [
        json.dumps({"type": "session_event", "payload": {"event": {"type": "client_connected"}}}),
        json.dumps({"type": "session_event", "payload": {"event": {"type": "session_view_changed"}}}),
        json.dumps({"type": "session_event", "payload": {"event": {"type": "block_event"}}}),
        json.dumps({"type": "client_connected", "payload": {}}),
        "",
        "not json",
        "[]",
    ]
    assert list(events_from_lines(noise)) == []


def test_session_lifecycle_events_are_kept():
    line = json.dumps(
        {
            "type": "session_created",
            "payload": {"session_id": "session:abc-123", "label": "build"},
        }
    )
    event = event_from_rex(line)
    assert event is not None
    assert event.detail == {"rex_type": "session_created", "session": "abc-123"}


def test_every_block_event_type_is_mapped():
    for rex_type in BLOCK_EVENTS:
        line = json.dumps(
            {
                "type": "session_event",
                "payload": {
                    "session_id": "session:abc",
                    "event": {"type": rex_type, "payload": {"block_id": "block:42"}},
                },
            }
        )
        event = event_from_rex(line)
        assert event is not None, rex_type
        assert event.detail["rex_type"] == rex_type


def test_capture_replays_into_sqlite(tmp_path):
    sock = Path(f"/tmp/tt-{uuid.uuid4().hex[:10]}.sock")
    collector = Collector(tmp_path, sock).start()
    try:
        with Client(sock) as client:
            for event in events_from_lines(CAPTURE):
                client.send_line(event)
        rows = collector.store.rows(kind="rex")
        # block_created + two block_owner_changed + block_closed; view changes are filtered.
        assert len(rows) == 4
        assert [row["detail"]["rex_type"] for row in rows] == [
            "block_created",
            "block_owner_changed",
            "block_owner_changed",
            "block_closed",
        ]
    finally:
        collector.stop()
        collector.store.close()

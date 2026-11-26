"""Store: one sqlite row per span plus a daily JSONL file."""

from __future__ import annotations

import json

from tasktrace.schema import build
from tasktrace.store import Store


def app_event(**extra):
    return build({"kind": "app", "app": "Ghostty", "bundle": "com.mitchellh.ghostty", **extra})


def test_append_writes_sqlite_row(tmp_path):
    store = Store(tmp_path)
    span_id = store.append(app_event(ws="A"))
    assert span_id == 1
    rows = store.rows()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == 1
    assert row["kind"] == "app"
    assert row["app"] == "Ghostty"
    assert row["bundle"] == "com.mitchellh.ghostty"
    assert row["ws"] == "A"
    assert row["detail"] == {}
    store.close()


def test_append_writes_daily_jsonl(tmp_path):
    store = Store(tmp_path)
    store.append(
        build({"kind": "ws", "ws": "A", "ts": "2026-11-25T09:00:00.000000+05:30", "mono": 1})
    )
    store.append(
        build({"kind": "ws", "ws": "B", "ts": "2026-11-26T09:00:00.000000+05:30", "mono": 2})
    )
    files = store.jsonl_files()
    assert [path.name for path in files] == ["2026-11-25.jsonl", "2026-11-26.jsonl"]

    first = [json.loads(line) for line in files[0].read_text().splitlines()]
    assert first[0]["ws"] == "A"
    assert first[0]["kind"] == "ws"
    assert set(first[0]) == {"ts", "mono", "kind", "app", "bundle", "ws", "idle_s", "source", "detail"}
    assert [row["ws"] for row in store.jsonl_rows()] == ["A", "B"]
    store.close()


def test_rows_filter_and_limit(tmp_path):
    store = Store(tmp_path)
    for index in range(5):
        store.append(build({"kind": "app" if index % 2 else "ws", "mono": index}))
    assert store.count() == 5
    assert store.count("app") == 2
    assert [row["mono"] for row in store.rows(limit=2)] == [0.0, 1.0]
    assert [row["kind"] for row in store.rows(kind="ws")] == ["ws", "ws", "ws"]
    store.close()


def test_reopen_keeps_rows(tmp_path):
    first = Store(tmp_path)
    first.append(app_event())
    first.close()

    second = Store(tmp_path)
    assert second.count() == 1
    second.close()

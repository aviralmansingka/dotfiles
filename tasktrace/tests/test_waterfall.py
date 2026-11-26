"""The waterfall: one box per task, one span per dwell, and the counts."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from tasktrace import cli, stitch, waterfall
from tasktrace.schema import parse_line
from tasktrace.store import Store

FIXTURE = Path(__file__).parent / "fixtures" / "waterfall-events.jsonl"
BASE = datetime(2026, 11, 26, 9, 0, 0, tzinfo=timezone.utc)


def at(seconds: float) -> str:
    return (BASE + timedelta(seconds=seconds)).isoformat(timespec="microseconds")


def row(
    seconds: float,
    *,
    kind: str = "app",
    app: str | None = "Ghostty",
    ws: str | None = "1",
    title: str | None = "dotfiles - dotfiles",
    mono: float = 0.0,
) -> dict:
    detail = {} if title is None else {"title": title}
    return {
        "ts": at(seconds),
        "mono": mono,
        "kind": kind,
        "app": app,
        "ws": ws,
        "detail": detail,
    }


def only(view: waterfall.Waterfall) -> waterfall.Box:
    assert len(view.boxes) == 1, [box.key for box in view.boxes]
    return view.boxes[0]


# ----------------------------------------------------------------------------- build


def test_one_box_per_task():
    view = waterfall.build(
        [
            row(0, app="Ghostty", ws="1"),
            row(100, app="Ghostty", ws="1"),
            row(200, app="Slack", ws="S", title="core (Channel) - Mohzi - Slack"),
            row(300, app="Slack", ws="S", title="core (Channel) - Mohzi - Slack"),
        ],
        view=waterfall.window(everything=True),
    )
    assert [box.key for box in view.boxes] == ["1/dotfiles", "S/core"]
    assert view.spans == 4
    assert all(len(box.bars) == 2 for box in view.boxes)


def test_one_span_per_dwell_labelled_with_app_and_workspace():
    box = only(
        waterfall.build(
            [
                row(0, app="Ghostty", ws="1"),
                row(10, app="Rex Beta", ws="1"),
                row(14.5, app="Slack", ws="1", title="dotfiles - Slack"),
            ],
            view=waterfall.window(everything=True),
        )
    )
    assert [(bar.app, bar.ws, bar.duration_s) for bar in box.bars] == [
        ("Ghostty", "1", 10.0),
        ("Rex Beta", "1", 4.5),
        ("Slack", "1", 0.0),
    ]
    # The last dwell of a trace is open: nothing recorded where it ended.
    assert [bar.open for bar in box.bars] == [False, False, True]


def test_a_span_without_a_workspace_takes_the_workspace_of_its_run():
    box = only(
        waterfall.build(
            [
                row(0, app="Ghostty", ws="2"),
                row(5, app="Finder", ws=None, title="dotfiles - Finder"),
            ],
            view=waterfall.window(everything=True),
        )
    )
    assert [bar.ws for bar in box.bars] == ["2", "2"]


def test_notify_and_agent_done_are_span_events_inside_the_dwell():
    box = only(
        waterfall.build(
            [
                row(0, app="Rex Beta", ws="1", title="dotfiles - Rex Beta"),
                row(2, kind="notify", app="pi", ws="1"),
                row(6, kind="agent_done", app="pi", ws="1"),
                row(9, app="Ghostty", ws="1"),
            ],
            view=waterfall.window(everything=True),
        )
    )
    # Two dwells, and the two events marked inside the first one.
    assert [bar.app for bar in box.bars] == ["Rex Beta", "Ghostty"]
    assert [mark.kind for mark in box.bars[0].marks] == ["notify", "agent_done"]
    assert box.bars[1].marks == ()
    assert box.bars[0].duration_s == 9.0  # the events do not cut the dwell
    assert (box.spans, box.events) == (4, 2)
    assert not any(bar.is_event for bar in box.bars)


def test_a_run_of_nothing_but_events_still_shows_them():
    box = only(
        waterfall.build(
            [row(0, kind="notify", app="pi", ws="1"), row(3, kind="agent_done", app="pi", ws="1")],
            view=waterfall.window(everything=True),
        )
    )
    assert len(box.bars) == 1
    assert box.bars[0].is_event and box.bars[0].kind == "notify"
    assert [mark.kind for mark in box.bars[0].marks] == ["agent_done"]
    assert box.spans == 2 and box.events == 1


def test_task_wall_time_is_attention_time():
    rows = [
        row(0, app="Ghostty", ws="1"),
        row(10, app="Ghostty", ws="1"),
        row(400, app="Ghostty", ws="1"),  # a 390 s gap splits the run
        row(410, app="Ghostty", ws="1"),
    ]
    view = waterfall.build(rows, view=waterfall.window(everything=True))
    box = only(view)
    assert box.runs == 2
    assert box.dwell_s == 20.0  # 10 + 10
    assert box.wall_s == 20.0  # 10 + 10, the gap between the runs never counts
    stitched = stitch.stitch(rows)
    assert box.wall_s == round(sum(task.wall_s for task in stitched), 3)


def test_an_open_dwell_leaves_the_wall_time_wider_than_the_dwells():
    box = only(
        waterfall.build(
            [
                row(0, app="Ghostty", ws="1"),
                row(10, app="Ghostty", ws="1"),
                row(30, kind="agent_done", app="pi", ws="1"),
            ],
            view=waterfall.window(everything=True),
        )
    )
    assert box.bars[-1].open is True
    assert box.dwell_s == 10.0  # the open dwell recorded no end
    assert box.wall_s == 30.0  # the run still reaches the agent_done row


def test_the_longest_span_is_the_widest_dwell():
    view = waterfall.build(
        [
            row(0, app="Ghostty", ws="1"),
            row(10, app="Rex Beta", ws="1"),
            row(60, app="Slack", ws="1", title="dotfiles - Slack"),
        ],
        view=waterfall.window(everything=True),
    )
    box = only(view)
    assert (box.longest.app, box.longest.duration_s) == ("Rex Beta", 50.0)
    assert box.wall_s == 60.0
    assert view.longest == (50.0, "Rex Beta", "1/dotfiles")


# ---------------------------------------------------------------------------- window


def test_the_default_window_is_one_week():
    now = datetime(2026, 11, 26, 12, 0, 0, tzinfo=timezone.utc)
    view = waterfall.window(now=now)
    assert view.days == 7.0
    assert view.until == now.timestamp()
    assert view.since == (now - timedelta(days=7)).timestamp()


def test_the_window_is_adjustable():
    now = datetime(2026, 11, 26, 12, 0, 0, tzinfo=timezone.utc)
    assert waterfall.window(now=now, days=1).days == 1.0
    bounded = waterfall.window(
        since="2026-11-25T00:00:00+00:00", until="2026-11-26T00:00:00+00:00"
    )
    assert bounded.days == 1.0
    assert bounded.since is not None and bounded.until - bounded.since == 86400.0
    assert waterfall.window(everything=True).holds(0.0)


def test_the_window_drops_rows_it_does_not_hold_and_counts_them():
    rows = [row(0), row(10), row(10 + 8 * 86400)]
    view = waterfall.build(rows, view=waterfall.window(now=BASE + timedelta(days=7)))
    assert view.spans == 2
    assert view.spans_outside_window == 1
    assert view.window.days == 7.0


def test_a_bare_stamp_is_read_as_local_time():
    assert waterfall.parse_when("2026-11-26T09:00:00").tzinfo is not None


# ---------------------------------------------------------------------------- render


def test_render_prints_one_box_per_task_with_its_counts():
    text = waterfall.render(
        waterfall.build(
            [
                row(0, app="Rex Beta", ws="1", title="dotfiles - Rex Beta"),
                row(2, kind="notify", app="pi", ws="1"),
                row(6, app="Ghostty", ws="1"),
                row(9, kind="agent_done", app="pi", ws="1"),
                row(30, app="Slack", ws="S", title="core - Slack"),
                row(34, app="Slack", ws="S", title="core - Slack"),
            ],
            view=waterfall.window(everything=True),
        )
    )
    assert text.startswith("tasktrace waterfall — window")
    assert text.count("┌─") == 2 and text.count("└") == 2
    for expected in ("1/dotfiles", "S/core", "spans 4", "events 2", "wall 9.000 s"):
        assert expected in text, expected
    assert "◆ notify" in text and "◆ agent_done" in text
    assert "summary" in text
    assert "6 spans · 2 tasks" in text


def test_render_marks_the_open_span_and_the_run_boundaries():
    text = waterfall.render(
        waterfall.build(
            [row(0, app="Ghostty", ws="1"), row(400, app="Ghostty", ws="1")],
            view=waterfall.window(everything=True),
        )
    )
    assert "open" in text
    assert "run 1" in text and "run 2" in text


def test_render_of_an_empty_window_says_so():
    view = waterfall.build([row(0)], view=waterfall.window(now=BASE + timedelta(days=30)))
    assert "no spans inside the window" in waterfall.render(view)


def test_the_json_dump_carries_the_boxes_and_the_totals():
    dumped = waterfall.build(
        [row(0, app="Ghostty", ws="1"), row(5, app="Ghostty", ws="1")],
        view=waterfall.window(everything=True),
    ).dump()
    assert dumped["tasks"] == 1 and dumped["spans"] == 2
    assert dumped["window"] == {"since": None, "until": None, "days": None}
    box = dumped["boxes"][0]
    assert box["key"] == "1/dotfiles" and box["task_id"] == stitch.task_id("1", "dotfiles")
    assert [bar["dwell_s"] for bar in box["rows"]] == [5.0, 0.0]
    assert box["rows"][1]["open"] is True


# ------------------------------------------------------------------------------- cli


@pytest.fixture()
def store(tmp_path):
    found = Store(tmp_path)
    try:
        yield found
    finally:
        found.close()


def test_the_cli_verb_reads_sqlite_and_prints_the_view(store, capsys):
    for line in (
        json.dumps(row(0, app="Rex Beta", ws="1", title="dotfiles - Rex Beta")),
        json.dumps(row(4, app="Ghostty", ws="1")),
        json.dumps(row(5, kind="agent_done", app="pi", ws="1")),
    ):
        store.append(parse_line(line))
    assert cli.main(["--home", str(store.home), "waterfall", "--all"]) == 0
    out = capsys.readouterr().out
    assert "1/dotfiles" in out
    assert "3 spans in 1 task" in out
    assert "◆ agent_done" in out


def test_the_cli_verb_takes_a_range(store, capsys):
    store.append(parse_line(json.dumps(row(0, app="Ghostty", ws="1"))))
    now = (BASE + timedelta(days=30)).isoformat(timespec="seconds")
    assert cli.main(["--home", str(store.home), "waterfall", "--until", now]) == 0
    assert "no spans inside the window" in capsys.readouterr().out
    assert (
        cli.main(
            [
                "--home",
                str(store.home),
                "waterfall",
                "--since",
                (BASE - timedelta(days=1)).isoformat(timespec="seconds"),
                "--until",
                (BASE + timedelta(days=1)).isoformat(timespec="seconds"),
            ]
        )
        == 0
    )
    assert "1/dotfiles" in capsys.readouterr().out


def test_the_cli_verb_prints_json(store, capsys):
    store.append(parse_line(json.dumps(row(0, app="Ghostty", ws="1"))))
    assert cli.main(["--home", str(store.home), "waterfall", "--all", "--json"]) == 0
    found = json.loads(capsys.readouterr().out)
    assert found["tasks"] == 1 and found["boxes"][0]["key"] == "1/dotfiles"


# ------------------------------------------------------------------ the real recording


def recorded() -> list[dict]:
    return [
        json.loads(line) for line in FIXTURE.read_text().splitlines() if line.strip()
    ]


def test_the_recording_is_a_real_capture_of_app_events():
    rows = recorded()
    assert len(rows) >= 8
    assert {row["kind"] for row in rows} >= {"app", "notify", "agent_done"}
    # The hook rows carry the probe's workspace, window id and window title.
    hooked = [row for row in rows if row["source"] == "aerospace"]
    assert hooked and all(row["ws"] for row in hooked)
    assert all(row["detail"]["window_id"] for row in hooked)
    assert all(row["detail"]["title"] for row in hooked)
    assert all(row["idle_s"] is not None for row in hooked)


def test_the_waterfall_over_the_real_recording(store):
    for row in recorded():
        store.append(parse_line(json.dumps(row)))
    newest = datetime.fromisoformat(recorded()[-1]["ts"])
    view = waterfall.build(store.rows(), view=waterfall.window(now=newest))

    assert len(view.boxes) >= 3
    assert view.spans == store.count()
    box = view.boxes[0]
    assert box.spans >= 2 and box.wall_s > 0
    assert box.longest is not None and box.longest.duration_s > 0
    assert any(bar.marks for current in view.boxes for bar in current.bars)
    assert view.longest is not None and view.longest[0] > 0

    text = waterfall.render(view)
    assert text.count("┌─") == len(view.boxes)
    assert "◆" in text

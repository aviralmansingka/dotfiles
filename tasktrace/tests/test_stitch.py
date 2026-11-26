"""Stitching rules: one task per (workspace, project), one trace per run of attention."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from tasktrace import cli, stitch
from tasktrace.schema import build
from tasktrace.store import Store

BASE = datetime(2026, 11, 26, 9, 0, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))


def ts(seconds: float) -> str:
    return (BASE + timedelta(seconds=seconds)).isoformat(timespec="microseconds")


def row(
    seconds: float,
    *,
    kind: str = "app",
    app: str | None = "Rex Beta",
    ws: str | None = None,
    title: str | None = None,
    detail: dict | None = None,
) -> dict:
    payload = {
        "ts": ts(seconds),
        "mono": 1000.0 + seconds,
        "kind": kind,
        "app": app,
        "bundle": None,
        "ws": ws,
        "idle_s": 0.5,
        "source": "test",
        "detail": detail if detail is not None else ({"title": title} if title else {}),
    }
    return payload


# --- the project root comes from the window title -------------------------------


@pytest.mark.parametrize(
    "title,app,expected",
    [
        # Real titles read from the live AeroSpace server on 2026-11-26:
        #   8749|Rex Beta|1|dotfiles - dotfiles
        #   100|Google Chrome|2|leaf - Google Chrome - Aviral (Mohzi)
        #   54|Slack|S|core (Channel) - Mohzi - Slack
        #   19484|ChatGPT|C|Private Stock Sale Strategy
        ("dotfiles - dotfiles", "Rex Beta", "dotfiles"),
        ("leaf - Google Chrome - Aviral (Mohzi)", "Google Chrome", "leaf"),
        ("core (Channel) - Mohzi - Slack", "Slack", "core"),
        ("Private Stock Sale Strategy", "ChatGPT", "Private Stock Sale Strategy"),
        # A path-shaped segment names the root, not the file inside it.
        ("~/dotfiles/src/tasktrace/cli.py - nvim", "Neovim", "dotfiles"),
        ("/Users/aviral/vault/notes.md — Obsidian", "Obsidian", "vault"),
        ("cli.py - dotfiles - Visual Studio Code", "Code", "dotfiles"),
        # A dirty marker is not part of the name.
        ("dotfiles* - pi", "pi", "dotfiles"),
        # The title is only the app's own name: no project.
        ("Ghostty", "Ghostty", None),
        ("Slack", "Slack", None),
        ("Untitled", "TextEdit", None),
        ("", "Ghostty", None),
        (None, "Ghostty", None),
    ],
)
def test_parse_project_reads_the_root_from_the_title(title, app, expected):
    assert stitch.parse_project(title, app) == expected


def test_a_title_that_gives_no_project_is_null_never_a_guess():
    assert stitch.parse_project("Telegram", "Telegram") is None
    assert stitch.parse_project(None) is None


def test_title_is_read_from_the_span_detail_then_the_row():
    assert stitch.title_of({"detail": {"title": "dotfiles - dotfiles"}}) == "dotfiles - dotfiles"
    assert stitch.title_of({"detail": {"window_title": "leaf"}}) == "leaf"
    assert stitch.title_of({"title": "leaf", "detail": {}}) == "leaf"
    assert stitch.title_of({"detail": {}}) is None


# --- the task key ---------------------------------------------------------------


def test_task_id_is_the_same_for_the_same_workspace_and_project():
    assert stitch.task_id("1", "dotfiles") == stitch.task_id("1", "dotfiles")
    assert stitch.task_id("1", "dotfiles") == "8bc9cc81f1e5"


def test_task_id_changes_with_the_workspace_or_the_project():
    keys = {
        stitch.task_id("1", "dotfiles"),
        stitch.task_id("2", "dotfiles"),
        stitch.task_id("1", "leaf"),
        stitch.task_id("1", None),
        stitch.task_id(None, "dotfiles"),
    }
    assert len(keys) == 5
    assert all(len(key) == 12 for key in keys)


def test_task_key_names_the_pair():
    assert stitch.task_key("1", "dotfiles") == "1/dotfiles"
    assert stitch.task_key(None, "dotfiles") == "-/dotfiles"
    assert stitch.task_key("2", None) == "2/-"


# --- merging and splitting -------------------------------------------------------


def rows_of(task):
    return [(trace.index, trace.span_count, trace.wall_s) for trace in task.traces]


def test_a_gap_under_two_minutes_merges_into_one_trace():
    rows = [
        row(0, ws="1", title="dotfiles - dotfiles"),
        row(60, ws="1", title="dotfiles - dotfiles"),
        row(119.9, ws="1", title="dotfiles - dotfiles"),
    ]
    tasks = stitch.stitch(rows)
    assert len(tasks) == 1
    assert tasks[0].key == "1/dotfiles"
    assert rows_of(tasks[0]) == [(1, 3, 119.9)]


def test_a_gap_of_two_minutes_splits_and_keeps_the_task_key():
    rows = [
        row(0, ws="1", title="dotfiles - dotfiles"),
        row(120, ws="1", title="dotfiles - dotfiles"),
    ]
    tasks = stitch.stitch(rows)
    assert len(tasks) == 1
    task = tasks[0]
    assert task.key == "1/dotfiles"
    assert task.span_count == 2
    assert [trace.index for trace in task.traces] == [1, 2]
    assert task.task_id == stitch.task_id("1", "dotfiles")


def test_a_workspace_change_splits_the_trace_and_the_task():
    rows = [
        row(0, ws="1", title="dotfiles - dotfiles"),
        row(10, ws="2", title="dotfiles - dotfiles"),
    ]
    tasks = stitch.stitch(rows)
    assert [task.key for task in tasks] == ["1/dotfiles", "2/dotfiles"]
    assert [len(task.traces) for task in tasks] == [1, 1]
    assert tasks[0].task_id != tasks[1].task_id


def test_a_project_change_splits_inside_one_workspace():
    rows = [
        row(0, ws="2", app="Google Chrome", title="leaf - Google Chrome - Aviral (Mohzi)"),
        row(10, ws="2", app="Google Chrome", title="dotfiles - Google Chrome - Aviral (Mohzi)"),
    ]
    tasks = stitch.stitch(rows)
    assert [task.key for task in tasks] == ["2/leaf", "2/dotfiles"]


def test_an_explicit_done_closes_the_trace_and_keeps_the_task():
    rows = [
        row(0, ws="1", title="dotfiles - dotfiles"),
        row(30, ws="1", kind="done", title="dotfiles - dotfiles"),
        row(60, ws="1", title="dotfiles - dotfiles"),
    ]
    tasks = stitch.stitch(rows)
    assert len(tasks) == 1
    task = tasks[0]
    assert [trace.span_count for trace in task.traces] == [2, 1]
    assert [span["kind"] for span in task.traces[0].spans] == ["app", "done"]


def test_spans_without_a_workspace_join_the_open_trace():
    # The NSWorkspace agent and the rex bridge carry no workspace of their own.
    rows = [
        row(0, app="Ghostty", ws=None, title="dotfiles - pi"),
        row(5, app=None, ws=None, kind="rex"),
        row(10, app="Ghostty", ws="1", title="dotfiles - pi"),
    ]
    tasks = stitch.stitch(rows)
    assert [(task.key, task.span_count) for task in tasks] == [("1/dotfiles", 3)]


def test_the_first_known_workspace_adopts_the_open_trace_without_a_split():
    rows = [
        row(0, app="Finder", ws=None, title=None),
        row(5, app="Finder", ws="2", title=None),
        row(10, app="Finder", ws="2", title=None),
    ]
    tasks = stitch.stitch(rows)
    assert len(tasks) == 1
    assert tasks[0].workspace == "2"
    assert len(tasks[0].traces) == 1


def test_a_titleless_span_keeps_the_trace_project_but_records_a_null_project():
    rows = [
        row(0, ws="1", title="dotfiles - dotfiles"),
        row(5, ws="1", title=None),
    ]
    (task,) = stitch.stitch(rows)
    assert task.project == "dotfiles"
    assert [span["project"] for span in task.traces[0].spans] == ["dotfiles", None]
    # The key still names the task the span joined.
    assert {span["task_id"] for span in task.traces[0].spans} == {task.task_id}


def test_a_first_title_adopts_the_project_without_splitting():
    rows = [
        row(0, ws="1", title=None),
        row(5, ws="1", title="dotfiles - dotfiles"),
    ]
    (task,) = stitch.stitch(rows)
    assert task.project == "dotfiles"
    assert len(task.traces) == 1


def test_rows_are_stitched_in_time_order_not_insert_order():
    rows = [
        row(300, ws="1", title="dotfiles - dotfiles"),
        row(0, ws="1", title="dotfiles - dotfiles"),
        row(60, ws="1", title="dotfiles - dotfiles"),
    ]
    (task,) = stitch.stitch(rows)
    assert [span["ts"] for span in task.traces[0].spans] == [ts(0), ts(60)]
    assert [span["ts"] for span in task.traces[1].spans] == [ts(300)]


def test_wall_time_never_counts_the_gap_between_traces():
    rows = [
        row(0, ws="1", title="dotfiles - dotfiles"),
        row(60, ws="1", title="dotfiles - dotfiles"),
        row(6000, ws="1", title="dotfiles - dotfiles"),
    ]
    (task,) = stitch.stitch(rows)
    assert task.wall_s == 60.0
    assert [trace.wall_s for trace in task.traces] == [60.0, 0.0]


def test_every_span_gets_a_task_id():
    rows = [
        row(0, ws="1", title="dotfiles - dotfiles"),
        row(60, ws="1", title=None),
        row(600, ws="2", app="Google Chrome", title="leaf - Google Chrome - Aviral (Mohzi)"),
    ]
    annotated = stitch.annotate(rows)
    assert len(annotated) == len(rows)
    assert all(span["task_id"] and span["key"] and span["trace"] for span in annotated)
    assert [span["key"] for span in annotated] == ["1/dotfiles", "1/dotfiles", "2/leaf"]


# --- the one CLI verb -----------------------------------------------------------


def write(home, rows) -> None:
    store = Store(home)
    try:
        for payload in rows:
            store.append(
                build({key: value for key, value in payload.items() if key not in ("ts", "mono")}, ts=payload["ts"], mono=payload["mono"])
            )
    finally:
        store.close()


def test_traces_dump_names_the_task_key_spans_and_wall_time(tmp_path, capsys):
    write(
        tmp_path,
        [
            row(0, ws="1", title="dotfiles - dotfiles"),
            row(60, ws="1", title="dotfiles - dotfiles"),
            row(240, ws="1", title="dotfiles - dotfiles"),
            row(260, ws="2", app="Google Chrome", title="leaf - Google Chrome - Aviral (Mohzi)"),
        ],
    )
    capsys.readouterr()
    assert cli.main(["--home", str(tmp_path), "traces"]) == 0
    out = capsys.readouterr().out
    tasks_block, traces_block = out.split("traces:")
    assert tasks_block.splitlines()[0] == "tasks:"
    header, task_row = tasks_block.strip().splitlines()[1:3]
    assert header.split("\t") == ["key", "task_id", "spans", "traces", "wall_s"]
    key, task_id, spans, traces, wall = task_row.split("\t")
    assert key == "1/dotfiles"
    assert task_id == stitch.task_id("1", "dotfiles")
    assert (spans, traces, wall) == ("3", "2", "60.0")
    rows_out = traces_block.strip().splitlines()
    assert rows_out[0].split("\t") == ["key", "trace", "start", "end", "spans", "wall_s", "apps"]
    assert [line.split("\t")[0] for line in rows_out[1:]] == ["1/dotfiles", "1/dotfiles", "2/leaf"]


def test_traces_json_is_one_object_per_task_with_its_runs(tmp_path, capsys):
    write(
        tmp_path,
        [
            row(0, ws="1", title="dotfiles - dotfiles"),
            row(60, ws="1", title="dotfiles - dotfiles"),
            row(900, ws="1", title="dotfiles - dotfiles"),
        ],
    )
    capsys.readouterr()
    assert cli.main(["--home", str(tmp_path), "traces", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["key"] == "1/dotfiles"
    assert payload["project"] == "dotfiles"
    assert (payload["spans"], payload["traces"], payload["wall_s"]) == (3, 2, 60.0)
    assert [run["spans"] for run in payload["runs"]] == [2, 1]
    assert payload["runs"][0]["rows"][0]["kind"] == "app"


def test_traces_limit_keeps_the_newest_spans(tmp_path, capsys):
    write(
        tmp_path,
        [
            row(0, ws="2", app="Google Chrome", title="leaf - Google Chrome - Aviral (Mohzi)"),
            row(600, ws="1", title="dotfiles - dotfiles"),
        ],
    )
    capsys.readouterr()
    assert cli.main(["--home", str(tmp_path), "traces", "--json", "--limit", "1"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["key"] == "1/dotfiles"


def test_an_empty_store_dumps_empty_blocks(tmp_path, capsys):
    assert cli.main(["--home", str(tmp_path), "traces"]) == 0
    out = capsys.readouterr().out
    assert "tasks:" in out and "traces:" in out
    assert len([line for line in out.splitlines() if line.startswith("key\t")]) == 2

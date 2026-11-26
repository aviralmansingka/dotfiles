"""CLI end to end against a real socket server, with every live probe stubbed."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from tasktrace import cli, probe
from tasktrace.server import Collector

FIXTURE = Path(__file__).parent / "fixtures" / "rex-events.jsonl"


@pytest.fixture()
def collector(tmp_path):
    sock = Path(f"/tmp/tt-{uuid.uuid4().hex[:10]}.sock")
    running = Collector(tmp_path, sock).start()
    try:
        yield running
    finally:
        running.stop()
        running.store.close()


def args(collector, *rest):
    """Point the CLI at the fixture's home and socket."""
    return ["--home", str(collector.home), "--socket", str(collector.socket_path), *rest]


def run(collector, argv, monkeypatch, **env):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return cli.main(args(collector, *argv))


def test_hook_focus_writes_an_app_row(collector, monkeypatch):
    code = run(
        collector,
        ["hook", "focus", "--no-probe", "--no-idle"],
        monkeypatch,
        AEROSPACE_FOCUSED_WORKSPACE="A",
        TASKTRACE_APP="Ghostty",
        TASKTRACE_BUNDLE="com.mitchellh.ghostty",
    )
    assert code == 0
    row = collector.store.rows()[0]
    assert (row["kind"], row["app"], row["ws"]) == ("app", "Ghostty", "A")
    assert row["source"] == "aerospace"


def test_hook_workspace_writes_a_ws_row(collector, monkeypatch):
    code = run(
        collector,
        ["hook", "workspace", "--no-probe", "--no-idle"],
        monkeypatch,
        AEROSPACE_FOCUSED_WORKSPACE="B",
        AEROSPACE_PREV_WORKSPACE="A",
    )
    assert code == 0
    row = collector.store.rows()[0]
    assert row["kind"] == "ws"
    assert row["ws"] == "B"
    assert row["detail"] == {"hook": "workspace", "prev_ws": "A"}


def test_hook_reads_socket_from_the_environment(collector, monkeypatch):
    monkeypatch.setenv("TASKTRACE_SOCK", str(collector.socket_path))
    assert cli.hook_main(["mode", "--no-probe", "--no-idle"]) == 0
    assert collector.store.rows()[0]["kind"] == "mode"


def test_hook_main_defaults_to_focus(collector, monkeypatch):
    monkeypatch.setenv("TASKTRACE_SOCK", str(collector.socket_path))
    monkeypatch.setenv("AEROSPACE_WORKSPACE", "C")
    assert cli.hook_main(["--no-probe", "--no-idle"]) == 0
    assert collector.store.rows()[0]["detail"]["hook"] == "focus"


def test_hook_without_a_server_exits_two(tmp_path, monkeypatch):
    monkeypatch.setenv("TASKTRACE_SOCK", str(tmp_path / "missing.sock"))
    assert cli.main(["hook", "focus", "--no-probe", "--no-idle"]) == 2


def test_bad_entry_point_is_a_usage_error():
    with pytest.raises(SystemExit):
        cli.main(["hook", "hotkey"])


def test_probe_values_are_recorded(collector, monkeypatch):
    monkeypatch.setattr(
        probe,
        "focus_context",
        lambda: {"app": "Rex Beta", "bundle": "com.superlogical.rex", "ws": "1"},
    )
    monkeypatch.setattr(probe, "idle_seconds", lambda: 7.25)
    code = run(
        collector,
        ["hook", "focus"],
        monkeypatch,
        AEROSPACE_WINDOW_ID="8749",
    )
    assert code == 0
    row = collector.store.rows()[0]
    assert row["app"] == "Rex Beta"
    assert row["bundle"] == "com.superlogical.rex"
    assert row["ws"] == "1"
    assert row["idle_s"] == 7.25


def test_send_with_detail(collector, monkeypatch):
    code = run(
        collector,
        [
            "send",
            "--kind",
            "notify",
            "--app",
            "pi",
            "--ws",
            "A",
            "--detail",
            '{"title": "done"}',
        ],
        monkeypatch,
    )
    assert code == 0
    row = collector.store.rows()[0]
    assert (row["kind"], row["source"], row["detail"]) == ("notify", "cli", {"title": "done"})


def test_rex_stdin_replay(collector, monkeypatch, capsys):
    lines = FIXTURE.read_text()
    monkeypatch.setattr("sys.stdin", __import__("io").StringIO(lines))
    code = run(collector, ["rex", "--stdin", "--no-idle"], monkeypatch)
    assert code == 0
    assert json.loads(capsys.readouterr().out) == {"ok": True, "rows": 4}
    assert collector.store.count("rex") == 4


def test_spans_dump(collector, monkeypatch, capsys):
    cli.main(args(collector, "send", "--kind", "app", "--app", "Ghostty"))
    capsys.readouterr()
    assert cli.main(args(collector, "spans")) == 0
    out = capsys.readouterr().out
    header, row = out.strip().splitlines()
    assert header.split("\t") == [
        "id",
        "ts",
        "mono",
        "kind",
        "app",
        "bundle",
        "ws",
        "idle_s",
        "source",
        "detail",
    ]
    assert row.split("\t")[3] == "app"
    assert row.split("\t")[4] == "Ghostty"


def test_spans_json(collector, monkeypatch, capsys):
    cli.main(args(collector, "send", "--kind", "app", "--app", "Ghostty"))
    capsys.readouterr()
    assert cli.main(args(collector, "spans", "--json")) == 0
    row = json.loads(capsys.readouterr().out)
    assert row["app"] == "Ghostty"
    assert row["detail"] == {}


def test_hooks_table_lists_nine_lines(capsys, monkeypatch):
    assert cli.main(["hooks"]) == 0
    out = capsys.readouterr().out
    assert out.count("tasktrace-hook") == 9
    assert "on-focus-changed" in out
    assert "exec-on-workspace-change" in out


def test_frontmost_and_idle_commands(capsys, monkeypatch):
    monkeypatch.setattr(probe, "frontmost_app", lambda: ("Ghostty", "com.mitchellh.ghostty"))
    monkeypatch.setattr(probe, "idle_seconds", lambda: 3.5)
    assert cli.main(["frontmost"]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "app": "Ghostty",
        "bundle": "com.mitchellh.ghostty",
    }
    assert cli.main(["idle"]) == 0
    assert capsys.readouterr().out.strip() == "3.5"

"""macOS probes: lsappinfo and ioreg parsing, with subprocesses stubbed out."""

from __future__ import annotations

import subprocess

from tasktrace import probe
from pathlib import Path

FRONT = "ASN:0x0-0xf00f:\n"

INFO = '''"Rex Beta" ASN:0x0-0xf00f: (in front)
    bundleID="com.superlogical.rex"
    bundle path=[ NULL ]
    executable path=[ NULL ]
'''

IOREG = '''+-o Root  <class IORegistryEntry, id 0x100000100, retain 37>
  +-o IOHIDSystem  <class IOHIDSystem, id 0x100000202, registered, matched, active, busy 0 (0 ms), retain 23>
      "HIDIdleTime" = 1876961541
'''


def fake_runner(outputs, calls=None):
    def run(argv, **kwargs):
        if calls is not None:
            calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, outputs.get(argv[0], ""), "")

    return run


def test_parse_lsappinfo_reads_name_and_bundle():
    assert probe.parse_lsappinfo(FRONT, INFO) == ("Rex Beta", "com.superlogical.rex")


def test_parse_lsappinfo_falls_back_to_the_front_line():
    front = '"Finder" ASN:0x0-0x1a01a:\n'
    assert probe.parse_lsappinfo(front, "") == ("Finder", None)


def test_parse_lsappinfo_survives_garbage():
    assert probe.parse_lsappinfo("", "bundleID=\"\"") == (None, None)


def test_frontmost_app_calls_lsappinfo_twice():
    calls = []
    outputs = {
        "lsappinfo": "ASN:0x0-0xf00f:\n",  # `front`; `info` output is checked below
    }

    def run(argv, **kwargs):
        calls.append(argv)
        if argv[1] == "front":
            return subprocess.CompletedProcess(argv, 0, FRONT, "")
        return subprocess.CompletedProcess(argv, 0, INFO, "")

    assert probe.frontmost_app(run) == ("Rex Beta", "com.superlogical.rex")
    assert calls[0] == ["lsappinfo", "front"]
    assert calls[1][:2] == ["lsappinfo", "info"]
    assert outputs  # keeps the fixture honest


def test_frontmost_app_returns_nulls_when_lsappinfo_is_missing():
    def run(argv, **kwargs):
        raise FileNotFoundError("lsappinfo")

    assert probe.frontmost_app(run) == (None, None)


WINDOW = "Rex Beta|com.superlogical.rex|1|dotfiles - dotfiles\n"


def test_aerospace_binary_falls_back_past_a_bare_path(monkeypatch, tmp_path):
    binary = tmp_path / "aerospace"
    binary.write_text("#!/bin/sh\n")
    binary.chmod(0o755)
    monkeypatch.setenv("TASKTRACE_AEROSPACE", str(binary))
    monkeypatch.setattr(probe, "_AEROSPACE", None)
    assert probe.aerospace_binary() == str(binary)


def test_aerospace_binary_is_null_when_absent(monkeypatch, tmp_path):
    monkeypatch.delenv("TASKTRACE_AEROSPACE", raising=False)
    monkeypatch.setattr(probe, "shutil", type("S", (), {"which": staticmethod(lambda name: None)})())
    monkeypatch.setattr(probe, "Path", lambda value: Path(tmp_path / "missing"))
    monkeypatch.setattr(probe, "_AEROSPACE", None)
    assert probe.aerospace_binary() is None


def test_parse_aerospace_window_splits_app_bundle_workspace_and_title():
    assert probe.parse_aerospace_window(WINDOW) == (
        "Rex Beta",
        "com.superlogical.rex",
        "1",
        "dotfiles - dotfiles",
    )


def test_parse_aerospace_window_tolerates_a_line_without_a_title():
    assert probe.parse_aerospace_window("Rex Beta|com.superlogical.rex|1\n") == (
        "Rex Beta",
        "com.superlogical.rex",
        "1",
        None,
    )
    assert probe.parse_aerospace_window("Rex Beta||1|\n") == ("Rex Beta", None, "1", None)


def test_parse_aerospace_window_tolerates_empty_and_junk():
    assert probe.parse_aerospace_window("") == (None, None, None, None)
    assert probe.parse_aerospace_window("no pipes here") == (None, None, None, None)


def test_parse_aerospace_workspace_reads_the_first_line():
    assert probe.parse_aerospace_workspace("1\n") == "1"
    assert probe.parse_aerospace_workspace("") is None


def test_focus_context_uses_aerospace_first():
    calls = []

    def run(argv, **kwargs):
        calls.append(argv)
        if argv[1:3] == ["list-windows", "--focused"]:
            return subprocess.CompletedProcess(argv, 0, WINDOW, "")
        return subprocess.CompletedProcess(argv, 0, "1\n", "")

    assert probe.focus_context(run) == {
        "app": "Rex Beta",
        "bundle": "com.superlogical.rex",
        "ws": "1",
        "title": "dotfiles - dotfiles",
    }
    assert Path(calls[0][0]).name == "aerospace"
    assert calls[0][1:3] == ["list-windows", "--focused"]
    assert "%{app-bundle-id}" in calls[0][-1]


def test_focus_context_falls_back_for_an_empty_workspace():
    def run(argv, **kwargs):
        if argv[1:3] == ["list-windows", "--focused"]:
            return subprocess.CompletedProcess(argv, 0, "", "")
        if argv[1:3] == ["list-workspaces", "--focused"]:
            return subprocess.CompletedProcess(argv, 0, "2\n", "")
        if argv[1] == "front":
            return subprocess.CompletedProcess(argv, 0, FRONT, "")
        return subprocess.CompletedProcess(argv, 0, INFO, "")

    assert probe.focus_context(run) == {
        "app": "Rex Beta",
        "bundle": "com.superlogical.rex",
        "ws": "2",
        "title": None,
    }


def test_focus_context_is_null_when_nothing_answers():
    def run(argv, **kwargs):
        raise FileNotFoundError("no such tool")

    assert probe.focus_context(run) == {
        "app": None,
        "bundle": None,
        "ws": None,
        "title": None,
    }


def test_parse_idle_converts_nanoseconds():
    assert probe.parse_idle(IOREG) == 1.877


def test_parse_idle_without_the_key_is_null():
    assert probe.parse_idle("no idle here") is None


def test_idle_seconds_uses_ioreg():
    calls = []
    runner = fake_runner({"ioreg": IOREG}, calls)
    assert probe.idle_seconds(runner) == 1.877
    assert calls == [["ioreg", "-c", "IOHIDSystem", "-r", "-d", "1"]]


def test_idle_seconds_is_null_on_a_failed_probe():
    def run(argv, **kwargs):
        return subprocess.CompletedProcess(argv, 1, "", "boom")

    assert probe.idle_seconds(run) is None

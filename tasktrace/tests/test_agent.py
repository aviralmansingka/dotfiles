"""The NSWorkspace agent: source shape and build bookkeeping, never compiled here."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from tasktrace import agent

SOURCE = Path(__file__).resolve().parents[1] / "agent" / "AppFocus.m"

# AppKit exists on macOS only, so a real compile is a platform skip, never a
# silent pass: `scripts/test-tasktrace.py` asserts this test reports SKIPPED
# (with this reason) on a non-macOS runner.


def test_agent_source_is_shipped():
    assert agent.source_path() == SOURCE
    source = SOURCE.read_text()
    assert "NSWorkspaceDidActivateApplicationNotification" in source
    assert "NSWorkspace" in source
    assert "TASKTRACE_SOCK" in source
    assert '"kind"' in source and '"app"' in source and '"bundle"' in source


def test_agent_writes_newline_delimited_json_to_the_socket():
    source = SOURCE.read_text()
    assert "NSJSONSerialization" in source
    assert "appendBytes:&newline" in source
    assert "socket(AF_UNIX, SOCK_STREAM, 0)" in source
    assert "connect(fd" in source


def test_build_command_uses_clang_and_links_appkit(tmp_path):
    argv = agent.build_command(tmp_path)
    assert argv[0] == "clang"
    assert "-fobjc-arc" in argv
    assert "AppKit" in argv
    assert "CoreGraphics" in argv
    assert argv[-1] == str(SOURCE)
    assert argv[-2] == str(agent.binary_path(tmp_path))


def test_existing_binary_skips_the_compiler(tmp_path):
    binary = agent.binary_path(tmp_path)
    binary.parent.mkdir(parents=True)
    binary.write_text("#!/bin/sh\n")
    binary.touch()
    source = agent.source_path()
    binary.touch()
    assert binary.stat().st_mtime >= source.stat().st_mtime

    def runner(*args, **kwargs):  # pragma: no cover - must not be called
        raise AssertionError("clang should not run")

    assert agent.ensure_binary(tmp_path, runner=runner) == binary


def test_missing_binary_compiles(tmp_path):
    calls = []

    def runner(argv, **kwargs):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "", "")

    assert agent.ensure_binary(tmp_path, runner=runner) == agent.binary_path(tmp_path)
    assert calls == [agent.build_command(tmp_path)]


def test_compiler_failure_is_reported(tmp_path):
    def runner(argv, **kwargs):
        return subprocess.CompletedProcess(argv, 1, "", "error: 'AppKit/AppKit.h' file not found")

    with pytest.raises(agent.AgentError, match="AppKit"):
        agent.ensure_binary(tmp_path, runner=runner)


def test_missing_clang_is_reported(tmp_path):
    def runner(argv, **kwargs):
        raise FileNotFoundError("clang")

    with pytest.raises(agent.AgentError, match="clang"):
        agent.ensure_binary(tmp_path, runner=runner)


@pytest.mark.skipif(sys.platform != "darwin", reason="AppKit needs macOS")
def test_the_agent_builds_on_macos(tmp_path):
    """The one test that really compiles: clang, AppKit and CoreGraphics."""
    assert subprocess.run(["clang", "--version"], capture_output=True).returncode == 0
    binary = agent.ensure_binary(tmp_path)
    assert binary.is_file() and binary.stat().st_size > 0
    assert binary == agent.binary_path(tmp_path)

"""Build and launch the NSWorkspace activation agent.

The agent is a small Objective-C program (`agent/AppFocus.m`) in this repo.  It
is compiled once into the collector home and then run as a long-lived
LaunchAgent or a `tasktrace app-agent` child.  Nothing here runs in tests.

clang compiles it, not swiftc: the CommandLineTools Swift compiler on this host
is older than the installed macOS SDK and cannot build any Swift program.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


class AgentError(RuntimeError):
    """The agent source or compiler is missing."""


def source_path() -> Path:
    here = Path(__file__).resolve()
    for parent in list(here.parents)[:6]:
        candidate = parent / "agent" / "AppFocus.m"
        if candidate.is_file():
            return candidate
    raise AgentError("agent/AppFocus.m not found next to the tasktrace package")


def binary_path(home: Path | str) -> Path:
    return Path(home) / "bin" / "AppFocus"


def build_command(home: Path | str) -> list[str]:
    return [
        "clang",
        "-fobjc-arc",
        "-O2",
        "-framework",
        "AppKit",
        "-framework",
        "CoreGraphics",
        "-o",
        str(binary_path(home)),
        str(source_path()),
    ]


def ensure_binary(home: Path | str, *, runner=subprocess.run) -> Path:
    binary = binary_path(home)
    source = source_path()
    if binary.is_file() and binary.stat().st_mtime >= source.stat().st_mtime:
        return binary
    binary.parent.mkdir(parents=True, exist_ok=True)
    try:
        done = runner(build_command(home), capture_output=True, text=True, timeout=180, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise AgentError(f"cannot run clang: {exc}") from exc
    if done.returncode != 0:
        raise AgentError(f"clang failed: {(done.stderr or done.stdout or '').strip()}")
    return binary


def run_argv(home: Path | str) -> list[str]:
    return [str(binary_path(home))]


def launch(home: Path | str, socket_path: Path | str) -> None:
    """exec the agent, inheriting stdout/stderr; the caller's process becomes it."""
    binary = ensure_binary(home)
    env = dict(os.environ)
    env["TASKTRACE_SOCK"] = str(socket_path)
    os.execve(str(binary), run_argv(home), env)

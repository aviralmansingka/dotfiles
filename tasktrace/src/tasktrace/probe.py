"""Cheap macOS probes: focused app, workspace and keyboard idle time.

Every probe is a subprocess call to a tool the machine already has
(`aerospace`, `lsappinfo`, `ioreg`), so the hook path needs no Objective-C
bridge, no extra dependency and no permissions prompt.  Failures are soft: a
missing value is recorded as null, never invented.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Callable

Runner = Callable[..., subprocess.CompletedProcess]

_NAME = re.compile(r'^"(?P<name>[^"]*)"\s+ASN:')
_BUNDLE = re.compile(r'bundleID="(?P<bundle>[^"]*)"')
_IDLE = re.compile(r'"HIDIdleTime"\s*=\s*(\d+)')

WINDOW_FORMAT = "%{app-name}|%{app-bundle-id}|%{workspace}|%{window-title}"

_AEROSPACE: str | None = None


def aerospace_binary() -> str | None:
    """Find the AeroSpace CLI even when the hook's PATH is bare."""
    global _AEROSPACE
    if _AEROSPACE is not None:
        return _AEROSPACE
    candidates = [
        os.environ.get("TASKTRACE_AEROSPACE"),
        shutil.which("aerospace"),
        "/opt/homebrew/bin/aerospace",
        "/usr/local/bin/aerospace",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            _AEROSPACE = candidate
            return candidate
    return None


def _run(argv: list[str], runner: Runner) -> str:
    try:
        done = runner(argv, capture_output=True, text=True, timeout=2, check=False)
    except (OSError, subprocess.SubprocessError):
        return ""
    if done.returncode != 0:
        return ""
    return done.stdout or ""


def parse_lsappinfo(front: str, info: str) -> tuple[str | None, str | None]:
    """Turn `lsappinfo front` + `lsappinfo info` output into (name, bundle id)."""
    name = None
    bundle = None
    for line in info.splitlines():
        match = _NAME.match(line.strip())
        if match and name is None:
            name = match.group("name").strip() or None
        match = _BUNDLE.search(line)
        if match and bundle is None:
            bundle = match.group("bundle").strip() or None
    if name is None:
        # `lsappinfo info <asn>` sometimes prints only the bundle keys.
        for line in front.splitlines():
            match = _NAME.match(line.strip())
            if match:
                name = match.group("name").strip() or None
                break
    return name, bundle


def frontmost_app(runner: Runner = subprocess.run) -> tuple[str | None, str | None]:
    front = _run(["lsappinfo", "front"], runner).strip()
    if not front:
        return None, None
    info = _run(["lsappinfo", "info", "-only", "name", "-only", "bundleid", front], runner)
    return parse_lsappinfo(front, info)


def parse_aerospace_window(
    output: str,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Parse one `list-windows --focused --format` line: app|bundle|workspace|title.

    A three-field line (no title) still parses; the title is then null.
    """
    for line in output.splitlines():
        parts = line.split("|")
        if len(parts) not in (3, 4):
            continue
        app, bundle, ws = (part.strip() or None for part in parts[:3])
        title = (parts[3].strip() or None) if len(parts) == 4 else None
        if app or bundle or ws or title:
            return app, bundle, ws, title
    return None, None, None, None


def parse_aerospace_workspace(output: str) -> str | None:
    for line in output.splitlines():
        value = line.strip()
        if value:
            return value
    return None


def focus_context(runner: Runner = subprocess.run) -> dict[str, str | None]:
    """Focused app, bundle, workspace and window title, AeroSpace first."""
    app, bundle, ws, title = parse_aerospace_window(
        _run(
            [aerospace_binary() or "aerospace", "list-windows", "--focused", "--format", WINDOW_FORMAT],
            runner,
        )
    )
    if ws is None:
        ws = parse_aerospace_workspace(
            _run([aerospace_binary() or "aerospace", "list-workspaces", "--focused"], runner)
        )
    if app is None and bundle is None:
        app, bundle = frontmost_app(runner)
    return {"app": app, "bundle": bundle, "ws": ws, "title": title}


def idle_seconds(runner: Runner = subprocess.run) -> float | None:
    output = _run(["ioreg", "-c", "IOHIDSystem", "-r", "-d", "1"], runner)
    return parse_idle(output)


def parse_idle(ioreg_output: str) -> float | None:
    match = _IDLE.search(ioreg_output)
    if not match:
        return None
    return round(int(match.group(1)) / 1_000_000_000, 3)

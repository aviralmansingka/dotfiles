#!/usr/bin/env python3
"""Record a real waterfall capture: one collector, real windows, real waiting.

This is the S03 evidence recorder.  It starts the real collector on a temporary
home, fires the real focus hook through the shim exactly as `exec-and-forget`
does, and sends `tasktrace send` rows for other real windows whose app name,
workspace and window title are read from the live AeroSpace server.  The waits
between the rows are real sleeps, so every dwell in the result is elapsed wall
clock, not a fabricated timestamp.

It writes the collector's daily JSONL to `tasktrace/tests/fixtures/`, which is
what the offline test reads: `test_waterfall.py` loads it into a throwaway
sqlite store and renders the waterfall, so the suite proves the view over a
real recording without a live session.

Run it from the repository root (macOS: it needs AeroSpace and the apps it
names):

    uv run --project tasktrace python tasktrace/scripts/record_waterfall.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SHIM = REPO / "tasktrace" / "bin" / "tasktrace-hook"
FIXTURE = REPO / "tasktrace" / "tests" / "fixtures" / "waterfall-events.jsonl"
WINDOW_FORMAT = "%{window-id}|%{app-name}|%{app-bundle-id}|%{workspace}|%{window-title}"


def aerospace() -> str:
    found = shutil.which("aerospace") or next(
        (
            path
            for path in ("/opt/homebrew/bin/aerospace", "/usr/local/bin/aerospace")
            if Path(path).is_file()
        ),
        None,
    )
    if not found:
        sys.exit("record_waterfall: no aerospace on PATH; this recorder needs the live server")
    return found


def windows() -> dict[str, dict[str, str]]:
    """Every open window on this host, keyed by app name."""
    out = subprocess.run(
        [aerospace(), "list-windows", "--all", "--format", WINDOW_FORMAT],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    found: dict[str, dict[str, str]] = {}
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) != 5:
            continue
        window_id, app, bundle, workspace, title = parts
        if app and app not in found:
            found[app] = {
                "window_id": window_id,
                "app": app,
                "bundle": bundle,
                "ws": workspace,
                "title": title,
            }
    return found


def focused() -> dict[str, str]:
    out = subprocess.run(
        [aerospace(), "list-windows", "--focused", "--format", WINDOW_FORMAT],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    window_id, app, bundle, workspace, title = out.split("|")
    return {"window_id": window_id, "app": app, "bundle": bundle, "ws": workspace, "title": title}


class Recorder:
    def __init__(self, home: Path, sock: Path) -> None:
        self.home = home
        self.sock = sock
        self.env = {
            **os.environ,
            "TASKTRACE_HOME": str(home),
            "TASKTRACE_SOCK": str(sock),
        }
        self.rows = 0

    def hook(self, window_id: str) -> None:
        """Fire the real focus hook the way AeroSpace's exec-and-forget does."""
        env = {**self.env, "AEROSPACE_WINDOW_ID": window_id}
        done = subprocess.run(
            ["/bin/bash", "-c", f'exec "{SHIM}" focus'],
            capture_output=True,
            text=True,
            env=env,
        )
        if done.returncode != 0:
            sys.exit(f"record_waterfall: hook failed: {done.stderr.strip() or done.stdout.strip()}")
        self.rows += 1
        print(f"  hook focus -> {done.stdout.strip()}")

    def send(
        self,
        kind: str,
        *,
        app: str | None = None,
        ws: str | None = None,
        title: str | None = None,
        source: str = "cli",
        note: str | None = None,
    ) -> None:
        """One `tasktrace send` row through the real CLI."""
        detail: dict[str, object] = {}
        if title:
            detail["title"] = title
        if note:
            detail["note"] = note
        argv = [
            sys.executable,
            "-m",
            "tasktrace",
            "--home",
            str(self.home),
            "--socket",
            str(self.sock),
            "send",
            "--kind",
            kind,
            "--source",
            source,
            "--detail",
            json.dumps(detail),
        ]
        if app:
            argv += ["--app", app]
        if ws:
            argv += ["--ws", ws]
        done = subprocess.run(argv, capture_output=True, text=True, env=self.env)
        if done.returncode != 0:
            sys.exit(f"record_waterfall: send failed: {done.stderr.strip() or done.stdout.strip()}")
        self.rows += 1
        print(f"  send {kind:<10} {app or '-':<14} ws {ws or '-':<3} {done.stdout.strip()}")


def main() -> int:
    home = Path(tempfile.mkdtemp(prefix="tt-waterfall-"))
    sock = Path(f"/tmp/tt-waterfall-{uuid.uuid4().hex[:10]}.sock")
    open_windows = windows()
    labelled = ", ".join(f"{name} ({item['ws']})" for name, item in open_windows.items())
    print(f"home    {home}")
    print(f"socket  {sock}")
    print(f"windows {labelled}")
    print()

    recorder = Recorder(home, sock)
    serve = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "tasktrace",
            "--home",
            str(home),
            "--socket",
            str(sock),
            "serve",
        ],
        stdout=subprocess.PIPE,
        text=True,
        env=recorder.env,
    )
    print(serve.stdout.readline().strip() if serve.stdout else "", flush=True)
    try:
        live = focused()
        print(f"block 1 — the real focus hook, on {live['app']} ws {live['ws']}")
        recorder.hook(live["window_id"])
        time.sleep(2.0)
        recorder.send("notify", app="pi", ws=live["ws"], note="turn finished", title=live["title"])
        time.sleep(3.0)
        recorder.hook(live["window_id"])

        for index, name in enumerate(("Rex Beta", "Slack", "Granola"), start=2):
            window = open_windows.get(name)
            if window is None:
                print(f"block {index} — {name} is not open; skipped")
                continue
            print(f"block {index} — {name} ws {window['ws']}: {window['title']!r}")
            wait = 2.0 if index == 2 else 3.0
            time.sleep(wait)
            recorder.send("app", app=name, ws=window["ws"], title=window["title"], source="cli")
            time.sleep(4.0 if index == 3 else 1.5)
            if index == 2:
                recorder.send(
                    "app", app=name, ws=window["ws"], title=window["title"], source="cli"
                )
                recorder.send("agent_done", app="pi", ws=window["ws"], note="step finished")
            elif index == 3:
                recorder.send(
                    "agent_done", app="pi", ws=window["ws"], note="turn finished",
                    title=window["title"],
                )
            else:
                recorder.send("app", app=name, ws=window["ws"], title=window["title"], source="cli")
    finally:
        serve.terminate()
        try:
            serve.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover - defensive
            serve.kill()

    lines: list[str] = []
    for path in sorted((home / "events").glob("*.jsonl")):
        lines.extend(line for line in path.read_text().splitlines() if line.strip())
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text("\n".join(lines) + "\n")
    kinds: dict[str, int] = {}
    for line in lines:
        kind = json.loads(line)["kind"]
        kinds[kind] = kinds.get(kind, 0) + 1
    print()
    print(f"wrote   {FIXTURE.relative_to(REPO)} — {len(lines)} rows")
    print(f"kinds   {json.dumps(kinds, sort_keys=True)}")
    shutil.rmtree(home, ignore_errors=True)
    if sock.exists():
        sock.unlink()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Record one sample trace: app activations, workspace switches, rex block changes.

Run it with uv:

    uv run --project tasktrace python tasktrace/scripts/record_sample.py

The collector runs here, the real NSWorkspace agent is compiled and launched,
the real apps named in --apps are activated, the AeroSpace hook entry points are
invoked with the environment AeroSpace passes them, and a real `rex events
--json` capture is replayed through the bridge.  Output lands in
tasktrace/samples/<date>/.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path

from tasktrace import agent, probe
from tasktrace.server import Collector

PROJECT = Path(__file__).resolve().parents[1]
REPO = PROJECT.parent


def aerospace_window(env: dict[str, str]) -> tuple[str | None, str | None]:
    """Live window id and workspace from the running AeroSpace server."""
    binary = probe.aerospace_binary()
    if binary is None:
        return None, None
    try:
        done = subprocess.run(
            [binary, "list-windows", "--focused", "--format", "%{window-id}|%{workspace}"],
            capture_output=True,
            text=True,
            timeout=3,
            env=env,
            check=False,
        )
    except OSError:
        return None, None
    parts = (done.stdout or "").strip().split("|")
    if done.returncode != 0 or len(parts) != 2:
        return None, None
    return parts[0].strip() or None, parts[1].strip() or None


def cli(env: dict[str, str], *args: str) -> subprocess.CompletedProcess:
    done = subprocess.run(
        [sys.executable, "-m", "tasktrace", *args],
        capture_output=True,
        text=True,
        env=env,
        cwd=PROJECT,
        check=False,
    )
    if done.returncode != 0:
        print(f"  ! {' '.join(args)} -> {done.returncode}: {done.stderr.strip()}", file=sys.stderr)
    return done


def hook(env: dict[str, str], entry: str, **extra: str) -> subprocess.CompletedProcess:
    """Run the shim exactly as `exec-and-forget` would: /bin/bash -c '<hook> <entry>'."""
    shim = PROJECT / "bin" / "tasktrace-hook"
    done = subprocess.run(
        ["/bin/bash", "-c", f'"{shim}" {entry}'],
        capture_output=True,
        text=True,
        env={**env, **extra},
        check=False,
    )
    print(f"    {entry}: rc={done.returncode} {done.stdout.strip() or done.stderr.strip()}")
    return done


def activate(path: str, seconds: float) -> None:
    subprocess.run(["open", "-a", path], check=False)
    time.sleep(seconds)


def record(
    out: Path,
    apps: list[str],
    rex_capture: Path,
    dwell: float,
    with_agent: bool,
) -> None:
    home = Path(tempfile.mkdtemp(prefix="tasktrace-sample-"))
    sock = Path(f"/tmp/tt-{uuid.uuid4().hex[:10]}.sock")
    collector = Collector(home, sock).start()
    env = dict(os.environ, TASKTRACE_HOME=str(home), TASKTRACE_SOCK=str(sock))

    started = datetime.now().astimezone()
    notes: list[str] = []

    try:
        # 1. App activations through the real NSWorkspace agent.
        if with_agent:
            binary = agent.ensure_binary(home)
            child = subprocess.Popen([str(binary)], env=env)
            try:
                time.sleep(1.0)
                for app_name in apps:
                    activate(app_name, dwell)
            finally:
                child.terminate()
                child.wait(timeout=5)
            notes.append(f"NSWorkspace agent: {', '.join(apps)} activated for real")
        else:
            notes.append("NSWorkspace agent skipped by --no-agent")

        # 2. AeroSpace hook entry points, with the environment AeroSpace sets.
        window_id, workspace = aerospace_window(env)
        context = probe.focus_context()
        workspace = workspace or context["ws"] or "1"
        other = "2" if workspace != "2" else "1"
        print(f"  aerospace: window={window_id} workspace={workspace}")
        if window_id:
            hook(env, "focus", AEROSPACE_WINDOW_ID=window_id)
        else:
            hook(env, "focus")
        hook(env, "workspace", AEROSPACE_FOCUSED_WORKSPACE=other, AEROSPACE_PREV_WORKSPACE=workspace)
        hook(env, "workspace", AEROSPACE_FOCUSED_WORKSPACE=workspace, AEROSPACE_PREV_WORKSPACE=other)
        notes.append(
            "AeroSpace hook: the shim ran through /bin/bash -c, as `exec-and-forget` does. "
            f"`focus` ran with AEROSPACE_WINDOW_ID={window_id} from the live AeroSpace server, "
            f"then two `workspace` rows for {workspace}->{other} and back"
        )

        # 3. Rex block changes, replayed from a real capture.
        if rex_capture.is_file():
            (out / "input").mkdir(parents=True, exist_ok=True)
            done = subprocess.run(
                [sys.executable, "-m", "tasktrace", "rex", "--stdin", "--no-idle"],
                input=rex_capture.read_text(),
                capture_output=True,
                text=True,
                env=env,
                cwd=PROJECT,
                check=False,
            )
            print(f"  rex replay: {done.stdout.strip() or done.stderr.strip()}")
            notes.append(f"rex bridge: replayed the real capture {rex_capture.name}")
            shutil.copy(rex_capture, out / "input" / "rex-capture.jsonl")
        else:
            notes.append(f"rex capture missing: {rex_capture}")
    finally:
        collector.stop()

    # 4. Export the recorded material.
    (out / "events").mkdir(parents=True, exist_ok=True)
    for source in collector.store.jsonl_files():
        shutil.copy(source, out / "events" / source.name)
    rows = collector.store.rows()
    with open(out / "spans.tsv", "w", encoding="utf-8") as handle:
        handle.write("id\tts\tmono\tkind\tapp\tbundle\tws\tidle_s\tsource\tdetail\n")
        for row in rows:
            handle.write(
                "\t".join(
                    str(row[key] if row[key] is not None else "")
                    for key in ("id", "ts", "mono", "kind", "app", "bundle", "ws", "idle_s", "source")
                )
                + "\t"
                + json.dumps(row["detail"], separators=(",", ":"), ensure_ascii=False)
                + "\n"
            )
    collector.store.close()

    counts = {kind: sum(1 for row in rows if row["kind"] == kind) for kind in sorted({r["kind"] for r in rows})}
    (out / "README.md").write_text(
        "\n".join(
            [
                "# Recorded sample",
                "",
                f"Recorded {started.isoformat(timespec='seconds')} on this host.",
                f"Rows: {len(rows)} ({', '.join(f'{kind}={count}' for kind, count in counts.items())}).",
                "",
                "## What is real",
                "",
                *(f"- {note}" for note in notes),
                "",
                "## Files",
                "",
                "- `events/` — the collector's daily JSONL, one line per span row.",
                "- `spans.tsv` — the same rows read back from sqlite.",
                "- `input/rex-capture.jsonl` — the raw `rex events --json` lines replayed.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"  rows: {len(rows)} -> {out}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--apps", default="Finder,Ghostty")
    parser.add_argument("--dwell", type=float, default=1.4)
    parser.add_argument("--rex-capture", type=Path, default=PROJECT / "tests" / "fixtures" / "rex-events.jsonl")
    parser.add_argument("--no-agent", action="store_true")
    args = parser.parse_args(argv)

    out = args.out or PROJECT / "samples" / datetime.now().astimezone().strftime("%Y-%m-%d")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    record(
        out,
        [name for name in args.apps.split(",") if name],
        args.rex_capture,
        args.dwell,
        not args.no_agent,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

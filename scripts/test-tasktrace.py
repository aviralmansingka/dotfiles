#!/usr/bin/env python3
# Paths: tasktrace/** scripts/test-tasktrace.py docs/ci-tests/tasktrace.md
"""tasktrace suite — the attention collector, the stitcher, and the waterfall.

The behavior of the package lives in its own pytest suite
(`tasktrace/tests/`): the collector, the probes, the stitcher, the waterfall,
and the nix packaging. This entry is what CI runs for the same paths, so it
guards three things an offline runner can check without a live session:

  - the pytest suite itself, when `uv` is available (it is the runner the
    package declares in `tasktrace/pyproject.toml`);
  - the module wiring: the package imports from source, and the two console
    scripts in `pyproject.toml` name functions that exist;
  - the view over the committed recording: the real capture under
    `tasktrace/tests/fixtures/` is loaded into a throwaway sqlite store and
    the waterfall is rendered through the real CLI entry point. That is
    stdlib only, so it runs even when `uv` is not installed.

Offline and deterministic: no network, no live pi session, no nvim, no
multiplexer server, no `$HOME` mutation (every store is under a temporary
directory), no sleeps. Each check prints PASS, FAIL, or SKIP with the
reason, plus per-check and total run times. The script exits non-zero when
any check fails. See docs/ci-tests/tasktrace.md for scope and known gaps.

Dual mode: a missing tool (uv, tomllib) SKIPs with a notice by default and
FAILs under STRICT=1, mirroring the repo rule. The macOS-only check inside
the suite — `test_the_agent_builds_on_macos`, the one that really compiles
the NSWorkspace agent — is guarded with a platform skip, and this entry
proves the skip is a skip, never a silent pass.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROJECT = REPO / "tasktrace"
SOURCE = PROJECT / "src"
FIXTURE = PROJECT / "tests" / "fixtures" / "waterfall-events.jsonl"
DOC = REPO / "docs" / "ci-tests" / "tasktrace.md"
STRICT = os.environ.get("STRICT") == "1"

try:
    import tomllib  # python 3.11+
except ImportError:  # python 3.9/3.10 (local macs)
    tomllib = None

RESULTS = []


def record(name, ok, reason=""):
    RESULTS.append((name, ok, reason))
    label = "PASS" if ok is True else "FAIL" if ok is False else "SKIP"
    suffix = f" — {reason}" if reason else ""
    print(f"{label} {name}{suffix}")


def python(*argv, env=None, timeout=180):
    """Run a python snippet in a child process, with the package on the path."""
    merged = {**os.environ, "PYTHONPATH": str(SOURCE), "PYTHONDONTWRITEBYTECODE": "1"}
    merged.update(env or {})
    return subprocess.run(
        [sys.executable, *argv],
        capture_output=True,
        text=True,
        timeout=timeout,
        env=merged,
        cwd=str(REPO),
    )


def snippet(code):
    """Run a python source string in a child, so a failure cannot leak here."""
    return python("-c", code)


def uv_available():
    for candidate in (
        os.environ.get("TASKTRACE_UV"),
        "/opt/homebrew/bin/uv",
        "/usr/local/bin/uv",
        str(Path.home() / ".local" / "bin" / "uv"),
        str(Path.home() / ".nix-profile" / "bin" / "uv"),
        "/run/current-system/sw/bin/uv",
    ):
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    found = None
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if directory and (Path(directory) / "uv").is_file():
            found = str(Path(directory) / "uv")
            break
    return found


def check_pytest():
    """The package's own suite, run the way `pyproject.toml` declares."""
    uv = uv_available()
    if uv is None:
        return None, ["uv is not installed; the pytest suite needs the project runner"]
    done = subprocess.run(
        [uv, "run", "--project", str(PROJECT), "pytest", "-q"],
        capture_output=True,
        text=True,
        timeout=300,
        cwd=str(REPO),
    )
    if done.returncode != 0:
        tail = (done.stdout + done.stderr).strip().splitlines()[-6:]
        return False, ["pytest failed: " + " | ".join(tail)]
    summary = [line for line in done.stdout.splitlines() if " passed" in line]
    return True, [summary[-1].strip() if summary else "pytest passed"]


def check_macos_guard():
    """The agent compile test must SKIP off macOS, never silently pass."""
    uv = uv_available()
    if uv is None:
        return None, ["uv is not installed; the guard check needs the project runner"]
    done = subprocess.run(
        [
            uv,
            "run",
            "--project",
            str(PROJECT),
            "pytest",
            "-q",
            "-rs",
            "-k",
            "test_the_agent_builds_on_macos",
        ],
        capture_output=True,
        text=True,
        timeout=300,
        cwd=str(REPO),
    )
    text = done.stdout + done.stderr
    if done.returncode != 0:
        return False, ["the agent check did not pass or skip: " + text.strip()[-200:]]
    if sys.platform == "darwin":
        if "1 passed" not in text:
            return False, ["macOS host but the agent did not compile: " + text.strip()[-200:]]
        return True, []
    if "1 skipped" not in text or "AppKit needs macOS" not in text:
        return False, ["non-macOS host without a platform skip: " + text.strip()[-200:]]
    return True, ["skipped on this platform, not silently passed"]


def check_imports():
    """The package imports from source and both console scripts resolve."""
    done = snippet(
        "import importlib\n"
        "for name in ('tasktrace.schema', 'tasktrace.store', 'tasktrace.stitch',\n"
        "             'tasktrace.waterfall', 'tasktrace.cli', 'tasktrace.probe'):\n"
        "    importlib.import_module(name)\n"
        "from tasktrace.cli import hook_main, main\n"
        "assert callable(main) and callable(hook_main)\n"
        "from tasktrace.waterfall import DEFAULT_DAYS\n"
        "assert DEFAULT_DAYS == 7.0, DEFAULT_DAYS\n"
        "print('ok')\n"
    )
    if done.returncode != 0:
        return False, [(done.stderr or done.stdout).strip().splitlines()[-1:][0]]
    return True, []


def check_one_week_default():
    """The window defaults to one week and stays adjustable."""
    done = snippet(
        "from datetime import datetime, timedelta, timezone\n"
        "from tasktrace import waterfall\n"
        "now = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)\n"
        "default = waterfall.window(now=now)\n"
        "assert default.days == 7.0, default.days\n"
        "assert default.until - default.since == 604800.0\n"
        "assert waterfall.window(now=now, days=1).days == 1.0\n"
        "narrow = waterfall.window(since='2026-11-25T00:00:00+00:00',\n"
        "                          until='2026-11-26T00:00:00+00:00')\n"
        "assert narrow.days == 1.0\n"
        "assert waterfall.window(everything=True).days is None\n"
        "print('ok')\n"
    )
    if done.returncode != 0:
        return False, [(done.stderr or done.stdout).strip().splitlines()[-1:][0]]
    return True, []


def check_waterfall_over_the_recording():
    """Load the committed real capture into sqlite and render the real view."""
    if not FIXTURE.is_file():
        return False, [f"{FIXTURE.relative_to(REPO)}: missing"]
    with tempfile.TemporaryDirectory() as home:
        done = python(
            "-c",
            (
                "import json, sys\n"
                "from tasktrace.schema import parse_line\n"
                "from tasktrace.store import Store\n"
                "from tasktrace import cli\n"
                f"rows = [json.loads(l) for l in open({str(FIXTURE)!r}) if l.strip()]\n"
                "store = Store(sys.argv[1])\n"
                "for row in rows:\n"
                "    store.append(parse_line(json.dumps(row)))\n"
                "assert store.count() == len(rows), (store.count(), len(rows))\n"
                "store.close()\n"
                "assert cli.main(['--home', sys.argv[1], 'waterfall', '--all']) == 0\n"
                "assert cli.main(['--home', sys.argv[1], 'waterfall', '--all', '--json']) == 0\n"
            ),
            home,
            env={"TASKTRACE_HOME": home},
        )
        text = done.stdout
    if done.returncode != 0:
        return False, [(done.stderr or text).strip().splitlines()[-1:][0]]
    problems = []
    for expected in ("tasktrace waterfall — window", "◆ notify", "◆ agent_done", "summary"):
        if expected not in text:
            problems.append(f"the view never printed {expected!r}")
    if "┌─" not in text:
        problems.append("no task box was drawn")
    # The JSON form must agree with the text form on the task count.
    dumps = [
        json.loads(line)
        for line in text.splitlines()
        if line.startswith("{") and '"boxes"' in line
    ]
    if not dumps:
        problems.append("--json printed no waterfall object")
    else:
        found = dumps[-1]
        if found["tasks"] != text.count("┌─"):
            problems.append(
                f"json says {found['tasks']} tasks, the view drew {text.count('┌─')} boxes"
            )
        if found["spans"] <= 0 or not found["boxes"]:
            problems.append("json reports no spans")
        if not any(box["rows"] for box in found["boxes"]):
            problems.append("json reports a task with no span rows")
    return (not problems), problems


def check_packaging():
    """A uv project with the two console scripts, and the doc that ships with it."""
    if tomllib is None:
        return None, ["tomllib unavailable (python < 3.11)"]
    problems = []
    try:
        with (PROJECT / "pyproject.toml").open("rb") as handle:
            project = tomllib.load(handle)
    except Exception as exc:  # noqa: BLE001
        return False, [f"tasktrace/pyproject.toml: does not parse as TOML: {exc}"]
    build = project.get("build-system", {})
    if build.get("build-backend") != "uv_build":
        problems.append(f"build backend is {build.get('build-backend')!r}, expected uv_build")
    if not any("uv_build" in requirement for requirement in build.get("requires", [])):
        problems.append("build requires does not list uv_build")
    scripts = sorted(project.get("project", {}).get("scripts", {}))
    if scripts != ["tasktrace", "tasktrace-hook"]:
        problems.append(f"console scripts are {scripts}")
    if not DOC.is_file():
        problems.append(f"{DOC.relative_to(REPO)}: missing")
    else:
        text = DOC.read_text()
        for heading in ("## Purpose", "## Overview", "## What the suite covers"):
            if heading not in text:
                problems.append(f"{DOC.relative_to(REPO)}: no {heading!r} section")
    return (not problems), problems


def main():
    started = time.monotonic()
    checks = [
        ("pytest suite (uv)", check_pytest),
        ("macOS agent check skips off macOS", check_macos_guard),
        ("package imports and console scripts", check_imports),
        ("window default is one week", check_one_week_default),
        ("waterfall over the recorded capture", check_waterfall_over_the_recording),
        ("packaging and domain doc", check_packaging),
    ]
    for name, fn in checks:
        began = time.monotonic()
        ok, problems = fn()
        record(name, ok, "; ".join(problems) if problems else "")
        print(f"     {time.monotonic() - began:.2f} s")
        if ok is None and STRICT:
            # A SKIP that is only allowed because a tool is missing becomes a
            # failure under STRICT (CI), mirroring the repo's dual mode.
            RESULTS[-1] = (name, False, f"SKIP not allowed under STRICT=1: {problems}")
    elapsed = time.monotonic() - started
    failed = [result for result in RESULTS if result[1] is False]
    print(
        f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed in {elapsed:.2f} s"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

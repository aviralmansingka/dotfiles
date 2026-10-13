#!/usr/bin/env python3
# Paths: pi/.pi/agent/extensions/** pi/bin/**
"""child-stdio structural lint: a captured child may never inherit stderr.

The #291 class: `execFileSync` (and `execSync`) capture stdout but, without
an explicit `stdio` option, Node routes the child's stderr to the parent's
stderr — the agent's TTY. The agent_not_found JSON splattered over the
orchestrator panes was one instance. The fix shape is
`stdio: ["pipe", "pipe", "pipe"]` (or deliberate `ignore`) plus
null-on-failure at the call site.

Why a source scan is allowed: the repo bans BEHAVIOR assertions made by
source-text greps (a grep cannot prove what a program does). This entry is
a STRUCTURAL lint, like `bash -n` or `py_compile`: it asserts a safety
property of the CALL SHAPE only — every captured child-process call in
scope carries an explicit `stdio` (JS) or a redirected `stderr` (Python).
It never claims to prove runtime behavior.

Leak model (each line verified against the real runtimes, offline):
- JS `execFileSync`/`execSync` without `stdio`: child stderr reaches the
  parent's TTY while stdout is captured. FLAGGED.
- JS `spawnSync`/`spawn`: default stdio is "pipe"; stderr lands in
  `result.stderr`, never the TTY. Exempt.
- JS async `execFile`/`exec`: stderr is delivered through the callback
  error/stderr argument, never the TTY. Exempt (the sites must still
  handle that error; the domain suites pin that behavior).
- Python `subprocess` calls that capture stdout but leave `stderr=None`:
  the child's stderr inherits the parent's TTY. FLAGGED.
  `capture_output=True` and `stderr=PIPE`/`stderr=STDOUT` are safe shapes.
  `os.popen` captures stdout with stderr inherited. FLAGGED.

Intentional passthrough is pinned in INTENTIONAL_INHERIT below (file +
call-site reason). A stale allowlist entry is a failure, so the list can
never rot silently.

Offline and deterministic: python3 stdlib only, no network, no $HOME
mutation, no sleeps. Exit 0 when every captured call is guarded or
allowlisted; exit 1 with file:line offenders otherwise.
See docs/ci-tests/child-stdio.md for scope, coverage, and known gaps.
"""

import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

JS_SYNC_RE = re.compile(r"\b(execFileSync|execSync)\s*\(")
PY_CALL_RE = re.compile(r"\b(?:subprocess\.(?:run|check_output|check_call|Popen)|os\.popen)\s*\(")
PY_STDOUT_PIPE_RE = re.compile(r"\bstdout\s*=\s*(?:subprocess\.)?PIPE\b")
PY_STDERR_RE = re.compile(r"\bstderr\s*=")
STDIO_RE = re.compile(r"\bstdio\b")

REGION_CAP = 4000  # chars; guards runaway scans on unbalanced text

# Call sites that intentionally let child stderr reach the terminal, or
# test-harness sites whose stderr passthrough lands in the suite runner's
# own log (never a user TTY). Keys are repo-relative paths.
#   {"allow_all": True, "reason": ...}  -> suppress every flag in the file
#   {"needle": ..., "reason": ...}      -> suppress the flagged call whose
#     argument region contains the needle (content-anchored, survives line
#     drift). An entry that suppresses nothing is a stale-entry failure.
INTENTIONAL_INHERIT = {
    # (herdr.ts and tmux.ts previously sat here as allow_all while their
    # stdio pass was in flight; the pass landed — every captured
    # execFileSync in both files now carries stdio: ["pipe", "pipe",
    # "pipe"] — so the entries were deleted and the lint enforces the
    # files.)
    # Injectable seam wrapper: the call shape has no stdio of its own —
    # every caller passes one (audited: 6 sites, all explicit).
    "pi/.pi/agent/extensions/nvim-open.ts": [
        {
            "needle": "(command, args, options)",
            "reason": (
                "injectable seam wrapper; it forwards options verbatim and "
                "every caller passes an explicit stdio (audited: 6 sites)"
            ),
        },
    ],
    # Test harness: stderr passthrough lands in the suite runner's log.
    "pi/.pi/agent/extensions/nvim-open.test.mjs": [
        {
            "needle": "command -v bash",
            "reason": "test harness: fake-bin probe via real sh; stderr goes to the runner log, not a user TTY",
        },
        {
            "needle": "[shScript, ...args]",
            "reason": "test harness: fake-binary child with a scratch env; stderr goes to the runner log, not a user TTY",
        },
    ],
    "pi/.pi/agent/extensions/no-mistakes-bridge.test.mjs": [
        {
            "needle": "ws-stub",
            "reason": "test harness: stub tab created through the fake herdr on PATH; stderr goes to the runner log, not a user TTY",
        },
        {
            "needle": '["pane", "close", gone]',
            "reason": "test harness: best-effort cleanup of a stub pane through the fake herdr",
        },
        {
            "needle": "w1:p-nope",
            "reason": (
                "deliberately leaky control-child source string — this is "
                "the #291 regression made visible; the suite pins that the "
                "production seam removes it"
            ),
        },
    ],
    "pi/.pi/agent/extensions/tool-call-renderer-public.test.mjs": [
        {
            "needle": "git init --quiet",
            "reason": "test harness: scratch git repo in a mkdtemp dir; stderr goes to the runner log, not a user TTY",
        },
    ],
}


def call_region(text: str, open_idx: int) -> str:
    """Return the balanced-paren argument region starting at open_idx."""
    depth = 0
    i = open_idx
    n = len(text)
    while i < n and i - open_idx < REGION_CAP:
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return text[open_idx : i + 1]
        i += 1
    return text[open_idx : open_idx + REGION_CAP]


def line_is_comment(line_text: str) -> bool:
    stripped = line_text.lstrip()
    return stripped.startswith(("//", "*", "/*", "#"))


def scan_js(text: str):
    """Yield (lineno, fn, region) for each captured sync call without stdio."""
    for match in JS_SYNC_RE.finditer(text):
        line_start = text.rfind("\n", 0, match.start()) + 1
        line_end = text.find("\n", match.start())
        if line_end == -1:
            line_end = len(text)
        if line_is_comment(text[line_start:line_end]):
            continue
        region = call_region(text, match.end() - 1)
        if not STDIO_RE.search(region):
            yield (text.count("\n", 0, match.start()) + 1, match.group(1), region)


def scan_py(text: str):
    """Yield (lineno, fn, region) for each captured subprocess call whose
    stderr is not redirected."""
    for match in PY_CALL_RE.finditer(text):
        line_start = text.rfind("\n", 0, match.start()) + 1
        line_end = text.find("\n", match.start())
        if line_end == -1:
            line_end = len(text)
        if line_is_comment(text[line_start:line_end]):
            continue
        region = call_region(text, match.end() - 1)
        fn = match.group(0)[:-1].strip()
        if fn == "os.popen":
            # Captures stdout; stderr is always inherited and cannot be
            # redirected through this API.
            yield (text.count("\n", 0, match.start()) + 1, fn, region)
        elif "capture_output" in region:
            continue  # captures stderr too
        elif PY_STDOUT_PIPE_RE.search(region) and not PY_STDERR_RE.search(region):
            yield (text.count("\n", 0, match.start()) + 1, fn, region)


def tracked_scope():
    """Every tracked .ts/.mjs/.py under the extensions tree and pi/bin, plus
    extensionless python-shebang scripts under pi/bin."""
    if subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=REPO, capture_output=True,
    ).returncode != 0:
        print(f"FAIL: {REPO} is not a git work tree; cannot enumerate scope")
        sys.exit(1)
    out = subprocess.run(
        ["git", "ls-files", "pi/.pi/agent/extensions", "pi/bin"],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    files = [f for f in out if f.endswith((".ts", ".mjs", ".py"))]
    for f in out:
        if "/" in f and "." not in f.rsplit("/", 1)[-1] and f.startswith("pi/bin/"):
            try:
                first = (REPO / f).read_text(encoding="utf-8", errors="replace").splitlines()[0]
            except (OSError, IndexError):
                continue
            if "python" in first:
                files.append(f)
    return sorted(files)


def main() -> int:
    started = time.monotonic()
    files = tracked_scope()
    flags = []  # (path, lineno, fn, region)
    scanned_calls = 0
    for rel in files:
        path = REPO / rel
        text = path.read_text(encoding="utf-8", errors="replace")
        scanner = scan_js if rel.endswith((".ts", ".mjs")) else scan_py
        all_calls = JS_SYNC_RE if rel.endswith((".ts", ".mjs")) else PY_CALL_RE
        scanned_calls += len(all_calls.findall(text))
        for lineno, fn, region in scanner(text):
            flags.append((rel, lineno, fn, region))

    used_entries = set()
    offenders = []
    for rel, lineno, fn, region in flags:
        entries = INTENTIONAL_INHERIT.get(rel, [])
        allowed = None
        for idx, entry in enumerate(entries):
            if entry.get("allow_all") or (
                "needle" in entry and entry["needle"] in region
            ):
                allowed = entry
                used_entries.add((rel, idx))
                break
        if allowed is None:
            offenders.append((rel, lineno, fn, region))

    stale = []
    for rel, entries in INTENTIONAL_INHERIT.items():
        if not (REPO / rel).exists():
            stale.append((rel, "<missing file>"))
            continue
        for idx, entry in enumerate(entries):
            if (rel, idx) not in used_entries:
                stale.append((rel, entry.get("needle") or "allow_all"))

    fail = False
    for rel, lineno, fn, region in offenders:
        first_line = region.splitlines()[0][:100]
        print(f"FAIL {rel}:{lineno}: captured {fn} without stdio — "
              f"child stderr inherits the TTY (#291 class): {first_line}")
        fail = True
    for rel, ident in stale:
        print(f"FAIL stale INTENTIONAL_INHERIT entry in {rel}: {ident} "
              f"matches no flagged call — remove or update it")
        fail = True

    elapsed = time.monotonic() - started
    if fail:
        print(f"child-stdio: FAILED ({len(files)} files, {scanned_calls} captured "
              f"calls, {len(flags)} flagged, {len(offenders)} unguarded) "
              f"in {elapsed:.2f}s")
        return 1
    print(f"child-stdio: passed — {len(files)} files, {scanned_calls} captured "
          f"calls scanned, {len(flags) - len(offenders)} allowlisted, "
          f"0 unguarded ({elapsed:.2f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

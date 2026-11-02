#!/usr/bin/env python3
"""Render-level guard for thinking-title rows.

Two phases, both rendered through a real pi TUI inside a PTY and replayed
with pyte. No model call happens.

Visible phase (live pi install): a fixture session with a short and a long
thinking block, each before a bash call, must show each thinking run as ONE
title row — the short block verbatim (codex-style), the long block as its
first sentence. Between the two tool rows the gap must be exactly blank,
title, blank. This catches deployment drift (extension not stowed, settings
not synced, hideThinkingBlock back on) that state checks alone can miss.

Hidden phase (isolated agent dir with hideThinkingBlock on): the same
fixture must show no extra row and no doubled blank lines. The hidden row
depends on the pi version:
- pi 1.5.0 and newer: the extension hands pi an empty label, and pi renders
  such a run as nothing, spacers included. No "✺ thinking" row may appear.
- pi 1.4.0: an empty label leaves its structural spacers behind
  (#thinking-space), so the extension keeps the visible "✺ thinking" label.
  Exactly one label row per hidden run, with single blank lines around it.

This phase names the branch's own extension file, so it tests the code
under change instead of the deployed copy. It also renders a message whose
only thinking block is whitespace: that is the "thinking off" case, and no
row may appear for it on any version.

The spinner that animates while a run streams cannot be captured from a
completed-session fixture; its rules are pinned in
pi/.pi/agent/extensions/thinking-title.test.mjs instead.

Run locally (needs the live pi install; no model call happens):

    uv run --with pyte scripts/test-pi-hidden-thinking-render.py

Each phase skips with a printed reason when its inputs are unavailable.
"""
import json
import os
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import time
import fcntl
import termios

ROWS, COLS = 100, 100

FINAL_TEXT = "fixture complete"
OFF_USER_TEXT = "Run one command, then reply complete."
SHORT_TITLE = "Planning the first command."
LONG_FIRST_SENTENCE = (
    "Checking the first result carefully before deciding whether the "
    "second command is necessary"
)

REPO_EXTENSION = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "pi/.pi/agent/extensions/thinking-title.ts",
)


def skip(reason: str) -> None:
    print(f"SKIP: {reason}")
    sys.exit(0)


def write_session(path: str, lines: list[dict]) -> None:
    with open(path, "w") as handle:
        for line in lines:
            handle.write(json.dumps(line) + "\n")


def build_session(path: str) -> None:
    """Fixture: user msg, thinking+bash1, result, thinking+bash2, result, text."""
    now = "2026-01-01T00:00:00.000Z"

    def entry(entry_id, parent, role, content, **extra):
        message = {"role": role, "content": content, "timestamp": now, **extra}
        return {"type": "message", "id": entry_id, "parentId": parent,
                "timestamp": now, "message": message}

    tool_one = {"type": "toolCall", "id": "tc-one", "name": "bash",
                "arguments": {"command": "echo one", "timeout": 15}}
    tool_two = {"type": "toolCall", "id": "tc-two", "name": "bash",
                "arguments": {"command": "echo two", "timeout": 15}}
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
             "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0,
                                        "cacheWrite": 0, "total": 0}}
    assistant = {"api": "openai-codex-responses", "provider": "openai-codex",
                 "model": "gpt-6-astra", "usage": usage, "thinkingLevel": "high"}

    long_thinking = (
        LONG_FIRST_SENTENCE + ". After that I will run the second command "
        "with the same timeout and verify the output matches what the task "
        "asked for before I write the final answer."
    )
    lines = [
        {"type": "session", "version": 3, "id": "fixture-session", "timestamp": now, "cwd": "/tmp"},
        entry("e-user", "fixture-session", "user",
              [{"type": "text", "text": "Run echo one, then echo two, then reply done."}]),
        entry("e-a1", "e-user", "assistant",
              [{"type": "thinking", "thinking": SHORT_TITLE},
               tool_one], stopReason="toolUse", **assistant),
        entry("e-r1", "e-a1", "toolResult",
              [{"type": "text", "text": "one\n"}], toolCallId="tc-one", toolName="bash"),
        entry("e-a2", "e-r1", "assistant",
              [{"type": "thinking", "thinking": long_thinking},
               tool_two], stopReason="toolUse", **assistant),
        entry("e-r2", "e-a2", "toolResult",
              [{"type": "text", "text": "two\n"}], toolCallId="tc-two", toolName="bash"),
        # Whitespace-only thinking run: the "thinking off" shape. Pi skips an
        # empty run on every release, so no row may appear for it.
        entry("e-a3", "e-r2", "assistant",
              [{"type": "thinking", "thinking": "  \n\t "},
               {"type": "text", "text": FINAL_TEXT}], stopReason="stop", **assistant),
    ]
    write_session(path, lines)


def build_plain_session(path: str) -> None:
    """Fixture with no thinking text at all: the "thinking off" shape.

    The assistant turns carry a tool call and a final text block and no
    thinking block. That is what a thinking level of off produces, and it is
    the transcript the user reported.
    """
    now = "2026-01-01T00:00:00.000Z"

    def entry(entry_id, parent, role, content, **extra):
        message = {"role": role, "content": content, "timestamp": now, **extra}
        return {"type": "message", "id": entry_id, "parentId": parent,
                "timestamp": now, "message": message}

    tool_one = {"type": "toolCall", "id": "tc-one", "name": "bash",
                "arguments": {"command": "echo one", "timeout": 15}}
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
             "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0,
                                        "cacheWrite": 0, "total": 0}}
    assistant = {"api": "openai-codex-responses", "provider": "openai-codex",
                 "model": "gpt-6-astra", "usage": usage, "thinkingLevel": "off"}
    lines = [
        {"type": "session", "version": 3, "id": "plain-session", "timestamp": now, "cwd": "/tmp"},
        entry("p-user", "plain-session", "user",
              [{"type": "text", "text": OFF_USER_TEXT}]),
        entry("p-a1", "p-user", "assistant", [tool_one], stopReason="toolUse", **assistant),
        entry("p-r1", "p-a1", "toolResult",
              [{"type": "text", "text": "one\n"}], toolCallId="tc-one", toolName="bash"),
        entry("p-a2", "p-r1", "assistant",
              [{"type": "text", "text": FINAL_TEXT}], stopReason="stop", **assistant),
    ]
    write_session(path, lines)


def capture(command: list[str], env: dict | None = None) -> bytes:
    master, slave = pty.openpty()
    child = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave,
                             cwd="/tmp", close_fds=True, preexec_fn=os.setsid,
                             env=env)
    os.close(slave)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    raw = bytearray()
    deadline = time.time() + 40
    last = time.time()
    while time.time() < deadline:
        ready, _, _ = select.select([master], [], [], 0.5)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            raw.extend(chunk)
            last = time.time()
        elif FINAL_TEXT.encode() in bytes(raw) and time.time() - last > 2.5:
            break
    try:
        os.killpg(os.getpgid(child.pid), signal.SIGTERM)
        child.wait(timeout=10)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        pass
    return bytes(raw)


def replay(raw: bytes) -> list[str]:
    import pyte
    screen = pyte.Screen(COLS, ROWS)
    pyte.ByteStream(screen).feed(raw)
    return ["".join((screen.buffer[y][x].data if x in screen.buffer[y] else " ")
                    for x in range(COLS)).rstrip() for y in range(ROWS)]


def find(rows: list[str], marker: str, start: int) -> int:
    for index in range(start, ROWS):
        if marker in rows[index]:
            return index
    return -1


def agent_dir() -> str:
    return os.environ.get("PI_CODING_AGENT_DIR", os.path.expanduser("~/.pi/agent"))


def check_visible_rows(session: str) -> None:
    """Live install: each thinking run is one title row, gap blank/title/blank."""
    settings_path = os.path.join(agent_dir(), "settings.json")
    if not os.path.exists(settings_path):
        print(f"SKIP visible phase: no pi settings at {settings_path}")
        return
    settings = json.load(open(settings_path))
    if settings.get("hideThinkingBlock") is True:
        print("SKIP visible phase: hideThinkingBlock is on; the title rows need the"
              " visible markdown path")
        return
    if "+extensions/thinking-title.ts" not in settings.get("extensions", []):
        print("SKIP visible phase: thinking-title.ts is not enabled in live settings;"
              " deploy first (merge + stow, or pi-settings-sync)")
        return

    raw = capture(["pi", "--session", session, "--tui-mode", "regular", "--offline"])
    rows = replay(raw)
    text = "\n".join(rows)

    call_one = find(rows, "echo one", 0)
    if call_one < 0:
        print("FAIL: first bash call row did not render; transcript was:\n" + text)
        sys.exit(1)
    result_one = find(rows, "└─", call_one + 1)
    call_two = find(rows, "echo two", result_one + 1)
    if result_one < 0 or call_two < 0:
        print("FAIL: could not locate both tool rows; transcript was:\n" + text)
        sys.exit(1)

    # Deployment drift shows as full thinking text instead of title rows.
    if LONG_FIRST_SENTENCE + ". After that" in text or "Planning the first command.\n\nPlanning" in text:
        print("FAIL: full thinking text rendered — the thinking-title transformer did not run."
              " Check extension deployment (scripts/test-pi-hidden-thinking.mjs) and that"
              " hideThinkingBlock is off.")
        print("\n".join(f"{i:3d}|{rows[i]}" for i in range(call_one, call_two + 1)))
        sys.exit(1)

    # The title row carries pi's output pad, so compare its stripped text.
    gap = rows[result_one + 1:call_two]
    if len(gap) != 3 or gap[0].strip() or gap[1].strip() != LONG_FIRST_SENTENCE or gap[2].strip():
        print(f"FAIL: expected [blank, '{LONG_FIRST_SENTENCE}', blank] between the tool rows, got:")
        print("\n".join(f"{i:3d}|{rows[i]}" for i in range(call_one, call_two + 1)))
        sys.exit(1)

    if find(rows, SHORT_TITLE, 0) < 0:
        print("FAIL: the short (codex-style) thinking block did not render verbatim as a title row")
        print("\n".join(f"{i:3d}|{rows[i]}" for i in range(0, call_one + 1)))
        sys.exit(1)

    for row in rows:
        if row.lstrip().startswith(("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")):
            print("FAIL: a spinner frame rendered in a completed transcript")
            sys.exit(1)

    print("visible phase passed: title rows render, gap is blank/title/blank, no spinner frames")


# pi 1.5.0 renders a hidden run with an empty label as no row and no
# spacer. Pi 1.4.0 keeps the spacers, so the extension keeps a visible
# label there. Keep this mirror in step with hiddenRowLabel in
# pi/.pi/agent/extensions/thinking-title.ts.
EMPTY_LABEL_FROM = (1, 5, 0)
LEGACY_HIDDEN_LABEL = "✺ thinking"


def pi_version() -> tuple[int, ...]:
    out = subprocess.run(["pi", "--version"], capture_output=True, text=True, timeout=60)
    text = (out.stdout + out.stderr).strip().splitlines()
    if not text:
        return ()
    parts = text[0].strip().split(".")
    try:
        return tuple(int(part.split("-")[0]) for part in parts)
    except ValueError:
        return ()


def expected_hidden_label(version: tuple[int, ...]) -> str:
    """Mirror of the extension's hiddenRowLabel gate."""
    if not version:
        return LEGACY_HIDDEN_LABEL
    return "" if version >= EMPTY_LABEL_FROM else LEGACY_HIDDEN_LABEL


def max_blank_run(rows: list[str]) -> int:
    longest = current = 0
    for row in rows:
        if row.strip():
            current = 0
        else:
            current += 1
            longest = max(longest, current)
    return longest


def fail(message: str, rows: list[str], start: int, end: int) -> None:
    print("FAIL: " + message)
    print("\n".join(f"{i:3d}|{rows[i]}" for i in range(start, end + 1)))
    sys.exit(1)


def check_hidden_rows(tmp: str, session: str) -> None:
    """Hidden thinking: the version's agreed row, no doubled blank lines.

    The isolated agent dir carries only hideThinkingBlock plus the branch's
    own extension file, so this phase does not depend on the live deploy.
    """
    if not os.path.exists(REPO_EXTENSION):
        print(f"SKIP hidden phase: no extension at {REPO_EXTENSION}")
        return

    version = pi_version()
    label = expected_hidden_label(version)
    shown = ".".join(str(part) for part in version) or "unknown"

    hidden_dir = os.path.join(tmp, "hidden-agent")
    os.makedirs(hidden_dir, exist_ok=True)
    with open(os.path.join(hidden_dir, "settings.json"), "w") as handle:
        json.dump({"hideThinkingBlock": True}, handle)

    env = dict(os.environ, PI_CODING_AGENT_DIR=hidden_dir)
    raw = capture(["pi", "--session", session, "--tui-mode", "regular",
                   "--offline", "-e", REPO_EXTENSION], env=env)
    rows = replay(raw)

    user_row = find(rows, "Run echo one", 0)
    final_row = find(rows, FINAL_TEXT, user_row + 1 if user_row >= 0 else 0)
    if user_row < 0 or final_row < 0:
        fail("hidden-phase fixture did not render", rows, 0, ROWS - 1)
    transcript = rows[user_row:final_row + 1]
    body = "\n".join(transcript)

    if SHORT_TITLE in body:
        fail("a title row rendered while thinking rows were hidden", rows, user_row, final_row)

    label_rows = [row for row in transcript if LEGACY_HIDDEN_LABEL in row]
    if not label:
        if label_rows:
            fail(f"pi {shown} drops a hidden run with an empty label, but a"
                 f" '{LEGACY_HIDDEN_LABEL}' row rendered (the extra bullet row the user reported)",
                 rows, user_row, final_row)
    else:
        if len(label_rows) != 2:
            fail(f"pi {shown} keeps a visible hidden label: expected one"
                 f" '{LEGACY_HIDDEN_LABEL}' row per hidden run, got {len(label_rows)}",
                 rows, user_row, final_row)

    stray = [row for row in transcript
             if "thinking" in row.lower() and LEGACY_HIDDEN_LABEL not in row]
    if stray:
        fail("a hidden thinking run rendered stray text: " + stray[0].strip(), rows, user_row, final_row)

    # Doubled blank lines are the #thinking-space failure: an empty label on a
    # release that keeps its structural spacers leaves five blank rows behind.
    # The label path itself pads two blank rows around the label, so allow that.
    allowed = 2 if label else 3
    if max_blank_run(transcript) > allowed:
        fail(f"the hidden transcript gained extra blank rows (max {max_blank_run(transcript)},"
             f" allowed {allowed})", rows, user_row, final_row)

    contract = "no row" if not label else f"one '{label}' row per hidden run"
    print(f"hidden phase passed (pi {shown}): hidden runs render {contract},"
          f" no doubled blank lines")


def check_thinking_off_rows(tmp: str, session: str) -> None:
    """Thinking off: an assistant turn with no thinking text adds no row.

    This is the user's report: with thinking disabled, an extra bullet row
    that says "thinking" showed up with no thinking text after it. The
    fixture has no thinking text, so any such row or any extra blank line is
    a regression. Both settings run: hidden rows and visible rows.
    """
    if not os.path.exists(REPO_EXTENSION):
        print(f"SKIP thinking-off phase: no extension at {REPO_EXTENSION}")
        return

    for hidden in (False, True):
        mode = "hidden" if hidden else "visible"
        case_dir = os.path.join(tmp, f"off-agent-{mode}")
        os.makedirs(case_dir, exist_ok=True)
        with open(os.path.join(case_dir, "settings.json"), "w") as handle:
            json.dump({"hideThinkingBlock": hidden}, handle)

        env = dict(os.environ, PI_CODING_AGENT_DIR=case_dir)
        raw = capture(["pi", "--session", session, "--tui-mode", "regular",
                       "--offline", "-e", REPO_EXTENSION], env=env)
        rows = replay(raw)

        user_row = find(rows, OFF_USER_TEXT, 0)
        final_row = find(rows, FINAL_TEXT, user_row + 1 if user_row >= 0 else 0)
        if user_row < 0 or final_row < 0:
            fail(f"thinking-off fixture ({mode} rows) did not render", rows, 0, ROWS - 1)
        transcript = rows[user_row:final_row + 1]

        for row in transcript:
            if "thinking" in row.lower() or "✺" in row:
                fail(f"thinking off with {mode} rows rendered a thinking row:"
                     f" {row.strip()}", rows, user_row, final_row)

        # Three blank rows is pi's own spacing from the user row to the first
        # tool row (measured on 1.4.0 and 1.5.0). A fourth one is a stray row.
        if max_blank_run(transcript) > 3:
            fail(f"thinking off with {mode} rows added blank lines"
                 f" (max {max_blank_run(transcript)}, allowed 3)", rows, user_row, final_row)

        if not any("echo one" in row for row in transcript):
            fail(f"thinking-off fixture ({mode} rows) lost the tool row", rows, user_row, final_row)

    print("thinking-off phase passed: no thinking row and no extra blank line"
          " with hidden and visible rows")


def main() -> None:
    if not shutil.which("pi"):
        skip("pi is not on PATH")
    try:
        import pyte  # noqa: F401
    except ImportError:
        skip("pyte is missing; run with: uv run --with pyte scripts/test-pi-hidden-thinking-render.py")

    version = pi_version()
    shown = ".".join(str(part) for part in version) or "unknown"
    label = expected_hidden_label(version)
    print(f"pi {shown}: hidden thinking runs render "
          + ("no row (empty label)" if not label else f"one '{label}' row per run"))

    with tempfile.TemporaryDirectory(prefix="pi-hidden-thinking-render-") as tmp:
        session = os.path.join(tmp, "fixture.jsonl")
        build_session(session)
        plain_session = os.path.join(tmp, "plain-fixture.jsonl")
        build_plain_session(plain_session)
        check_visible_rows(session)
        check_thinking_off_rows(tmp, plain_session)
        check_hidden_rows(tmp, session)

    print("render check passed")


if __name__ == "__main__":
    main()

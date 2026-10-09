#!/usr/bin/env python3
"""Render-level guard for hidden thinking.

Opens a fixture session (thinking blocks between two bash calls) in a real
pi TUI inside a PTY, replays the terminal stream, and asserts the rendered
transcript shows exactly ONE blank line between the two tool rows and no
Thinking label text. This catches a stale bundle (pi update dropped the
patch) that state checks alone would miss.

Run locally (needs the live pi install; no model call happens):

    uv run --with pyte scripts/test-pi-hidden-thinking-render.py

Skips with exit 0 when pi, pyte, or hideThinkingBlock is unavailable.
"""
import json
import os
import pty
import re
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


def skip(reason: str) -> None:
    print(f"SKIP: {reason}")
    sys.exit(0)


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

    lines = [
        {"type": "session", "version": 3, "id": "fixture-session", "timestamp": now, "cwd": "/tmp"},
        entry("e-user", "fixture-session", "user",
              [{"type": "text", "text": "Run echo one, then echo two, then reply done."}]),
        entry("e-a1", "e-user", "assistant",
              [{"type": "thinking", "thinking": "Planning the first command carefully."},
               tool_one], stopReason="toolUse", **assistant),
        entry("e-r1", "e-a1", "toolResult",
              [{"type": "text", "text": "one\n"}], toolCallId="tc-one", toolName="bash"),
        entry("e-a2", "e-r1", "assistant",
              [{"type": "thinking", "thinking": "Checking the first result before running the second command."},
               tool_two], stopReason="toolUse", **assistant),
        entry("e-r2", "e-a2", "toolResult",
              [{"type": "text", "text": "two\n"}], toolCallId="tc-two", toolName="bash"),
        entry("e-a3", "e-r2", "assistant",
              [{"type": "text", "text": "done"}], stopReason="stop", **assistant),
    ]
    with open(path, "w") as handle:
        for line in lines:
            handle.write(json.dumps(line) + "\n")


def capture(command: list[str]) -> bytes:
    master, slave = pty.openpty()
    child = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave,
                             cwd="/tmp", close_fds=True, preexec_fn=os.setsid)
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
        elif b"echo two" in bytes(raw) and time.time() - last > 2.5:
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


def main() -> None:
    if not shutil.which("pi"):
        skip("pi is not on PATH")
    try:
        import pyte  # noqa: F401
    except ImportError:
        skip("pyte is missing; run with: uv run --with pyte scripts/test-pi-hidden-thinking-render.py")

    settings_path = os.path.join(os.environ.get("PI_CODING_AGENT_DIR",
                                                os.path.expanduser("~/.pi/agent")), "settings.json")
    if not os.path.exists(settings_path):
        skip(f"no pi settings at {settings_path}")
    settings = json.load(open(settings_path))
    if settings.get("hideThinkingBlock") is not True:
        skip("hideThinkingBlock is not true; the hidden-thinking contract is inactive")

    with tempfile.TemporaryDirectory(prefix="pi-hidden-thinking-render-") as tmp:
        session = os.path.join(tmp, "fixture.jsonl")
        build_session(session)
        raw = capture(["pi", "--session", session, "--tui-mode", "regular", "--offline"])

    rows = replay(raw)
    text = "\n".join(rows)

    if "Thinking" in text:
        print("FAIL: a Thinking label row rendered in the transcript")
        sys.exit(1)

    def find(marker: str, start: int) -> int:
        for index in range(start, ROWS):
            if marker in rows[index]:
                return index
        return -1

    call_one = find("echo one", 0)
    if call_one < 0:
        print("FAIL: first bash call row did not render; transcript was:\n" + text)
        sys.exit(1)
    result_one = find("└─", call_one + 1)
    call_two = find("echo two", result_one + 1)
    if result_one < 0 or call_two < 0:
        print("FAIL: could not locate both tool rows; transcript was:\n" + text)
        sys.exit(1)

    gap = rows[result_one + 1:call_two]
    blanks = sum(1 for row in gap if not row)
    if len(gap) != 1 or blanks != 1:
        print(f"FAIL: {len(gap)} row(s) between the tool rows "
              f"({blanks} blank); expected exactly 1 blank line")
        print("\n".join(f"{i:3d}|{rows[i]}" for i in range(call_one, call_two + 1)))
        sys.exit(1)

    print("render check passed: exactly one blank line between the tool rows, no Thinking label")
    print("\n".join(f"{i:3d}|{rows[i]}" for i in range(call_one, call_two + 1)))


if __name__ == "__main__":
    main()

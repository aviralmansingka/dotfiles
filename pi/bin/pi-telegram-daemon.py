#!/usr/bin/env python3
"""Bridge Telegram bot messages to a long-running pi RPC session.

Default behavior is intentionally conservative:
- Requires PI_TELEGRAM_BOT_TOKEN.
- Only watches configured allowlisted chat IDs/usernames.
- Only allowlisted chats are handled.
- When PI_TELEGRAM_PREFIX is set, text and caption messages require it; bare images are accepted.
- Replies are sent back to the same Telegram chat.
"""

from __future__ import annotations

import base64
import html
import json
import mimetypes
import os
import queue
import re
import shlex
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

HOME = Path.home()
DEFAULT_STATE = HOME / ".pi/agent/pi-telegram-state.json"
DEFAULT_PI = "pi"
DEFAULT_CWD = HOME / "vault"
DEFAULT_MODEL = "openai-codex/gpt-5.6-luna:high"

BOT_TOKEN = os.environ.get("PI_TELEGRAM_BOT_TOKEN", "").strip()
API_BASE = os.environ.get("PI_TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")
STATE_PATH = Path(os.environ.get("PI_TELEGRAM_STATE", str(DEFAULT_STATE)))
PI_BIN = os.environ.get("PI_TELEGRAM_PI_BIN", str(DEFAULT_PI))
PI_CWD = os.environ.get("PI_TELEGRAM_CWD", str(DEFAULT_CWD))
PI_MODEL = os.environ.get("PI_TELEGRAM_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
PREFIX = os.environ.get("PI_TELEGRAM_PREFIX", "!pi")
ALLOWED_CHATS = {
    x.strip() for x in os.environ.get("PI_TELEGRAM_ALLOWED_CHATS", "").split(",") if x.strip()
}
# In group/supergroup chats, only respond when this bot is explicitly @mentioned
# (or replied to). Prevents double-answering when two bots share a group. DMs are
# never affected by this flag. Default on so adding a group to ALLOWED_CHATS is safe.
REQUIRE_MENTION = os.environ.get("PI_TELEGRAM_REQUIRE_MENTION", "1").strip().lower() in ("1", "true", "yes", "on")
MENTION_STRIP = os.environ.get("PI_TELEGRAM_MENTION_STRIP", "1").strip().lower() in ("1", "true", "yes", "on")

# Populated at startup via getMe so we can match @mentions and replies-to-bot.
BOT_ID: Optional[int] = None
BOT_USERNAME: str = ""
PROCESS_EXISTING = os.environ.get("PI_TELEGRAM_PROCESS_EXISTING", "0") == "1"
MAX_REPLY_CHARS = int(os.environ.get("PI_TELEGRAM_MAX_REPLY_CHARS", "3900"))
PROMPT_TIMEOUT_SECONDS = int(os.environ.get("PI_TELEGRAM_PROMPT_TIMEOUT_SECONDS", "900"))
POLL_TIMEOUT_SECONDS = int(os.environ.get("PI_TELEGRAM_POLL_TIMEOUT_SECONDS", "50"))
SESSIONS_DIR = Path(os.environ.get("PI_TELEGRAM_SESSIONS_DIR", str(HOME / ".pi/agent/sessions")))
MAX_SESSION_LIST = int(os.environ.get("PI_TELEGRAM_MAX_SESSION_LIST", "12"))
RETRY_SECONDS = float(os.environ.get("PI_TELEGRAM_RETRY_SECONDS", "5"))
TYPING_INTERVAL_SECONDS = float(os.environ.get("PI_TELEGRAM_TYPING_INTERVAL_SECONDS", "4"))
THINKING_STREAM_ENABLED = os.environ.get("PI_TELEGRAM_THINKING_STREAM", "1") == "1"
MAX_TRACE_CHARS = int(os.environ.get("PI_TELEGRAM_MAX_TRACE_CHARS", "200"))
GOAL_LABEL_CHARS = int(os.environ.get("PI_TELEGRAM_GOAL_LABEL_CHARS", "20"))
STATUS_EDIT_INTERVAL = float(os.environ.get("PI_TELEGRAM_STATUS_EDIT_INTERVAL", "1.0"))
STATUS_FINAL_PAUSE = float(os.environ.get("PI_TELEGRAM_STATUS_FINAL_PAUSE", "0.3"))

VOICE_TRANSCRIPTION_PROVIDER = os.environ.get("PI_TELEGRAM_VOICE_TRANSCRIPTION_PROVIDER", "auto").strip().lower()
VOICE_TRANSCRIPTION_CMD = os.environ.get("PI_TELEGRAM_VOICE_TRANSCRIPTION_CMD", "").strip()
VOICE_OPENAI_API_KEY = os.environ.get("PI_TELEGRAM_OPENAI_API_KEY", os.environ.get("OPENAI_API_KEY", "")).strip()
VOICE_OPENAI_API_BASE = os.environ.get("PI_TELEGRAM_OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
VOICE_OPENAI_MODEL = os.environ.get("PI_TELEGRAM_OPENAI_TRANSCRIBE_MODEL", "whisper-1").strip()
MAX_AUDIO_BYTES = int(os.environ.get("PI_TELEGRAM_MAX_AUDIO_BYTES", str(20 * 1024 * 1024)))
MAX_IMAGE_BYTES = int(os.environ.get("PI_TELEGRAM_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))

SYSTEM_PROMPT = """
You are Pi, running headlessly behind the owner's Telegram bot.
The Telegram sender is the owner controlling you remotely.
Telegram replies must be succinct and never a wall of text. Use short answers, compact bullets when useful, and ask before sending long explanations.
Use lightweight Markdown-style emphasis when helpful: **bold**, `code`, and fenced code blocks; the Telegram bridge renders these as HTML.
You may use local tools to help the owner, but do not send Telegram messages to other people or groups unless the owner explicitly asks you to send an exact message to an exact recipient.
If a requested action is risky or ambiguous, ask a clarifying question instead of guessing.
""".strip()


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


@dataclass
class IncomingMessage:
    update_id: int
    message_id: int
    chat_id: str
    chat_name: str
    chat_username: str
    sender: str
    sender_is_bot: bool
    timestamp: int
    content: str
    audio_file_id: str = ""
    audio_file_size: int = 0
    audio_mime_type: str = ""
    audio_kind: str = ""
    image_file_id: str = ""
    image_file_size: int = 0
    image_mime_type: str = ""
    image_kind: str = ""
    chat_type: str = ""
    entities: list[dict[str, Any]] = field(default_factory=list)
    reply_to_sender_id: Optional[int] = None
    reply_to_sender_is_bot: bool = False


# ---------------------------------------------------------------------------
# Thinking-trace rendering — mirrors the TUI tool-call-renderer extension.
#
# The TUI (pi/.pi/agent/extensions/tool-call-renderer.ts) renders a tree:
#
#   │  2 steps · 3 calls · 1/2 complete
#   ├─ ▸ Reading config
#   │  └─ ◆ settings.json · 1 read · loaded
#   ├─ ▹ Editing daemon
#   │  └─ ◇ daemon.py · 3 edits · running 1.2s
#   └─ ▹ Running tests
#      └─ ◇ $ npm test · running 0.5s
#
# Step titles use triangle glyphs (▸ done, ▹ running, × failed).
# Tool summaries use diamond glyphs (◆ done, ◇ running, × failed).
# Thinking bullets use • with tree connectors (├─/└─/│).
# Telegram HTML only supports <b>, <code>, <i> — no colors — so the
# glyph shapes carry the status meaning instead of TUI colors.
# ---------------------------------------------------------------------------

TITLE_MAX = 40


def _first_non_empty_line(value: str) -> Optional[str]:
    for line in value.split("\n"):
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def _sanitize_title(value: Optional[str]) -> Optional[str]:
    """Strip ANSI, markdown, HTML, and collapse whitespace — port of TUI sanitizeTitle."""
    line = _first_non_empty_line(value or "")
    if not line:
        return None
    title = line
    title = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", title)  # ANSI escapes
    title = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", title)  # image alt
    title = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", title)  # link text
    title = re.sub(r"</?[^>]+>", " ", title)  # HTML tags
    title = re.sub(r"^\s*(?:#{1,6}\s+|>\s*|(?:[-+*]|\d+[.)])\s+)", "", title)  # md prefix
    title = re.sub(r"[*_~`]", "", title)  # emphasis markers
    title = re.sub(r"\s+", " ", title).strip()
    return title or None


def _truncate_title(title: str) -> str:
    if len(title) <= TITLE_MAX:
        return title
    return title[:TITLE_MAX].rstrip() + "…"


def _plural(count: int, singular: str) -> str:
    return f"{count} {singular}{'' if count == 1 else 's'}"


def _as_str(value: Any) -> Optional[str]:
    return value if isinstance(value, str) else None


def _as_record(value: Any) -> dict[str, Any]:
    if value is not None and isinstance(value, dict):
        return value
    return {}


def _basename(path: str) -> str:
    return path.strip().strip("'").strip('"').rsplit("/", 1)[-1]


# ---------------------------------------------------------------------------
# Data model — ported from tool-call-renderer.ts WorkStep / ToolCall.
# ---------------------------------------------------------------------------


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None


@dataclass
class WorkStep:
    title: str
    title_locked: bool
    thinking: list[str] = field(default_factory=list)
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_ids: set[str] = field(default_factory=set)
    completed_tool_call_ids: set[str] = field(default_factory=set)
    failed: bool = False
    started_at: Optional[float] = None
    completed_at: Optional[float] = None


# ---------------------------------------------------------------------------
# Title derivation — ported from fallbackTitle / displayToolName / etc.
# ---------------------------------------------------------------------------


def _display_tool_name(tool_call: ToolCall) -> str:
    if tool_call.name != "mcp":
        return tool_call.name
    server = (
        _as_str(tool_call.arguments.get("server")) or _as_str(tool_call.arguments.get("connect")) or "gateway"
    )
    label = (server or "").strip()
    return f"mcp({label or 'gateway'})"


def _group_tools(tool_calls: list[ToolCall]) -> list[str]:
    counts: dict[str, int] = {}
    for tc in tool_calls:
        name = _display_tool_name(tc)
        counts[name] = counts.get(name, 0) + 1
    return [f"{name}{' ×' + str(c) if c > 1 else ''}" for name, c in counts.items()]


def _tool_target(tool_call: ToolCall) -> Optional[str]:
    path = _as_str(tool_call.arguments.get("path"))
    if path:
        return _basename(path)
    file = _as_str(tool_call.arguments.get("file"))
    if file:
        return _basename(file)
    return None


def _unique_targets(tool_calls: list[ToolCall]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for tc in tool_calls:
        t = _tool_target(tc)
        if t and t not in seen:
            seen.add(t)
            result.append(t)
    return result


def _format_targets(targets: list[str]) -> Optional[str]:
    if not targets:
        return None
    if len(targets) <= 2:
        return ", ".join(targets)
    return _plural(len(targets), "file")


def _is_check_command(tool_call: ToolCall) -> bool:
    if tool_call.name != "bash":
        return False
    command = _as_str(tool_call.arguments.get("command")) or ""
    return bool(re.search(r"(?:^|[\s/.-])(?:test|tests|verify|check|lint|typecheck|tsc)(?:[\s/.-]|$)", command, re.IGNORECASE))


_COMMAND_SUMMARIES: dict[str, str] = {
    "ls": "Listing files", "find": "Finding files", "grep": "Searching text",
    "rg": "Searching text", "cat": "Reading file", "head": "Reading file",
    "tail": "Reading file", "wc": "Counting", "diff": "Comparing files",
    "mkdir": "Creating directory", "rm": "Removing files", "cp": "Copying files",
    "mv": "Moving files", "ln": "Linking files", "chmod": "Changing permissions",
    "touch": "Creating file", "tar": "Archiving", "zip": "Compressing",
    "unzip": "Extracting", "echo": "Printing", "curl": "Fetching URL",
    "wget": "Downloading", "ssh": "Connecting via SSH", "scp": "Copying via SSH",
    "rsync": "Syncing files", "ping": "Pinging host", "docker": "Running Docker",
    "kubectl": "Running kubectl", "systemctl": "Managing service",
    "journalctl": "Reading logs", "git": "Git operation", "gh": "GitHub operation",
    "npm": "Running npm", "npx": "Running npx", "yarn": "Running yarn",
    "pnpm": "Running pnpm", "bun": "Running bun", "node": "Running Node",
    "python": "Running Python", "python3": "Running Python", "pip": "Running pip",
    "uv": "Running uv", "pytest": "Running tests", "jest": "Running tests",
    "vitest": "Running tests", "cargo": "Running Cargo", "go": "Running Go",
    "make": "Building", "brew": "Running Homebrew", "stow": "Running stow",
    "nix": "Running Nix", "nixos-rebuild": "Rebuilding NixOS",
    "apt": "Managing packages", "apt-get": "Managing packages",
    "ffmpeg": "Processing media", "ps": "Listing processes",
    "kill": "Killing process", "df": "Checking disk", "du": "Checking disk usage",
    "free": "Checking memory", "date": "Checking date",
    "hostname": "Checking hostname", "uname": "Checking system",
    "whoami": "Checking user", "pwd": "Checking directory",
    "cd": "Changing directory", "which": "Finding command",
    "test": "Testing condition", "true": "No-op", "false": "No-op",
}

_SUBCOMMAND_TOOLS = {"git", "npm", "npx", "yarn", "pnpm", "docker", "kubectl", "systemctl", "service", "apt", "apt-get", "brew", "cargo", "go", "uv", "pip", "pip3", "gh"}


def _summarize_command(command: str) -> str:
    """Describe a bash command's intent for use as a step title."""
    lines = command.strip().splitlines()
    if not lines:
        return "Running command"
    # Keep heredoc bodies out of the shell heuristic; otherwise newlines are
    # command boundaries and let us skip setup-only assignment lines.
    cmd = lines[0].strip() if "<<" in lines[0] else ";".join(lines)
    try:
        lexer = shlex.shlex(cmd, posix=True, punctuation_chars=";&|")
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        tokens = cmd.split()

    commands: list[list[str]] = []
    current: list[str] = []
    for token in tokens:
        if token and not token.strip(";&|"):
            if current:
                commands.append(current)
                current = []
        else:
            current.append(token)
    if current:
        commands.append(current)

    best = (0, "Running command")
    control_starts = {"case", "for", "if", "select", "until", "while"}
    control_words = {"do", "elif", "else", "then", "!", "(", "{"}
    control_ends = {"done", "esac", "fi", ")", "}"}
    prefixes = {"sudo", "env", "time", "nohup", "exec", "bash", "sh", "source"}
    for parts in commands:
        if parts[0] in control_starts or parts[0] in control_ends:
            continue
        while parts and parts[0] in control_words:
            parts = parts[1:]
        while parts and ("=" in parts[0] or parts[0] in prefixes):
            parts = parts[1:]
        if not parts:
            continue
        base = parts[0].rsplit("/", 1)[-1].strip("(){}")
        positional = [a for a in parts[1:] if not a.startswith("-")]
        summary = _COMMAND_SUMMARIES.get(base)
        if base in _SUBCOMMAND_TOOLS and positional:
            title = f"{base} {positional[0]}"[:TITLE_MAX]
            score = 4
        elif summary:
            subject = positional[0].rstrip("/").rsplit("/", 1)[-1] if positional else ""
            if subject in (".", "*", "—", ""):
                subject = ""
            available = TITLE_MAX - len(summary) - 1
            concise_subject = subject[:available].rstrip(";&|")
            title = f"{summary} {concise_subject}" if concise_subject and available > 0 else summary
            score = 3 if concise_subject else 2
        else:
            title = base[:TITLE_MAX] or "Running command"
            score = 1
        if score > best[0]:
            best = (score, title)
    return best[1]


def _fallback_title(tool_calls: list[ToolCall]) -> str:
    targets = _unique_targets(tool_calls)
    target = _format_targets(targets)
    names = [tc.name for tc in tool_calls]
    bash_calls = [tc for tc in tool_calls if tc.name == "bash"]
    if all(n in ("edit", "write") for n in names):
        return f"Updating {target or _plural(len(tool_calls), 'file')}"
    if all(n == "read" for n in names):
        return f"Reading {target or _plural(len(tool_calls), 'file')}"
    if all(_is_check_command(tc) for tc in tool_calls):
        return "Running checks"
    if all(n == "bash" for n in names):
        first_cmd = _as_str(tool_calls[0].arguments.get("command")) or ""
        return _summarize_command(first_cmd)
    # Mixed tools: prefer the bash command's intent if present (it's usually
    # the primary action), falling back to a target-based label.
    if bash_calls:
        first_cmd = _as_str(bash_calls[0].arguments.get("command")) or ""
        return _summarize_command(first_cmd)
    if target:
        return f"Working with {target}"
    return f"Using {', '.join(_group_tools(tool_calls))}"


def _title_from_text(content: list[dict[str, Any]]) -> Optional[str]:
    for item in content:
        if item.get("type") != "text":
            continue
        title = _sanitize_title(_as_str(item.get("text")))
        if title:
            return title
    return None


def _thinking_from_content(content: list[dict[str, Any]]) -> list[str]:
    result: list[str] = []
    for item in content:
        if item.get("type") != "thinking":
            continue
        sanitized = _sanitize_title(_as_str(item.get("thinking")))
        if sanitized:
            result.append(sanitized)
    return result


# ---------------------------------------------------------------------------
# Tool summary — ported from summaryParts / bashCallSummary / renderParts.
# Telegram HTML can't do colors, so we use <b> for emphasis and plain text.
# ---------------------------------------------------------------------------


def _format_elapsed(ms: float) -> str:
    if ms < 1000:
        return f"{int(ms)}ms"
    if ms < 60000:
        return f"{ms / 1000:.1f}s"
    minutes = int(ms // 60000)
    seconds = int((ms % 60000) // 1000)
    return f"{minutes}m{seconds}s"


def _step_status(step: WorkStep) -> str:
    """pending | success | failure — ported from TUI status()."""
    if step.failed:
        return "failure"
    if not step.tool_call_ids or len(step.completed_tool_call_ids) == len(step.tool_call_ids):
        return "success"
    return "pending"


def _step_outcome(step: WorkStep, now: float, success_text: str) -> str:
    current = _step_status(step)
    if current == "pending":
        if step.started_at is not None:
            return f"running {_format_elapsed(max(0, now - step.started_at) * 1000)}"
        return "running"
    if current == "failure":
        return "failed"
    return success_text


def _call_outcome(call: ToolCall, step: WorkStep, now: float) -> str:
    if step.failed and call.id not in step.completed_tool_call_ids:
        return "failed"
    if call.id in step.completed_tool_call_ids:
        return "completed"
    if call.started_at is not None:
        return f"running {_format_elapsed(max(0, now - call.started_at) * 1000)}"
    return "running"


def _summary_text(step: WorkStep, now: float) -> str:
    """Render the tool summary for a step — ported from TUI summaryParts."""
    calls = step.tool_calls
    targets = _format_targets(_unique_targets(calls))
    names = [tc.name for tc in calls]
    parts: list[str] = []

    def add(text: str) -> None:
        parts.append(text)

    if targets:
        add(targets)

    if all(n == "edit" for n in names):
        edits = sum(
            len(tc.arguments.get("edits")) if isinstance(tc.arguments.get("edits"), list) else 1
            for tc in calls
        )
        add(_plural(edits, "edit"))
        add(_step_outcome(step, now, "updated"))
    elif all(n == "write" for n in names):
        add(_plural(len(calls), "write"))
        add(_step_outcome(step, now, "written"))
    elif all(n == "read" for n in names):
        add(_plural(len(calls), "read"))
        add(_step_outcome(step, now, "loaded"))
    elif len(calls) == 1 and calls[0].name == "bash":
        command = (_as_str(calls[0].arguments.get("command")) or "").split("\n")[0].strip()
        if command:
            add(f"$ {command}")
        else:
            add("1 command")
        add(_step_outcome(step, now, "completed"))
    elif all(_is_check_command(tc) for tc in calls):
        add(_plural(len(calls), "check"))
        add(_step_outcome(step, now, "passed"))
    elif all(n == "bash" for n in names):
        add(_plural(len(calls), "command"))
        add(_step_outcome(step, now, "completed"))
    else:
        add(_plural(len(calls), "call"))
        add(" · ".join(_group_tools(calls)))
        add(_step_outcome(step, now, "completed"))

    return " · ".join(parts)


def _bash_call_text(call: ToolCall, step: WorkStep, now: float) -> str:
    """Render a single bash call — ported from bashCallSummary."""
    command = (_as_str(call.arguments.get("command")) or "").split("\n")[0].strip()
    text = f"$ {command}" if command else "1 command"
    return f"{text} · {_call_outcome(call, step, now)}"


def _try_json_object(raw: str) -> Optional[dict[str, Any]]:
    """Parse a JSON object, tolerating the partial fragments seen mid-stream."""
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


# ---------------------------------------------------------------------------
# TraceBuilder — accumulates the work-step tree from RPC streaming events.
# Replaces ThinkingTreeBuilder; mirrors the TUI's updateAssistant / WorkStepRow.
# ---------------------------------------------------------------------------


class TraceBuilder:
    """Reassemble the live assistant message from RPC deltas, track work-step
    lifecycle, and render a compact one-line-per-step trace.

    Telegram is a mobile-first surface, so the render is deliberately flatter
    than the TUI tree: only step titles and per-step elapsed time. The TUI
    (pi/.pi/agent/extensions/tool-call-renderer.ts) keeps the full tree with
    tool summaries and thinking bullets; the model here stays faithful to it so
    a richer render can be restored without rework.
    """

    def __init__(self, clock: Optional[Any] = None) -> None:
        self.steps: list[WorkStep] = []
        self.blocks: dict[int, dict[str, Any]] = {}
        self.current_step: Optional[WorkStep] = None
        self.thinking_draft_title: Optional[str] = None
        self.thinking_draft_thinking: list[str] = []
        # Injectable so step/tool timestamps line up with render(now) in tests.
        self.clock = clock or time.monotonic
        self.start_time: float = self.clock()

    # -- lifecycle --------------------------------------------------------

    def on_agent_start(self) -> None:
        self.steps = []
        self.current_step = None
        self.thinking_draft_title = None
        self.thinking_draft_thinking = []

    def on_turn_start(self) -> None:
        self.blocks = {}
        self.current_step = None
        self.thinking_draft_title = None
        self.thinking_draft_thinking = []

    def on_turn_end(self) -> None:
        self.current_step = None
        self.thinking_draft_title = None
        self.thinking_draft_thinking = []

    def on_agent_end(self) -> None:
        for step in self.steps:
            if _step_status(step) == "pending":
                step.failed = True

    # -- delta assembly (from message_update) -----------------------------

    def on_message_start(self, message: dict[str, Any]) -> None:
        if (message.get("role") or "assistant") == "assistant":
            self.blocks = {}
            # Each assistant message gets its own step — mirrors the TUI
            # where each AssistantMessageComponent creates a new WorkStep.
            self.current_step = None
            self.thinking_draft_title = None
            self.thinking_draft_thinking = []

    def on_message_end(self, message: dict[str, Any]) -> None:
        if (message.get("role") or "assistant") != "assistant":
            return
        content = message.get("content") or []
        if not content:
            return
        self.blocks = {i: dict(block) for i, block in enumerate(content) if isinstance(block, dict)}
        self._update_step()

    def _content(self) -> list[dict[str, Any]]:
        return [self.blocks[i] for i in sorted(self.blocks)]

    def on_assistant_event(self, ame: dict[str, Any]) -> None:
        et = ame.get("type") or ""
        idx = ame.get("contentIndex")
        if not isinstance(idx, int):
            return
        if et.startswith("text_"):
            block = self.blocks.setdefault(idx, {"type": "text", "text": ""})
            if et == "text_delta":
                block["text"] = (block.get("text") or "") + (ame.get("delta") or "")
            elif et == "text_end":
                block["text"] = ame.get("content") or block.get("text") or ""
        elif et.startswith("thinking_"):
            block = self.blocks.setdefault(idx, {"type": "thinking", "thinking": ""})
            if et == "thinking_delta":
                block["thinking"] = (block.get("thinking") or "") + (ame.get("delta") or "")
            elif et == "thinking_end":
                block["thinking"] = ame.get("content") or block.get("thinking") or ""
        elif et.startswith("toolcall_"):
            block = self.blocks.setdefault(idx, {"type": "toolCall", "id": "", "name": "", "arguments": {}, "raw_args": ""})
            if et == "toolcall_delta":
                block["raw_args"] = (block.get("raw_args") or "") + (ame.get("delta") or "")
                parsed = _try_json_object(block["raw_args"])
                if parsed is not None:
                    block["arguments"] = parsed
            elif et == "toolcall_end":
                call = ame.get("toolCall") or {}
                block["id"] = call.get("id") or block.get("id") or ""
                block["name"] = call.get("name") or block.get("name") or ""
                args = call.get("arguments")
                if isinstance(args, str):
                    args = _try_json_object(args)
                if isinstance(args, dict):
                    block["arguments"] = args
        else:
            return
        self._update_step()

    # -- step creation/update (mirrors TUI updateAssistant) ---------------

    def _tool_calls_from_content(self) -> list[ToolCall]:
        result: list[ToolCall] = []
        for block in self._content():
            if block.get("type") in ("toolCall", "tool_call"):
                call_id = _as_str(block.get("id")) or ""
                name = (_as_str(block.get("name")) or "").strip() or "tool"
                args = block.get("arguments")
                if isinstance(args, str):
                    args = _try_json_object(args)
                if not isinstance(args, dict):
                    args = {}
                result.append(ToolCall(id=call_id, name=name, arguments=args))
        return result

    def _update_step(self) -> None:
        content = self._content()
        tool_calls = self._tool_calls_from_content()
        explicit_title = _title_from_text(content)
        thinking = _thinking_from_content(content)
        has_thinking = any(b.get("type") == "thinking" and (b.get("thinking") or "").strip() for b in content)

        if not tool_calls:
            # Draft phase — no tools yet.  Show a live indicator so the
            # Telegram status isn't blank while the agent streams text or
            # thinking.  This mirrors the TUI's thinking-draft display but
            # also covers text-only responses (the TUI shows those as native
            # message content; Telegram has no such inline view).
            self.thinking_draft_title = explicit_title if (has_thinking or explicit_title) else None
            self.thinking_draft_thinking = thinking if has_thinking else []
            return

        # Have tool calls — create or update the step.
        self.thinking_draft_title = None
        self.thinking_draft_thinking = []

        step_thinking = thinking if thinking else self.thinking_draft_thinking
        step_explicit_title = explicit_title or self.thinking_draft_title
        # Title derivation — adapted for compact mobile render:
        #   1. explicit text title from model
        #   2. tool-derived fallback (if tools present)
        #   3. first sanitized thinking line (if thinking present)
        #   4. "Thinking" — last resort
        # The TUI uses "Thinking" as a category label with bullets below;
        # Telegram shows no bullets, so we surface the thinking content or
        # tool intent as the title instead.
        if step_explicit_title:
            title = step_explicit_title
        elif tool_calls:
            title = _fallback_title(tool_calls)
        elif step_thinking:
            title = _truncate_title(step_thinking[0])
        else:
            title = "Thinking"

        step = self.current_step
        if step is None:
            # Dedup: if the last step has the same title, merge into it
            # instead of showing a duplicate line.
            if self.steps and self.steps[-1].title == title:
                step = self.steps[-1]
                step.completed_at = None  # reopen for new tool calls
                self.current_step = step
            else:
                step = WorkStep(
                    title=title,
                    title_locked=bool(step_explicit_title),
                    thinking=step_thinking,
                    started_at=self.clock(),
                )
                self.steps.append(step)
                self.current_step = step
        else:
            if not step.title_locked and step_explicit_title:
                step.title = title
                step.title_locked = True
            elif not step.title_locked:
                step.title = title

        step.tool_calls = tool_calls
        step.tool_call_ids = {tc.id for tc in tool_calls}
        step.thinking = step_thinking

    # -- tool execution lifecycle ----------------------------------------

    def on_tool_execution_start(self, tool_call_id: str, tool_name: str, args: dict[str, Any]) -> None:
        step = self.current_step
        if not step:
            return
        tc = next((c for c in step.tool_calls if c.id == tool_call_id), None)
        if not tc:
            return
        now = self.clock()
        if tc.started_at is None:
            tc.started_at = now
        if step.started_at is None or now < step.started_at:
            step.started_at = now

    def on_tool_execution_end(self, tool_call_id: str, is_error: bool) -> None:
        step = self.current_step
        if not step:
            return
        tc = next((c for c in step.tool_calls if c.id == tool_call_id), None)
        if tc and tc.completed_at is None:
            tc.completed_at = self.clock()
        step.completed_tool_call_ids.add(tool_call_id)
        if is_error:
            step.failed = True
        if _step_status(step) != "pending" and step.completed_at is None:
            step.completed_at = (tc.completed_at if tc else None) or self.clock()

    # -- rendering --------------------------------------------------------
    # Mobile-first: one line per step, title plus elapsed. Tool summaries and
    # thinking bullets stay in the model but are not rendered here.

    def _step_line(self, step: WorkStep, now: float) -> str:
        status = _step_status(step)
        glyph = "▹" if status == "pending" else ("×" if status == "failure" else "▸")
        title = html.escape(_truncate_title(step.title))
        return f"{glyph} <b>{title}</b>"

    def render(self, now: float) -> str:
        elapsed = int(now - self.start_time)
        minutes, seconds = divmod(elapsed, 60)
        header = f"thinking · {minutes}:{seconds:02d}"

        lines: list[str] = [header]
        for step in self.steps:
            lines.append(self._step_line(step, now))

        # No step yet (streaming text or thinking before the first tool call).
        if not self.steps and (self.thinking_draft_title or self.thinking_draft_thinking):
            draft_title = self.thinking_draft_title
            if not draft_title and self.thinking_draft_thinking:
                draft_title = _truncate_title(self.thinking_draft_thinking[0])
            title = html.escape(draft_title or "Thinking")
            lines.append(f"▹ <b>{title}</b>")

        text = "\n".join(lines)
        if len(text) > MAX_REPLY_CHARS:
            cut = text[:MAX_REPLY_CHARS]
            last_nl = cut.rfind("\n")
            text = (cut[:last_nl] + "\n…") if last_nl > len(header) else (cut[:-1] + "…")
        return text


# Kept for backward compatibility with tests and external callers.
ThinkingTreeBuilder = TraceBuilder


class StatusMessenger:
    """Manage one live Telegram status message that shows the thinking tree.

    Created on the first thinking update, edited in place (coalesced to
    STATUS_EDIT_INTERVAL), and deleted when the agent settles. The final
    reply is then sent as a separate normal message.
    """

    def __init__(self, chat_id: str, reply_to: Optional[int] = None) -> None:
        self.chat_id = chat_id
        self.reply_to = reply_to
        self.message_id: Optional[int] = None
        self.tree = ThinkingTreeBuilder()
        self.last_edit = 0.0
        self.dirty = False
        self.start_time = time.monotonic()

    def on_event(self, ev: dict[str, Any]) -> None:
        et = ev.get("type")
        if et == "agent_start":
            self.tree.on_agent_start()
            self.dirty = True
        elif et == "turn_start":
            self.tree.on_turn_start()
            self.dirty = True
        elif et == "message_start":
            self.tree.on_message_start(ev.get("message") or {})
        elif et == "message_update":
            ame = ev.get("assistantMessageEvent") or {}
            if ame:
                self.tree.on_assistant_event(ame)
                self.dirty = True
        elif et == "message_end":
            self.tree.on_message_end(ev.get("message") or {})
            self.dirty = True
        elif et == "tool_execution_start":
            self.tree.on_tool_execution_start(
                ev.get("toolCallId") or "",
                ev.get("toolName") or "",
                ev.get("args") or {},
            )
            self.dirty = True
        elif et == "tool_execution_end":
            self.tree.on_tool_execution_end(
                ev.get("toolCallId") or "",
                bool(ev.get("isError")),
            )
            self.dirty = True
        elif et == "turn_end":
            self.tree.on_turn_end()
            self.dirty = True
        elif et == "agent_end":
            self.tree.on_agent_end()
            self.dirty = True
        self._maybe_flush()

    def flush(self) -> None:
        self._maybe_flush(force=True)

    def _maybe_flush(self, force: bool = False) -> None:
        if not self.dirty:
            return
        now = time.monotonic()
        if self.message_id is None:
            self._create()
            self.dirty = False
            self.last_edit = now
            return
        if not force and now - self.last_edit < STATUS_EDIT_INTERVAL:
            return
        self._edit()
        self.dirty = False
        self.last_edit = now

    def _create(self) -> None:
        text = self.tree.render(time.monotonic())
        payload: dict[str, Any] = {"chat_id": self.chat_id, "text": text, "parse_mode": "HTML"}
        if self.reply_to is not None:
            payload["reply_parameters"] = {"message_id": self.reply_to, "allow_sending_without_reply": True}
        try:
            result = telegram_api("sendMessage", payload, timeout=30)
            self.message_id = result.get("message_id")
        except Exception as e:
            log(f"Status create failed: {e}")

    def _edit(self) -> None:
        if self.message_id is None:
            return
        text = self.tree.render(time.monotonic())
        try:
            telegram_api(
                "editMessageText",
                {"chat_id": self.chat_id, "message_id": self.message_id, "text": text, "parse_mode": "HTML"},
                timeout=30,
            )
        except Exception as e:
            log(f"Status edit failed: {e}")

    def finalize(self) -> None:
        if self.dirty:
            self._edit()
            self.dirty = False
        if STATUS_FINAL_PAUSE > 0 and self.message_id is not None:
            time.sleep(STATUS_FINAL_PAUSE)
        self._delete()

    def _delete(self) -> None:
        if self.message_id is None:
            return
        try:
            telegram_api("deleteMessage", {"chat_id": self.chat_id, "message_id": self.message_id}, timeout=10)
        except Exception as e:
            log(f"Status delete failed: {e}")
        self.message_id = None

    def _elapsed(self) -> int:
        return int(time.monotonic() - self.start_time)


class PiRPC:
    def __init__(self) -> None:
        self.proc: Optional[subprocess.Popen[str]] = None
        self.lines: "queue.Queue[dict[str, Any]]" = queue.Queue()
        self.reader_thread: Optional[threading.Thread] = None
        self.stderr_thread: Optional[threading.Thread] = None
        self.lock = threading.Lock()
        self.start()

    def start(self) -> None:
        self.stop()
        env = os.environ.copy()
        env["PATH"] = f"{HOME}/.nvm/versions/node/v22.22.3/bin:{HOME}/.local/bin:{HOME}/go/bin:" + env.get("PATH", "")
        args = [
            PI_BIN,
            "--mode",
            "rpc",
            "--name",
            "telegram-daemon",
            "--model",
            PI_MODEL,
            "--append-system-prompt",
            SYSTEM_PROMPT,
        ]
        log(f"Starting pi RPC: {' '.join(args)} (cwd={PI_CWD})")
        self.proc = subprocess.Popen(
            args,
            cwd=PI_CWD,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )
        self.reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self.reader_thread.start()
        self.stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self.stderr_thread.start()

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None

    def _read_stdout(self) -> None:
        assert self.proc and self.proc.stdout
        for raw in self.proc.stdout:
            line = raw.rstrip("\n\r")
            if not line:
                continue
            try:
                self.lines.put(json.loads(line))
            except json.JSONDecodeError:
                log(f"pi stdout non-json: {line[:500]}")

    def _read_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        for raw in self.proc.stderr:
            line = raw.rstrip("\n\r")
            if line:
                log(f"pi stderr: {line}")

    def _send(self, cmd: dict[str, Any]) -> None:
        if not self.proc or self.proc.poll() is not None or not self.proc.stdin:
            self.start()
        assert self.proc and self.proc.stdin
        self.proc.stdin.write(json.dumps(cmd, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def _wait_response(self, request_id: str, timeout: int = 30) -> dict[str, Any]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                ev = self.lines.get(timeout=1)
            except queue.Empty:
                continue
            self._handle_event(ev)
            if ev.get("type") == "response" and ev.get("id") == request_id:
                return ev
        raise TimeoutError(f"Timed out waiting for response {request_id}")

    def _handle_event(self, ev: dict[str, Any]) -> None:
        if ev.get("type") == "extension_ui_request":
            # Headless mode: auto-cancel blocking dialogs so the daemon never hangs.
            method = ev.get("method")
            if method in {"confirm", "select", "input", "editor"}:
                rid = ev.get("id")
                if rid:
                    response: dict[str, Any] = {"type": "extension_ui_response", "id": rid, "cancelled": True}
                    if method == "confirm":
                        response["confirmed"] = False
                    try:
                        self._send(response)
                    except Exception as e:
                        log(f"Failed to answer extension UI request: {e}")
        elif ev.get("type") == "tool_execution_start":
            log(f"pi tool: {ev.get('toolName')} {ev.get('args', {})}")
        elif ev.get("type") == "extension_error":
            log(f"pi extension error: {ev}")

    def ask(
        self,
        message: str,
        chat_id: Optional[str] = None,
        reply_to: Optional[int] = None,
        images: Optional[list[dict[str, Any]]] = None,
    ) -> str:
        with self.lock:
            status: Optional[StatusMessenger] = None
            if chat_id and THINKING_STREAM_ENABLED:
                status = StatusMessenger(chat_id, reply_to)
            request_id = str(uuid.uuid4())
            cmd: dict[str, Any] = {"id": request_id, "type": "prompt", "message": message}
            if images:
                cmd["images"] = images
            self._send(cmd)
            accepted = False
            deadline = time.time() + PROMPT_TIMEOUT_SECONDS
            while time.time() < deadline:
                try:
                    ev = self.lines.get(timeout=1)
                except queue.Empty:
                    if self.proc and self.proc.poll() is not None:
                        if status:
                            status.finalize()
                        raise RuntimeError("pi RPC exited while processing prompt")
                    if status:
                        status.flush()
                    continue
                self._handle_event(ev)
                if status:
                    status.on_event(ev)
                if ev.get("type") == "response" and ev.get("id") == request_id:
                    if not ev.get("success"):
                        if status:
                            status.finalize()
                        raise RuntimeError(ev.get("error", "pi rejected prompt"))
                    accepted = True
                if accepted and ev.get("type") == "agent_end":
                    break
            else:
                if status:
                    status.finalize()
                raise TimeoutError("Timed out waiting for pi to finish")

            if status:
                status.finalize()

            response_id = str(uuid.uuid4())
            self._send({"id": response_id, "type": "get_last_assistant_text"})
            response = self._wait_response(response_id)
            text = (response.get("data") or {}).get("text")
            return text or "(No response.)"

    def new_session(self) -> str:
        with self.lock:
            request_id = str(uuid.uuid4())
            self._send({"id": request_id, "type": "new_session"})
            response = self._wait_response(request_id)
            if response.get("success"):
                return "Started a fresh pi session."
            return f"Failed to start a fresh pi session: {response.get('error')}"

    def switch_session(self, session_path: str) -> Optional[str]:
        """Load a different session file. Returns None on success, else an error message."""
        with self.lock:
            request_id = str(uuid.uuid4())
            self._send({"id": request_id, "type": "switch_session", "sessionPath": session_path})
            response = self._wait_response(request_id)
            if not response.get("success"):
                return f"Failed to switch session: {response.get('error')}"
            if (response.get("data") or {}).get("cancelled"):
                return "Session switch was cancelled by a pi extension."
            return None

    def status(self) -> str:
        with self.lock:
            request_id = str(uuid.uuid4())
            self._send({"id": request_id, "type": "get_state"})
            response = self._wait_response(request_id)
            if not response.get("success"):
                return f"Pi status error: {response.get('error')}"
            data = response.get("data") or {}
            model = data.get("model") or {}
            voice_provider = configured_voice_provider()
            return (
                "Pi Telegram bridge is running.\n"
                f"Model: {model.get('provider', '?')}/{model.get('id', '?')}\n"
                f"Session: {data.get('sessionName') or data.get('sessionId')}\n"
                f"Streaming: {data.get('isStreaming')}\n"
                f"Voice notes: {voice_provider if voice_provider else 'not configured'}"
            )


def telegram_api(method: str, payload: dict[str, Any], timeout: int = 60) -> Any:
    if not BOT_TOKEN:
        raise RuntimeError("PI_TELEGRAM_BOT_TOKEN is not set")
    url = f"{API_BASE}/bot{BOT_TOKEN}/{method}"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram {method} failed HTTP {e.code}: {raw}") from e
    data = json.loads(raw)
    if not data.get("ok"):
        raise RuntimeError(f"Telegram {method} failed: {data}")
    return data.get("result")


def telegram_download(file_path: str, timeout: int = 120) -> bytes:
    if not BOT_TOKEN:
        raise RuntimeError("PI_TELEGRAM_BOT_TOKEN is not set")
    url = f"{API_BASE}/file/bot{BOT_TOKEN}/{file_path}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram file download failed HTTP {e.code}: {raw}") from e


def configured_voice_provider() -> str:
    provider = VOICE_TRANSCRIPTION_PROVIDER
    if provider in {"", "none", "off", "disabled"}:
        return ""
    if provider == "command":
        return "command" if VOICE_TRANSCRIPTION_CMD else ""
    if provider == "openai":
        return "openai" if VOICE_OPENAI_API_KEY else ""
    if provider != "auto":
        return provider
    if VOICE_TRANSCRIPTION_CMD:
        return "command"
    if VOICE_OPENAI_API_KEY:
        return "openai"
    return ""


def download_telegram_audio(msg: IncomingMessage) -> Path:
    if not msg.audio_file_id:
        raise RuntimeError("Telegram message has no voice/audio file")
    if msg.audio_file_size and msg.audio_file_size > MAX_AUDIO_BYTES:
        raise RuntimeError(
            f"Telegram audio is too large ({msg.audio_file_size} bytes > {MAX_AUDIO_BYTES} byte limit)"
        )

    file_info = telegram_api("getFile", {"file_id": msg.audio_file_id}, timeout=30)
    file_path = str((file_info or {}).get("file_path") or "")
    if not file_path:
        raise RuntimeError("Telegram getFile did not return file_path")
    size = int((file_info or {}).get("file_size") or msg.audio_file_size or 0)
    if size and size > MAX_AUDIO_BYTES:
        raise RuntimeError(f"Telegram audio is too large ({size} bytes > {MAX_AUDIO_BYTES} byte limit)")

    suffix = Path(file_path).suffix or mimetypes.guess_extension(msg.audio_mime_type or "") or ".oga"
    fd, tmp_name = tempfile.mkstemp(prefix="pi-telegram-voice-", suffix=suffix)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(telegram_download(file_path, timeout=120))
        return tmp_path
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        finally:
            raise


def download_telegram_image(msg: IncomingMessage) -> Path:
    """Download the selected Telegram photo/image document to a temp file."""
    if not msg.image_file_id:
        raise RuntimeError("Telegram message has no photo/image file")
    if msg.image_file_size and msg.image_file_size > MAX_IMAGE_BYTES:
        raise RuntimeError(
            f"Telegram image is too large ({msg.image_file_size} bytes > {MAX_IMAGE_BYTES} byte limit)"
        )

    file_info = telegram_api("getFile", {"file_id": msg.image_file_id}, timeout=30)
    file_path = str((file_info or {}).get("file_path") or "")
    if not file_path:
        raise RuntimeError("Telegram getFile did not return file_path")
    size = int((file_info or {}).get("file_size") or msg.image_file_size or 0)
    if size and size > MAX_IMAGE_BYTES:
        raise RuntimeError(f"Telegram image is too large ({size} bytes > {MAX_IMAGE_BYTES} byte limit)")

    suffix = Path(file_path).suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,10}", suffix):
        suffix = mimetypes.guess_extension(msg.image_mime_type or "") or ".jpg"
    image_bytes = telegram_download(file_path, timeout=120)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise RuntimeError(
            f"Telegram image is too large ({len(image_bytes)} bytes > {MAX_IMAGE_BYTES} byte limit)"
        )

    fd, tmp_name = tempfile.mkstemp(prefix="pi-telegram-image-", suffix=suffix)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(image_bytes)
        return tmp_path
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        finally:
            raise


def _shell_quote(value: str) -> str:
    # Avoid importing shlex solely for one POSIX quote operation.
    return "'" + value.replace("'", "'\\''") + "'"


def transcribe_with_command(audio_path: Path, mime_type: str) -> str:
    if not VOICE_TRANSCRIPTION_CMD:
        raise RuntimeError("PI_TELEGRAM_VOICE_TRANSCRIPTION_CMD is not set")
    replacements = {
        "{file}": _shell_quote(str(audio_path)),
        "{path}": _shell_quote(str(audio_path)),
        "{mime}": _shell_quote(mime_type or "application/octet-stream"),
        "{filename}": _shell_quote(audio_path.name),
    }
    command = VOICE_TRANSCRIPTION_CMD
    if any(token in command for token in replacements):
        for token, value in replacements.items():
            command = command.replace(token, value)
    else:
        command = f"{command} {_shell_quote(str(audio_path))}"
    result = subprocess.run(command, shell=True, text=True, capture_output=True, timeout=300)
    if result.returncode != 0:
        stderr = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"voice transcription command failed ({result.returncode}): {stderr[:500]}")
    transcript = (result.stdout or "").strip()
    if not transcript:
        raise RuntimeError("voice transcription command returned an empty transcript")
    return transcript


def _multipart_form(fields: dict[str, str], file_field: str, file_path: Path, mime_type: str) -> tuple[bytes, str]:
    boundary = "----piTelegramVoice" + uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    file_bytes = file_path.read_bytes()
    parts.extend(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'.encode(),
            f"Content-Type: {mime_type or 'application/octet-stream'}\r\n\r\n".encode(),
            file_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    return b"".join(parts), boundary


def transcribe_with_openai(audio_path: Path, mime_type: str) -> str:
    if not VOICE_OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY or PI_TELEGRAM_OPENAI_API_KEY is not set")
    body, boundary = _multipart_form(
        {"model": VOICE_OPENAI_MODEL, "response_format": "text"},
        "file",
        audio_path,
        mime_type or "audio/ogg",
    )
    req = urllib.request.Request(
        f"{VOICE_OPENAI_API_BASE}/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {VOICE_OPENAI_API_KEY}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            transcript = resp.read().decode("utf-8", errors="replace").strip()
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI transcription failed HTTP {e.code}: {raw[:500]}") from e
    if not transcript:
        raise RuntimeError("OpenAI transcription returned an empty transcript")
    return transcript


def image_rpc_payload(image_path: Path, mime_type: str) -> dict[str, Any]:
    """Build the pi RPC ImageContent block for a downloaded Telegram image."""
    mime = mime_type or mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    return {
        "type": "image",
        "data": base64.b64encode(image_path.read_bytes()).decode("ascii"),
        "mimeType": mime,
    }


def transcribe_telegram_audio(msg: IncomingMessage) -> str:
    provider = configured_voice_provider()
    if not provider:
        raise RuntimeError(
            "Voice notes need transcription configured. Set OPENAI_API_KEY/PI_TELEGRAM_OPENAI_API_KEY, "
            "or set PI_TELEGRAM_VOICE_TRANSCRIPTION_CMD."
        )
    audio_path = download_telegram_audio(msg)
    try:
        mime_type = msg.audio_mime_type or mimetypes.guess_type(audio_path.name)[0] or "audio/ogg"
        if provider == "command":
            return transcribe_with_command(audio_path, mime_type)
        if provider == "openai":
            return transcribe_with_openai(audio_path, mime_type)
        raise RuntimeError(f"Unsupported voice transcription provider: {provider}")
    finally:
        audio_path.unlink(missing_ok=True)


def load_state() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text())
    except FileNotFoundError:
        return {}
    except Exception as e:
        log(f"Failed to load state, starting fresh: {e}")
        return {}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_PATH)


def get_latest_update_id() -> int:
    updates = telegram_api(
        "getUpdates",
        {"timeout": 0, "limit": 100, "allowed_updates": ["message"]},
        timeout=10,
    )
    if not updates:
        return 0
    return max(int(update.get("update_id", 0)) for update in updates)


def fetch_updates(after_update_id: int) -> list[dict[str, Any]]:
    return telegram_api(
        "getUpdates",
        {
            "offset": after_update_id + 1,
            "timeout": POLL_TIMEOUT_SECONDS,
            "limit": 20,
            "allowed_updates": ["message"],
        },
        timeout=POLL_TIMEOUT_SECONDS + 10,
    )


def display_chat_name(chat: dict[str, Any]) -> str:
    for key in ("title", "username"):
        if chat.get(key):
            return str(chat[key])
    name = " ".join(str(chat.get(k, "")).strip() for k in ("first_name", "last_name")).strip()
    return name


def display_sender(sender: dict[str, Any]) -> str:
    if sender.get("username"):
        return "@" + str(sender["username"])
    name = " ".join(str(sender.get(k, "")).strip() for k in ("first_name", "last_name")).strip()
    return name or str(sender.get("id", ""))


def parse_message(update: dict[str, Any]) -> Optional[IncomingMessage]:
    message = update.get("message")
    if not isinstance(message, dict):
        return None
    chat = message.get("chat") or {}
    sender = message.get("from") or {}
    chat_id = chat.get("id")
    message_id = message.get("message_id")
    if chat_id is None or message_id is None:
        return None
    content = message.get("text") or message.get("caption") or ""

    audio_obj: dict[str, Any] = {}
    audio_kind = ""
    for kind in ("voice", "audio"):
        maybe_audio = message.get(kind)
        if isinstance(maybe_audio, dict) and maybe_audio.get("file_id"):
            audio_obj = maybe_audio
            audio_kind = kind
            break
    document = message.get("document")
    if not audio_obj and isinstance(document, dict) and str(document.get("mime_type", "")).startswith("audio/"):
        audio_obj = document
        audio_kind = "document"

    image_obj: dict[str, Any] = {}
    image_kind = ""
    image_mime_type = ""
    photo_sizes = message.get("photo")
    if isinstance(photo_sizes, list) and photo_sizes:
        # Telegram sends several resolutions; pick the largest variant.
        def _photo_area(p: dict[str, Any]) -> int:
            return int(p.get("width") or 0) * int(p.get("height") or 0)

        best = max(
            (p for p in photo_sizes if isinstance(p, dict) and p.get("file_id")),
            key=lambda p: (_photo_area(p), int(p.get("file_size") or 0)),
            default=None,
        )
        if best:
            image_obj = best
            image_kind = "photo"
            image_mime_type = "image/jpeg"  # Telegram photo payloads are always JPEG
    if not image_obj and isinstance(document, dict) and str(document.get("mime_type", "")).startswith("image/"):
        image_obj = document
        image_kind = "document"
        image_mime_type = str(document.get("mime_type", ""))

    entities = message.get("entities") or message.get("caption_entities") or []
    reply_msg = message.get("reply_to_message") or {}
    reply_sender = reply_msg.get("from") or {}

    return IncomingMessage(
        update_id=int(update.get("update_id", 0)),
        message_id=int(message_id),
        chat_id=str(chat_id),
        chat_name=display_chat_name(chat),
        chat_username=("@" + str(chat["username"])) if chat.get("username") else "",
        sender=display_sender(sender),
        sender_is_bot=bool(sender.get("is_bot")),
        timestamp=int(message.get("date", 0)),
        content=str(content),
        audio_file_id=str(audio_obj.get("file_id", "")),
        audio_file_size=int(audio_obj.get("file_size") or 0),
        audio_mime_type=str(audio_obj.get("mime_type", "")),
        audio_kind=audio_kind,
        image_file_id=str(image_obj.get("file_id", "")),
        image_file_size=int(image_obj.get("file_size") or 0),
        image_mime_type=image_mime_type,
        image_kind=image_kind,
        chat_type=str(chat.get("type", "")),
        entities=[dict(e) for e in entities if isinstance(e, dict)],
        reply_to_sender_id=int(reply_sender.get("id")) if reply_sender.get("id") is not None else None,
        reply_to_sender_is_bot=bool(reply_sender.get("is_bot")),
    )


def send_chat_action(chat_id: str, action: str = "typing") -> None:
    try:
        telegram_api("sendChatAction", {"chat_id": chat_id, "action": action}, timeout=10)
    except Exception as e:
        log(f"Telegram sendChatAction failed: {e}")


class ChatActionLoop:
    """Keep a Telegram chat action alive while a blocking operation runs."""

    def __init__(self, chat_id: str, action: str = "typing", interval: float = TYPING_INTERVAL_SECONDS) -> None:
        self.chat_id = chat_id
        self.action = action
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread: Optional[threading.Thread] = None

    def __enter__(self) -> "ChatActionLoop":
        if self.interval <= 0:
            return self
        send_chat_action(self.chat_id, self.action)
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, _exc_type: Any, _exc: Any, _tb: Any) -> None:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=1)

    def _run(self) -> None:
        while not self.stop_event.wait(self.interval):
            send_chat_action(self.chat_id, self.action)


def chunk_reply(text: str) -> list[str]:
    """Split replies on line boundaries where possible."""
    chunks: list[str] = []
    current = ""
    for line in text.splitlines(keepends=True):
        if current and len(current) + len(line) > MAX_REPLY_CHARS:
            chunks.append(current.rstrip())
            current = ""
        while len(line) > MAX_REPLY_CHARS:
            chunks.append(line[:MAX_REPLY_CHARS].rstrip())
            line = line[MAX_REPLY_CHARS:]
        current += line
    if current.strip() or not chunks:
        chunks.append(current.rstrip())
    return chunks


def telegram_html(text: str) -> str:
    """Render safe, small Markdown-ish text into Telegram HTML."""

    def inline(value: str) -> str:
        escaped = html.escape(value, quote=False)
        escaped = re.sub(r"`([^`\n]+)`", lambda m: f"<code>{m.group(1)}</code>", escaped)
        escaped = re.sub(r"\*\*([^*\n]+)\*\*", lambda m: f"<b>{m.group(1)}</b>", escaped)
        if escaped.startswith("- "):
            escaped = "• " + escaped[2:]
        return escaped

    rendered: list[str] = []
    in_pre = False
    pre_lines: list[str] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.strip().startswith("```"):
            if in_pre:
                rendered.append("<pre>" + html.escape("\n".join(pre_lines), quote=False) + "</pre>")
                pre_lines = []
                in_pre = False
            else:
                in_pre = True
            continue
        if in_pre:
            pre_lines.append(line)
        else:
            rendered.append(inline(line))
    if in_pre:
        rendered.append("<pre>" + html.escape("\n".join(pre_lines), quote=False) + "</pre>")
    return "\n".join(rendered).strip() or " "


def send_telegram(chat_id: str, text: str, reply_to_message_id: Optional[int] = None) -> None:
    chunks = chunk_reply(text)
    for idx, chunk in enumerate(chunks, 1):
        if len(chunks) > 1:
            chunk = f"({idx}/{len(chunks)})\n{chunk}"
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": telegram_html(chunk),
            "parse_mode": "HTML",
        }
        if reply_to_message_id is not None:
            payload["reply_parameters"] = {"message_id": reply_to_message_id, "allow_sending_without_reply": True}
        telegram_api("sendMessage", payload, timeout=60)


def is_allowed(msg: IncomingMessage) -> bool:
    if not ALLOWED_CHATS:
        return False
    identifiers = {msg.chat_id}
    if msg.chat_username:
        identifiers.add(msg.chat_username)
        identifiers.add(msg.chat_username.lstrip("@"))
    return bool(identifiers & ALLOWED_CHATS)


def fetch_bot_identity() -> None:
    """Populate BOT_ID / BOT_USERNAME via getMe so group mentions can be matched."""
    global BOT_ID, BOT_USERNAME
    try:
        me = telegram_api("getMe", {}, timeout=10) or {}
        BOT_ID = int(me.get("id")) if me.get("id") is not None else None
        BOT_USERNAME = str(me.get("username") or "").lstrip("@").lower()
        log(f"Bot identity: id={BOT_ID} username=@{BOT_USERNAME or '?'}")
    except Exception as e:
        log(f"Failed to fetch bot identity via getMe: {e}")


def is_group_chat(msg: IncomingMessage) -> bool:
    return msg.chat_type.lower() in ("group", "supergroup")


def message_mentions_bot(msg: IncomingMessage) -> bool:
    """True if the message explicitly @mentions or commands this bot."""
    if BOT_ID is None and not BOT_USERNAME:
        return False
    expected = f"@{BOT_USERNAME}" if BOT_USERNAME else None
    text = msg.content or ""
    for ent in msg.entities:
        etype = str(ent.get("type", "")).split(".")[-1].lower()
        offset = int(ent.get("offset", -1))
        length = int(ent.get("length", 0))
        if offset < 0 or length <= 0:
            continue
        span = text[offset:offset + length]
        if etype == "mention" and expected and span.strip().lower() == expected:
            return True
        if etype == "text_mention":
            user = ent.get("user") or {}
            if user.get("id") == BOT_ID:
                return True
        if etype == "bot_command" and expected:
            at = span.find("@")
            if at >= 0 and span[at:].strip().lower() == expected:
                return True
    return False


def is_reply_to_bot(msg: IncomingMessage) -> bool:
    return BOT_ID is not None and msg.reply_to_sender_id == BOT_ID


def strip_bot_mention(text: str) -> str:
    if not BOT_USERNAME:
        return text
    cleaned = re.sub(rf"(?i)@{re.escape(BOT_USERNAME)}\b[,\-:\s]*", "", text).strip()
    return cleaned or text


def strip_command_prefix(content: str, is_voice: bool) -> Optional[str]:
    content = content.strip()
    if not content:
        return None
    pfx = PREFIX.strip()
    if not pfx:
        return content

    candidates = [pfx]
    # Voice transcripts rarely include symbols like "!". If the text prefix is
    # "!pi", accept spoken "pi ..." as the voice-note equivalent.
    if is_voice:
        spoken = pfx.lstrip("!/").strip()
        if spoken and spoken.lower() not in {c.lower() for c in candidates}:
            candidates.append(spoken)
        if spoken.lower() == "pi":
            candidates.append("pie")

    lower = content.lower()
    separators = " \t\r\n:,-—–"
    for candidate in candidates:
        c = candidate.lower()
        if lower == c:
            return "status"
        if lower.startswith(c) and len(content) > len(candidate) and content[len(candidate)] in separators:
            return content[len(candidate) :].lstrip(separators).strip() or "status"
    return None


def scan_session(path: Path) -> tuple[str, str]:
    """Return (cwd, label) for a session file. Label = first user-message snippet."""
    cwd, name = "", ""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                if i > 400:
                    break
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                rtype = rec.get("type")
                if rtype == "session":
                    cwd = str(rec.get("cwd") or "")
                elif rtype == "session_info" and rec.get("name") and not name:
                    name = str(rec["name"])
                elif rtype == "message" and (rec.get("message") or {}).get("role") == "user":
                    content = rec["message"].get("content")
                    if isinstance(content, str):
                        text = content
                    elif isinstance(content, list):
                        text = " ".join(
                            str(c.get("text", ""))
                            for c in content
                            if isinstance(c, dict) and c.get("type") == "text"
                        )
                    else:
                        text = ""
                    text = text.strip()
                    # Drop this daemon's own bridge header from Telegram-originated sessions.
                    if text.startswith(("Telegram command from chat", "Telegram voice-note transcript", "Telegram image from chat")) and "\n\n" in text:
                        text = text.split("\n\n", 1)[1].strip()
                    if text:
                        return cwd, " ".join(text.split())[:60]
    except OSError:
        pass
    return cwd, name or path.stem.split("_")[-1][:8]


def list_pi_sessions() -> list[tuple[Path, str, str, float]]:
    """Every pi session on this host, newest first: (path, cwd, label, mtime)."""
    if not SESSIONS_DIR.is_dir():
        return []
    files = sorted(SESSIONS_DIR.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    sessions = []
    for p in files[:MAX_SESSION_LIST]:
        cwd, label = scan_session(p)
        sessions.append((p, cwd, label, p.stat().st_mtime))
    return sessions


def format_age(mtime: float) -> str:
    mins = max(0, int((time.time() - mtime) / 60))
    if mins < 60:
        return f"{mins}m ago"
    hours = mins // 60
    if hours < 48:
        return f"{hours}h ago"
    return f"{hours // 24}d ago"


def format_session_list() -> str:
    sessions = list_pi_sessions()
    if not sessions:
        return "No pi sessions found on this host."
    lines = ["Recent pi chats on homelab (newest first):"]
    for i, (_p, cwd, label, mtime) in enumerate(sessions, 1):
        lines.append(f"{i}. {label} · {Path(cwd).name if cwd else '?'} · {format_age(mtime)}")
    lines.append("Reply with: switch N")
    return "\n".join(lines)


def handle_switch(pi: "PiRPC", arg: str) -> str:
    sessions = list_pi_sessions()
    if not sessions:
        return "No pi sessions found on this host."
    target = None
    if arg.isdigit():
        idx = int(arg)
        if 1 <= idx <= len(sessions):
            target = sessions[idx - 1]
    else:
        matches = [s for s in sessions if arg in s[0].name or arg.lower() in s[2].lower()]
        if len(matches) == 1:
            target = matches[0]
        elif len(matches) > 1:
            return f"'{arg}' matches {len(matches)} chats — use the number from 'chats'."
    if target is None:
        return f"No chat '{arg}'. Send 'chats' to list sessions, then 'switch N'."
    err = pi.switch_session(str(target[0]))
    if err:
        return err
    return f"Switched to: {target[2]} · {Path(target[1]).name if target[1] else '?'} · {format_age(target[3])}"


def should_handle(msg: IncomingMessage) -> Optional[str]:
    if msg.sender_is_bot:
        return None
    prompt = strip_command_prefix(msg.content or "", is_voice=bool(msg.audio_kind))
    if prompt is None:
        if msg.image_file_id and not (msg.content or "").strip():
            # Bare photo/screenshot with no caption: forward it to pi directly.
            prompt = ""
        else:
            return None

    if not is_allowed(msg):
        log(
            "Ignoring unauthorized Telegram command "
            f"chat_id={msg.chat_id} chat={msg.chat_name!r} username={msg.chat_username!r} sender={msg.sender!r}"
        )
        return None

    # Shared-group safety: in group/supergroup chats, only respond when this
    # bot is explicitly @mentioned or replied to. Keeps two bots in one group
    # from double-answering every human message. DMs are never gated here.
    if REQUIRE_MENTION and is_group_chat(msg):
        if not (message_mentions_bot(msg) or is_reply_to_bot(msg)):
            return None
        if MENTION_STRIP:
            prompt = strip_bot_mention(prompt)
            if not prompt:
                prompt = "status"

    return prompt


def main() -> int:
    if not BOT_TOKEN:
        log("PI_TELEGRAM_BOT_TOKEN is required")
        return 1
    if not ALLOWED_CHATS:
        log("PI_TELEGRAM_ALLOWED_CHATS is empty; all Telegram commands will be ignored")
    log(f"Watching Telegram bot updates; allowed chats: {', '.join(sorted(ALLOWED_CHATS)) or '(none)'}; prefix: {PREFIX!r}; require_mention={REQUIRE_MENTION}")
    fetch_bot_identity()

    state = load_state()
    if "last_update_id" not in state:
        state["last_update_id"] = 0 if PROCESS_EXISTING else get_latest_update_id()
        save_state(state)
        log(f"Initialized last_update_id={state['last_update_id']}")

    pi = PiRPC()
    stop = False

    def _stop(_signum: int, _frame: Any) -> None:
        nonlocal stop
        stop = True
        log("Stopping...")

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    while not stop:
        try:
            last_update_id = int(state.get("last_update_id", 0))
            for update in fetch_updates(last_update_id):
                update_id = int(update.get("update_id", 0))
                state["last_update_id"] = max(int(state.get("last_update_id", 0)), update_id)
                save_state(state)
                msg = parse_message(update)
                if not msg:
                    continue
                try:
                    if msg.audio_file_id and not msg.sender_is_bot and is_allowed(msg):
                        log(
                            "Transcribing Telegram audio "
                            f"chat={msg.chat_id} update={msg.update_id} kind={msg.audio_kind} size={msg.audio_file_size}"
                        )
                        transcript = transcribe_telegram_audio(msg)
                        if msg.content.strip():
                            msg.content = f"{msg.content.strip()}\n\nVoice transcript:\n{transcript}"
                        else:
                            msg.content = transcript

                    prompt = should_handle(msg)
                    if prompt is None:
                        continue
                    log(f"Handling Telegram command from chat={msg.chat_id} update={msg.update_id}: {prompt[:120]!r}")
                    cmd = prompt.lower().lstrip("/").strip()
                    if cmd in {"status", "ping"}:
                        reply = pi.status()
                    elif cmd in {"reset", "new", "new session"}:
                        reply = pi.new_session()
                    elif cmd in {"chats", "sessions", "switch", "resume"}:
                        reply = format_session_list()
                    elif cmd.startswith(("switch ", "resume ")):
                        reply = handle_switch(pi, cmd.split(None, 1)[1].strip())
                    else:
                        image_path: Optional[Path] = None
                        try:
                            images: Optional[list[dict[str, Any]]] = None
                            if msg.image_file_id:
                                log(
                                    "Downloading Telegram image "
                                    f"chat={msg.chat_id} update={msg.update_id} kind={msg.image_kind} size={msg.image_file_size}"
                                )
                                image_path = download_telegram_image(msg)
                                images = [image_rpc_payload(image_path, msg.image_mime_type)]
                            if msg.image_kind:
                                source_note = "Telegram image"
                            elif msg.audio_kind:
                                source_note = "Telegram voice-note transcript"
                            else:
                                source_note = "Telegram command"
                            full_prompt = (
                                f"{source_note} from chat {msg.chat_name or msg.chat_id} "
                                f"by {msg.sender} at unix timestamp {msg.timestamp}:\n\n{prompt}"
                            )
                            with ChatActionLoop(msg.chat_id):
                                reply = pi.ask(full_prompt, chat_id=msg.chat_id, reply_to=msg.message_id, images=images)
                        finally:
                            # Deleted only after pi.ask returns, so pi has already
                            # received the base64 payload.
                            if image_path is not None:
                                image_path.unlink(missing_ok=True)
                    send_telegram(msg.chat_id, reply, reply_to_message_id=msg.message_id)
                except Exception as e:
                    log(f"Command failed: {e}")
                    try:
                        send_telegram(msg.chat_id, f"Pi bridge error: {e}", reply_to_message_id=msg.message_id)
                    except Exception as send_err:
                        log(f"Also failed to send error over Telegram: {send_err}")
        except Exception as e:
            log(f"Loop error: {e}")
            time.sleep(RETRY_SECONDS)

    pi.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

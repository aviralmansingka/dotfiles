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
import hmac
import html
import json
import mimetypes
import os
import queue
import re
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
# Leave room below Telegram's 32,768-character Rich Message limit.
MAX_RICH_REPLY_CHARS = 32000
PROMPT_TIMEOUT_SECONDS = int(os.environ.get("PI_TELEGRAM_PROMPT_TIMEOUT_SECONDS", "900"))
POLL_TIMEOUT_SECONDS = int(os.environ.get("PI_TELEGRAM_POLL_TIMEOUT_SECONDS", "50"))
SESSIONS_DIR = Path(os.environ.get("PI_TELEGRAM_SESSIONS_DIR", str(HOME / ".pi/agent/sessions")))
MAX_SESSION_LIST = int(os.environ.get("PI_TELEGRAM_MAX_SESSION_LIST", "12"))
RETRY_SECONDS = float(os.environ.get("PI_TELEGRAM_RETRY_SECONDS", "5"))
TYPING_INTERVAL_SECONDS = float(os.environ.get("PI_TELEGRAM_TYPING_INTERVAL_SECONDS", "4"))
THINKING_STREAM_ENABLED = os.environ.get("PI_TELEGRAM_THINKING_STREAM", "1") == "1"
STATUS_EDIT_INTERVAL = float(os.environ.get("PI_TELEGRAM_STATUS_EDIT_INTERVAL", "1.0"))
STATUS_FINAL_PAUSE = float(os.environ.get("PI_TELEGRAM_STATUS_FINAL_PAUSE", "0.3"))

VOICE_TRANSCRIPTION_PROVIDER = os.environ.get("PI_TELEGRAM_VOICE_TRANSCRIPTION_PROVIDER", "auto").strip().lower()
VOICE_TRANSCRIPTION_CMD = os.environ.get("PI_TELEGRAM_VOICE_TRANSCRIPTION_CMD", "").strip()
VOICE_OPENAI_API_KEY = os.environ.get("PI_TELEGRAM_OPENAI_API_KEY", os.environ.get("OPENAI_API_KEY", "")).strip()
VOICE_OPENAI_API_BASE = os.environ.get("PI_TELEGRAM_OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
VOICE_OPENAI_MODEL = os.environ.get("PI_TELEGRAM_OPENAI_TRANSCRIBE_MODEL", "whisper-1").strip()
MAX_AUDIO_BYTES = int(os.environ.get("PI_TELEGRAM_MAX_AUDIO_BYTES", str(20 * 1024 * 1024)))
MAX_IMAGE_BYTES = int(os.environ.get("PI_TELEGRAM_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))

# --- Private iOS Shortcut audio endpoint ---------------------------------
# The owner's iPhone Action Button shortcut POSTs multipart/form-data with
# fields `token` (shared secret) and `file` (audio) here, over Tailscale.
# Enabled only when a token and port are configured.
SHORTCUT_HOST = os.environ.get("PI_TELEGRAM_SHORTCUT_HOST", "").strip()
SHORTCUT_PORT = int(os.environ.get("PI_TELEGRAM_SHORTCUT_PORT", "0") or 0)
SHORTCUT_PATH = os.environ.get("PI_TELEGRAM_SHORTCUT_PATH", "/shortcut-audio").strip() or "/shortcut-audio"
SHORTCUT_TOKEN = os.environ.get("PI_TELEGRAM_SHORTCUT_TOKEN", "").strip()
# 1 = post the shortcut voice note itself into the Telegram chat (as a bot
# voice message), so the chat keeps a visible, playable record of the note.
SHORTCUT_SEND_TO_TELEGRAM = os.environ.get("PI_TELEGRAM_SHORTCUT_SEND_TELEGRAM_REPLY", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# Pin the pi session file so daemon restarts continue the same conversation.
# Without this, each restart starts a fresh session.
PI_SESSION = os.environ.get("PI_TELEGRAM_SESSION", "").strip()

SYSTEM_PROMPT = """
You are Pi, running headlessly behind the owner's Telegram bot.
The Telegram sender is the owner controlling you remotely.
Telegram replies must be succinct and never a wall of text. Use short answers, compact bullets when useful, and ask before sending long explanations.
Do not append suggested follow-up questions. Ask questions only when needed or requested.
Use Markdown when helpful: headings, lists, links, **bold**, `code`, and fenced code blocks. Telegram can render it as a Rich Message.
For mcpScript or codemode calls, add a leading `//` comment that states the intent without a tool name.
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
# Trace rendering — one intent title and optional result summary per tool call.
#
# The chat gets a single live message holding available titles in call order,
# repeated calls included. Each line leads with the
# same status glyph as the TUI work tree (◇ running, ◆ success, × failure).
# A finished call can have one result summary, connected by `└─`. The trace
# never renders raw commands, arguments, result bodies, or inline buttons.
#
# Titles come from a leading intent comment, a stored `intentTitle`, or the
# TUI renderer's asynchronous title generator. Result summaries use the same
# session model. Calls without titles stay hidden.
# The status message is deleted when the reply is ready.
# ---------------------------------------------------------------------------

TITLE_MAX = 40
# ponytail: bound the full result line, including its tree prefix.
SUMMARY_LINE_MAX = 28
_SUMMARY_PREFIX = "└─ "

# Tool → comment marker for the leading intent line, and the arg that holds
# the script source.
_INTENT_MARKERS = {"bash": "#", "powershell": "#", "python": "#", "mcpScript": "//", "codemode": "//"}
_INTENT_SOURCE_ARG = {"bash": "command", "powershell": "command", "python": "code", "mcpScript": "code", "codemode": "code"}
_TELEGRAM_TITLE_PREFIX = "pi-telegram:title:"
_TELEGRAM_RESULT_PREFIX = "pi-telegram:result:"


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


def _as_str(value: Any) -> Optional[str]:
    return value if isinstance(value, str) else None


def _as_record(value: Any) -> dict[str, Any]:
    if value is not None and isinstance(value, dict):
        return value
    return {}


def _utf16_len(text: str) -> int:
    """Length in UTF-16 code units — what Telegram counts."""
    return len(text.encode("utf-16-le")) // 2


@dataclass
class ToolCall:
    """One executed tool call — its title and settled status."""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    result: Optional[dict[str, Any]] = None
    generated_title: Optional[str] = None
    result_summary: Optional[str] = None
    failed: Optional[bool] = None  # None = still running


def _lift_leading_comment(source: str, marker: str, skip: Optional[Any] = None) -> Optional[str]:
    """First leading comment line of a script — the model's intent title.

    Port of the TUI's liftLeadingComment: only a comment block that starts
    the source titles the call, so a `#` inside a heredoc body stays body.
    A shebang is diagnostics, not intent, so it never titles a call.
    """
    strip = re.compile(r"^" + re.escape(marker) + r"+\s*")
    title: Optional[str] = None
    for line in (source or "").split("\n"):
        if not line.strip():
            continue
        if not line.lstrip().startswith(marker):
            break
        text = _sanitize_title(strip.sub("", line.lstrip()))
        if not text or text.startswith("!") or (skip and skip(text)):
            continue
        if title is None:
            title = text
    return title


def _stored_intent_title(tool_call: ToolCall) -> Optional[str]:
    """A model/harness title persisted in the call's result details."""
    details = _as_record(_as_record(tool_call.result).get("details"))
    return _sanitize_title(_as_str(details.get("intentTitle")))


def _call_title(tool_call: ToolCall) -> Optional[str]:
    """Prefer stored and comment titles, then the live generated title."""
    title = _stored_intent_title(tool_call)
    if not title:
        marker = _INTENT_MARKERS.get(tool_call.name)
        source = _as_str(tool_call.arguments.get(_INTENT_SOURCE_ARG.get(tool_call.name, "")))
        if marker and source:
            skip = (lambda text: text.startswith("@options")) if tool_call.name in {"mcpScript", "codemode"} else None
            title = _lift_leading_comment(source, marker, skip)
    title = title or tool_call.generated_title
    return _truncate_title(title) if title else None


class TraceBuilder:
    """Ordered record of a turn's tool calls, built from RPC execution events.

    `tool_execution_start` is the authoritative source: it carries the id,
    the tool name, and the complete args. `tool_execution_end` adds the
    result, whose details may hold an `intentTitle`. Nothing speculative is
    tracked, so no partial-argument placeholder or duplicate row can appear.
    Calls survive `agent_start`: a retry or auto-continue within one prompt
    keeps every title it already showed.
    """

    def __init__(self) -> None:
        self.calls: list[ToolCall] = []
        # An instant model response can precede the forwarded tool-start event.
        self.pending_titles: dict[str, str] = {}

    def _tracked(self, tool_call_id: str) -> Optional[ToolCall]:
        return next((c for c in reversed(self.calls) if tool_call_id and c.id == tool_call_id), None)

    def on_tool_execution_start(self, tool_call_id: str, tool_name: str, args: dict[str, Any]) -> None:
        self.calls.append(ToolCall(
            id=tool_call_id, name=tool_name or "tool", arguments=dict(args or {}),
            generated_title=self.pending_titles.pop(tool_call_id, None),
        ))

    def on_title(self, tool_call_id: str, value: str) -> bool:
        title = _sanitize_title(value)
        if not tool_call_id or not title:
            return False
        call = self._tracked(tool_call_id)
        if call is None:
            if len(self.pending_titles) < 32:
                self.pending_titles[tool_call_id] = title
            return False
        if call.generated_title == title:
            return False
        call.generated_title = title
        return True

    def on_summary(self, tool_call_id: str, value: str) -> bool:
        summary = _sanitize_title(value)
        call = self._tracked(tool_call_id)
        if call is None or not summary or call.result_summary == summary:
            return False
        if _utf16_len(_SUMMARY_PREFIX + summary) > SUMMARY_LINE_MAX:
            return False
        call.result_summary = summary
        return True

    def on_tool_execution_end(
        self, tool_call_id: str, result: Optional[dict[str, Any]] = None, is_error: bool = False
    ) -> None:
        call = self._tracked(tool_call_id)
        if call is not None:
            call.result = result
            call.failed = bool(is_error)

    def render(self) -> str:
        """Render each title and its optional, connected result summary.

        The leading glyph matches the TUI work tree: ◇ while the call runs,
        ◆ when it settled successfully, × when it failed. Only whole lines
        are kept, so the cut never splits an HTML entity. Telegram measures
        message length in UTF-16 code units, not characters.
        """
        lines: list[str] = []
        used = 0
        for call in self.calls:
            title = _call_title(call)
            if not title:
                continue
            glyph = "×" if call.failed else ("◇" if call.failed is None else "◆")
            line = f"{glyph} {html.escape(title, quote=False)}"
            cost = _utf16_len(line) + (1 if lines else 0)
            if used + cost > MAX_REPLY_CHARS:
                break
            lines.append(line)
            used += cost
            if call.failed is not None and call.result_summary:
                line = _SUMMARY_PREFIX + html.escape(call.result_summary, quote=False)
                cost = _utf16_len(line) + 1
                if used + cost > MAX_REPLY_CHARS:
                    break
                lines.append(line)
                used += cost
        return "\n".join(lines)


class StatusMessenger:
    """One live Telegram message holding the turn's titles and result summaries.

    Created on the first available title — before that the chat shows only the
    native typing action — then edited in place (coalesced to
    STATUS_EDIT_INTERVAL). The message is deleted when the reply is ready.
    A turn with no tool calls creates no message. The trace never carries
    reply_parameters, so it never quotes the prompt above the titles.
    """

    def __init__(self, chat_id: str) -> None:
        self.chat_id = chat_id
        self.message_id: Optional[int] = None
        self.tree = TraceBuilder()
        self.last_edit = 0.0
        self.dirty = False
        self.last_text: Optional[str] = None

    def on_event(self, ev: dict[str, Any]) -> None:
        et = ev.get("type")
        if et == "tool_execution_start":
            # Nested calls (mcpScript children) do not get their own line.
            if not ev.get("parentToolCallId"):
                self.tree.on_tool_execution_start(
                    ev.get("toolCallId") or "",
                    ev.get("toolName") or "",
                    ev.get("args") if isinstance(ev.get("args"), dict) else {},
                )
                self.dirty = True
        elif et == "tool_execution_end":
            # Same filter as starts, so a nested call never edits the trace.
            if not ev.get("parentToolCallId"):
                self.tree.on_tool_execution_end(
                    ev.get("toolCallId") or "",
                    ev.get("result") if isinstance(ev.get("result"), dict) else None,
                    bool(ev.get("isError")),
                )
                self.dirty = True
        elif et == "extension_ui_request" and ev.get("method") == "setStatus":
            key = _as_str(ev.get("statusKey")) or ""
            text = _as_str(ev.get("statusText"))
            if key.startswith(_TELEGRAM_TITLE_PREFIX) and text is not None:
                self.dirty |= self.tree.on_title(key[len(_TELEGRAM_TITLE_PREFIX):], text)
            elif key.startswith(_TELEGRAM_RESULT_PREFIX) and text is not None:
                self.dirty |= self.tree.on_summary(key[len(_TELEGRAM_RESULT_PREFIX):], text)
        self._maybe_flush()

    def flush(self) -> None:
        self._maybe_flush(force=True)

    def _maybe_flush(self, force: bool = False) -> None:
        if not self.dirty:
            return
        text = self.tree.render()
        if not text:
            return  # no tool call yet: no status message
        now = time.monotonic()
        if self.message_id is None:
            self._create(text)
            self.dirty = False
            self.last_edit = now
            return
        if not force and now - self.last_edit < STATUS_EDIT_INTERVAL:
            return
        self._edit(text)
        self.dirty = False
        self.last_edit = now

    def _create(self, text: str) -> None:
        payload: dict[str, Any] = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "HTML",
            "link_preview_options": {"is_disabled": True},
        }
        try:
            result = telegram_api("sendMessage", payload, timeout=30)
            self.message_id = _as_record(result).get("message_id")
            self.last_text = text
        except Exception as e:
            log(f"Status create failed: {e}")

    def _edit(self, text: str) -> None:
        if self.message_id is None or text == self.last_text:
            return
        payload: dict[str, Any] = {
            "chat_id": self.chat_id,
            "message_id": self.message_id,
            "text": text,
            "parse_mode": "HTML",
            "link_preview_options": {"is_disabled": True},
        }
        try:
            telegram_api("editMessageText", payload, timeout=30)
            self.last_text = text
        except Exception as e:
            log(f"Status edit failed: {e}")

    def finalize(self) -> None:
        """Show the final status, then remove the trace when the reply is ready."""
        if self.message_id is not None:
            self.flush()
            if STATUS_FINAL_PAUSE > 0:
                time.sleep(STATUS_FINAL_PAUSE)
        self.dirty = False
        self._delete()

    def _delete(self) -> None:
        if self.message_id is None:
            return
        try:
            telegram_api("deleteMessage", {"chat_id": self.chat_id, "message_id": self.message_id}, timeout=10)
        except Exception as e:
            log(f"Status delete failed: {e}")
        self.message_id = None


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
        env["PI_TELEGRAM_TOOL_TITLES"] = "1" if THINKING_STREAM_ENABLED else "0"
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
        if PI_SESSION:
            # Sticky session: reopen the pinned session file so restarts
            # keep the conversation instead of starting a fresh session.
            args += ["--session", PI_SESSION]
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
                status = StatusMessenger(chat_id)
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
                if ev.get("type") == "response" and ev.get("id") == request_id:
                    if not ev.get("success"):
                        if status:
                            status.finalize()
                        raise RuntimeError(ev.get("error", "pi rejected prompt"))
                    if _as_record(ev.get("data")).get("disposition") == "handled":
                        if status:
                            status.finalize()
                        return "Command handled."
                    # The prompt's preflight response precedes its run events;
                    # earlier events belong to an older prompt.
                    accepted = True
                    continue
                if not accepted:
                    continue
                if status:
                    status.on_event(ev)
                if ev.get("type") == "agent_settled":
                    # A retry or auto-continue emits another agent_start/agent_end;
                    # only the settled event ends this prompt.
                    break
            else:
                if status:
                    status.finalize()
                raise TimeoutError("Timed out waiting for pi to finish")

            try:
                response_id = str(uuid.uuid4())
                self._send({"id": response_id, "type": "get_last_assistant_text"})
                response = self._wait_response(response_id)
                text = (response.get("data") or {}).get("text")
                return text or "(No response.)"
            finally:
                if status:
                    status.finalize()

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


class TelegramAPIError(RuntimeError):
    def __init__(self, message: str, code: Optional[int]) -> None:
        super().__init__(message)
        self.code = code


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
        e.read()
        raise TelegramAPIError(f"Telegram {method} failed HTTP {e.code}", e.code) from e
    data = json.loads(raw)
    if not data.get("ok"):
        code = data.get("error_code")
        raise TelegramAPIError(f"Telegram {method} failed: {code}", code)
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
        {"timeout": 0, "limit": 100, "allowed_updates": ["message", "callback_query"]},
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
            "allowed_updates": ["message", "callback_query"],
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


def strip_suggested_followups(text: str) -> str:
    """Remove the automatic follow-up section, but keep later sections and code."""
    heading_re = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
    bold_re = re.compile(r"^ {0,3}\*\*(.+?)\*\*:?[ \t]*$")
    followup_re = re.compile(r"^suggested[ \t]+follow[-‑ ]?ups?(?:[ \t]+questions)?[ \t]*:?[ \t]*$", re.I)
    fence_re = re.compile(r"^ {0,3}(`{3,}|~{3,})")
    out: list[str] = []
    fence = ""
    skip_level = 0
    for line in text.splitlines(keepends=True):
        raw = line.rstrip("\r\n")
        marker = fence_re.match(raw)
        if marker:
            token = marker.group(1)
            if not fence:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = ""
        elif not fence:
            heading = heading_re.match(raw)
            bold = bold_re.match(raw)
            title = heading.group(2) if heading else bold.group(1) if bold else ""
            level = len(heading.group(1)) if heading else 2
            if followup_re.fullmatch(title):
                skip_level = level
                continue
            if skip_level and (heading or bold) and level <= skip_level:
                skip_level = 0
        if not skip_level:
            out.append(line)
    return "".join(out).rstrip()


def telegram_rich_markdown(text: str) -> Optional[str]:
    """Disable raw HTML and media without changing literal code."""
    if "<" not in text and "![" not in text:
        return text
    # ponytail: if code might contain markup, use the existing safe renderer.
    if re.search(r"`|~{3}| {4}|\t", text):
        return None

    def escape(match: re.Match[str]) -> str:
        slashes = match.group(1)
        return slashes + ("" if len(slashes) % 2 else "\\") + match.group(2)

    return re.sub(r"(\\*)(<|!\[)", escape, text)


def chunk_reply(text: str) -> list[str]:
    """Split standard replies by UTF-16 length, on line boundaries when possible."""
    # Leave room for the (n/total) prefix and allow at least one emoji.
    limit = max(2, min(MAX_REPLY_CHARS, 4000))
    chunks: list[str] = []
    current = ""
    current_size = 0
    for line in text.splitlines(keepends=True):
        line_size = _utf16_len(line)
        if current and current_size + line_size > limit:
            chunks.append(current.rstrip())
            current = ""
            current_size = 0
        while line_size > limit:
            cut = 0
            used = 0
            for char in line:
                size = 2 if ord(char) > 0xFFFF else 1
                if used + size > limit:
                    break
                used += size
                cut += 1
            chunks.append(line[:cut].rstrip())
            line = line[cut:]
            line_size -= used
        current += line
        current_size += line_size
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


def _build_multipart(fields: dict[str, tuple[Optional[str], bytes]]) -> tuple[bytes, str]:
    """Build a multipart/form-data body. Inverse of parse_multipart."""
    boundary = f"pi-bridge-{uuid.uuid4().hex}"
    out = b""
    for name, (filename, data) in fields.items():
        out += f"--{boundary}\r\n".encode("utf-8")
        if filename:
            out += (
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8")
                + b"Content-Type: application/octet-stream\r\n"
            )
        else:
            out += f'Content-Disposition: form-data; name="{name}"\r\n'.encode("utf-8")
        out += b"\r\n" + data + b"\r\n"
    return out + f"--{boundary}--\r\n".encode("utf-8"), boundary


def send_telegram_voice(chat_id: str, audio_path: Path) -> None:
    """Send an audio file as a playable voice message into a Telegram chat."""
    if not BOT_TOKEN:
        raise RuntimeError("PI_TELEGRAM_BOT_TOKEN is not set")
    data = audio_path.read_bytes()
    if len(data) > MAX_AUDIO_BYTES:
        raise RuntimeError(f"audio file exceeds {MAX_AUDIO_BYTES} bytes")
    body, boundary = _build_multipart(
        {
            "chat_id": (None, chat_id.encode("utf-8")),
            "voice": (audio_path.name, data),
        }
    )
    req = urllib.request.Request(
        f"{API_BASE}/bot{BOT_TOKEN}/sendVoice",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram sendVoice failed HTTP {e.code}: {raw}") from e
    result = json.loads(raw)
    if not result.get("ok"):
        raise RuntimeError(f"Telegram sendVoice failed: {result}")


def send_telegram(chat_id: str, text: str, reply_to_message_id: Optional[int] = None) -> None:
    text = strip_suggested_followups(text) or "(No response.)"
    reply_parameters = (
        {"message_id": reply_to_message_id, "allow_sending_without_reply": True}
        if reply_to_message_id is not None else None
    )
    markdown = telegram_rich_markdown(text) if len(text) <= MAX_RICH_REPLY_CHARS else None
    if markdown is not None and len(markdown) <= MAX_RICH_REPLY_CHARS:
        payload: dict[str, Any] = {"chat_id": chat_id, "rich_message": {"markdown": markdown}}
        if reply_parameters is not None:
            payload["reply_parameters"] = reply_parameters
        try:
            telegram_api("sendRichMessage", payload, timeout=60)
            return
        except TelegramAPIError as e:
            # Only a definite rejection is safe to retry in another format.
            if e.code not in (400, 404):
                raise
            log("Telegram rejected the Rich Message; using standard messages")

    # ponytail: long, unsafe-to-escape, or rejected replies use the existing renderer.
    chunks = chunk_reply(text)
    for idx, chunk in enumerate(chunks, 1):
        if len(chunks) > 1:
            chunk = f"({idx}/{len(chunks)})\n{chunk}"
        payload = {
            "chat_id": chat_id, "text": telegram_html(chunk), "parse_mode": "HTML",
            "link_preview_options": {"is_disabled": True},
        }
        if reply_parameters is not None:
            payload["reply_parameters"] = reply_parameters
        try:
            telegram_api("sendMessage", payload, timeout=60)
        except TelegramAPIError as e:
            if e.code != 400:
                raise
            # Telegram can reject nested entities in the small HTML renderer.
            plain_payload = dict(payload, text=chunk)
            del plain_payload["parse_mode"]
            telegram_api("sendMessage", plain_payload, timeout=60)


def send_telegram_reply(chat_id: str, text: str, reply_to_message_id: Optional[int] = None) -> None:
    try:
        send_telegram(chat_id, text, reply_to_message_id=reply_to_message_id)
    except Exception as e:
        # A timeout can mean Telegram delivered the reply. Do not send another message.
        log(f"Failed to send Telegram reply ({type(e).__name__}); delivery may be unknown")


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
    text = (msg.content or "").encode("utf-16-le", errors="surrogatepass")
    for ent in msg.entities:
        etype = str(ent.get("type", "")).split(".")[-1].lower()
        offset = int(ent.get("offset", -1))
        length = int(ent.get("length", 0))
        if offset < 0 or length <= 0:
            continue
        span = text[offset * 2:(offset + length) * 2].decode("utf-16-le", errors="replace")
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
    # A message that is only the mention strips to ""; should_handle then
    # maps that to "status". Never return the original text here — that
    # would leak the raw mention into the prompt and make the status
    # fallback in should_handle unreachable.
    return re.sub(rf"(?i)@{re.escape(BOT_USERNAME)}\b[,\-:\s]*", "", text).strip()


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
                    # Drop this daemon's own bridge header from Telegram and Shortcut sessions.
                    if text.startswith(("Telegram command from chat", "Telegram voice-note transcript", "Telegram image from chat", "iOS Shortcut voice-note transcript")) and "\n\n" in text:
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


# ---------------------------------------------------------------------------
# Private iOS Shortcut audio endpoint: Action Button -> record -> POST here.
# ---------------------------------------------------------------------------


def parse_multipart(body: bytes, boundary: str) -> dict[str, tuple[Optional[str], bytes]]:
    """Parse multipart/form-data into {field name: (filename or None, bytes)}.

    Deliberately small: shortcut posts carry one text field (`token`) and one
    file field (`file`). The client-chosen random boundary never appears in
    part data, so a plain split is safe.
    """
    delim = b"--" + boundary.encode("utf-8")
    fields: dict[str, tuple[Optional[str], bytes]] = {}
    for chunk in body.split(delim)[1:]:
        if chunk.startswith(b"--"):
            break  # closing delimiter
        if chunk.startswith(b"\r\n"):
            chunk = chunk[2:]
        if chunk.endswith(b"\r\n"):
            chunk = chunk[:-2]
        head, sep, data = chunk.partition(b"\r\n\r\n")
        if not sep:
            continue
        name: Optional[str] = None
        filename: Optional[str] = None
        for line in head.split(b"\r\n"):
            if re.match(rb"(?i)^content-disposition:", line):
                nm = re.search(rb'name="([^"]*)"', line)
                fm = re.search(rb'filename="([^"]*)"', line)
                if nm:
                    name = nm.group(1).decode("utf-8", "replace")
                if fm:
                    filename = fm.group(1).decode("utf-8", "replace") or None
        if name is not None:
            fields[name] = (filename, data)
    return fields


def shortcut_target_chat_id() -> str:
    """Use the only numeric private chat, or refuse an ambiguous target."""
    # ponytail: require one numeric DM; add an explicit target setting for multiple DMs.
    private_chats = [c for c in ALLOWED_CHATS if c.isascii() and c.isdigit() and int(c) > 0]
    return private_chats[0] if len(private_chats) == 1 else ""


def handle_shortcut_audio(pi: "PiRPC", filename: Optional[str], data: bytes) -> None:
    """Transcribe a shortcut voice note, hand it to pi, reply in the chat."""
    chat_id = shortcut_target_chat_id()
    if not chat_id:
        raise RuntimeError("PI_TELEGRAM_ALLOWED_CHATS must contain exactly one numeric private chat id")
    suffix = Path(filename or "note.m4a").suffix or ".m4a"
    fd, tmp_name = tempfile.mkstemp(prefix="shortcut-audio-", suffix=suffix)
    audio_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        provider = configured_voice_provider()
        mime_type = mimetypes.guess_type(audio_path.name)[0] or "audio/mp4"
        if provider == "openai":
            transcript = transcribe_with_openai(audio_path, mime_type)
        else:
            transcript = transcribe_with_command(audio_path, mime_type)
        if SHORTCUT_SEND_TO_TELEGRAM:
            try:
                send_telegram_voice(chat_id, audio_path)
            except Exception as e:
                log(f"Failed to post shortcut voice note to Telegram: {e}")
    finally:
        audio_path.unlink(missing_ok=True)
    if not transcript.strip():
        raise RuntimeError("Transcription came back empty")
    prompt = (
        "iOS Shortcut voice-note transcript from the owner "
        f"at unix timestamp {int(time.time())}:\n\n{transcript}"
    )
    with ChatActionLoop(chat_id):
        reply = pi.ask(prompt, chat_id=chat_id)
    send_telegram_reply(chat_id, reply)


def _run_shortcut_note(pi: "PiRPC", filename: Optional[str], data: bytes) -> None:
    try:
        handle_shortcut_audio(pi, filename, data)
    except Exception as e:
        log(f"Shortcut audio failed: {e}")
        chat_id = shortcut_target_chat_id()
        if chat_id:
            try:
                send_telegram(chat_id, f"Pi shortcut note error: {e}")
            except Exception as send_err:
                log(f"Also failed to send shortcut error over Telegram: {send_err}")


class ShortcutHandler(BaseHTTPRequestHandler):
    server_version = "PiShortcut/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        log(f"shortcut http: {self.client_address[0]} {fmt % args}")

    def _respond(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == SHORTCUT_PATH:
            self._respond(200, {"ok": True, "service": "pi-telegram shortcut endpoint"})
        else:
            self._respond(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path != SHORTCUT_PATH:
            self._respond(404, {"ok": False, "error": "not found"})
            return
        ctype = self.headers.get("Content-Type", "")
        m = re.search(r'boundary="?([^";]+)"?', ctype) if "multipart/form-data" in ctype else None
        if not m:
            self._respond(400, {"ok": False, "error": "expected multipart/form-data"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_AUDIO_BYTES + 1_000_000:
            self._respond(413, {"ok": False, "error": "audio too large"})
            return
        fields = parse_multipart(self.rfile.read(length), m.group(1))
        token = (fields.get("token", (None, b""))[1] or b"").decode("utf-8", "replace").strip()
        if not SHORTCUT_TOKEN or not hmac.compare_digest(token.encode("utf-8"), SHORTCUT_TOKEN.encode("utf-8")):
            log(f"Shortcut endpoint rejected bad token from {self.client_address[0]}")
            self._respond(403, {"ok": False, "error": "bad token"})
            return
        filename, data = fields.get("file", (None, b""))
        if not data:
            self._respond(400, {"ok": False, "error": "missing file field"})
            return
        pi = getattr(self.server, "pi", None)
        if pi is None:
            self._respond(503, {"ok": False, "error": "agent not ready"})
            return
        threading.Thread(target=_run_shortcut_note, args=(pi, filename, data), daemon=True, name="shortcut-note").start()
        self._respond(200, {"ok": True, "bytes": len(data)})


class ShortcutHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], pi: "PiRPC") -> None:
        self.pi = pi
        super().__init__(address, ShortcutHandler)


def start_shortcut_listener(pi: "PiRPC") -> Optional[threading.Thread]:
    """Serve the shortcut audio endpoint. Returns its thread, or None if disabled."""
    if not (SHORTCUT_TOKEN and SHORTCUT_PORT):
        log("Shortcut endpoint disabled (PI_TELEGRAM_SHORTCUT_TOKEN/PORT not set)")
        return None
    try:
        httpd = ShortcutHTTPServer((SHORTCUT_HOST or "0.0.0.0", SHORTCUT_PORT), pi)
    except OSError as e:
        log(f"Shortcut endpoint failed to bind {SHORTCUT_HOST}:{SHORTCUT_PORT}: {e}")
        return None
    t = threading.Thread(target=httpd.serve_forever, daemon=True, name="shortcut-listener")
    t.start()
    log(f"Shortcut audio endpoint on http://{SHORTCUT_HOST or '0.0.0.0'}:{SHORTCUT_PORT}{SHORTCUT_PATH}")
    return t


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


def handle_callback_query(update: dict[str, Any]) -> None:
    """Answer every callback query; old trace buttons are inert but answered."""
    cb = update.get("callback_query") or {}
    cb_id = str(cb.get("id") or "")
    if not cb_id:
        return
    data = str(cb.get("data") or "")
    chat_id = str(((cb.get("message") or {}).get("chat") or {}).get("id") or "")
    payload: dict[str, Any] = {"callback_query_id": cb_id}
    if data.startswith(("d:", "h:")):
        # The Details button is gone; a tap on an old message must not hang.
        payload["text"] = (
            "Trace details are no longer available."
            if chat_id in ALLOWED_CHATS
            else "Not allowed"
        )
    try:
        telegram_api("answerCallbackQuery", payload, timeout=10)
    except Exception as e:
        log(f"Callback answer failed: {e}")


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
    start_shortcut_listener(pi)
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
                if update.get("callback_query"):
                    try:
                        handle_callback_query(update)
                    except Exception as e:
                        log(f"Callback failed: {e}")
                    continue
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
                    send_telegram_reply(msg.chat_id, reply, reply_to_message_id=msg.message_id)
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

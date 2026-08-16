#!/usr/bin/env python3
"""Bridge Telegram bot messages to a long-running pi RPC session.

Default behavior is intentionally conservative:
- Requires PI_TELEGRAM_BOT_TOKEN.
- Only watches configured allowlisted chat IDs/usernames.
- Only allowlisted chats are handled.
- When PI_TELEGRAM_PREFIX is set, only messages with that prefix are sent to pi.
- Replies are sent back to the same Telegram chat.
"""

from __future__ import annotations

import base64
import html
import json
import os
import queue
import mimetypes
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
from pathlib import Path
from typing import Any, Optional

HOME = Path.home()
DEFAULT_STATE = HOME / ".pi/agent/pi-telegram-state.json"
DEFAULT_PI = "pi"
DEFAULT_CWD = HOME / "vault"
DEFAULT_MODEL = "openai-codex/gpt-5.5"

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
GOAL_LABEL_CHARS = int(os.environ.get("PI_TELEGRAM_GOAL_LABEL_CHARS", "80"))
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


def _strip_markdown(text: str) -> str:
    """Remove common markdown emphasis so it doesn't show as literal ** or `.

    Telegram HTML mode doesn't parse markdown, so raw **bold** or `code`
    in thinking text renders as literal asterisks/backticks.
    """
    text = re.sub(r"\*{1,3}([^*\n]+)\*{1,3}", r"\1", text)
    text = re.sub(r"`([^`\n]+)`", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


class ThinkingTreeBuilder:
    """Accumulate a goal→traces tree from RPC streaming events.

    Each turn (work step) produces one goal node. The assistant message's
    text block is the goal label; each thinking block under it is a leaf trace.
    The partial.content array from message_update is cumulative, so we replace
    (not append) on each update.
    """

    def __init__(self) -> None:
        self.goals: list[dict[str, Any]] = []

    def on_turn_start(self) -> None:
        self.goals.append({"label": "working…", "traces": [], "done": False})

    def on_message_update(self, content: list[dict[str, Any]]) -> None:
        if not self.goals:
            self.on_turn_start()
        goal = self.goals[-1]
        label = ""
        traces: list[str] = []
        for block in content:
            bt = block.get("type")
            if bt == "text" and (block.get("text") or "").strip():
                label = block["text"].strip()
            elif bt == "thinking" and (block.get("thinking") or "").strip():
                traces.append(block["thinking"].strip())
        if label:
            goal["label"] = label
            goal["label_derived"] = False
        elif not goal.get("label_derived") and traces:
            goal["label"] = _strip_markdown(traces[0][:GOAL_LABEL_CHARS])
            if len(traces[0]) > GOAL_LABEL_CHARS:
                goal["label"] += "…"
            goal["label_derived"] = True
        goal["traces"] = traces

    def on_turn_end(self) -> None:
        if self.goals:
            self.goals[-1]["done"] = True

    def render(self, elapsed: int) -> str:
        header = f"thinking · 0:{elapsed:02d}"
        lines: list[str] = [header]
        for goal in self.goals:
            marker = "✓" if goal["done"] else "▸"
            label = _strip_markdown(goal["label"])
            lines.append(f"{marker} <b>{html.escape(label)}</b>")
        text = "\n".join(lines)
        if len(text) > MAX_REPLY_CHARS:
            cut = text[:MAX_REPLY_CHARS]
            last_nl = cut.rfind("\n")
            if last_nl > len(header):
                text = cut[:last_nl] + "\n…"
            else:
                text = cut[:-1] + "…"
        return text


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
        if et == "turn_start":
            self.tree.on_turn_start()
            self.dirty = True
        elif et == "message_update":
            ame = ev.get("assistantMessageEvent") or {}
            partial = ame.get("partial") or {}
            content = partial.get("content") or []
            if content:
                self.tree.on_message_update(content)
                self.dirty = True
        elif et == "turn_end":
            self.tree.on_turn_end()
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
        text = self.tree.render(self._elapsed())
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
        text = self.tree.render(self._elapsed())
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

    suffix = Path(file_path).suffix or mimetypes.guess_extension(msg.image_mime_type or "") or ".jpg"
    fd, tmp_name = tempfile.mkstemp(prefix="pi-telegram-image-", suffix=suffix)
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
            key=lambda p: (int(p.get("file_size") or 0), _photo_area(p)),
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

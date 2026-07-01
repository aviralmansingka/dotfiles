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

import json
import os
import queue
import mimetypes
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
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
PROCESS_EXISTING = os.environ.get("PI_TELEGRAM_PROCESS_EXISTING", "0") == "1"
MAX_REPLY_CHARS = int(os.environ.get("PI_TELEGRAM_MAX_REPLY_CHARS", "3900"))
PROMPT_TIMEOUT_SECONDS = int(os.environ.get("PI_TELEGRAM_PROMPT_TIMEOUT_SECONDS", "900"))
POLL_TIMEOUT_SECONDS = int(os.environ.get("PI_TELEGRAM_POLL_TIMEOUT_SECONDS", "50"))
RETRY_SECONDS = float(os.environ.get("PI_TELEGRAM_RETRY_SECONDS", "5"))
TYPING_INTERVAL_SECONDS = float(os.environ.get("PI_TELEGRAM_TYPING_INTERVAL_SECONDS", "4"))

VOICE_TRANSCRIPTION_PROVIDER = os.environ.get("PI_TELEGRAM_VOICE_TRANSCRIPTION_PROVIDER", "auto").strip().lower()
VOICE_TRANSCRIPTION_CMD = os.environ.get("PI_TELEGRAM_VOICE_TRANSCRIPTION_CMD", "").strip()
VOICE_OPENAI_API_KEY = os.environ.get("PI_TELEGRAM_OPENAI_API_KEY", os.environ.get("OPENAI_API_KEY", "")).strip()
VOICE_OPENAI_API_BASE = os.environ.get("PI_TELEGRAM_OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
VOICE_OPENAI_MODEL = os.environ.get("PI_TELEGRAM_OPENAI_TRANSCRIBE_MODEL", "whisper-1").strip()
MAX_AUDIO_BYTES = int(os.environ.get("PI_TELEGRAM_MAX_AUDIO_BYTES", str(20 * 1024 * 1024)))

SYSTEM_PROMPT = """
You are Pi, running headlessly behind the owner's Telegram bot.
The Telegram sender is the owner controlling you remotely.
Be concise by default because replies are delivered as Telegram messages.
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

    def ask(self, message: str) -> str:
        with self.lock:
            request_id = str(uuid.uuid4())
            self._send({"id": request_id, "type": "prompt", "message": message})
            accepted = False
            deadline = time.time() + PROMPT_TIMEOUT_SECONDS
            while time.time() < deadline:
                try:
                    ev = self.lines.get(timeout=1)
                except queue.Empty:
                    if self.proc and self.proc.poll() is not None:
                        raise RuntimeError("pi RPC exited while processing prompt")
                    continue
                self._handle_event(ev)
                if ev.get("type") == "response" and ev.get("id") == request_id:
                    if not ev.get("success"):
                        raise RuntimeError(ev.get("error", "pi rejected prompt"))
                    accepted = True
                if accepted and ev.get("type") == "agent_end":
                    break
            else:
                raise TimeoutError("Timed out waiting for pi to finish")

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


def send_telegram(chat_id: str, text: str, reply_to_message_id: Optional[int] = None) -> None:
    chunks = [text[i : i + MAX_REPLY_CHARS] for i in range(0, len(text), MAX_REPLY_CHARS)] or [""]
    for idx, chunk in enumerate(chunks, 1):
        if len(chunks) > 1:
            chunk = f"({idx}/{len(chunks)})\n{chunk}"
        payload: dict[str, Any] = {"chat_id": chat_id, "text": chunk}
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


def should_handle(msg: IncomingMessage) -> Optional[str]:
    if msg.sender_is_bot:
        return None
    prompt = strip_command_prefix(msg.content or "", is_voice=bool(msg.audio_kind))
    if prompt is None:
        return None

    if not is_allowed(msg):
        log(
            "Ignoring unauthorized Telegram command "
            f"chat_id={msg.chat_id} chat={msg.chat_name!r} username={msg.chat_username!r} sender={msg.sender!r}"
        )
        return None

    return prompt


def main() -> int:
    if not BOT_TOKEN:
        log("PI_TELEGRAM_BOT_TOKEN is required")
        return 1
    if not ALLOWED_CHATS:
        log("PI_TELEGRAM_ALLOWED_CHATS is empty; all Telegram commands will be ignored")
    log(f"Watching Telegram bot updates; allowed chats: {', '.join(sorted(ALLOWED_CHATS)) or '(none)'}; prefix: {PREFIX!r}")

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
                    if prompt.lower() in {"status", "ping"}:
                        reply = pi.status()
                    elif prompt.lower() in {"reset", "new", "new session"}:
                        reply = pi.new_session()
                    else:
                        source_note = "Telegram voice-note transcript" if msg.audio_kind else "Telegram command"
                        full_prompt = (
                            f"{source_note} from chat {msg.chat_name or msg.chat_id} "
                            f"by {msg.sender} at unix timestamp {msg.timestamp}:\n\n{prompt}"
                        )
                        with ChatActionLoop(msg.chat_id):
                            reply = pi.ask(full_prompt)
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

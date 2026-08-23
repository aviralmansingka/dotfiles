#!/usr/bin/env python3
"""Bridge WhatsApp messages to a long-running pi RPC session.

Default behavior is intentionally conservative:
- Only watches the configured allowlisted chat(s).
- Only text messages prefixed with !bot are sent to pi.
- Voice notes are transcribed locally and sent to pi only if they contain an avirus wake word.
- Replies are sent back to the same WhatsApp chat.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import queue
import re
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

HOME = Path.home()
DEFAULT_DB = HOME / "projects/whatsapp-mcp/whatsapp-bridge/store/messages.db"
DEFAULT_STATE = HOME / ".pi/agent/pi-whatsapp-state.json"
DEFAULT_PI = HOME / ".nvm/versions/node/v22.22.3/bin/pi"
DEFAULT_CWD = HOME / "vault"

DB_PATH = Path(os.environ.get("PI_WHATSAPP_DB", str(DEFAULT_DB)))
STATE_PATH = Path(os.environ.get("PI_WHATSAPP_STATE", str(DEFAULT_STATE)))
PI_BIN = os.environ.get("PI_WHATSAPP_PI_BIN", str(DEFAULT_PI))
PI_CWD = os.environ.get("PI_WHATSAPP_CWD", str(DEFAULT_CWD))
API_BASE = os.environ.get("PI_WHATSAPP_API_BASE", "http://127.0.0.1:8765/api")
TRANSCRIBE_BIN = Path(os.environ.get("PI_WHATSAPP_TRANSCRIBE_BIN", str(HOME / "dotfiles/pi/bin/pi-telegram-transcribe.py")))
PREFIX = os.environ.get("PI_WHATSAPP_PREFIX", "!bot")
CHAT_PREFIXES_RAW = os.environ.get("PI_WHATSAPP_CHAT_PREFIXES", "")
POLL_SECONDS = float(os.environ.get("PI_WHATSAPP_POLL_SECONDS", "2"))
OWN_CHAT = os.environ.get("PI_WHATSAPP_OWN_CHAT", "17654143800@s.whatsapp.net")
ALLOWED_CHATS = {
    x.strip() for x in os.environ.get("PI_WHATSAPP_ALLOWED_CHATS", OWN_CHAT).split(",") if x.strip()
}


def parse_chat_prefixes(raw: str) -> dict[str, str]:
    prefixes: dict[str, str] = {}
    for item in raw.split(","):
        item = item.strip()
        if not item or ":" not in item:
            continue
        chat_jid, prefix = item.split(":", 1)
        chat_jid = chat_jid.strip()
        prefix = prefix.strip()
        if chat_jid and prefix:
            prefixes[chat_jid] = prefix
    return prefixes


CHAT_PREFIXES = parse_chat_prefixes(CHAT_PREFIXES_RAW)
PROCESS_EXISTING = os.environ.get("PI_WHATSAPP_PROCESS_EXISTING", "0") == "1"
MAX_REPLY_CHARS = int(os.environ.get("PI_WHATSAPP_MAX_REPLY_CHARS", "3500"))
PROMPT_TIMEOUT_SECONDS = int(os.environ.get("PI_WHATSAPP_PROMPT_TIMEOUT_SECONDS", "900"))
RESPONSE_PREFIX = os.environ.get("PI_WHATSAPP_RESPONSE_PREFIX", "").strip()
VOICE_ENABLED = os.environ.get("PI_WHATSAPP_VOICE_ENABLED", "1") == "1"
VOICE_SEND_ERRORS = os.environ.get("PI_WHATSAPP_VOICE_SEND_ERRORS", "0") == "1"
VOICE_ALLOWED_CHATS = {
    x.strip()
    for x in os.environ.get("PI_WHATSAPP_VOICE_ALLOWED_CHATS", "").split(",")
    if x.strip()
}
VOICE_TRIGGER_PATTERNS = [
    re.compile(r"(?i)(?:^|\b)!?avirus\b"),
    re.compile(r"(?i)\ba\s+virus\b"),
    re.compile(r"(?i)\bof\s+virus\b"),
    re.compile(r"(?i)\bor\s+virus\b"),
    re.compile(r"(?i)\baviral\b"),
    re.compile(r"(?i)\ba\s+v\s+i\s+r\s+u\s+s\b"),
    re.compile(r"(?i)\ba\s+(?:v|vee)\s+(?:i|eye)\s+(?:r|are)\s+(?:u|you)\s+(?:s|ess)\b"),
    re.compile(r"(?i)\bif\s+me\s+i\s+are\s+you\s+s\b"),
]

SYSTEM_PROMPT = """
You are Pi, running headlessly behind Aviral's WhatsApp.
The WhatsApp sender is an allowlisted person using Aviral's WhatsApp bridge.
Be concise by default because replies are delivered as WhatsApp messages.
Use local tools carefully. Do not expose secrets, credentials, private system details, or unrelated private vault/WhatsApp data unless the request is clearly authorized and necessary.
Do not send WhatsApp messages to other people or groups unless the sender explicitly asks you to send an exact message to an exact recipient.
If a requested action is risky or ambiguous, ask a clarifying question instead of guessing.
""".strip()


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


@dataclass
class IncomingMessage:
    rowid: int
    message_id: str
    chat_jid: str
    chat_name: str
    sender: str
    is_from_me: bool
    timestamp: str
    content: str
    media_type: str


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
        env["PATH"] = f"{HOME}/.nvm/versions/node/v22.22.3/bin:{HOME}/.local/bin:" + env.get("PATH", "")
        args = [
            PI_BIN,
            "--mode",
            "rpc",
            "--name",
            "whatsapp-daemon",
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
            return (
                "Pi WhatsApp bridge is running.\n"
                f"Model: {model.get('provider', '?')}/{model.get('id', '?')}\n"
                f"Session: {data.get('sessionName') or data.get('sessionId')}\n"
                f"Streaming: {data.get('isStreaming')}"
            )


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


def get_max_rowid() -> int:
    if not DB_PATH.exists():
        return 0
    con = sqlite3.connect(DB_PATH)
    try:
        row = con.execute("SELECT COALESCE(MAX(rowid), 0) FROM messages").fetchone()
        return int(row[0] or 0)
    finally:
        con.close()


def fetch_messages(after_rowid: int) -> list[IncomingMessage]:
    if not DB_PATH.exists():
        return []
    con = sqlite3.connect(DB_PATH)
    try:
        rows = con.execute(
            """
            SELECT messages.rowid, messages.id, messages.chat_jid, COALESCE(chats.name, ''),
                   messages.sender, messages.is_from_me, messages.timestamp, COALESCE(messages.content, ''),
                   COALESCE(messages.media_type, '')
            FROM messages
            LEFT JOIN chats ON chats.jid = messages.chat_jid
            WHERE messages.rowid > ?
            ORDER BY messages.rowid ASC
            """,
            (after_rowid,),
        ).fetchall()
        return [IncomingMessage(*row) for row in rows]
    finally:
        con.close()


def send_whatsapp(recipient: str, text: str) -> None:
    chunks = [text[i : i + MAX_REPLY_CHARS] for i in range(0, len(text), MAX_REPLY_CHARS)] or [""]
    for idx, chunk in enumerate(chunks, 1):
        if len(chunks) > 1:
            chunk = f"({idx}/{len(chunks)})\n{chunk}"
        if RESPONSE_PREFIX:
            chunk = f"{RESPONSE_PREFIX} {chunk}".rstrip()
        payload = json.dumps({"recipient": recipient, "message": chunk}).encode("utf-8")
        req = urllib.request.Request(
            f"{API_BASE}/send",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            if resp.status != 200:
                raise RuntimeError(f"WhatsApp send failed HTTP {resp.status}: {body}")


def is_allowed_chat(msg: IncomingMessage) -> bool:
    return not ALLOWED_CHATS or msg.chat_jid in ALLOWED_CHATS


def should_handle(msg: IncomingMessage) -> Optional[str]:
    if not is_allowed_chat(msg):
        return None
    content = (msg.content or "").strip()
    if not content:
        return None
    prefix = CHAT_PREFIXES.get(msg.chat_jid, PREFIX)
    lower = content.lower()
    pfx = prefix.lower()
    if lower == pfx:
        return "status"
    if lower.startswith(pfx + " "):
        return content[len(prefix) :].strip()
    return None


def voice_has_trigger(transcript: str) -> bool:
    return any(pattern.search(transcript) for pattern in VOICE_TRIGGER_PATTERNS)


def should_try_voice(msg: IncomingMessage) -> bool:
    voice_chat_allowed = not VOICE_ALLOWED_CHATS or msg.chat_jid in VOICE_ALLOWED_CHATS
    return VOICE_ENABLED and is_allowed_chat(msg) and voice_chat_allowed and (msg.media_type or "").lower() == "audio"


def decrypt_media_from_db(message_id: str, chat_jid: str) -> Path:
    """Fallback downloader for cases where whatsmeow's /download gets a 403.

    WhatsApp media URLs are encrypted. The local message DB has the media key and
    hashes, so we can fetch the encrypted blob directly and decrypt it locally.
    """
    con = sqlite3.connect(DB_PATH)
    try:
        row = con.execute(
            """
            SELECT media_type, filename, url, media_key, file_sha256, file_enc_sha256
            FROM messages
            WHERE id = ? AND chat_jid = ?
            """,
            (message_id, chat_jid),
        ).fetchone()
    finally:
        con.close()
    if not row:
        raise FileNotFoundError(f"media message not found in DB: {chat_jid}:{message_id}")

    media_type, filename, url, media_key, file_sha256, file_enc_sha256 = row
    if not url or not media_key:
        raise RuntimeError("media row is missing url or media key")
    info_by_type = {
        "image": b"WhatsApp Image Keys",
        "video": b"WhatsApp Video Keys",
        "audio": b"WhatsApp Audio Keys",
        "document": b"WhatsApp Document Keys",
    }
    info = info_by_type.get((media_type or "").lower())
    if not info:
        raise RuntimeError(f"unsupported media type for fallback decrypt: {media_type}")

    req = urllib.request.Request(str(url), headers={"User-Agent": "WhatsApp/2.23.20.0"})
    encrypted = urllib.request.urlopen(req, timeout=120).read()
    if file_enc_sha256 and hashlib.sha256(encrypted).digest() != file_enc_sha256:
        raise RuntimeError("encrypted media hash mismatch")

    keys = HKDF(
        algorithm=hashes.SHA256(),
        length=112,
        salt=None,
        info=info,
        backend=default_backend(),
    ).derive(media_key)
    iv, cipher_key, mac_key = keys[:16], keys[16:48], keys[48:80]
    ciphertext, mac = encrypted[:-10], encrypted[-10:]
    expected_mac = hmac.new(mac_key, iv + ciphertext, hashlib.sha256).digest()[:10]
    if not hmac.compare_digest(mac, expected_mac):
        raise RuntimeError("encrypted media MAC mismatch")

    decryptor = Cipher(algorithms.AES(cipher_key), modes.CBC(iv), backend=default_backend()).decryptor()
    plaintext = decryptor.update(ciphertext) + decryptor.finalize()
    pad = plaintext[-1]
    if 1 <= pad <= 16 and plaintext.endswith(bytes([pad]) * pad):
        plaintext = plaintext[:-pad]
    if file_sha256 and hashlib.sha256(plaintext).digest() != file_sha256:
        raise RuntimeError("decrypted media hash mismatch")

    suffix = Path(filename or "audio.ogg").suffix or ".ogg"
    fd, tmp_name = tempfile.mkstemp(prefix="pi-whatsapp-media-", suffix=suffix)
    os.close(fd)
    path = Path(tmp_name)
    path.write_bytes(plaintext)
    return path


def download_media(message_id: str, chat_jid: str) -> Path:
    payload = json.dumps({"message_id": message_id, "chat_jid": chat_jid}).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}/download",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            if resp.status != 200:
                raise RuntimeError(f"WhatsApp media download failed HTTP {resp.status}: {body}")
        result = json.loads(body)
        if not result.get("success") or not result.get("path"):
            raise RuntimeError(result.get("message") or f"WhatsApp media download failed: {result}")
        path = Path(result["path"])
        if not path.exists():
            raise FileNotFoundError(f"WhatsApp media download path missing: {path}")
        return path
    except Exception as exc:
        log(f"WhatsApp API media download failed; trying direct decrypt fallback: {exc}")
        return decrypt_media_from_db(message_id, chat_jid)


def transcribe_voice(audio_path: Path) -> str:
    env = os.environ.copy()
    env.setdefault("PI_TELEGRAM_WHISPER_MODEL", "Systran/faster-whisper-base.en")
    env.setdefault("PI_TELEGRAM_WHISPER_FALLBACK_MODEL", "Systran/faster-whisper-base.en")
    env.setdefault("PI_TELEGRAM_WHISPER_DEVICE", "cpu")
    env.setdefault("PI_TELEGRAM_WHISPER_COMPUTE_TYPE", "int8")
    env.setdefault("PI_TELEGRAM_WHISPER_LANGUAGE", "en")
    env.setdefault("HF_HUB_OFFLINE", "1")
    proc = subprocess.run(
        [str(TRANSCRIBE_BIN), str(audio_path)],
        text=True,
        capture_output=True,
        timeout=300,
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "voice transcription failed")
    return proc.stdout.strip()


def handle_voice_prompt(pi: PiRPC, msg: IncomingMessage) -> None:
    audio_path = download_media(msg.message_id, msg.chat_jid)
    transcript = transcribe_voice(audio_path)
    log(f"Voice transcript chat={msg.chat_jid} rowid={msg.rowid}: {transcript[:500]!r}")
    if not transcript or not voice_has_trigger(transcript):
        log(f"Ignoring voice note without avirus wake word chat={msg.chat_jid} rowid={msg.rowid}")
        return
    full_prompt = (
        f"WhatsApp voice-note command from chat {msg.chat_name or msg.chat_jid} "
        f"at {msg.timestamp}. The full transcript is below. Treat it as the user prompt; "
        "the wake word was only used to route it to you.\n\n"
        f"{transcript}"
    )
    reply = pi.ask(full_prompt)
    send_whatsapp(msg.chat_jid, reply)


def main() -> int:
    log(f"Watching WhatsApp DB: {DB_PATH}")
    prefix_summary = ", ".join(f"{chat}={prefix!r}" for chat, prefix in sorted(CHAT_PREFIXES.items()))
    log(
        f"Allowed chats: {', '.join(sorted(ALLOWED_CHATS)) or '(all)'}; "
        f"prefix: {PREFIX!r}; chat prefixes: {prefix_summary or '(none)'}"
    )
    state = load_state()
    if "last_rowid" not in state:
        state["last_rowid"] = 0 if PROCESS_EXISTING else get_max_rowid()
        save_state(state)
        log(f"Initialized last_rowid={state['last_rowid']}")

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
            last_rowid = int(state.get("last_rowid", 0))
            for msg in fetch_messages(last_rowid):
                state["last_rowid"] = max(int(state.get("last_rowid", 0)), msg.rowid)
                save_state(state)
                prompt = should_handle(msg)
                if prompt is None and not should_try_voice(msg):
                    continue
                try:
                    if prompt is not None:
                        log(f"Handling WhatsApp command from chat={msg.chat_jid} rowid={msg.rowid}: {prompt[:120]!r}")
                        if prompt.lower() in {"status", "ping"}:
                            reply = pi.status()
                        elif prompt.lower() in {"reset", "new", "new session"}:
                            reply = pi.new_session()
                        else:
                            full_prompt = (
                                f"WhatsApp command from chat {msg.chat_name or msg.chat_jid} "
                                f"at {msg.timestamp}:\n\n{prompt}"
                            )
                            reply = pi.ask(full_prompt)
                        send_whatsapp(msg.chat_jid, reply)
                    else:
                        log(f"Checking WhatsApp voice note from chat={msg.chat_jid} rowid={msg.rowid}")
                        handle_voice_prompt(pi, msg)
                except Exception as e:
                    log(f"Command failed: {e}")
                    if prompt is not None or VOICE_SEND_ERRORS:
                        try:
                            send_whatsapp(msg.chat_jid, f"Pi bridge error: {e}")
                        except Exception as send_err:
                            log(f"Also failed to send error over WhatsApp: {send_err}")
            time.sleep(POLL_SECONDS)
        except Exception as e:
            log(f"Loop error: {e}")
            time.sleep(5)

    pi.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

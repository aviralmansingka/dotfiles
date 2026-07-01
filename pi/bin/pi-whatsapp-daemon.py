#!/usr/bin/env python3
"""Bridge WhatsApp messages to a long-running pi RPC session.

Default behavior is intentionally conservative:
- Only watches the configured allowlisted chat(s).
- Only messages prefixed with !pi are sent to pi.
- Replies are sent back to the same WhatsApp chat.
"""

from __future__ import annotations

import json
import os
import queue
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

HOME = Path.home()
DEFAULT_DB = HOME / "projects/whatsapp-mcp/whatsapp-bridge/store/messages.db"
DEFAULT_STATE = HOME / ".pi/agent/pi-whatsapp-state.json"
DEFAULT_PI = "pi"
DEFAULT_CWD = HOME / "vault"

DB_PATH = Path(os.environ.get("PI_WHATSAPP_DB", str(DEFAULT_DB)))
STATE_PATH = Path(os.environ.get("PI_WHATSAPP_STATE", str(DEFAULT_STATE)))
PI_BIN = os.environ.get("PI_WHATSAPP_PI_BIN", str(DEFAULT_PI))
PI_CWD = os.environ.get("PI_WHATSAPP_CWD", str(DEFAULT_CWD))
API_BASE = os.environ.get("PI_WHATSAPP_API_BASE", "http://127.0.0.1:8765/api")
PREFIX = os.environ.get("PI_WHATSAPP_PREFIX", "!pi")
POLL_SECONDS = float(os.environ.get("PI_WHATSAPP_POLL_SECONDS", "2"))
OWN_CHAT = os.environ.get("PI_WHATSAPP_OWN_CHAT", "")
ALLOWED_CHATS = {
    x.strip() for x in os.environ.get("PI_WHATSAPP_ALLOWED_CHATS", OWN_CHAT).split(",") if x.strip()
}
PROCESS_EXISTING = os.environ.get("PI_WHATSAPP_PROCESS_EXISTING", "0") == "1"
MAX_REPLY_CHARS = int(os.environ.get("PI_WHATSAPP_MAX_REPLY_CHARS", "3500"))
PROMPT_TIMEOUT_SECONDS = int(os.environ.get("PI_WHATSAPP_PROMPT_TIMEOUT_SECONDS", "900"))

SYSTEM_PROMPT = """
You are Pi, running headlessly behind the owner's WhatsApp.
The WhatsApp sender is the owner controlling you remotely.
Be concise by default because replies are delivered as WhatsApp messages.
You may use local tools to help the owner, but do not send WhatsApp messages to other people or groups unless the owner explicitly asks you to send an exact message to an exact recipient.
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
                   messages.sender, messages.is_from_me, messages.timestamp, COALESCE(messages.content, '')
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


def should_handle(msg: IncomingMessage) -> Optional[str]:
    if not ALLOWED_CHATS:
        return None
    if msg.chat_jid not in ALLOWED_CHATS:
        return None
    content = (msg.content or "").strip()
    if not content:
        return None
    lower = content.lower()
    pfx = PREFIX.lower()
    if lower == pfx:
        return "status"
    if lower.startswith(pfx + " "):
        return content[len(PREFIX) :].strip()
    return None


def main() -> int:
    log(f"Watching WhatsApp DB: {DB_PATH}")
    log(f"Allowed chats: {', '.join(sorted(ALLOWED_CHATS)) or '(all)'}; prefix: {PREFIX!r}")
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
                if prompt is None:
                    continue
                log(f"Handling WhatsApp command from chat={msg.chat_jid} rowid={msg.rowid}: {prompt[:120]!r}")
                try:
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
                except Exception as e:
                    log(f"Command failed: {e}")
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

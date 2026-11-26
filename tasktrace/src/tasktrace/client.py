"""Talk to the collector over its unix socket."""

from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any, Mapping

from .schema import Event, SchemaError, build


class ClientError(RuntimeError):
    """The collector is not listening, or refused the line."""


def _connect(path: Path, timeout: float) -> socket.socket:
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(timeout)
    try:
        conn.connect(str(path))
    except (FileNotFoundError, ConnectionRefusedError, OSError) as exc:
        conn.close()
        raise ClientError(f"cannot reach collector at {path}: {exc}") from exc
    return conn


class Client:
    """One connection, many lines.  Reconnects once when the server restarted."""

    def __init__(self, socket_path: Path | str, timeout: float = 2.0) -> None:
        self.socket_path = Path(socket_path)
        self.timeout = timeout
        self._conn: socket.socket | None = None
        self._buffer = b""

    def connect(self) -> "Client":
        self._conn = _connect(self.socket_path, self.timeout)
        self._buffer = b""
        return self

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
        self._buffer = b""

    def __enter__(self) -> "Client":
        return self.connect()

    def __exit__(self, *exc: object) -> None:
        self.close()

    def send_line(self, event: Event | Mapping[str, Any] | str) -> dict[str, Any]:
        if isinstance(event, Event):
            line = event.line()
        elif isinstance(event, str):
            line = event
        elif isinstance(event, Mapping):
            line = build(event).line()
        else:  # pragma: no cover - defensive
            raise SchemaError("send_line takes an Event, a mapping or a JSON string")
        if not line.endswith("\n"):
            line += "\n"  # the wire protocol is one newline terminated line per event
        if self._conn is None:
            self.connect()
        assert self._conn is not None
        try:
            self._conn.sendall(line.encode())
            return self._read_answer()
        except (BrokenPipeError, ConnectionResetError, OSError):
            self.close()
            raise ClientError("collector connection dropped")

    def _read_answer(self) -> dict[str, Any]:
        assert self._conn is not None
        while b"\n" not in self._buffer:
            chunk = self._conn.recv(4096)
            if not chunk:
                self.close()
                raise ClientError("collector closed the connection without an answer")
            self._buffer += chunk
        head, _, self._buffer = self._buffer.partition(b"\n")
        return json.loads(head.decode())


def send(event: Event | Mapping[str, Any], socket_path: Path | str) -> dict[str, Any]:
    with Client(socket_path) as client:
        return client.send_line(event)

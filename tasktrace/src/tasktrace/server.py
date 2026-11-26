"""Unix socket server: one JSON line in, one span row out."""

from __future__ import annotations

import json
import os
import socketserver
import threading
from pathlib import Path

from .schema import SchemaError, build, now_mono, now_ts
from .store import DEFAULT_HOME, Store


def default_socket(home: Path | str = DEFAULT_HOME) -> Path:
    return Path(home) / "sock"


class _Handler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        # A plain recv/send loop: socketserver's buffered rfile can sit on a
        # small line until the peer closes, which turns every hook into a two
        # second stall.  recv returns as soon as a line is complete.
        buffer = b""
        while True:
            chunk = self.request.recv(65536)
            if not chunk:
                return
            buffer += chunk
            while b"\n" in buffer:
                head, _, buffer = buffer.partition(b"\n")
                line = head.strip()
                if not line:
                    continue
                try:
                    answer = self.server.record(line.decode("utf-8", "replace"))  # type: ignore[attr-defined]
                except SchemaError as exc:
                    answer = {"ok": False, "error": str(exc)}
                try:
                    self.request.sendall(
                        (json.dumps(answer, separators=(",", ":")) + "\n").encode()
                    )
                except OSError:
                    return  # the emitter left without waiting for the ack


class _Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True

    def __init__(self, socket_path: Path, store: Store) -> None:
        self.store = store
        super().__init__(str(socket_path), _Handler)

    def record(self, line: str) -> dict:
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SchemaError(f"not JSON: {exc}") from exc
        event = build(payload, ts=now_ts(), mono=now_mono())
        span_id = self.store.append(event)
        return {"ok": True, "id": span_id, "kind": event.kind}


class Collector:
    """Owns the socket file, the accept loop thread and the store."""

    def __init__(
        self,
        home: Path | str = DEFAULT_HOME,
        socket_path: Path | str | None = None,
    ) -> None:
        self.home = Path(home)
        self.home.mkdir(parents=True, exist_ok=True)
        self.socket_path = Path(socket_path) if socket_path else default_socket(self.home)
        self.store = Store(self.home)
        self._server: _Server | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> "Collector":
        if self.socket_path.exists():
            # A previous run died without unlinking; the path is ours by construction.
            self.socket_path.unlink()
        self.socket_path.parent.mkdir(parents=True, exist_ok=True)
        self._server = _Server(self.socket_path, self.store)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="tasktrace-accept",
            daemon=True,
        )
        self._thread.start()
        return self

    def serve_forever(self) -> None:
        """Run the accept loop on the calling thread (used by `tasktrace serve`)."""
        self.start()
        assert self._thread is not None
        try:
            self._thread.join()
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        try:
            self.socket_path.unlink()
        except FileNotFoundError:
            pass
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2)
        self._thread = None

    def __enter__(self) -> "Collector":
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.stop()
        self.store.close()


def socket_path_from_env(home: Path | str | None = None) -> Path:
    explicit = os.environ.get("TASKTRACE_SOCK")
    if explicit:
        return Path(explicit)
    return default_socket(Path(home) if home else DEFAULT_HOME)

#!/usr/bin/env python3
"""Authenticated faster-whisper HTTP worker for the dedicated STT VM."""

from __future__ import annotations

import hmac
import mimetypes
import os
import stat
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


LISTEN_HOST = os.environ.get("PI_STT_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("PI_STT_PORT", "8767"))
TOKENS_FILE = Path(os.environ.get("PI_STT_TOKENS_FILE", str(Path.home() / ".config/pi-stt-tokens")))
MAX_AUDIO_BYTES = int(os.environ.get("PI_STT_MAX_AUDIO_BYTES", str(20 * 1024 * 1024)))
MODEL_NAME = os.environ.get("PI_STT_MODEL", "large-v3-turbo")
MODEL_DEVICE = os.environ.get("PI_STT_DEVICE", "cuda")
MODEL_COMPUTE_TYPE = os.environ.get("PI_STT_COMPUTE_TYPE", "float16")
MODEL_LANGUAGE = os.environ.get("PI_STT_LANGUAGE", "en") or None


def load_tokens(path: Path) -> dict[str, str]:
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise RuntimeError(f"{path} must not be readable by group or others")

    tokens: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        client_id, separator, token = line.partition(":")
        if not separator or not client_id.strip() or len(token.strip()) < 32:
            raise RuntimeError(f"invalid token entry at {path}:{line_number}")
        if token.strip() in tokens.values():
            raise RuntimeError(f"duplicate token at {path}:{line_number}")
        tokens[client_id.strip()] = token.strip()
    if not tokens:
        raise RuntimeError(f"no STT client tokens configured in {path}")
    return tokens


def authenticate(header: str, tokens: dict[str, str]) -> str:
    scheme, separator, candidate = header.partition(" ")
    if not separator or scheme.lower() != "bearer" or not candidate:
        return ""
    for client_id, expected in tokens.items():
        if hmac.compare_digest(candidate, expected):
            return client_id
    return ""


def load_model() -> Any:
    from faster_whisper import WhisperModel

    return WhisperModel(MODEL_NAME, device=MODEL_DEVICE, compute_type=MODEL_COMPUTE_TYPE)


def make_server(host: str, port: int, model: Any, tokens: dict[str, str]) -> ThreadingHTTPServer:
    # ponytail: one GPU lock is enough until measured demand requires per-device scheduling.
    inference_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "pi-stt"

        def log_message(self, fmt: str, *args: Any) -> None:
            print(f"stt http: {fmt % args}", flush=True)

        def send_text(self, status: HTTPStatus, message: str) -> None:
            body = message.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/healthz":
                self.send_text(HTTPStatus.OK, "ok")
            else:
                self.send_text(HTTPStatus.NOT_FOUND, "not found")

        def do_POST(self) -> None:
            if self.path != "/transcribe":
                self.send_text(HTTPStatus.NOT_FOUND, "not found")
                return

            authorization = self.headers.get("Authorization", "")
            if not authorization:
                self.send_text(HTTPStatus.UNAUTHORIZED, "missing bearer token")
                return
            client_id = authenticate(authorization, tokens)
            if not client_id:
                self.send_text(HTTPStatus.FORBIDDEN, "invalid bearer token")
                return

            try:
                content_length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                content_length = 0
            if content_length <= 0:
                self.send_text(HTTPStatus.LENGTH_REQUIRED, "Content-Length is required")
                return
            if content_length > MAX_AUDIO_BYTES:
                self.send_text(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, f"audio exceeds {MAX_AUDIO_BYTES} bytes")
                return

            audio = self.rfile.read(content_length)
            if len(audio) != content_length:
                self.send_text(HTTPStatus.BAD_REQUEST, "incomplete audio body")
                return

            content_type = self.headers.get("Content-Type", "audio/ogg").split(";", 1)[0]
            suffix = mimetypes.guess_extension(content_type) or ".audio"
            tmp_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(prefix="pi-stt-", suffix=suffix, delete=False) as tmp:
                    tmp.write(audio)
                    tmp_path = Path(tmp.name)
                print(f"transcribing client={client_id} bytes={content_length}", flush=True)
                with inference_lock:
                    segments, _info = model.transcribe(
                        str(tmp_path),
                        language=MODEL_LANGUAGE,
                        vad_filter=True,
                        beam_size=5,
                    )
                    transcript = " ".join(
                        segment.text.strip() for segment in segments if segment.text.strip()
                    ).strip()
                if not transcript:
                    self.send_text(HTTPStatus.UNPROCESSABLE_ENTITY, "no speech detected")
                    return
                self.send_text(HTTPStatus.OK, transcript)
            except Exception as error:
                print(f"transcription failed client={client_id}: {error}", flush=True)
                self.send_text(HTTPStatus.INTERNAL_SERVER_ERROR, "transcription failed")
            finally:
                if tmp_path is not None:
                    tmp_path.unlink(missing_ok=True)

    return ThreadingHTTPServer((host, port), Handler)


def main() -> int:
    tokens = load_tokens(TOKENS_FILE)
    model = load_model()
    server = make_server(LISTEN_HOST, LISTEN_PORT, model, tokens)
    print(
        f"STT worker listening on {LISTEN_HOST}:{LISTEN_PORT}; "
        f"model={MODEL_NAME} device={MODEL_DEVICE} clients={','.join(sorted(tokens))}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

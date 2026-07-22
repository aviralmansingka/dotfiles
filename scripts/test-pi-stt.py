#!/usr/bin/env python3
"""Small end-to-end check for the Pi STT worker and client."""

from __future__ import annotations

import importlib.util
import os
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load("pi_stt_worker", ROOT / "pi/bin/pi-stt-worker.py")
client = load("pi_stt_client", ROOT / "pi/bin/pi-stt-client.py")


class Segment:
    text = " authenticated transcription "


class Model:
    def transcribe(self, _path: str, **_kwargs):
        return [Segment()], None


def status(url: str, token: str = "") -> int:
    headers = {"Content-Type": "audio/ogg"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=b"fake audio", headers=headers, method="POST")
    try:
        urllib.request.urlopen(request)
    except urllib.error.HTTPError as error:
        return error.code
    return 200


def main() -> int:
    token = "a" * 32
    with tempfile.NamedTemporaryFile(mode="w", delete=False) as token_file:
        token_file.write(f"aviral:{token}\n")
        token_path = Path(token_file.name)
    try:
        os.chmod(token_path, 0o600)
        assert worker.load_tokens(token_path) == {"aviral": token}
        os.chmod(token_path, 0o644)
        try:
            worker.load_tokens(token_path)
        except RuntimeError:
            pass
        else:
            raise AssertionError("world-readable token file was accepted")
    finally:
        token_path.unlink()

    server = worker.make_server("127.0.0.1", 0, Model(), {"aviral": token})
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/transcribe"
    try:
        assert status(url) == 401
        assert status(url, "b" * 32) == 403
        with tempfile.NamedTemporaryFile(suffix=".ogg") as audio:
            audio.write(b"fake audio")
            audio.flush()
            assert client.transcribe(Path(audio.name), url, token) == "authenticated transcription"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print("pi-stt: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

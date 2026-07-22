#!/usr/bin/env python3
"""Send one audio file to the authenticated Pi STT worker."""

from __future__ import annotations

import mimetypes
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def transcribe(audio_path: Path, url: str, token: str, timeout: int = 300) -> str:
    if not token:
        raise RuntimeError("PI_STT_TOKEN is required")
    request = urllib.request.Request(
        url,
        data=audio_path.read_bytes(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            transcript = response.read().decode("utf-8", errors="replace").strip()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"STT worker returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"STT worker request failed: {error.reason}") from error
    if not transcript:
        raise RuntimeError("STT worker returned an empty transcript")
    return transcript


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: pi-stt-client.py <audio-file>", file=sys.stderr)
        return 2
    audio_path = Path(sys.argv[1])
    if not audio_path.is_file():
        print(f"audio file not found: {audio_path}", file=sys.stderr)
        return 2

    try:
        print(
            transcribe(
                audio_path,
                os.environ.get("PI_STT_URL", "http://127.0.0.1:8767/transcribe"),
                os.environ.get("PI_STT_TOKEN", ""),
                int(os.environ.get("PI_STT_TIMEOUT_SECONDS", "300")),
            )
        )
    except Exception as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

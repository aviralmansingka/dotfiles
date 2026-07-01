#!/home/avirus/.local/share/pi-telegram-voice/.venv/bin/python
"""Transcribe Telegram voice notes for pi-telegram-daemon.

This script is intentionally small and dependency-light. It uses faster-whisper
from a dedicated venv under ~/.local/share/pi-telegram-voice and prints only the
transcript to stdout so the Telegram bridge can pass it to Pi.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: pi-telegram-transcribe.py <audio-file>", file=sys.stderr)
        return 2

    audio_path = Path(sys.argv[1])
    if not audio_path.exists():
        print(f"audio file not found: {audio_path}", file=sys.stderr)
        return 2

    model_name = os.environ.get("PI_TELEGRAM_WHISPER_MODEL", "base.en")
    device = os.environ.get("PI_TELEGRAM_WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("PI_TELEGRAM_WHISPER_COMPUTE_TYPE", "int8")
    language = os.environ.get("PI_TELEGRAM_WHISPER_LANGUAGE", "en") or None

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )
    transcript = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    if not transcript:
        print("no speech detected", file=sys.stderr)
        return 1
    print(transcript)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

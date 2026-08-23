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


def transcribe_once(audio_path: Path, *, model_name: str, device: str, compute_type: str, language: str | None) -> str:
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )
    # faster-whisper does most of the actual inference while this generator is
    # consumed, so CUDA failures can happen here rather than during model init.
    return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()


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

    try:
        transcript = transcribe_once(
            audio_path,
            model_name=model_name,
            device=device,
            compute_type=compute_type,
            language=language,
        )
    except Exception as e:
        if device.lower() != "cuda":
            raise
        print(f"CUDA transcription failed, falling back to CPU: {e}", file=sys.stderr)
        transcript = transcribe_once(
            audio_path,
            model_name=model_name,
            device="cpu",
            compute_type="int8",
            language=language,
        )
    if not transcript:
        print("no speech detected", file=sys.stderr)
        return 1
    print(transcript)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

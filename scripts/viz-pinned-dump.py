#!/usr/bin/env python3
# Paths: scripts/viz-pinned-dump.py scripts/viz-evidence.sh docs/visualize-eval/**
"""Print a rataflow `--frames` dump at an exact terminal size, without a pane.

The app measures the terminal it runs in, so a dump at exactly 77x47 (the eval's
pinned pane) is the fit proof: a drawing that fits prints its header with no
`canvas WxH` extent, and one that does not fit prints the extent and a drag-to-pan
badge. A half pane's size follows the tab, which no worker controls, so this
helper runs the binary under a pty of the requested size and prints its stdout.

Usage:
  scripts/viz-pinned-dump.py --bin /abs/rataflow-view --spec SPEC.json \\
      --cols 77 --rows 47 --frames 120 [--step-ms 100] [--select-all]

Rows are the ROWS the app sees: the app prints `viewport: <cols>x<rows>`, so pass
the viewport you want to prove (77x47), not the pane including its border.
"""

from __future__ import annotations

import argparse
import fcntl
import os
import pty
import struct
import sys
import termios


def run(binary: str, argv: list[str], cols: int, rows: int) -> tuple[int, bytes]:
    pid, fd = pty.fork()
    if pid == 0:  # child
        try:
            os.execv(binary, [binary] + argv)
        except OSError as error:  # pragma: no cover - exec failure path
            os.write(2, f"viz-pinned-dump: cannot exec {binary}: {error}\n".encode())
            os._exit(127)
    # The window size must be set before the child measures it; the pty starts
    # at the parent's size, and the app reads it on startup, so a child that
    # measured early would report the wrong size. Set it immediately and again
    # after the first read, which is what makes the recorded `viewport:` line
    # match the request in practice.
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    data = b""
    try:
        while True:
            chunk = os.read(fd, 1 << 16)
            if not chunk:
                break
            data += chunk
    except OSError:
        pass
    _, status = os.waitpid(pid, 0)
    return status, data


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bin", required=True, help="absolute rataflow-view path")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--cols", type=int, default=77)
    parser.add_argument("--rows", type=int, default=47)
    parser.add_argument("--frames", type=int, default=12)
    parser.add_argument("--step-ms", type=int, default=100)
    parser.add_argument("--select-all", action="store_true")
    args = parser.parse_args(argv)

    app_argv = ["--frames", str(args.frames), "--step-ms", str(args.step_ms)]
    if args.select_all:
        app_argv.append("--select-all")
    app_argv.append(args.spec)
    status, data = run(args.bin, app_argv, args.cols, args.rows)
    # A pty hands back CRLF; the dump is a plain-text file and the recorded
    # `viewport:` line has to match the validator's anchored pattern exactly.
    text = data.decode("utf-8", errors="replace").replace("\r\n", "\n")
    text = text.replace("\r", "").replace("\x1b", "")
    if not text.strip():
        print("viz-pinned-dump: the app printed nothing; no dump written", file=sys.stderr)
        return 1
    sys.stdout.write(text)
    # A dump whose own header is not the requested size cannot prove anything,
    # so say so loudly instead of letting it look like a pin.
    wanted = f"viewport: {args.cols}x{args.rows} zoom: "
    if wanted not in text:
        print(
            f"viz-pinned-dump: warning: the dump does not report {wanted!r}; "
            "the pty size did not reach the app",
            file=sys.stderr,
        )
        return 2
    return 0 if status == 0 else status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

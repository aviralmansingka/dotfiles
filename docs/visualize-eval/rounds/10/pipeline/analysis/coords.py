# Locate claim coordinates (1-based col,row) in one rataflow plain-text capture.
# Usage: uv run coords.py CAPTURE.txt [--glyphs ●▼╭] [--needle verify]
import argparse
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--glyphs", default="\u25cf\u25bc")
    ap.add_argument("--needles", default="CLI,API gateway,Auth,Job queue,Worker pool,Postgres,verify,enqueue,read,write,+ [+]")
    args = ap.parse_args()
    rows = open(args.capture, encoding="utf-8", errors="replace").read().splitlines()
    for y, row in enumerate(rows, start=1):
        hits = []
        for ch in args.glyphs:
            start = 0
            while True:
                x = row.find(ch, start)
                if x < 0:
                    break
                hits.append(f"{ch}@{x + 1},{y}")
                start = x + 1
        for needle in args.needles.split(","):
            if needle and needle in row:
                hits.append(f"{needle!r}@{row.find(needle) + 1},{y}")
        if hits:
            print(" ".join(hits))
    return 0


if __name__ == "__main__":
    sys.exit(main())

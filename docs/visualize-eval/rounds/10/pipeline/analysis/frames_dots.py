# Parse rataflow --frames dumps: dot cells per frame, per-frame advance, lap proof.
# Usage: uv run frames_dots.py FRAMES.txt [--json OUT.json]
import argparse
import json
import re
import sys

DOT = "\u25cf"


def parse(path):
    frames = {}
    cur = None
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            m = re.match(r"^frame (\d+) at (\d+)ms$", line)
            if m:
                cur = int(m.group(1))
                frames[cur] = {"ms": int(m.group(2)), "rows": []}
                continue
            if cur is not None:
                frames[cur]["rows"].append(line)
    return frames


def dots(frame):
    out = []
    for y, row in enumerate(frame["rows"], start=1):
        for x, ch in enumerate(row, start=1):
            if ch == DOT:
                out.append((x, y))
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames")
    ap.add_argument("--json")
    args = ap.parse_args()
    frames = parse(args.frames)
    order = sorted(frames)
    table = []
    for idx in order:
        table.append({"frame": idx, "ms": frames[idx]["ms"], "dots": dots(frames[idx])})
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(table, fh, indent=1)
    print(f"frames parsed: {len(table)}")
    counts = sorted({len(t['dots']) for t in table})
    print(f"dot counts across frames: {counts}")
    for t in table[:6] + table[-3:]:
        print(f"  frame {t['frame']:>2} {t['ms']:>5}ms dots={t['dots']}")


if __name__ == "__main__":
    sys.exit(main())

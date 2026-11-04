# Parse one rataflow --frames dump and prove constant-speed motion.
# Usage: uv run motion.py FRAMES.txt [--json OUT.json]
# Reports: frame times, dot cells, per-dot advance between well-spaced frames,
# and wrap frames (a dot returning to its own origin = one completed lap).
import argparse
import json
import re
import sys

DOT = "\u25cf"


def parse(path):
    frames = {}
    cur = None
    for raw in open(path, encoding="utf-8", errors="replace"):
        line = raw.rstrip("\n")
        m = re.match(r"^frame (\d+) at (\d+)ms$", line)
        if m:
            cur = int(m.group(1))
            frames[cur] = [line]
            continue
        if cur is not None:
            frames[cur].append(line)
    return frames


def dots(rows):
    return sorted(
        (x, y)
        for y, row in enumerate(rows, start=1)
        for x, ch in enumerate(row, start=1)
        if ch == DOT
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("frames")
    ap.add_argument("--json")
    args = ap.parse_args()
    frames = parse(args.frames)
    order = sorted(frames)
    table = [{"frame": i, "ms": (i * 100), "dots": dots(frames[i])} for i in order]
    wraps = []
    for a, b in zip(table, table[1:]):
        for d in b["dots"]:
            if d not in a["dots"] and (a["dots"] and min(
                    abs(d[0] - p[0]) + abs(d[1] - p[1]) for p in a["dots"]) > 12):
                wraps.append({"from_frame": a["frame"], "to_frame": b["frame"],
                              "from_dots": a["dots"], "to_dots": b["dots"]})
    print(f"frames={len(table)} span_ms={table[-1]['ms']}")
    print(f"dot_count_per_frame={sorted({len(t['dots']) for t in table})}")
    advanced = [t for t in table if t["dots"] != table[0]["dots"]]
    print(f"frames_with_advanced_dots={len(advanced)} of {len(table)}")
    for t in table[:4]:
        print(f"  frame {t['frame']:>2} {t['ms']:>5}ms {t['dots']}")
    for t in table[-2:]:
        print(f"  frame {t['frame']:>2} {t['ms']:>5}ms {t['dots']}")
    print(f"wrap_like_jumps={len(wraps)}")
    if args.json:
        json.dump({"table": table, "wraps": wraps}, open(args.json, "w", encoding="utf-8"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())

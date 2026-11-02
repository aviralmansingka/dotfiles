#!/usr/bin/env -S uv run --no-project python
"""List node rects and every arrow/dot glyph (1-based line/col) for a pane capture."""
import re, sys

SGR = re.compile(r"\x1b\[([0-9;]*)m")


def grid(path):
    rows = []
    for line in open(path, encoding="utf-8", errors="replace").read().split("\n"):
        plain = SGR.sub("", line.rstrip("\r"))
        rows.append(plain)
    return rows


def main(path):
    rows = grid(path)
    print(f"# {path}  lines={len(rows)} cols={max(len(r) for r in rows)}")
    for y, r in enumerate(rows, 1):
        for x, ch in enumerate(r, 1):
            if ch == "╭":
                # find the matching box by scanning outward
                right = r.find("╮", x)
                if right < 0 or set(r[x:right]) != {"─"}:
                    continue
                bottom = None
                for y2 in range(y, len(rows)):
                    if y2 - 1 < len(rows) and len(rows[y2 - 1]) >= x and rows[y2 - 1][x - 1] == "╰":
                        bottom = y2
                        break
                label = rows[y][x:right] if y < len(rows) else ""
                print(f"node  {label.strip()!r:24} lines {y}-{bottom or '?'} cols {x}-{right + 1}")
    for y, r in enumerate(rows, 1):
        for x, ch in enumerate(r, 1):
            if ch in "▼▲◀▶●":
                ctx = r[max(0, x - 4):x + 4]
                print(f"glyph {ch} at line {y:2} col {x:2}   context: {ctx!r}")


main(sys.argv[1])

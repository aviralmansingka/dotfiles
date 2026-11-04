#!/usr/bin/env python3
"""Minimal ANSI screen-grid parser for `herdr pane read --format ansi` captures.

Usage:
  ansi_grid.py <capture.ansi> [--json]

Builds a grid of cells (char, fg, bold) and prints either a color map summary
(cell counts per fg color) or JSON with per-row runs, plus a helper `--diff old new`
mode that lists cells whose (char, fg, bold) changed between two captures.
"""
import json
import re
import sys

SGR = re.compile(r"\x1b\[([0-9;]*)m")
CSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def parse(path):
    data = open(path, encoding="utf-8", errors="replace").read()
    rows = []
    fg = None
    bold = False
    row = []

    def push_line():
        rows.append(list(row))
        row.clear()

    i = 0
    while i < len(data):
        ch = data[i]
        if ch == "\x1b":
            m = SGR.match(data, i)
            if m:
                params = [p for p in m.group(1).split(";") if p != ""]
                if not params or params == ["0"]:
                    fg = None
                    bold = False
                else:
                    k = 0
                    while k < len(params):
                        p = params[k]
                        if p == "1":
                            bold = True
                        elif p == "0":
                            fg = None
                            bold = False
                        elif p == "38" and params[k + 1] == "2":
                            fg = "rgb({},{},{})".format(*[int(x) for x in params[k + 2:k + 5]])
                            k += 4
                        elif p == "48" and params[k + 1] == "2":
                            k += 4
                        k += 1
                i = m.end()
                continue
            m = CSI.match(data, i)
            if m:
                i = m.end()
                continue
            i += 1
            continue
        if ch == "\r":
            i += 1
            continue
        if ch == "\n":
            push_line()
            i += 1
            continue
        row.append((ch, fg, bold))
        i += 1
    if row:
        push_line()
    return rows


def as_text(rows):
    return "\n".join("".join(c[0] for c in r) for r in rows)


def diff(a, b):
    out = []
    for r in range(max(len(a), len(b))):
        ra = a[r] if r < len(a) else []
        rb = b[r] if r < len(b) else []
        for c in range(max(len(ra), len(rb))):
            ca = ra[c] if c < len(ra) else None
            cb = rb[c] if c < len(rb) else None
            if ca != cb:
                out.append({
                    "row": r + 1,
                    "col": c + 1,
                    "before": {"char": ca[0], "fg": ca[1], "bold": ca[2]} if ca else None,
                    "after": {"char": cb[0], "fg": cb[1], "bold": cb[2]} if cb else None,
                })
    return out


def main(argv):
    if len(argv) >= 4 and argv[1] == "--diff":
        a = parse(argv[2])
        b = parse(argv[3])
        print(json.dumps(diff(a, b), indent=1))
        return 0
    rows = parse(argv[1])
    if "--json" in argv:
        print(json.dumps([[list(c) for c in r] for r in rows]))
        return 0
    print(as_text(rows))
    counts = {}
    for r in rows:
        for ch, fg, bold in r:
            if ch.strip():
                counts[(fg, bold)] = counts.get((fg, bold), 0) + 1
    print("\n# non-space cells per (fg,bold):")
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"#  {v:5d}  {k}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

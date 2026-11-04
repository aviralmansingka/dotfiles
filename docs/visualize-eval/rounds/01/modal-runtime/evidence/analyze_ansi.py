#!/usr/bin/env -S uv run --no-project python
"""Analyze a rataflow-view ANSI capture: box completeness, border colors,
arrowhead placement, and dot collisions. Evidence only; no renderer changes."""

import re
import sys
from collections import defaultdict

SGR = re.compile(r"\x1b\[([0-9;]*)m")
BOX = set("╭╮╰╯─│")


def parse(path):
    """Return rows of (char, fg) cells for a pane ANSI capture."""
    data = open(path, encoding="utf-8", errors="replace").read()
    grid, fg = [], "default"
    for line in data.split("\n"):
        row, i = [], 0
        while i < len(line):
            m = SGR.match(line, i)
            if m:
                params = [p for p in m.group(1).split(";") if p != ""]
                for j, p in enumerate(params):
                    if p == "38" and params[j + 1] == "2":
                        fg = "#%02x%02x%02x" % tuple(int(x) for x in params[j + 2:j + 5])
                i = m.end()
                continue
            row.append((line[i], fg))
            i += 1
        grid.append(row)
    return grid


def boxes(grid):
    """Group box-drawing border cells into rectangular boxes."""
    seen, found = set(), []
    for y, row in enumerate(grid):
        for x, (ch, _) in enumerate(row):
            if ch != "╭" or (x, y) in seen:
                continue
            # walk right along the top border
            x2 = x + 1
            while x2 < len(row) and row[x2][0] == "─":
                x2 += 1
            if x2 >= len(row) or row[x2][0] != "╮":
                continue
            y2 = y + 1
            while y2 < len(grid) and grid[y2][x][0] == "│":
                y2 += 1
            if y2 >= len(grid) or grid[y2][x][0] != "╰":
                continue
            cells = [(cx, y) for cx in range(x, x2 + 1)] + \
                    [(cx, y2) for cx in range(x, x2 + 1)] + \
                    [(x, cy) for cy in range(y, y2 + 1)] + \
                    [(x2, cy) for cy in range(y, y2 + 1)]
            found.append({"x": x, "y": y, "x2": x2, "y2": y2, "cells": cells,
                          "label": "".join(c for c, _ in grid[y + 1][x + 1:x2])})
            seen.update(cells)
    return found


def main(path):
    grid = parse(path)
    bs = boxes(grid)
    print(f"file: {path}")
    print(f"grid: {max(len(r) for r in grid)}x{len(grid)}")
    print(f"boxes: {len(bs)}")
    for b in sorted(bs, key=lambda b: (b["y"], b["x"])):
        colours = defaultdict(int)
        for cx, cy in b["cells"]:
            colours[grid[cy][cx][1]] += 1
        w, h = b["x2"] - b["x"] + 1, b["y2"] - b["y"] + 1
        print(f"  box {b['label']!r:24} at ({b['x']:2},{b['y']:2}) {w}x{h} "
              f"border-colours={dict(colours)}")

    arrows = defaultdict(list)
    for y, row in enumerate(grid):
        for x, (ch, _) in enumerate(row):
            if ch in "▼▲◀▶":
                arrows[ch].append((x, y))
                # arrow glyph must not sit on a node border or touch a word
                col = grid[y][x][1]
                if ch in "▼▲" and x + 1 < len(row) and row[x + 1][0].isalnum():
                    print(f"  DEFECT arrow at ({x},{y}) touches word: "
                          f"'{row[x][0]}{row[x+1][0]}'")
                if ch in "◀▶" and x + 1 < len(row) and row[x + 1][0].isalpha():
                    print(f"  DEFECT arrow at ({x},{y}) touches word")
    print(f"arrows: { {k: len(v) for k, v in arrows.items()} }")
    border_cells = {c: True for b in bs for c in b["cells"]}
    for y, row in enumerate(grid):
        for x, (ch, _) in enumerate(row):
            if ch == "●" and (x, y) in border_cells:
                print(f"  DEFECT dot on border at ({x},{y})")
    print("dot glyphs:", sum(1 for r in grid for c, _ in r if c == "●"))
    print("overflow badge:", any("overflows" in "".join(c for c, _ in r) for r in grid))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p)
        print()

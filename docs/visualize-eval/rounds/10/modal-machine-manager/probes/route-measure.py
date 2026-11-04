#!/usr/bin/env python3
# Paths: docs/visualize-eval/rounds/10/modal-machine-manager/
"""Measure drawn route lengths from a single rataflow-view frame dump.

Boxes are found structurally (a `╭─…─╮` top border with the matching
`╰─…─╯` below it). Everything else drawn with route glyphs is a route cell.
BFS from the route cells that touch a box (start ports) reports the longest
distance to an arrowhead cell, which is the longest route's cell count and
therefore sets the required frame count: ceil(cells / 0.5).
"""
from __future__ import annotations

import collections
import re
import sys

ROUTE = set("│─╮╰╭╯┼├┤┬┴┌┐└┘●")
HEADS = set("▲▼◀▶")
FRAME = re.compile(r"^frame (\d+) at (\d+)ms$")
TOP = re.compile(r"╭─+╮")


def find_boxes(g, h, w):
    boxes = []
    for r in range(h):
        line = "".join(g[r])
        for m in TOP.finditer(line):
            x0, x1 = m.start(), m.end() - 1
            for r2 in range(r + 1, min(h, r + 8)):
                if len(g[r2]) > x1 and g[r2][x0] == "╰" and g[r2][x1] == "╯":
                    boxes.append((r, r2, x0, x1))
                    break
    return boxes


def main(path: str) -> int:
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    start = 0
    for i, line in enumerate(lines):
        if FRAME.match(line):
            start = i + 1
    grid = lines[start:]
    h = len(grid)
    w = max((len(l) for l in grid), default=0)
    g = [list(l.ljust(w)) for l in grid]

    boxes = find_boxes(g, h, w)
    boxcells = set()
    for (y0, y1, x0, x1) in boxes:
        for r in range(y0, y1 + 1):
            for c in range(x0, x1 + 1):
                boxcells.add((r, c))

    route = {
        (r, c)
        for r in range(h)
        for c in range(w)
        if (g[r][c] in ROUTE or g[r][c] in HEADS) and (r, c) not in boxcells
    }
    heads = {c for c in route if g[c[0]][c[1]] in HEADS}
    starts = {
        c
        for c in route
        if c not in heads
        and any((c[0] + dr, c[1] + dc) in boxcells
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    }

    dist: dict[tuple[int, int], int] = {}
    q = collections.deque()
    for s in starts:
        dist[s] = 0
        q.append(s)
    while q:
        cr, cc = q.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = cr + dr, cc + dc
            if (nr, nc) in route and (nr, nc) not in dist:
                dist[(nr, nc)] = dist[(cr, cc)] + 1
                q.append((nr, nc))

    print(f"boxes={len(boxes)} route_cells={len(route)} starts={len(starts)} heads={len(heads)}")
    vals = []
    for cell in sorted(heads):
        d = dist.get(cell)
        vals.append((d, cell))
    for d, cell in sorted(vals, reverse=True):
        print(f"head at {cell} cells_from_port={'unreachable' if d is None else d + 1}")
    ok = [d + 1 for d, _ in vals if d is not None]
    if ok:
        print(f"LONGEST_ROUTE_CELLS={max(ok)}  frames_needed={2 * max(ok)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))

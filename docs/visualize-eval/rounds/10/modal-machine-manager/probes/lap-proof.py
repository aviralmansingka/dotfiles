#!/usr/bin/env python3
# Paths: docs/visualize-eval/rounds/10/modal-machine-manager/
"""Prove dot laps from a pinned rateflow frames dump.

Route cells are the connected components of drawn route glyphs outside the node
boxes; the node boxes are found structurally from their `╭─…─╮` top border. For
every component the script reports its cell count (the route length) and how
many of those cells a dot was seen on across the captured frames. A route whose
dot completes a lap shows visited == cells.
"""
from __future__ import annotations

import collections
import re
import sys

ROUTE = set("│─╮╰╭╯┼├┤┬┴┌┐└┘●")
HEADS = set("▲▼◀▶")
FRAME = re.compile(r"^frame (\d+) at (\d+)ms$")
TOP = re.compile(r"╭─+╮")


def parse(path):
    frames, cur, row = {}, None, -1
    for line in open(path, encoding="utf-8", errors="replace"):
        m = FRAME.match(line)
        if m:
            cur = int(m.group(1))
            frames[cur] = []
            row = -1
            continue
        row += 1
        if cur is None:
            continue
        frames[cur].append(line.rstrip("\n"))
    return frames


def boxes_of(grid):
    h = len(grid)
    w = max((len(l) for l in grid), default=0)
    g = [list(l.ljust(w)) for l in grid]
    boxes = []
    for r in range(h):
        for m in TOP.finditer("".join(g[r])):
            x0, x1 = m.start(), m.end() - 1
            for r2 in range(r + 1, min(h, r + 8)):
                if len(g[r2]) > x1 and g[r2][x0] == "╰" and g[r2][x1] == "╯":
                    boxes.append((r, r2, x0, x1))
                    break
    return g, boxes


def main(path: str) -> int:
    frames = parse(path)
    idx = sorted(frames)
    g, boxes = boxes_of(frames[idx[0]])
    h, w = len(g), len(g[0])
    boxcells = set()
    for (y0, y1, x0, x1) in boxes:
        for r in range(y0, y1 + 1):
            for c in range(x0, x1 + 1):
                boxcells.add((r, c))

    grids = {}
    for i in idx:
        gg, _ = boxes_of([l for l in frames[i]])
        width = max((len(l) for l in frames[i]), default=0)
        grids[i] = [list(l.ljust(width)) for l in frames[i]]

    first = grids[idx[0]]
    route = set()
    for r in range(min(h, len(first))):
        for c in range(min(w, len(first[r]))):
            ch = first[r][c]
            if (ch in ROUTE or ch in HEADS) and (r, c) not in boxcells:
                route.add((r, c))

    comps = []
    seen = set()
    for cell in sorted(route):
        if cell in seen:
            continue
        q = collections.deque([cell])
        seen.add(cell)
        comp = {cell}
        while q:
            cr, cc = q.popleft()
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (cr + dr, cc + dc)
                if n in route and n not in seen:
                    seen.add(n)
                    comp.add(n)
                    q.append(n)
        comps.append(comp)

    visited = {i: set() for i in range(len(comps))}
    for i in idx:
        for r, row in enumerate(grids[i]):
            for c, ch in enumerate(row):
                if ch == "\u25cf":
                    for k, comp in enumerate(comps):
                        if (r, c) in comp:
                            visited[k].add((r, c))

    print(f"frames={len(idx)} (first {idx[0]}, last {idx[-1]})  route_components={len(comps)}")
    cells = []
    full = 0
    for k, comp in enumerate(comps):
        heads = sum(1 for c in comp if first[c[0]][c[1]] in HEADS)
        cov = len(visited[k])
        cells.append(len(comp))
        if cov >= len(comp):
            full += 1
        print(f"  route {k}: cells={len(comp):3d} heads={heads} dot_cells_seen={cov:3d} "
              f"coverage={'FULL' if cov >= len(comp) else 'partial'}")
    print(f"LONGEST_ROUTE_CELLS={max(cells)}  frames_required={2 * max(cells)}  "
          f"routes_with_full_lap={full}/{len(comps)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))

#!/usr/bin/env python3
# Paths: docs/visualize-eval/rounds/10/modal-machine-manager/
"""Measure route lengths from a rataflow-view --frames dump.

Dots advance 0.5 cells per 100 ms step in constant mode, so the frame index at
which a dot returns to a cell it already occupied gives that route's length.
Reports per-dot distinct-cell counts and detected lap indices.
"""
from __future__ import annotations

import re
import sys

FRAME_RE = re.compile(r"^frame (\d+) at (\d+)ms$")


def parse(text: str) -> list[list[tuple[int, int]]]:
    frames: list[list[tuple[int, int]]] = []
    cur: list[tuple[int, int]] | None = None
    row = -1
    for line in text.splitlines():
        if FRAME_RE.match(line):
            cur = []
            frames.append(cur)
            row = -1
            continue
        row += 1
        if cur is None:
            continue
        for col, ch in enumerate(line):
            if ch == "\u25cf":  # ●
                cur.append((row, col))
    return frames


def main(path: str) -> int:
    frames = parse(open(path, encoding="utf-8", errors="replace").read())
    if not frames:
        print("no frames parsed")
        return 1
    n = len(frames)
    print(f"frames={n}")
    # Track dots by nearest-continuation across frames.
    tracks: list[list[tuple[int, int, int]]] = []  # (frame, row, col)
    for idx, pts in enumerate(frames):
        used: set[int] = set()
        for (r, c) in pts:
            best, bestd = None, None
            for t in tracks:
                pr, pc, _ = t[-1][1], t[-1][2], t[-1][0]
                d = abs(pr - r) + abs(pc - c)
                if d <= 2 and (bestd is None or d < bestd):
                    best, bestd = t, d
            if best is None:
                tracks.append([(idx, r, c)])
            else:
                best.append((idx, r, c))
            used.add((r, c))
    print(f"tracks={len(tracks)}")
    lens = []
    for i, t in enumerate(tracks):
        cells = [(r, c) for _, r, c in t]
        distinct = len(set(cells))
        # lap: first frame whose cell equals the track's first cell after moving away
        first = cells[0]
        lap = None
        moved = False
        for j, cell in enumerate(cells[1:], start=1):
            if cell != first:
                moved = True
            elif moved:
                lap = t[j][0]
                break
        lens.append((distinct, lap, t[0][0], t[-1][0], len(t)))
    lens.sort(key=lambda x: (x[0], -(x[1] if x[1] is not None else 10**9)), reverse=True)
    for distinct, lap, f0, fl, seen in lens:
        print(f"track distinct_cells={distinct:3d} lap_frame={lap} "
              f"first={f0} last={fl} sightings={seen}")
    print(f"MAX distinct_cells={max(x[0] for x in lens)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))

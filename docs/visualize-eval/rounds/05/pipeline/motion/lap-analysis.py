#!/usr/bin/env python3
"""Derive dot laps from a pinned COLUMNS=77 LINES=47 `--frames` dump.

Prints the U+25CF dot cells per frame (1-based inside the frame block, so the
header line is row 1), then for each frame-0 dot cell the frames at which a dot
sits on that same cell again. Consecutive frames collapse to one observation
because a 0.5 cells/100 ms dot needs two steps to advance one cell, so
`lap_frames = 2 * route_cells` and `ceil(route_cells * 2)` frames cover a lap.
"""
import re
import sys

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines()
frames, cur = {}, None
for line in lines:
    m = re.match(r"^frame (\d+) at (\d+)ms$", line)
    if m:
        cur = int(m.group(1))
        frames[cur] = []
    elif cur is not None:
        frames[cur].append(line)


def dots(i):
    return [(r + 1, c + 1) for r, line in enumerate(frames[i])
            for c, ch in enumerate(line) if ch == "\u25cf"]


print(f"dump: {path}")
print(f"frames: {len(frames)}, rows per frame: {len(frames[0])}")
for i in sorted(frames):
    cells = dots(i)
    print(f"frame {i:2d} ({i * 100:4d}ms) dots={len(cells)} {cells}")

print()
print("lap per frame-0 dot cell (collapsed runs of identical cells first):")
laps = []
for cell in dots(0):
    seen = [i for i in sorted(frames) if cell in dots(i)]
    kept = []
    for i in seen:
        if not kept or i - kept[-1] >= 2:
            kept.append(i)
    gaps = [b - a for a, b in zip(kept, kept[1:])]
    lap = min(gaps) if gaps else None
    if lap:
        laps.append(lap)
        print(f"  origin {cell}: observed {seen} -> collapsed {kept} "
              f"-> lap {lap} frames = {lap // 2} route cells")
    else:
        print(f"  origin {cell}: observed {seen} -> no lap inside this dump")
longest = max(laps)
print(f"longest lap: {longest} frames = longest route of {longest // 2} cells; "
      f"required frames ceil({longest // 2} * 2) = {longest}; "
      f"this dump has {len(frames)} frames (0..{max(frames)})")

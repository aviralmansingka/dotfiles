#!/usr/bin/env python3
# Paths: docs/visualize-eval/rounds/10/modal-machine-manager/
"""Compare dot cells between two frames of a pinned frames dump (constant mode)."""
import re, sys
FRAME = re.compile(r"^frame (\d+) at (\d+)ms$")
def frames(path):
    out = {}
    cur = None; row = -1
    for line in open(path, encoding="utf-8", errors="replace"):
        if FRAME.match(line):
            cur = int(FRAME.match(line).group(1)); out[cur] = []
            row = -1; continue
        row += 1
        if cur is None: continue
        for col, ch in enumerate(line.rstrip("\n")):
            if ch == "\u25cf":
                out[cur].append((row, col))
    return out
path, f0, f1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
fr = frames(path)
a, b = fr.get(f0, []), fr.get(f1, [])
print(f"frame {f0}: {len(a)} dots {sorted(a)}")
print(f"frame {f1}: {len(b)} dots {sorted(b)}")
dists = []
for p in sorted(a):
    best = min(b, key=lambda q: abs(p[0]-q[0]) + abs(p[1]-q[1])) if b else None
    if best:
        dists.append((abs(p[0]-best[0]) + abs(p[1]-best[1]), p, best))
print("manhattan moves:", sorted(d[0] for d in dists))
for d in sorted(dists):
    print(f"  {d[1]} -> {d[2]}  manhattan={d[0]}")

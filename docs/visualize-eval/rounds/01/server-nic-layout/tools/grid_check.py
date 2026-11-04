"""Structural checks over a plain-text capture of rataflow-view.

Reports:
  * boxes found (label, rect)
  * arrowheads and the cell they point into (must be a box border)
  * stems: border cells with a route glyph on the outside (source stems)
  * suspicious glyphs: route/arrow glyphs inside a box interior, or a box
    border cell that is not a border glyph

Usage: uv run python grid_check.py <capture.text.txt>
"""

import re
import sys

BOX_CHARS = set("╭╮╰╯─│")
ARROWS = {"▼": (0, 1), "▲": (0, -1), "▶": (1, 0), "◀": (-1, 0)}
ROUTE = set("╭╮╰╯─│▼▲▶◀●")


def load(path):
    return [list(line.rstrip("\n")) for line in open(path, encoding="utf-8")]


def boxes(grid):
    out = []
    for y, row in enumerate(grid):
        text = "".join(row)
        for m in re.finditer("╭─+╮", text):
            x0, x1 = m.start(), m.end() - 1
            yy = y + 1
            while yy < len(grid) and "".join(grid[yy])[x0] != "╰":
                yy += 1
            label = " / ".join(
                "".join(grid[k][x0 + 1:x1]).strip() for k in range(y + 1, yy)
            ).strip()
            out.append({"label": label, "y0": y, "y1": yy, "x0": x0, "x1": x1})
    return out


def border_cells(b):
    cells = {(b["y0"], x) for x in range(b["x0"], b["x1"] + 1)}
    cells |= {(b["y1"], x) for x in range(b["x0"], b["x1"] + 1)}
    cells |= {(y, b["x0"]) for y in range(b["y0"], b["y1"] + 1)}
    cells |= {(y, b["x1"]) for y in range(b["y0"], b["y1"] + 1)}
    return cells


def at(grid, y, x):
    if 0 <= y < len(grid) and 0 <= x < len(grid[y]):
        return grid[y][x]
    return " "


def main():
    grid = load(sys.argv[1])
    bs = boxes(grid)
    print("boxes:")
    for b in bs:
        print(f"  {b['label']!r:26} rows {b['y0']+1}-{b['y1']+1} cols {b['x0']+1}-{b['x1']+1}")
    borders = {}
    for b in bs:
        for c in border_cells(b):
            borders[c] = b["label"]

    print("\narrowheads:")
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch in ARROWS:
                dx, dy = ARROWS[ch]
                ty, tx = y + dy, x + dx
                target = borders.get((ty, tx))
                verdict = f"into {target!r}" if target else f"NOT a border (cell={at(grid, ty, tx)!r})"
                print(f"  ▼ at row {y+1} col {x+1} -> {verdict}")

    print("\nstems (route glyph touching a box side):")
    for b in bs:
        for x in range(b["x0"] + 1, b["x1"]):
            below, above = at(grid, b["y1"] + 1, x), at(grid, b["y0"] - 1, x)
            if below in "│●":
                print(f"  from {b['label']!r} bottom col {x+1}: {below!r}")
            if above in "│●":
                print(f"  into {b['label']!r} top    col {x+1}: {above!r}")
        for y in range(b["y0"] + 1, b["y1"]):
            right, left = at(grid, y, b["x1"] + 1), at(grid, y, b["x0"] - 1)
            if right in "│●":
                print(f"  from {b['label']!r} right row {y+1}: {right!r}")
            if left in "│●":
                print(f"  into {b['label']!r} left  row {y+1}: {left!r}")

    print("\ninterior sanitation:")
    bad = 0
    for b in bs:
        for y in range(b["y0"] + 1, b["y1"]):
            for x in range(b["x0"] + 1, b["x1"]):
                ch = grid[y][x]
                if ch in ROUTE:
                    print(f"  route glyph {ch!r} inside {b['label']!r} at row {y+1} col {x+1}")
                    bad += 1
    for b in bs:
        for (y, x) in border_cells(b):
            pass
    print(f"  {bad} interior glyph problems")

    print("\nborder glyph sanity:")
    problems = 0
    for b in bs:
        for x in range(b["x0"] + 1, b["x1"]):
            for y in (b["y0"], b["y1"]):
                ch = grid[y][x]
                if ch != "─":
                    print(f"  {b['label']!r} horizontal border row {y+1} col {x+1} = {ch!r}")
                    problems += 1
        for y in range(b["y0"] + 1, b["y1"]):
            for x in (b["x0"], b["x1"]):
                ch = grid[y][x]
                if ch != "│":
                    print(f"  {b['label']!r} vertical border row {y+1} col {x+1} = {ch!r}")
                    problems += 1
        corners = [grid[b["y0"]][b["x0"]], grid[b["y0"]][b["x1"]],
                   grid[b["y1"]][b["x0"]], grid[b["y1"]][b["x1"]]]
        if corners != ["╭", "╮", "╰", "╯"]:
            print(f"  {b['label']!r} corners = {corners}")
            problems += 1
    print(f"  {problems} border problems")


if __name__ == "__main__":
    main()

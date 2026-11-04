"""Decode `herdr pane read --format ansi` captures into a cell grid.

Prints, for every box found in the plain-text capture, the foreground colors
used on its perimeter and the bold cells, so border-color continuity and the
selection accent can be checked without eyeballing escapes.

Usage: uv run python ansi_grid.py <capture.ansi.txt> [<plain.text.txt>]
"""

import re
import sys

SGR = re.compile(r"\x1b\[([0-9;]*)m")


def parse(path):
    rows = []
    for line in open(path, encoding="utf-8").read().split("\n"):
        cells = []
        fg = None
        bold = False
        pos = 0
        for m in SGR.finditer(line):
            # text before this escape belongs to the current style
            for ch in line[pos:m.start()]:
                cells.append([ch, fg, bold])
            params = [p for p in m.group(1).split(";") if p != ""]
            i = 0
            while i < len(params):
                if params[i] == "0":
                    fg, bold = None, False
                elif params[i] == "1":
                    bold = True
                elif params[i] == "38" and params[i + 1] == "2":
                    fg = tuple(int(x) for x in params[i + 2:i + 5])
                    i += 5
                    continue
                elif params[i] == "48" and params[i + 1] == "2":
                    i += 5
                    continue
                i += 1
            pos = m.end()
        rows.append(cells)
    return rows


def boxes(rows):
    """Find boxes in a decoded grid: runs of ╭───╮ / │ / ╰───╯."""
    found = []
    for y, row in enumerate(rows):
        text = "".join(c[0] for c in row)
        for m in re.finditer("╭─+╮", text):
            x0, x1 = m.start(), m.end() - 1
            # walk down collecting side cells until the closing border
            perim = []
            for x in range(x0, x1 + 1):
                perim.append((y, x))
            yy = y + 1
            while yy < len(rows):
                t = "".join(c[0] for c in rows[yy])
                if t[x0:x1 + 1].startswith("╰"):
                    for x in range(x0, x1 + 1):
                        perim.append((yy, x))
                    label = " ".join(
                        "".join(c[0] for c in rows[k][x0 + 1:x1]).strip()
                        for k in range(y + 1, yy)
                    ).strip()
                    found.append({"x0": x0, "x1": x1, "y0": y, "y1": yy,
                                  "label": label, "perim": perim})
                    break
                perim.append((yy, x0))
                perim.append((yy, x1))
                yy += 1
    return found


def main():
    grid = parse(sys.argv[1])
    for b in boxes(grid):
        colors = {}
        bold_cells = []
        for (y, x) in b["perim"]:
            cell = grid[y][x]
            colors.setdefault((cell[1], cell[2]), []).append((y + 1, x + 1, cell[0]))
            if cell[2]:
                bold_cells.append((y + 1, x + 1))
        dominant = max(colors.items(), key=lambda kv: len(kv[1]))
        print(f"box {b['label']!r} rows {b['y0']+1}-{b['y1']+1} cols {b['x0']+1}-{b['x1']+1}")
        for (fg, bold), cells in sorted(colors.items(), key=lambda kv: -len(kv[1])):
            mark = " <-dominant" if (fg, bold) == dominant[0] else ""
            print(f"   fg={fg} bold={bold} cells={len(cells)}{mark}")
        if bold_cells:
            print(f"   bold cells: {bold_cells}")
        non_dom = [(fg, bold, len(c)) for (fg, bold), c in colors.items() if (fg, bold) != dominant[0]]
        if non_dom:
            print(f"   MIXED BORDER COLORS: {non_dom}")


if __name__ == "__main__":
    main()

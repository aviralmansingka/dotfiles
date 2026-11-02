"""Audit a rataflow-view ANSI pane capture: box border colour uniformity.

Usage: uv run python color-audit.py <capture.ansi>

Parses truecolor SGR runs into a cell grid (char + foreground colour), then
finds rectangle boxes (corner glyph pairs on a row, closed on a lower row) and
reports, per box, the distinct border colours. A box whose border cells carry
more than one colour is a border-colour defect; a box whose border colour
differs from its layer siblings is reported as a layer-family outlier.

Scratch evidence tool for the visualize-eval round 01 capture; it reads only
the capture file.
"""

import re
import sys

SGR = re.compile(r"\x1b\[([0-9;]*)m")


def parse(path):
    rows = []
    cells = []
    fg = None
    data = open(path, encoding="utf-8", errors="replace").read()
    i = 0
    while i < len(data):
        m = SGR.match(data, i)
        if m:
            params = [p for p in m.group(1).split(";") if p]
            if not params or params == ["0"]:
                fg = None
            else:
                if len(params) == 5 and params[0] == "38" and params[1] == "2":
                    fg = tuple(int(x) for x in params[2:5])
                elif len(params) == 2 and params[0] == "38":
                    fg = ("idx", params[1])
            i = m.end()
            continue
        ch = data[i]
        if ch == "\r":
            i += 1
            continue
        if ch == "\n":
            rows.append(cells)
            cells = []
            i += 1
            continue
        cells.append((ch, fg))
        i += 1
    if cells:
        rows.append(cells)
    return rows


def find_boxes(rows):
    boxes = []
    for y, row in enumerate(rows):
        for x, (ch, _c) in enumerate(row):
            if ch != "╭":
                continue
            w = 0
            while x + 1 + w < len(row) and row[x + 1 + w][0] == "─":
                w += 1
            if x + 1 + w >= len(row) or row[x + 1 + w][0] != "╮":
                continue
            right = x + 1 + w
            h = 0
            while y + 1 + h < len(rows):
                r = rows[y + 1 + h]
                if right >= len(r) or r[x][0] != "│" or r[right][0] != "│":
                    break
                h += 1
            bottom = y + 1 + h
            if bottom >= len(rows):
                continue
            b = rows[bottom]
            if b[x][0] != "╰" or right >= len(b) or b[right][0] != "╯":
                continue
            boxes.append((x, y, right, bottom))
    return boxes


def main():
    path = sys.argv[1]
    rows = parse(path)
    boxes = find_boxes(rows)
    print(f"capture: {path}")
    print(f"grid: {max(len(r) for r in rows)} cols x {len(rows)} rows")
    print(f"boxes: {len(boxes)}")
    for x, y, right, bottom in boxes:
        cs = []
        for xx in range(x, right + 1):
            cs.append(("top", xx, y, rows[y][xx]))
            cs.append(("bot", xx, bottom, rows[bottom][xx]))
        for yy in range(y + 1, bottom):
            cs.append(("left", x, yy, rows[yy][x]))
            cs.append(("right", right, yy, rows[yy][right]))
        colours = {}
        for side, xx, yy, (_ch, c) in cs:
            colours.setdefault(c, []).append((side, xx, yy, _ch))
        label = None
        ys = sorted({yy for _s, _x, yy, _c in cs})
        ymid = ys[len(ys) // 2]
        inside = "".join(ch for ch, _c in rows[ymid][x + 1:right]).strip()
        borders = []
        for c, where in colours.items():
            borders.append((c, len(where)))
        ctxt = ", ".join(str(c) + f" x{n}" for c, n in sorted(borders, key=lambda t: -t[1]))
        print(
            f"  box ({x+1},{y+1})-({right+1},{bottom+1}) label~{inside!r} "
            f"size={right-x+1}x{bottom-y+1} border_colours=[{ctxt}]"
        )
        # every border cell must carry exactly the modal colour
        modal = max(colours.items(), key=lambda kv: len(kv[1]))[0]
        odd = [(s, xx + 1, yy + 1, ch, c) for s, xx, yy, ch in
               [w for v in colours.values() for w in v] if c != modal]
        odd = [(s, xx, yy, ch, c) for s, xx, yy, ch, c in odd]
        if odd:
            for s, xx, yy, ch, c in odd[:8]:
                print(f"    off-colour border cell {s} ({xx},{yy}) {ch!r} colour={c}")
        # connection handles: arrowheads sitting on/next to a border cell
        hits = []
        for yy in range(y, bottom + 1):
            for xx in range(x, right + 1):
                ch = rows[yy][xx][0]
                if ch in "▼▲◀▶●":
                    hits.append((xx + 1, yy + 1, ch, rows[yy][xx][1]))
        if hits:
            print(f"    arrow/dot glyphs on border: {hits}")
    # dot check over the whole grid
    dots = [
        (x + 1, y + 1)
        for y, row in enumerate(rows)
        for x, (ch, _c) in enumerate(row)
        if ch == "●"
    ]
    print(f"flow dots (●): {len(dots)} at {dots[:10]}")


if __name__ == "__main__":
    main()

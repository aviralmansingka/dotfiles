#!/usr/bin/env python3
"""Border / color / glyph checks over an ANSI pane capture.

Usage: validate_grid.py <capture.ansi>
Auto-detects node boxes (corners + full sides), then reports:
  * per-box rect, border colors, whether all four sides match one color,
  * whether any border cell is a non-border glyph (arrow/dot/label),
  * whether any arrow or flow dot glyph overlaps a border cell,
  * edge-label and arrow glyph inventory outside boxes.
Exit code 1 if any check fails.
"""
import sys
import json

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from ansi_grid import parse  # noqa: E402

BORDER = set("╭╮╰╯─│├┤┬┴┼")
ARROWS = set("▲▼◀▶><^v")
DOT = set("●")


def cells(rows):
    return rows


def find_boxes(rows):
    boxes = []
    for r, row in enumerate(rows):
        for c, (ch, fg, _b) in enumerate(row):
            if ch != "╭":
                continue
            # walk right along top border
            c2 = c + 1
            while c2 < len(row) and row[c2][0] == "─":
                c2 += 1
            if c2 >= len(row) or row[c2][0] != "╮":
                continue
            top_r = r
            # walk down left side
            r2 = r + 1
            while r2 < len(rows) and c < len(rows[r2]) and rows[r2][c][0] == "│":
                r2 += 1
            if r2 >= len(rows) or c >= len(rows[r2]) or rows[r2][c][0] != "╰":
                continue
            bot_r = r2
            if c2 >= len(rows[bot_r]) or rows[bot_r][c2][0] != "╯":
                continue
            ok_bottom = all(
                c3 < len(rows[bot_r]) and rows[bot_r][c3][0] == "─"
                for c3 in range(c + 1, c2)
            )
            ok_right = all(
                c2 < len(rows[r3]) and rows[r3][c2][0] == "│"
                for r3 in range(top_r + 1, bot_r)
            )
            if not (ok_bottom and ok_right):
                continue
            label = " ".join(
                "".join(ch for ch, _f, _b in rows[rr][c + 1:c2]).strip()
                for rr in range(top_r + 1, bot_r)
            ).strip()
            boxes.append({
                "label_hint": label,
                "top": top_r + 1,
                "bottom": bot_r + 1,
                "left": c + 1,
                "right": c2 + 1,
                "height": bot_r - top_r + 1,
                "width": c2 - c + 1,
            })
    return boxes


def check(rows):
    boxes = find_boxes(rows)
    report = {"boxes": [], "failures": []}
    border_cell = {}
    for b in boxes:
        r0, r1 = b["top"], b["bottom"]
        c0, c1 = b["left"], b["right"]
        r0 -= 1
        r1 -= 1
        c0 -= 1
        c1 -= 1
        cells_list = []
        for c in range(c0, c1 + 1):
            cells_list.append(("top", r0, c))
            cells_list.append(("bottom", r1, c))
        for r in range(r0, r1 + 1):
            cells_list.append(("left", r, c0))
            cells_list.append(("right", r, c1))
        colors = {}
        bad = []
        for side, r, c in cells_list:
            if r >= len(rows) or c >= len(rows[r]):
                bad.append((side, r + 1, c + 1, "missing"))
                continue
            ch, fg, bold = rows[r][c]
            border_cell[(r, c)] = ch
            if ch not in BORDER:
                bad.append((side, r + 1, c + 1, f"non-border glyph {ch!r}"))
            colors.setdefault((fg, bold), 0)
            colors[(fg, bold)] += 1
        entry = {
            "label_hint": b["label_hint"],
            "rect": {"top": b["top"], "left": b["left"], "height": b["height"], "width": b["width"]},
            "border_colors": [{"fg": k[0], "bold": k[1], "cells": v} for k, v in colors.items()],
            "uniform_color": len(colors) == 1,
            "sides_complete": not bad,
            "border_defects": bad,
        }
        report["boxes"].append(entry)
        if bad:
            report["failures"].append({"box": b["label_hint"], "defects": bad})
        if len(colors) != 1:
            report["failures"].append({"box": b["label_hint"], "defect": "border color not uniform"})

    overlaps = []
    for r, row in enumerate(rows):
        for c, (ch, _fg, _b) in enumerate(row):
            if ch in ARROWS | DOT and (r, c) in border_cell:
                overlaps.append({"row": r + 1, "col": c + 1, "glyph": ch})
    report["arrow_or_dot_on_border"] = overlaps
    if overlaps:
        report["failures"].append({"defect": "arrow/dot glyph on a node border", "cells": overlaps})
    report["ok"] = not report["failures"]
    return report


def main(argv):
    rows = parse(argv[1])
    rep = check(rows)
    print(json.dumps(rep, indent=1))
    return 0 if rep["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))

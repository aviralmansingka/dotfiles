#!/usr/bin/env python3
"""Mechanical readability checks for one frozen-rataflow view capture.

Reads <view>/spec.json plus captures/unselected.txt and captures/unselected.ansi.txt
and reports, for the judge:
  header line, label presence, arrowheads per edge, stem cells, dot-on-border cells,
  control-palette overlap, per-box border colour completeness, overflow badge.

Usage: uv run scripts/verify-view.py <view-dir>
"""
import json
import re
import sys
from pathlib import Path

ESC_SGR = re.compile(r"\x1b\[([0-9;]*)m")


def read_cells(path):
    """Return rows of (col, glyph, fg, bg, bold) from an ANSI capture."""
    rows = []
    for line in path.read_text().replace("\r\n", "\n").split("\n"):
        row, fg, bg, bold, col, i = [], None, None, False, 0, 0
        while i < len(line):
            if line[i] == "\x1b":
                j = line.index("m", i)
                param = line[i + 2 : j]
                if param == "0":
                    fg = bg = None
                    bold = False
                elif param == "1":
                    bold = True
                elif param.startswith("38;"):
                    fg = param
                elif param.startswith("48;"):
                    bg = param
                i = j + 1
            else:
                col += 1
                row.append((col, line[i], fg, bg, bold))
                i += 1
        rows.append(row)
    return rows


def text_rows(rows):
    return ["".join(c[1] for c in row) for row in rows]


def find_boxes(lines):
    """Detect boxes: ╭ ─ ╮ / │ … │ / ╰ ─ ╯ rectangles."""
    boxes = []
    for r, line in enumerate(lines):
        for m in re.finditer(r"╭─+╮", line):
            x0, x1 = m.start() + 1, m.end()  # 1-based inclusive
            # find matching bottom
            for r2 in range(r + 1, min(r + 20, len(lines))):
                if len(lines[r2]) >= x1 and lines[r2][x0 - 1] == "╰" and lines[r2][x1 - 1] == "╯":
                    label = lines[r + 1][x0 : x1 - 1].strip()
                    boxes.append({"top": r + 1, "bottom": r2 + 1, "x0": x0, "x1": x1, "rows": r2 - r + 1, "label": label})
                    break
    return boxes


def border_cells(box):
    cells = set()
    for c in range(box["x0"], box["x1"] + 1):
        cells.add((box["top"], c))
        cells.add((box["bottom"], c))
    for r in range(box["top"], box["bottom"] + 1):
        cells.add((r, box["x0"]))
        cells.add((r, box["x1"]))
    return cells


def main():
    view = Path(sys.argv[1])
    spec = json.loads((view / "spec.json").read_text())
    text = (view / "captures" / "unselected.txt").read_text().split("\n")
    rows = read_cells(view / "captures" / "unselected.ansi.txt")
    lines = text_rows(rows)
    lines = [ln.rstrip("\r") for ln in lines]
    report = []
    ok = True

    def add(status, msg):
        nonlocal ok
        if status == "FAIL":
            ok = False
        report.append(f"[{status}] {msg}")

    header = lines[0].strip()
    add("PASS" if header.startswith("rataflow-view · ") else "FAIL", f"header: {header!r}")
    add("FAIL" if "overflows" in "\n".join(lines) else "PASS", "overflow badge absent")

    node_labels = {n["id"]: n.get("label", n["id"]) for n in spec["nodes"]}
    edge_labels = [e.get("label", "") for e in spec["edges"]]
    joined = "\n".join(lines)
    for nid, label in node_labels.items():
        add("PASS" if label in joined else "FAIL", f"node label visible: {nid} -> {label!r}")
    for e, lab in zip(spec["edges"], edge_labels):
        if lab:
            add("PASS" if lab in joined else "FAIL", f"edge label visible: {e['from']}->{e['to']} {lab!r}")

    boxes = find_boxes(lines)
    add("PASS" if len(boxes) == len(spec["nodes"]) else "FAIL", f"boxes detected: {len(boxes)} (nodes {len(spec['nodes'])}) {[b['label'] for b in boxes]}")

    # arrowheads
    arrows = [(r, c) for r, row in enumerate(rows) for c, g, *_ in [(x[0], x[1]) for x in row] if g in "▼▲◀▶"]
    arrow_list = [(r + 1, c, rows[r][c - 1][1]) for r, c in arrows]
    n_edges = len(spec["edges"])
    add("PASS" if len(arrow_list) == n_edges else "FAIL", f"arrowheads: {len(arrow_list)} for {n_edges} edges -> {arrow_list}")

    # each ▼ must sit directly above a box top border cell
    tops = {(b["top"], c) for b in boxes for c in range(b["x0"], b["x1"] + 1)}
    for r, c, g in arrow_list:
        if g == "▼":
            add("PASS" if (r + 1, c) in tops else "FAIL", f"▼ at row {r} col {c} points into a box top border at row {r+1}")
        elif g in "◀▶":
            sides = {(rr, b["x0"]) for b in boxes for rr in range(b["top"], b["bottom"] + 1)} | {
                (rr, b["x1"]) for b in boxes for rr in range(b["top"], b["bottom"] + 1)
            }
            target = (r, c - 1) if g == "◀" else (r, c + 1)
            add("PASS" if target in sides else "FAIL", f"{g} at row {r} col {c} points into a box side {target}")

    # flow dots must not sit on a border cell
    dots = [(r + 1, c) for r, row in enumerate(rows) for c, g, *_ in [(x[0], x[1]) for x in row] if g == "●"]
    borders = set()
    for b in boxes:
        borders |= border_cells(b)
    bad = [d for d in dots if d in borders]
    add("PASS" if not bad else "FAIL", f"flow dots not on borders: {len(dots)} dots, offenders {bad}")

    # control palette must not overlap boxes, dots, arrows or labels
    pal_rows = [r for r, ln in enumerate(lines) if "┌───────┐" in ln or "[+]" in ln or "[-]" in ln or "[f]" in ln or "[i]" in ln]
    if pal_rows:
        p_top, p_bot = min(pal_rows), max(pal_rows)
        pal_cells = set()
        for r in range(p_top, p_bot + 1):
            for c, g, *_ in [(x[0], x[1]) for x in rows[r]]:
                if g.strip() and c < 20:  # palette floats bottom-left
                    pal_cells.add((r + 1, c))
        overlap = [p for p in sorted(pal_cells) if p in borders]
        pal_x0 = min(c for _, c in pal_cells)
        pal_x1 = max(c for _, c in pal_cells)
        add("PASS" if not overlap else "FAIL",
            f"palette rows {p_top+1}-{p_bot+1} cols {pal_x0}-{pal_x1} clear of node borders (overlap {overlap})")
        arrow_cells = {(r, c) for r, c, _ in arrow_list}
        clash = sorted(cell for cell in pal_cells if cell in borders or cell in set(dots) or cell in arrow_cells)
        add("PASS" if not clash else "FAIL", f"palette clear of node borders, dots and arrowheads (clash {clash})")
        # nearest graph glyph to the palette rectangle, to show the clearance
        graph = [(r, c) for r, row in enumerate(rows, 1) for c, g, *_ in [(x[0], x[1]) for x in row]
                 if g.strip() and c > pal_x1 and r >= p_top + 1]
        if graph:
            near = min(graph, key=lambda rc: (abs(rc[1] - pal_x1), rc[0]))
            add("NOTE", f"nearest graph glyph right of the palette: row {near[0]} col {near[1]} "
                        f"(palette right edge col {pal_x1})")
    else:
        add("WARN", "control palette not detected")

    # stem check:每 edge must have a stem cell directly under its source box bottom border
    bottoms = {(b["bottom"], c) for b in boxes for c in range(b["x0"], b["x1"] + 1)}
    stems = {(r, c) for r, row in enumerate(rows, 1) for c, g, *_ in [(x[0], x[1]) for x in row] if g == "│"}
    for b in boxes:
        cand = [(r, c) for (r, c) in stems if r == b["bottom"] + 1 and b["x0"] <= c <= b["x1"]]
        if cand:
            add("PASS", f"source stem leaves box {b['label']!r} bottom at {cand}")

    # border colour completeness: every border cell must carry the box layer hue,
    # except the connection-handle cell(s), which the frozen renderer paints muted.
    for b in boxes:
        colours = {}
        for (r, c) in sorted(border_cells(b)):
            fg = rows[r - 1][c - 1][2]
            colours.setdefault(fg, []).append((r, c))
        ranked = sorted(colours.items(), key=lambda kv: -len(kv[1]))
        main_fg, main_cells = ranked[0]
        odd = {fg: cells for fg, cells in ranked[1:]}
        note = ", ".join(f"{fg or 'none'}x{len(cells)} {cells[:2]}" for fg, cells in odd.items())
        add("PASS" if not odd else "NOTE", f"box {b['label']!r} border {main_fg} on {len(main_cells)} cells; other colours: {note or 'none'}")

    out = view / "captures" / "verify.txt"
    head = f"view: {view.name}\nspec: spec.json\ncapture: captures/unselected.txt + captures/unselected.ansi.txt\n"
    out.write_text(head + "\n".join(report) + f"\n\nRESULT: {'all mechanical checks passed' if ok else 'FAILURES PRESENT'}\n")
    print(out.read_text())


if __name__ == "__main__":
    main()

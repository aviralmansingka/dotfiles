#!/usr/bin/env python3
# Paths: scripts/viz-frame-audit.py scripts/viz-validate.py docs/visualize-eval/**
"""Audit a rataflow `--frames` dump: per-route dot motion, mechanically.

Offline and deterministic: reads one plain-text frames capture and nothing else.
Round 12's animation category was BLOCKED because no judge completed the
independent all-route equal-distance comparison by eye. This tool performs that
comparison and prints the table a judge cites.

What it establishes, from the capture alone:

  frames          the frame stamps are evenly spaced (a capture, not a mash)
  routes          how many dots are tracked, and that each starts at frame 0
  speed           every route moves one steady rate: no stall longer than the
                  render's own resting frame, no skipped cell, and the same
                  displacement over every equal-length frame window
  equal distance  over one shared window, every still-moving route covers the
                  same distance (one shared speed), which is the comparison the
                  animation category needs

Tracking rule: a dot advances at most one cell per frame at the frozen
0.5 cells/step rate, so a step of more than one cell is a lap restart, never a
move. A vanished dot is paired with the dot that reappears at its own lap-start
cell, so a looping animation stays one route instead of splitting per lap.

Usage:
  scripts/viz-frame-audit.py FRAMES.txt [--window 10] [--tolerance 1]
      [--max-jump 1] [--dot-glyph ●] [--summary] [--json OUT.json]

Exit status: 0 when every check passes, 1 otherwise, so a validator can gate on
it. `--summary` prints only the verdict lines, which is what
`viz-validate.py --frame-audit` appends to its own output.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

# rataflow paints every dot with one glyph (`flow_edge::DOT`).
DOT_GLYPHS = "●"
FRAME_RE = re.compile(r"^frame (\d+) at (\d+)ms\s*$")
VIEWPORT_RE = re.compile(r"^viewport: (\d+)x(\d+) zoom: ([0-9.]+) (natural|fit)", re.M)


def parse_frames(text: str) -> tuple[dict[int, list[str]], list[int]]:
    """Split a frames dump into {frame index: art lines} plus frame order.

    Text before the first `frame N at Mms` line is capture preamble (the
    `viewport:` proof line, or pane chrome from a live read) and is dropped.
    """
    bodies: dict[int, list[str]] = {}
    order: list[int] = []
    current: int | None = None
    for line in text.splitlines():
        if m := FRAME_RE.match(line):
            current = int(m.group(1))
            bodies[current] = []
            order.append(current)
            continue
        if current is not None:
            bodies[current].append(line)
    return bodies, order


def dot_positions(lines: list[str], glyphs: str) -> list[tuple[int, int]]:
    return sorted(
        (row, col)
        for row, line in enumerate(lines)
        for col, char in enumerate(line)
        if char in glyphs
    )


def manhattan(a: tuple[int, int], b: tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


class Route:
    """One tracked dot: segments of cells, one segment per animated lap."""

    __slots__ = ("route_id", "segments", "first_frame")

    def __init__(self, route_id: int, frame: int, cell: tuple[int, int]) -> None:
        self.route_id = route_id
        self.segments: list[list[tuple[int, tuple[int, int]]]] = [[(frame, cell)]]
        self.first_frame = frame

    # -- geometry -------------------------------------------------------------
    @property
    def current(self) -> list[tuple[int, tuple[int, int]]]:
        return self.segments[-1]

    @property
    def last_cell(self) -> tuple[int, int]:
        return self.current[-1][1]

    @property
    def lap_start(self) -> tuple[int, int]:
        return self.current[0][1]

    def extend(self, frame: int, cell: tuple[int, int]) -> None:
        self.current.append((frame, cell))

    def restart(self, frame: int, cell: tuple[int, int]) -> None:
        self.segments.append([(frame, cell)])

    # -- motion facts ---------------------------------------------------------
    def segment_cells(self, index: int) -> int:
        segment = self.segments[index]
        return sum(
            manhattan(previous, cell)
            for (_, previous), (_, cell) in zip(segment, segment[1:])
        )

    def last_move_frame(self, index: int | None = None) -> int:
        segment = self.segments[-1] if index is None else self.segments[index]
        last = segment[0][0]
        for (_, previous), (frame, cell) in zip(segment, segment[1:]):
            if cell != previous:
                last = frame
        return last

    def speed(self) -> float:
        """Cells per frame over the first lap: the rate the capture shows.

        Lap 1 is complete for a looping dot (it ends where the next lap starts)
        and is the whole run for a dot that arrives and rests, so it is the one
        span that is not truncated by the capture's end.
        """
        segment = self.segments[0]
        span = self.last_move_frame(0) - segment[0][0]
        return round(self.segment_cells(0) / span, 3) if span > 0 else 0.0

    def jumps(self, max_jump: int) -> list[str]:
        out = []
        for index, segment in enumerate(self.segments):
            for (frame0, previous), (frame, cell) in zip(segment, segment[1:]):
                delta = manhattan(previous, cell)
                if delta > max_jump:
                    out.append(
                        f"r{self.route_id} lap {index + 1} frame {frame0}->{frame} "
                        f"steps {delta} cells"
                    )
        return out

    def longest_stall(self) -> int:
        """Longest run of frames with no step, inside one lap, before the last step.

        A dot at 0.5 cells/step rests one frame between steps (quantization), so
        a stall of 1 is the render rate; anything longer is a visible pause.
        """
        best = 0
        for index, segment in enumerate(self.segments):
            if len(segment) < 3:
                continue
            # A rest before the lap restart is a visible pause, so an inner
            # segment's tail counts; only the capture's last segment is bounded
            # by its last step (a dot that arrived may legitimately rest there).
            limit = (
                segment[-1][0]
                if index < len(self.segments) - 1
                else self.last_move_frame(index)
            )
            run = 0
            previous = None
            for frame, cell in segment:
                if frame > limit:
                    break
                if previous is not None and cell == previous:
                    run += 1
                    best = max(best, run)
                else:
                    run = 0
                previous = cell
        return best

    def window_path(self, frame_a: int, frame_b: int) -> int | None:
        """Cells travelled between two frames inside ONE lap, else None.

        Path length, not endpoint distance: a dot that loops a short lap comes
        back to where it was, and endpoint distance would read that as standing
        still. A window that crosses a lap restart is not comparable at all — the
        dot teleports back to its origin, which the renderer never draws.
        """
        for segment in self.segments:
            frames = {frame for frame, _ in segment}
            if frame_a not in frames or frame_b not in frames:
                continue
            return sum(
                manhattan(previous, cell)
                for (frame0, previous), (frame1, cell) in zip(segment, segment[1:])
                if frame0 >= frame_a and frame1 <= frame_b
            )
        return None


def track(frames: dict[int, list[str]], order: list[int], glyphs: str,
          max_jump: int) -> tuple[list[Route], list[int], list[str]]:
    """Track every dot across the capture, keeping looping dots as one route."""
    routes: list[Route] = []
    active: list[Route] = []
    late: list[int] = []
    notes: list[str] = []
    for position, frame in enumerate(order):
        cells = dot_positions(frames[frame], glyphs)
        if position == 0:
            for cell in cells:
                route = Route(len(routes) + 1, frame, cell)
                routes.append(route)
                active.append(route)
            continue
        candidates = []
        for route in active:
            for index, cell in enumerate(cells):
                distance = manhattan(route.last_cell, cell)
                if distance <= max_jump:
                    candidates.append((distance, route.route_id, index, route, cell))
        candidates.sort(key=lambda item: (item[0], item[1], item[2]))
        claimed: set[int] = set()
        stepped: dict[int, Route] = {}
        for _, _, index, route, cell in candidates:
            if index in claimed or route.route_id in stepped:
                continue
            claimed.add(index)
            stepped[route.route_id] = route
            route.extend(frame, cell)
        waiting = [route for route in active if route.route_id not in stepped]
        free = [cell for index, cell in enumerate(cells) if index not in claimed]
        restarted: list[Route] = []
        # A dot that advances more than one cell in a frame is looping, not
        # moving: rataflow restarts it at its own arrow origin. Pair the jump
        # with the route whose current lap started at that very cell.
        for cell in list(free):
            owners = [route for route in waiting if route.lap_start == cell]
            if len(owners) != 1:
                continue
            route = owners[0]
            waiting.remove(route)
            free.remove(cell)
            route.restart(frame, cell)
            restarted.append(route)
        # Any jump left is still a restart (a route whose origin cell moved),
        # so pair the leftovers nearest-first before inventing a new dot.
        pairs = sorted(
            (manhattan(route.last_cell, cell), route.route_id, index)
            for index, cell in enumerate(free)
            for route in waiting
        )
        for _, route_id, index in pairs:
            route = next(
                (item for item in waiting if item.route_id == route_id), None
            )
            if route is None or index >= len(free):
                continue
            cell = free[index]
            waiting.remove(route)
            free = [item for i, item in enumerate(free) if i != index]
            route.restart(frame, cell)
            restarted.append(route)
        for cell in free:
            route = Route(len(routes) + 1, frame, cell)
            routes.append(route)
            restarted.append(route)
            late.append(route.route_id)
            notes.append(
                f"r{route.route_id} first appears at frame {frame} cell {cell}"
            )
        for route in waiting:
            notes.append(
                f"r{route.route_id} leaves the capture at frame {route.current[-1][0]}"
            )
        active = list(stepped.values()) + restarted
    return routes, late, notes


def audit(path: Path, window: int, tolerance: int, max_jump: int,
          glyphs: str = DOT_GLYPHS, expect_routes: int | None = None,
          rate_tolerance: float = 0.05) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    frames, order = parse_frames(text)
    result: dict = {
        "capture": str(path),
        "viewport": None,
        "frames": len(order),
        "frame_range": [min(order), max(order)] if order else [],
        "window": window,
        "tolerance": tolerance,
        "rate_tolerance": rate_tolerance,
        "problems": [],
        "notes": [],
        "routes": [],
        "windows": [],
    }
    if m := VIEWPORT_RE.search(text):
        result["viewport"] = {
            "columns": int(m.group(1)),
            "rows": int(m.group(2)),
            "zoom": float(m.group(3)),
            "mode": m.group(4),
        }
    if len(order) < 3:
        result["problems"].append(
            f"only {len(order)} timestamped frame(s); at least 3 are needed for motion"
        )
        result["verdict"] = "fail"
        return result

    stamps = {
        int(m.group(1)): int(m.group(2))
        for line in text.splitlines()
        if (m := FRAME_RE.match(line))
    }
    deltas = [stamps[b] - stamps[a] for a, b in zip(order, order[1:])]
    result["step_ms"] = deltas[0] if deltas else None
    result["frames_even"] = all(d == deltas[0] for d in deltas)
    if not result["frames_even"]:
        bad = [f"{order[i]}->{order[i + 1]}={d}ms" for i, d in enumerate(deltas)
               if d != deltas[0]]
        result["problems"].append(
            f"frame stamps are not evenly spaced ({', '.join(bad[:4])})"
        )
    if order != list(range(order[0], order[0] + len(order))):
        result["problems"].append("frame indexes are not consecutive")

    counts = Counter(len(frames[frame]) for frame in order)  # lines per frame
    del counts

    routes, late, notes = track(frames, order, glyphs, max_jump)
    result["notes"] = notes
    result["late_routes"] = late
    if late:
        result["problems"].append(
            f"{len(late)} dot(s) first appear after frame {order[0]}: {late[:5]}"
        )

    dots_per_frame = [len(dot_positions(frames[frame], glyphs)) for frame in order]
    result["dots_per_frame"] = sorted(set(dots_per_frame))
    if len(set(dots_per_frame)) > 1:
        result["notes"].append(
            f"dot count varies per frame: {sorted(Counter(dots_per_frame).items())}"
        )
    moved = [route for route in routes if sum(
        route.segment_cells(i) for i in range(len(route.segments))
    ) > 0]
    stationary = [route for route in routes if route not in moved]
    if stationary:
        result["stationary_routes"] = [route.route_id for route in stationary]
        result["problems"].append(
            f"{len(stationary)} dot(s) never move in this capture "
            f"(r{[route.route_id for route in stationary][:5]}); a dot that rests "
            "only on its own origin cell is allowed, a frozen dot is not motion"
        )
    if not moved:
        result["problems"].append(
            "no dot moved in this capture: the source asks for no dots "
            "(animation is not applicable, so do not request --frame-audit) or "
            "the capture is not a --frames dump"
        )
        result["verdict"] = "fail"
        return result

    # ---- the comparison window ----------------------------------------------
    # The window has to fit inside ONE lap of every route it compares, and a
    # short route's lap is only a few frames long. Take the widest window that
    # still leaves two routes measurable, and report which window was used so a
    # judge reads the real comparison and not the request.
    used_window = window

    def windowed(route, span):
        return [
            value
            for value in (
                route.window_path(start, start + span)
                for start in order
                if start + span <= order[-1]
            )
            if value is not None
        ]

    while used_window > 1:
        measurable = sum(1 for route in moved if windowed(route, used_window))
        if measurable >= 2:
            break
        used_window = max(1, used_window // 2)
    result["window_used"] = used_window
    # Quantization scales with the window: a 2-frame window cannot distinguish a
    # 1-cell spread over a 10-frame one.
    allowed = max(1, round(tolerance * used_window / max(1, window)))
    result["spread_allowed"] = allowed

    # ---- per route -----------------------------------------------------------
    for route in moved:
        laps = [route.segment_cells(i) for i in range(len(route.segments))]
        complete = laps[:-1]
        distances = windowed(route, used_window)
        spread = (max(distances) - min(distances)) if distances else 0
        stalls = route.longest_stall()
        entry = {
            "route": route.route_id,
            "start": list(route.segments[0][0][1]),
            "end": list(route.last_cell),
            "laps": len(route.segments),
            "lap_cells": laps,
            "cells": sum(laps),
            "steps": sum(
                1
                for segment in route.segments
                for (_, a), (_, b) in zip(segment, segment[1:])
                if a != b
            ),
            "first_frame": route.first_frame,
            "last_move_frame": route.last_move_frame(),
            "rate_cells_per_frame": route.speed(),
            "window_distances": distances,
            "window_spread": spread,
            "longest_stall": stalls,
            "steady": stalls <= 1 and spread <= allowed,
        }
        if len(set(complete)) > 1:
            entry["lap_lengths_differ"] = True
        result["routes"].append(entry)
        if stalls > 1:
            result["problems"].append(
                f"r{entry['route']} pauses {stalls} frames between steps"
            )
        if spread > allowed:
            result["problems"].append(
                f"r{entry['route']} covers {distances} cells over {used_window}-frame "
                f"windows (spread {spread} > {allowed})"
            )
        for problem in route.jumps(max_jump):
            result["problems"].append(problem)

    # ---- equal distance across routes, one shared window ---------------------
    for start in order:
        end = start + used_window
        if end > order[-1]:
            break
        distances = {}
        for route in moved:
            value = route.window_path(start, end)
            if value is None:
                continue
            # A route that has stopped (arrived) or not yet started is not
            # comparable in this window.
            if end > route.last_move_frame() or start < route.first_frame:
                continue
            distances[f"r{route.route_id}"] = value
        if len(distances) < 2:
            continue
        spread = max(distances.values()) - min(distances.values())
        result["windows"].append(
            {
                "from": start,
                "to": end,
                "distances": distances,
                "spread": spread,
                "routes": len(distances),
            }
        )
    result["equal_distance_windows"] = len(result["windows"])
    failures = [
        f"{w['from']}-{w['to']}: spread {w['spread']} over {w['routes']} routes"
        for w in result["windows"]
        if w["spread"] > allowed
    ]
    result["equal_distance_failures"] = failures
    if not result["windows"]:
        result["problems"].append(
            f"no {used_window}-frame window has two comparable moving routes; "
            "equal distance cannot be shown"
        )
    elif failures:
        result["problems"].append(
            f"dots cover different distances over equal windows ({len(failures)} of "
            f"{len(result['windows'])}): {'; '.join(failures[:3])}"
        )

    # Rate consistency over time: the mean distance per window must hold.
    means = [sum(w["distances"].values()) / w["routes"] for w in result["windows"]]
    result["window_means"] = [round(m, 2) for m in means]
    if means and (max(means) - min(means)) > 2 * allowed:
        result["problems"].append(
            f"the shared rate drifts: per-window mean distance ranges "
            f"{min(means):.2f}..{max(means):.2f} cells (limit {2 * allowed})"
        )

    # ---- one shared rate across routes ---------------------------------------
    rates = [entry["rate_cells_per_frame"] for entry in result["routes"]]
    result["rate_spread"] = round(max(rates) - min(rates), 3) if rates else 0.0
    rate_limit = rate_tolerance
    result["rate_limit"] = rate_limit
    if result["rate_spread"] > rate_limit + 1e-9:
        result["problems"].append(
            f"routes run at different rates: {min(rates):.3f}..{max(rates):.3f} "
            f"cells/frame (spread {result['rate_spread']} > {rate_limit})"
        )

    result["steady_routes"] = sum(1 for entry in result["routes"] if entry["steady"])
    result["routes_tracked"] = len(result["routes"])
    if expect_routes is not None and result["routes_tracked"] != expect_routes:
        result["problems"].append(
            f"tracked {result['routes_tracked']} route(s) but the check reports "
            f"{expect_routes} dot route(s); tracking split or merged a dot"
        )
    result["verdict"] = "pass" if not result["problems"] else "fail"
    return result


def summary_lines(result: dict) -> list[str]:
    """The verdict lines a judge cites and the validator appends."""
    tracked = result.get("routes_tracked", 0)
    lines = [f"frame audit: {Path(result['capture']).name} — {result['frames']} frames"]
    if result.get("viewport"):
        view = result["viewport"]
        lines.append(
            f"  viewport: {view['columns']}x{view['rows']} @{view['zoom']:.2f} "
            f"{view['mode']} · step {result.get('step_ms')}ms"
            f" · {tracked} route(s) tracked · dots/frame {result.get('dots_per_frame')}"
        )
    lines.append(
        f"  frames evenly spaced: {'pass' if result.get('frames_even') else 'fail'}"
        f" · steady routes: {result.get('steady_routes', 0)}/{tracked}"
    )
    for entry in result.get("routes", []):
        laps = entry["lap_cells"]
        lines.append(
            f"  r{entry['route']:<2} {entry['cells']:>4} cells / {laps} → "
            f"Δ per {result.get('window_used', result['window'])} frames "
            f"{entry['window_distances'][:5]} · "
            f"stall {entry['longest_stall']} · "
            f"{'steady' if entry['steady'] else 'UNSTEADY'}"
        )
    if result.get("windows"):
        spreads = ", ".join(
            f"{w['from']}-{w['to']}:{w['spread']}" for w in result["windows"][:6]
        )
        lines.append(
            f"  equal distance: "
            f"{'pass' if not result.get('equal_distance_failures') else 'fail'} over "
            f"{len(result['windows'])} x {result.get('window_used')} frame window(s) "
            f"(spread ≤ {result.get('spread_allowed')}) — {spreads}"
        )
    else:
        lines.append("  equal distance: not measurable (no shared window)")
    rates = [entry["rate_cells_per_frame"] for entry in result.get("routes", [])]
    if rates:
        lines.append(
            f"  rates: {min(rates):.3f}..{max(rates):.3f} cells/frame, spread "
            f"{result.get('rate_spread')} (allowed {result.get('rate_limit')})"
        )
    if result.get("problems"):
        lines.append(f"  verdict: FAIL — {len(result['problems'])} problem(s)")
        for problem in result["problems"][:8]:
            lines.append(f"    - {problem}")
    else:
        lines.append(
            "  verdict: PASS — every tracked dot holds one rate and covers equal distance"
        )
    return lines


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("capture")
    parser.add_argument("--window", type=int, default=10,
                        help="frames compared for the equal-distance check (default 10)")
    parser.add_argument("--tolerance", type=int, default=1,
                        help="allowed cell spread within one window (default 1)")
    parser.add_argument("--rate-tolerance", type=float, default=0.05,
                        help="allowed spread between route rates in cells/frame "
                             "(default 0.05, a tenth of the frozen 0.5 c/step)")
    parser.add_argument("--max-jump", type=int, default=1,
                        help="largest real single-frame step; more is a lap restart (default 1)")
    parser.add_argument("--dot-glyph", default=DOT_GLYPHS,
                        help="glyph rataflow paints a dot with (default ●)")
    parser.add_argument("--expect-routes", type=int,
                        help="route count the check reports; a mismatch means tracking "
                             "split or merged a dot")
    parser.add_argument("--summary", action="store_true",
                        help="print only the verdict lines")
    parser.add_argument("--json", metavar="OUT", help="write the full audit as JSON")
    args = parser.parse_args(argv)

    path = Path(args.capture)
    if not path.is_file():
        print(f"FAIL frame_audit_readable — {path} is not a file")
        return 1
    result = audit(path, args.window, args.tolerance, args.max_jump, args.dot_glyph,
                   args.expect_routes, args.rate_tolerance)
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=1) + "\n")
    if not args.summary:
        print(f"frame audit: {path}")
        if result["frames"]:
            print(
                f"frames: {result['frames']} ({result['frame_range'][0]}.."
                f"{result['frame_range'][1]}) step {result.get('step_ms')}ms "
                f"window {result['window']} tolerance {result['tolerance']} "
                f"rate±{result['rate_tolerance']} c/frame"
            )
        for line in summary_lines(result):
            if not line.startswith("frame audit:"):
                print(line)
        print("\nroute table")
        print(f"{'route':>6} {'laps':>4} {'cells':>6} {'steps':>6} {'stall':>6} "
              f"{'spread':>7}  verdict")
        for entry in result.get("routes", []):
            print(
                f"{'r' + str(entry['route']):>6} {entry['laps']:>4} "
                f"{entry['cells']:>6} {entry['steps']:>6} "
                f"{entry['longest_stall']:>6} {entry['window_spread']:>7}  "
                f"{'steady' if entry['steady'] else 'UNSTEADY'}"
            )
    else:
        for line in summary_lines(result):
            print(line)
    return 0 if result.get("verdict") == "pass" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

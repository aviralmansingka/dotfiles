"""Render the task waterfall: one box per task, one bar per dwell inside it.

The view is read straight out of ``spans.sqlite3``: no server, no daemon, no web
page.  ``tasktrace waterfall`` opens the store, keeps the rows inside the window
(one week by default), stitches them into tasks and traces, and prints one box
per task.

A *span* in the view is one dwell: the time one app held attention on one
workspace, measured from its own row to the next dwell row of the same trace.
The last dwell of a trace is ``open`` — nothing recorded where it ended — so it
gets a zero dwell and is drawn as a dot.

``notify`` and ``agent_done`` are span events, not dwells.  They are drawn as
``◆`` rows *inside* the dwell they happened in, so a notification does not cut
the app's attention in two, and they still count as spans of the task.

Reported per task: spans, span events, runs, wall time, and the longest span.
Wall time is attention time — first span to last span of each run, summed — so
the gaps between runs never count, which is the number ``tasktrace traces``
already prints for a task.  The dwells are the bars, and the last dwell of a run
is open, so the dwells a recording closed sum to less than the wall time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Iterable, Mapping, Sequence

from .stitch import MERGE_GAP_S, epoch, stitch, task_key

# Span events: they mark a moment inside a dwell, they do not own one.
EVENT_KINDS = frozenset({"notify", "agent_done"})

DEFAULT_DAYS = 7.0
BAR_WIDTH = 20
BAR = "█"
DOT = "·"
MARK = "◆"


# --------------------------------------------------------------------------- window


def parse_when(text: str) -> datetime:
    """An ISO 8601 stamp from the command line, in the local zone when it has none."""
    stamp = datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        stamp = stamp.astimezone()  # interpret a bare stamp as local time
    return stamp


def stamp(moment: datetime) -> str:
    return moment.astimezone().isoformat(timespec="seconds")


@dataclass(frozen=True)
class Window:
    """The slice of the store the waterfall shows.  ``None`` bounds mean open."""

    since: float | None
    until: float | None
    days: float | None

    def holds(self, when: float) -> bool:
        if self.since is not None and when < self.since:
            return False
        if self.until is not None and when > self.until:
            return False
        return True

    def dump(self) -> dict[str, Any]:
        return {
            "since": _iso(self.since),
            "until": _iso(self.until),
            "days": self.days,
        }


def _iso(when: float | None) -> str | None:
    return None if when is None else stamp(datetime.fromtimestamp(when))


def window(
    *,
    now: datetime | None = None,
    days: float | None = DEFAULT_DAYS,
    since: str | None = None,
    until: str | None = None,
    everything: bool = False,
) -> Window:
    """The window: one week back from ``now`` unless the range is given by hand.

    ``--days`` is the default contract (7 days).  ``--since`` and ``--until``
    override either edge, and ``--all`` drops the window entirely.
    """
    if everything:
        return Window(since=None, until=None, days=None)
    end = parse_when(until) if until else (now or datetime.now().astimezone())
    start = parse_when(since) if since else end - timedelta(days=days or DEFAULT_DAYS)
    width = round((end - start).total_seconds() / 86400, 3)
    return Window(since=start.timestamp(), until=end.timestamp(), days=width)


# --------------------------------------------------------------------------- model


@dataclass(frozen=True)
class Mark:
    """One span event: a ``notify`` or an ``agent_done`` inside a dwell."""

    kind: str
    ts: str
    offset_s: float
    app: str | None
    ws: str | None

    def dump(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "ts": self.ts,
            "offset_s": self.offset_s,
            "app": self.app,
            "ws": self.ws,
        }


@dataclass(frozen=True)
class Bar:
    """One span of the waterfall: a dwell, or a bare event when nothing else ran."""

    start: str
    start_epoch: float
    duration_s: float
    kind: str
    app: str | None
    ws: str | None
    trace: int
    open: bool = False
    marks: tuple[Mark, ...] = ()

    @property
    def is_event(self) -> bool:
        return self.kind in EVENT_KINDS

    def dump(self) -> dict[str, Any]:
        return {
            "ts": self.start,
            "kind": self.kind,
            "app": self.app,
            "ws": self.ws,
            "dwell_s": self.duration_s,
            "trace": self.trace,
            "open": self.open,
            "event": self.is_event,
            "marks": [mark.dump() for mark in self.marks],
        }


@dataclass(frozen=True)
class Box:
    """One task: every dwell and span event inside the window."""

    workspace: str | None
    project: str | None
    task_id: str
    bars: tuple[Bar, ...]

    @property
    def key(self) -> str:
        return task_key(self.workspace, self.project)

    @property
    def spans(self) -> int:
        """Every span in the box, dwells and span events alike."""
        return sum(1 + len(bar.marks) for bar in self.bars)

    @property
    def events(self) -> int:
        return sum(len(bar.marks) for bar in self.bars)

    @property
    def runs(self) -> int:
        return len({bar.trace for bar in self.bars})

    @property
    def start_epoch(self) -> float:
        return min(bar.start_epoch for bar in self.bars)

    @property
    def dwell_s(self) -> float:
        """The dwells the recording actually closed; the open one contributes 0."""
        return round(sum(bar.duration_s for bar in self.bars), 3)

    @property
    def wall_s(self) -> float:
        """Attention time: first span to last span of each run, summed.

        The same number ``tasktrace traces`` prints for the task, so the two
        views of the same rows agree.  The gaps between runs never count.
        """
        total = 0.0
        for trace in {bar.trace for bar in self.bars}:
            rows = [bar for bar in self.bars if bar.trace == trace]
            start = min(bar.start_epoch for bar in rows)
            end = max(
                [bar.start_epoch for bar in rows]
                + [epoch(mark.ts) for bar in rows for mark in bar.marks]
            )
            total += end - start
        return round(total, 3)

    @property
    def longest(self) -> Bar | None:
        if not self.bars:
            return None
        return max(self.bars, key=lambda bar: (bar.duration_s, -bar.start_epoch))

    def dump(self) -> dict[str, Any]:
        longest = self.longest
        return {
            "key": self.key,
            "task_id": self.task_id,
            "workspace": self.workspace,
            "project": self.project,
            "spans": self.spans,
            "events": self.events,
            "runs": self.runs,
            "wall_s": self.wall_s,
            "dwell_s": self.dwell_s,
            "longest_s": longest.duration_s if longest else 0.0,
            "longest_app": longest.app if longest else None,
            "start": _iso(self.start_epoch),
            "rows": [bar.dump() for bar in self.bars],
        }


@dataclass(frozen=True)
class Waterfall:
    """The whole view: a window, one box per task, and the totals."""

    window: Window
    boxes: tuple[Box, ...]
    spans_outside_window: int = 0

    @property
    def spans(self) -> int:
        return sum(box.spans for box in self.boxes)

    @property
    def wall_s(self) -> float:
        return round(sum(box.wall_s for box in self.boxes), 3)

    @property
    def longest(self) -> tuple[float, str, str] | None:
        """(dwell, app, task key) of the longest span in the window."""
        best: tuple[float, str, str] | None = None
        for box in self.boxes:
            bar = box.longest
            if bar is None:
                continue
            found = (bar.duration_s, bar.app or "-", box.key)
            if best is None or found > best:
                best = found
        return best

    def dump(self) -> dict[str, Any]:
        return {
            "window": self.window.dump(),
            "tasks": len(self.boxes),
            "spans": self.spans,
            "wall_s": self.wall_s,
            "spans_outside_window": self.spans_outside_window,
            "boxes": [box.dump() for box in self.boxes],
        }


# --------------------------------------------------------------------------- build


def _row_ws(row: Mapping[str, Any], fallback: str | None) -> str | None:
    own = row.get("ws")
    return own if isinstance(own, str) and own else fallback


def _bars(trace) -> list[Bar]:
    """One bar per dwell of the trace, with its span events marked inside it."""
    rows: Sequence[Mapping[str, Any]] = trace.spans
    dwells: list[tuple[Mapping[str, Any], list[Mark]]] = []
    loose: list[Mapping[str, Any]] = []
    base = epoch(rows[0]["ts"]) if rows else 0.0

    for row in rows:
        if row.get("kind") in EVENT_KINDS:
            if dwells:
                dwells[-1][1].append(_mark(row, base, trace.workspace))
            else:
                loose.append(row)
            continue
        dwells.append((row, []))

    if not dwells:
        # Nothing but span events in this trace: keep them, as one bare bar.
        first, *rest = loose
        alone = Bar(
            start=str(first["ts"]),
            start_epoch=epoch(first["ts"]),
            duration_s=0.0,
            kind=str(first.get("kind")),
            app=first.get("app"),
            ws=_row_ws(first, trace.workspace),
            trace=trace.index,
            marks=tuple(_mark(row, base, trace.workspace) for row in rest),
        )
        return [alone]

    starts = [epoch(row["ts"]) for row, _ in dwells]
    bars: list[Bar] = []
    for index, (row, marks) in enumerate(dwells):
        last = index == len(dwells) - 1
        dwell = 0.0 if last else max(0.0, starts[index + 1] - starts[index])
        bars.append(
            Bar(
                start=str(row["ts"]),
                start_epoch=starts[index],
                duration_s=round(dwell, 3),
                kind=str(row.get("kind")),
                app=row.get("app"),
                ws=_row_ws(row, trace.workspace),
                trace=trace.index,
                open=last,
                marks=tuple(marks),
            )
        )
    if loose:
        # Events before the first dwell belong to the run, so they ride on it.
        bars[0] = Bar(
            start=bars[0].start,
            start_epoch=bars[0].start_epoch,
            duration_s=bars[0].duration_s,
            kind=bars[0].kind,
            app=bars[0].app,
            ws=bars[0].ws,
            trace=bars[0].trace,
            open=bars[0].open,
            marks=tuple(_mark(row, base, trace.workspace) for row in loose) + bars[0].marks,
        )
    return bars


def _mark(row: Mapping[str, Any], base: float, fallback_ws: str | None) -> Mark:
    when = epoch(row["ts"])
    return Mark(
        kind=str(row.get("kind")),
        ts=str(row["ts"]),
        offset_s=round(when - base, 3),
        app=row.get("app"),
        ws=_row_ws(row, fallback_ws),
    )


def build(
    rows: Iterable[Mapping[str, Any]],
    *,
    view: Window | None = None,
    merge_gap_s: float = MERGE_GAP_S,
) -> Waterfall:
    """Group span rows into task boxes, one bar per dwell inside each box."""
    view = view or window(everything=True)
    everything = list(rows)
    kept = [row for row in everything if view.holds(epoch(row["ts"]))]
    boxes: list[Box] = []
    for task in stitch(kept, merge_gap_s):
        bars: list[Bar] = []
        for trace in task.traces:
            bars.extend(_bars(trace))
        if not bars:
            continue
        bars.sort(key=lambda bar: bar.start_epoch)
        boxes.append(
            Box(
                workspace=task.workspace,
                project=task.project,
                task_id=task.task_id,
                bars=tuple(bars),
            )
        )
    boxes.sort(key=lambda box: (box.start_epoch, box.key))
    return Waterfall(
        window=view,
        boxes=tuple(boxes),
        spans_outside_window=len(everything) - len(kept),
    )


# --------------------------------------------------------------------------- render


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" + ("" if count == 1 else "s")


def _clip(text: str | None, width: int) -> str:
    found = text or "-"
    if len(found) <= width:
        return found
    return found[: width - 1] + "…"


def _bar_cells(dwell: float, scale: float, width: int) -> str:
    if dwell <= 0:
        return DOT
    cells = 1 if scale <= 0 else max(1, round(dwell / scale * width))
    return BAR * cells


def _widest(bars: Sequence[Bar], pick, floor: int) -> int:
    return max([floor, *(len(pick(bar) or "-") for bar in bars)])


def render_box(box: Box, *, bar_width: int = BAR_WIDTH) -> list[str]:
    """The box for one task: a header, one line per dwell, and the event rows."""
    bars = box.bars
    app_w = min(28, _widest(bars, lambda bar: bar.app, 3))
    ws_w = min(10, _widest(bars, lambda bar: bar.ws, 2))
    kind_w = _widest(bars, lambda bar: bar.kind, 4)
    longest = box.longest
    head = f"{box.key}  {box.task_id}"
    facts = (
        f"spans {box.spans} · events {box.events} · runs {box.runs}"
        f" · wall {box.wall_s:.3f} s"
        f" · longest {longest.duration_s if longest else 0.0:.3f} s"
        f" ({_clip(longest.app if longest else None, 20)})"
    )
    lines = [
        head,
        facts,
        "",
        f"{'#':>3}  {'t+ (s)':>8}  {'dwell(s)':>8}  {'app':<{app_w}}  {'ws':<{ws_w}}"
        f"  {'kind':<{kind_w}}  span",
    ]

    scale = max((bar.duration_s for bar in bars), default=0.0)
    number = 0
    run = None
    for bar in bars:
        if box.runs > 1 and bar.trace != run:
            run = bar.trace
            lines.append(f"{'··':>3}  run {run}")
        number += 1
        offset = bar.start_epoch - box.start_epoch
        app = _clip(bar.app, app_w)
        ws = _clip(bar.ws, ws_w)
        kind = bar.kind.ljust(kind_w)
        row = f"{number:>3}  {offset:>8.3f}  "
        if bar.is_event:
            lines.append(
                row + f"{'event':>8}  {app:<{app_w}}  {ws:<{ws_w}}  {kind}"
                f"  {MARK} {bar.kind}"
            )
            continue
        cells = _bar_cells(bar.duration_s, scale, bar_width)
        suffix = " open" if bar.open else ""
        lines.append(
            row + f"{bar.duration_s:>8.3f}  {app:<{app_w}}  {ws:<{ws_w}}  {kind}"
            f"  {cells}{suffix}"
        )
        for mark in bar.marks:
            at = epoch(mark.ts) - box.start_epoch
            lines.append(
                f"{'·':>3}  {at:>8.3f}  {'event':>8}  {_clip(mark.app, app_w):<{app_w}}"
                f"  {_clip(mark.ws, ws_w):<{ws_w}}  {mark.kind.ljust(kind_w)}  {MARK} {mark.kind}"
            )
    return lines


def render(waterfall: Waterfall, *, bar_width: int = BAR_WIDTH) -> str:
    """The whole view as text: one box per task, then the counts."""
    out: list[str] = []
    days = waterfall.window.days
    span = (
        f"{_iso(waterfall.window.since) or 'start'} .. "
        f"{_iso(waterfall.window.until) or 'now'}"
        f"{'' if days is None else f'  ({days:g} d)'}"
    )
    out.append(f"tasktrace waterfall — window {span}")
    out.append(
        f"{_plural(waterfall.spans, 'span')} in {_plural(len(waterfall.boxes), 'task')}"
        f" · wall {waterfall.wall_s:.3f} s"
    )
    out.append("")
    if not waterfall.boxes:
        out.append("no spans inside the window")
        return "\n".join(out)

    for box in waterfall.boxes:
        lines = render_box(box, bar_width=bar_width)
        width = max(len(line) for line in lines) + 2
        out.append("┌─" + "─" * (width - 1) + "┐")
        for line in lines:
            out.append("│ " + line.ljust(width - 1) + "│")
        out.append("└" + "─" * width + "┘")
        out.append("")

    out.append("summary")
    out.append(
        f"  {'#':>2}  {'key':<32}  {'task_id':<12}  {'spans':>5}  {'events':>6}"
        f"  {'runs':>4}  {'wall_s':>8}  {'longest_s':>9}  longest span"
    )
    for index, box in enumerate(waterfall.boxes, start=1):
        longest = box.longest
        out.append(
            f"  {index:>2}  {box.key:<32}  {box.task_id:<12}  {box.spans:>5}"
            f"  {box.events:>6}  {box.runs:>4}  {box.wall_s:>8.3f}"
            f"  {longest.duration_s if longest else 0.0:>9.3f}"
            f"  {_clip(longest.app if longest else None, 18)}"
            f" (ws {_clip(longest.ws if longest else None, 6)})"
        )
    best = waterfall.longest
    out.append("")
    out.append(
        f"{_plural(waterfall.spans, 'span')} · {_plural(len(waterfall.boxes), 'task')}"
        f" · {waterfall.wall_s:.3f} s wall"
        + ("" if best is None else f" · longest span {best[0]:.3f} s ({best[1]})")
    )
    return "\n".join(out)

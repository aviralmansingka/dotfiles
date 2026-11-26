"""Stitch span rows into task traces.

A *task* is one (workspace, project root) pair, so coming back to the same pair
after lunch continues the same task. A *trace* is one run of attention inside a
task: a gap, a workspace change, a project change or an explicit `done` closes
the trace, and the next span opens a new one with the same task key.

Rules, all of them:

- the project root comes from the window title (`parse_project`); a title that
  names no project records ``None``, never a guess;
- ``task_id`` is a hash of (workspace, project root), so the same pair always
  gets the same key, across days and reboots;
- the gap is measured on ``ts`` (wall clock, stamped by the server), never on
  ``mono``: mono restarts at boot, so a reboot would show up as a bogus gap;
- a gap under ``MERGE_GAP_S`` (120 s) merges into the open trace; 120 s or more
  splits it;
- a span with no workspace of its own (the NSWorkspace agent, the rex bridge)
  takes the workspace of the open trace, and a span whose title gives no project
  keeps the open trace's project;
- a value that goes from unknown to known adopts the open trace instead of
  splitting it: the first titled span in a titleless run is evidence, not a
  change;
- a ``done`` row closes the trace it belongs to.

The span keeps its own ``project`` (``null`` when the title gave none) and also
carries the ``task_id`` of the trace it joined, so one gap never rewrites what a
span itself said.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable, Mapping, Sequence

MERGE_GAP_S = 120.0

# Titles put the document or project first and the app's own chrome last, so
# segments are read left to right: "cli.py - dotfiles - Visual Studio Code".
_SEPARATOR = re.compile(r"\s+[—–|·]\s+|\s+::\s+|\s+-\s+")
_QUALIFIER = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]\s*$")
_FILE = re.compile(
    r"\.(?:md|py|go|rs|ts|tsx|js|jsx|lua|sh|nix|toml|json|ya?ml|txt|c|h|m|mm"
    r"|java|rb|sql|html|css|conf|lock|org|tex)$",
    re.IGNORECASE,
)
_GENERIC = frozenset({"", "untitled", "new tab", "login", "cursor", "home", "settings"})


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def title_of(row: Mapping[str, Any]) -> str | None:
    """The window title a span recorded, from the span's own detail first."""
    detail = row.get("detail")
    if isinstance(detail, Mapping):
        for key in ("title", "window_title"):
            found = _text(detail.get(key))
            if found:
                return found
    return _text(row.get("title"))


def segments(title: str) -> list[str]:
    """Split a window title into its project-shaped pieces."""
    return [part.strip() for part in _SEPARATOR.split(title) if part.strip()]


def _path_root(segment: str) -> str | None:
    """Project root from a path-shaped segment, or None when it is not a path."""
    if "://" in segment:
        return None
    token = segment.split()[0].strip("\"'`")
    if not (token.startswith("~") or token.startswith("/") or "/" in token):
        return None
    parts = [part for part in token.split("/") if part not in ("", ".", "~")]
    if parts and parts[0].lower() == "users" and len(parts) > 2:
        parts = parts[2:]  # /Users/<name>/<root>
    elif parts and parts[0].lower() in ("home", "root") and len(parts) > 1:
        parts = parts[1:]  # Linux /home/<name>/<root>
    if not parts:
        return None
    if _FILE.search(parts[-1]) and len(parts) > 1:
        parts = parts[:-1]  # a file is not a project root
    # The first component is the root; anything deeper is a file inside it.
    return parts[0] if parts else None


def parse_project(title: str | None, app: str | None = None) -> str | None:
    """Project root named by a window title, or None when the title names none."""
    title = _text(title)
    if not title:
        return None
    app_key = (app or "").strip().casefold()
    for segment in segments(title):
        found = _path_root(segment)
        if found:
            return found
        cleaned = _QUALIFIER.sub("", segment).strip().strip("•*+").strip()
        if not cleaned:
            continue
        if app_key and cleaned.casefold() == app_key:
            continue  # the title is only the app's own name
        if _FILE.search(cleaned):
            continue  # the title names a file, not a project
        if cleaned.casefold() in _GENERIC:
            continue
        return cleaned
    return None


def task_id(workspace: str | None, project: str | None) -> str:
    """Stable key for a (workspace, project root) pair."""
    preimage = "\x1f".join("" if value is None else value for value in (workspace, project))
    return hashlib.sha256(preimage.encode("utf-8")).hexdigest()[:12]


def task_key(workspace: str | None, project: str | None) -> str:
    """Readable name for the same pair: `1/dotfiles`, `2-/-`, `-/dotfiles`."""
    return f"{workspace or '-'}/{project or '-'}"


def epoch(ts: str) -> float:
    """Wall clock seconds for an ISO 8601 stamp, the only clock a gap may use."""
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()


def _order_key(row: Mapping[str, Any]) -> tuple[float, float]:
    mono = row.get("mono")
    return (epoch(row["ts"]), float(mono) if isinstance(mono, (int, float)) else 0.0)


@dataclass(frozen=True)
class Trace:
    """One uninterrupted run of attention inside a task."""

    index: int
    workspace: str | None
    project: str | None
    start: str
    end: str
    spans: tuple[dict[str, Any], ...]

    @property
    def task_id(self) -> str:
        return task_id(self.workspace, self.project)

    @property
    def key(self) -> str:
        return task_key(self.workspace, self.project)

    @property
    def span_count(self) -> int:
        return len(self.spans)

    @property
    def wall_s(self) -> float:
        return round(epoch(self.end) - epoch(self.start), 3)

    @property
    def apps(self) -> list[str]:
        seen: dict[str, None] = {}
        for span in self.spans:
            name = span.get("app")
            if name:
                seen.setdefault(name, None)
        return list(seen)

    def dump(self, *, with_spans: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "trace": self.index,
            "start": self.start,
            "end": self.end,
            "wall_s": self.wall_s,
            "spans": self.span_count,
            "apps": self.apps,
        }
        if with_spans:
            payload["rows"] = [dict(span) for span in self.spans]
        return payload


@dataclass(frozen=True)
class Task:
    """One (workspace, project root) pair and every trace inside it."""

    workspace: str | None
    project: str | None
    traces: tuple[Trace, ...]

    @property
    def task_id(self) -> str:
        return task_id(self.workspace, self.project)

    @property
    def key(self) -> str:
        return task_key(self.workspace, self.project)

    @property
    def span_count(self) -> int:
        return sum(trace.span_count for trace in self.traces)

    @property
    def wall_s(self) -> float:
        # Attention time only: the gaps between traces belong to no task.
        return round(sum(trace.wall_s for trace in self.traces), 3)

    @property
    def start(self) -> str:
        return self.traces[0].start

    @property
    def end(self) -> str:
        return self.traces[-1].end

    def dump(self, *, with_spans: bool = True) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "key": self.key,
            "workspace": self.workspace,
            "project": self.project,
            "spans": self.span_count,
            "traces": len(self.traces),
            "wall_s": self.wall_s,
            "start": self.start,
            "end": self.end,
            "runs": [trace.dump(with_spans=with_spans) for trace in self.traces],
        }


@dataclass
class _Open:
    workspace: str | None
    project: str | None
    start: str
    end: str


def _span_view(row: Mapping[str, Any], project: str | None) -> dict[str, Any]:
    detail = row.get("detail")
    title = title_of(row)
    return {
        "ts": row.get("ts"),
        "mono": row.get("mono"),
        "kind": row.get("kind"),
        "app": row.get("app"),
        "ws": row.get("ws"),
        "idle_s": row.get("idle_s"),
        "project": project,
        "title": title,
        "task_id": None,
        "key": None,
        "trace": None,
        "detail": dict(detail) if isinstance(detail, Mapping) else {},
    }


def _splits(
    open_: _Open, ts: str, workspace: str | None, project: str | None, merge_gap_s: float
) -> bool:
    if epoch(ts) - epoch(open_.end) >= merge_gap_s:
        return True
    if workspace is not None and open_.workspace is not None and workspace != open_.workspace:
        return True
    if project is not None and open_.project is not None and project != open_.project:
        return True
    return False


def stitch(rows: Iterable[Mapping[str, Any]], merge_gap_s: float = MERGE_GAP_S) -> list[Task]:
    """Group span rows into tasks, and each task into traces."""
    traces: list[Trace] = []
    open_: _Open | None = None
    spans: list[dict[str, Any]] = []
    last_ws: str | None = None

    def close() -> None:
        assert open_ is not None
        index = len(traces) + 1
        for span in spans:
            span["task_id"] = task_id(open_.workspace, open_.project)
            span["key"] = task_key(open_.workspace, open_.project)
            span["trace"] = index
        traces.append(
            Trace(
                index=index,
                workspace=open_.workspace,
                project=open_.project,
                start=open_.start,
                end=open_.end,
                spans=tuple(spans),
            )
        )
        spans.clear()

    for row in sorted(rows, key=_order_key):
        ts = str(row.get("ts"))
        own_ws = _text(row.get("ws"))
        if own_ws:
            last_ws = own_ws
        own_project = parse_project(title_of(row), _text(row.get("app")))
        workspace = own_ws if own_ws is not None else (open_.workspace if open_ else last_ws)
        project = own_project if own_project is not None else (open_.project if open_ else None)

        if open_ is not None and _splits(open_, ts, workspace, project, merge_gap_s):
            close()
            open_ = None

        if open_ is None:
            open_ = _Open(workspace=workspace, project=project, start=ts, end=ts)
        else:
            # Unknown -> known is evidence about the same run, not a change.
            if open_.workspace is None and workspace is not None:
                open_.workspace = workspace
            if open_.project is None and project is not None:
                open_.project = project

        spans.append(_span_view(row, own_project))
        open_.end = ts

        if row.get("kind") == "done":
            close()
            open_ = None

    if open_ is not None:
        close()

    ordered: dict[tuple[str | None, str | None], list[Trace]] = {}
    for trace in traces:
        ordered.setdefault((trace.workspace, trace.project), []).append(trace)
    return [
        Task(workspace=key[0], project=key[1], traces=tuple(group))
        for key, group in ordered.items()
    ]


def annotate(
    rows: Iterable[Mapping[str, Any]], merge_gap_s: float = MERGE_GAP_S
) -> Sequence[dict[str, Any]]:
    """Every span row with its project, task_id, key and trace index filled in."""
    found: list[dict[str, Any]] = []
    for task in stitch(rows, merge_gap_s):
        for trace in task.traces:
            found.extend(dict(span) for span in trace.spans)
    found.sort(key=lambda span: (epoch(span["ts"]), span.get("mono") or 0.0))
    return found

"""The nine collector hook entry points.

AeroSpace can run commands on nine different surfaces.  Each one maps to one
`tasktrace hook <entry>` invocation; eight of them call `exec-and-forget`, and
`exec-on-workspace-change` (the one surface that takes a raw process vector
instead of AeroSpace commands) calls the same hook through `/bin/sh`.

`tasktrace hooks` prints the table, so the paste lines never drift from the code.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .schema import Event, build

HOOK_BIN = "tasktrace-hook"


@dataclass(frozen=True)
class Hook:
    name: str
    kind: str
    source: str
    surface: str
    line: str
    note: str = ""

    def event(
        self,
        env: Mapping[str, str],
        *,
        frontmost: tuple[str | None, str | None] = (None, None),
        ws: str | None = None,
        title: str | None = None,
        idle_s: float | None = None,
        label: str | None = None,
        ts: str | None = None,
        mono: float | None = None,
    ) -> Event:
        app = env.get("TASKTRACE_APP") or frontmost[0]
        bundle = env.get("TASKTRACE_BUNDLE") or frontmost[1]
        workspace = (
            env.get("AEROSPACE_FOCUSED_WORKSPACE")
            or env.get("AEROSPACE_WORKSPACE")
            or env.get("TASKTRACE_WS")
            or ws
        )
        detail: dict[str, Any] = {"hook": self.name}
        window_id = env.get("AEROSPACE_FOCUSED_WINDOW_ID") or env.get("AEROSPACE_WINDOW_ID")
        if window_id:
            detail["window_id"] = window_id
        prev = env.get("AEROSPACE_PREV_WORKSPACE")
        if prev:
            detail["prev_ws"] = prev
        if label:
            detail["label"] = label
        # The window title is what the task stitcher reads its project root from.
        if title:
            detail["title"] = title
        return build(
            {
                "kind": self.kind,
                "app": app,
                "bundle": bundle,
                "ws": workspace,
                "idle_s": idle_s,
                "source": self.source,
                "detail": detail,
            },
            ts=ts,
            mono=mono,
        )


HOOKS: dict[str, Hook] = {
    "focus": Hook(
        name="focus",
        kind="app",
        source="aerospace",
        surface="on-focus-changed (window or workspace focus)",
        line=f"on-focus-changed = ['exec-and-forget {HOOK_BIN} focus']",
        note="Fires on every focused-window and focused-workspace change. "
        "app/bundle/ws come from the AeroSpace env (when it sends a workspace) "
        "or from a live query of the focused window.",
    ),
    "workspace": Hook(
        name="workspace",
        kind="ws",
        source="aerospace",
        surface="exec-on-workspace-change (raw process vector)",
        line=f"exec-on-workspace-change = ['/bin/sh', '-c', 'exec \"{HOOK_BIN}\" workspace']",
        note="The only surface that is not an AeroSpace command list, so it cannot "
        "call exec-and-forget; it runs the same hook through /bin/sh. "
        "AEROSPACE_FOCUSED_WORKSPACE / AEROSPACE_PREV_WORKSPACE are read here.",
    ),
    "monitor": Hook(
        name="monitor",
        kind="monitor",
        source="aerospace",
        surface="on-focused-monitor-changed",
        line=(
            "on-focused-monitor-changed = ['move-mouse monitor-lazy-center', "
            f"'exec-and-forget {HOOK_BIN} monitor']"
        ),
        note="Merge into the existing list; this repo's config already sets the first entry.",
    ),
    "mode": Hook(
        name="mode",
        kind="mode",
        source="aerospace",
        surface="on-mode-changed",
        line=f"on-mode-changed = ['exec-and-forget {HOOK_BIN} mode']",
    ),
    "window": Hook(
        name="window",
        kind="window",
        source="aerospace",
        surface="[[on-window-detected]] run",
        line=f"run = [\"exec-and-forget {HOOK_BIN} window\"]",
        note="Paste inside a [[on-window-detected]] rule; the rule's env carries AEROSPACE_WINDOW_ID.",
    ),
    "startup": Hook(
        name="startup",
        kind="boot",
        source="aerospace",
        surface="after-startup-command",
        line=f"after-startup-command = ['exec-and-forget {HOOK_BIN} startup']",
    ),
    "login": Hook(
        name="login",
        kind="boot",
        source="aerospace",
        surface="after-login-command",
        line=f"after-login-command = ['exec-and-forget {HOOK_BIN} login']",
    ),
    "binding": Hook(
        name="binding",
        kind="bind",
        source="aerospace",
        surface="[mode.<name>.binding] value list",
        line=(
            "alt-1 = ['workspace 1', "
            f"'exec-and-forget {HOOK_BIN} binding alt-1']"
        ),
        note="Optional label argument names the key; bindings that switch workspace "
        "already produce a ws row through on-focus-changed.",
    ),
    "app": Hook(
        name="app",
        kind="app",
        source="probe",
        surface="any shell (LaunchAgent, after-login-command, a hotkey)",
        line=f"exec-and-forget {HOOK_BIN} app",
        note="Snapshot row for the frontmost app without AeroSpace context; "
        "the long-lived NSWorkspace agent covers activations with no polling.",
    ),
}


def build_event(
    name: str,
    env: Mapping[str, str],
    *,
    frontmost: tuple[str | None, str | None] = (None, None),
    ws: str | None = None,
    title: str | None = None,
    idle_s: float | None = None,
    label: str | None = None,
    ts: str | None = None,
    mono: float | None = None,
) -> Event:
    hook = HOOKS.get(name)
    if hook is None:
        raise KeyError(f"unknown hook {name!r}; known hooks: {', '.join(HOOKS)}")
    return hook.event(
        env,
        frontmost=frontmost,
        ws=ws,
        title=title,
        idle_s=idle_s,
        label=label,
        ts=ts,
        mono=mono,
    )

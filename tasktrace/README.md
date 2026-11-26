# tasktrace

Collects attention spans — which app, on which workspace, when — into sqlite and
a daily JSONL, then stitches them into task traces: one task per (workspace,
project root), one trace per uninterrupted run of attention. This is the
attention-trace mission through step S02; the waterfall comes later.

```
                 ┌──────────────────────────┐
NSWorkspace ────►│                          │
AeroSpace hooks ►│  unix socket (NDJSON)    ├──► spans.sqlite3
rex events ─────►│                          ├──► events/YYYY-MM-DD.jsonl
                 └──────────────────────────┘
```

## Run

```sh
uv run --project tasktrace tasktrace serve          # socket + sinks
uv run --project tasktrace tasktrace app-agent      # NSWorkspace activation agent
uv run --project tasktrace tasktrace rex -s <label> # bridge `rex events --json`
uv run --project tasktrace tasktrace spans          # dump span rows
uv run --project tasktrace tasktrace traces         # dump the stitched task traces
```

Defaults: home `~/.local/state/tasktrace` (`TASKTRACE_HOME`), socket
`<home>/sock` (`TASKTRACE_SOCK`). `tasktrace serve` prints both.

## One event per line

Every emitter sends one JSON object per line to the socket:

```json
{"kind":"app","app":"Ghostty","bundle":"com.mitchellh.ghostty","ws":"A","idle_s":12.5,"source":"aerospace","detail":{}}
```

`ts` and `mono` are stamped by the server when the emitter omits them, so a slow
hook cannot backdate a row. `kind` is one of `app ws rex monitor mode window boot
bind idle notify agent_done done`; an unknown kind is refused without killing the
server. Every row carries `ts mono kind app bundle ws idle_s` (plus `source` and
`detail`); a probe that cannot answer records `null` instead of a guess.

Sinks, written together under the home directory:

- `spans.sqlite3` — table `spans(id, ts, mono, kind, app, bundle, ws, idle_s, source, detail)`, indexed on `ts` and `kind`.
- `events/<YYYY-MM-DD>.jsonl` — the same rows, one per line, split by local date.

`tasktrace spans [--json] [--kind K] [--limit N]` dumps them.

## Emitters

### NSWorkspace activation agent (`agent/AppFocus.m`)

A ~110 line Objective-C program built once with `clang -fobjc-arc -framework
AppKit -framework CoreGraphics`. It observes
`NSWorkspaceDidActivateApplicationNotification` (and launch), and writes `kind:
app` with the localized name, bundle id, pid and `idle_s` from
`CGEventSourceSecondsSinceLastEventType`. One row per activation, no polling, no
permissions prompt. It does not know AeroSpace workspaces, so its `ws` is null;
the hook rows carry the workspace.

Built with clang rather than swiftc: on this host the CommandLineTools Swift 6.1
compiler cannot build against the installed macOS 26 SDK, while clang matches it.

### AeroSpace hooks

One line was added to `aerospace/.aerospace.toml`:

```toml
on-focus-changed = ['exec-and-forget tasktrace-hook focus']
```

`exec-and-forget` runs the string through `/bin/bash -c`, so the program name is
resolved on `PATH` — which is why the hook comes from the nix profile, not from a
repo path. AeroSpace runs its hooks with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`,
where `uv` does not exist: a shim that calls `uv run` dies with 127. The nix
package (`nix/pkgs/tasktrace.nix`) wraps the stdlib-only CLI with its own
`python3`, so `tasktrace` and `tasktrace-hook` are both on `PATH` after a profile
switch and a hook needs no repository checkout at all.

`tasktrace-hook <entry> [args…]` is `tasktrace hook <entry> [args…]`; no argument
means `focus`. It reads the callback environment, probes the focused window
(app, bundle, workspace and window title), and sends one row. `bin/tasktrace-hook`
is the dev shim for the worktree: it finds `uv` by candidate paths, and no test
depends on it.

AeroSpace documents exactly four callback variables — `AEROSPACE_WINDOW_ID`,
`AEROSPACE_WORKSPACE` (one of the two, for focus callbacks), and
`AEROSPACE_FOCUSED_WORKSPACE` / `AEROSPACE_PREV_WORKSPACE` (workspace-change).
When only a window id is present the hook asks the running AeroSpace server
(`aerospace list-windows --focused --format '%{app-name}|%{app-bundle-id}|%{workspace}|%{window-title}'`)
for app, bundle, workspace and window title, and falls back to `lsappinfo` if
that fails. The title lands in `detail.title`; it is what the stitcher reads the
project root from.
`idle_s` comes from `ioreg`'s `HIDIdleTime`. `tasktrace hooks` prints the entry
points and the line to paste for each.

| entry point | AeroSpace surface | line |
| --- | --- | --- |
| `focus` | `on-focus-changed` | `on-focus-changed = ['exec-and-forget tasktrace-hook focus']` |
| `workspace` | `exec-on-workspace-change` (raw process, so no `exec-and-forget`) | `exec-on-workspace-change = ['/bin/sh', '-c', 'exec "tasktrace-hook" workspace']` |
| `monitor` | `on-focused-monitor-changed` | `on-focused-monitor-changed = ['move-mouse monitor-lazy-center', 'exec-and-forget tasktrace-hook monitor']` |
| `mode` | `on-mode-changed` | `on-mode-changed = ['exec-and-forget tasktrace-hook mode']` |
| `window` | `[[on-window-detected]] run` | `run = ["exec-and-forget tasktrace-hook window"]` |
| `startup` | `after-startup-command` | `after-startup-command = ['exec-and-forget tasktrace-hook startup']` |
| `login` | `after-login-command` | `after-login-command = ['exec-and-forget tasktrace-hook login']` |
| `binding` | `[mode.<name>.binding]` value | `alt-1 = ['workspace 1', 'exec-and-forget tasktrace-hook binding alt-1']` |
| `app` | any shell (LaunchAgent, hotkey) | `exec-and-forget tasktrace-hook app` |

Only `focus` is wired in the repo config: it fires on every window and workspace
focus change, which is the whole attention signal. The rest are one-paste
extras; `exec-on-workspace-change` is the exception that cannot call
`exec-and-forget`, because it takes a raw argv vector instead of AeroSpace
commands.

Empty-workspace limit: when focus lands on a workspace with no window, AeroSpace
sets `AEROSPACE_WORKSPACE` and the row is written with `app: null` and that
`ws`. Nothing is invented to fill the app.

### rex bridge (`tasktrace rex`)

Spawns `rex events --json` and keeps the session's block lifecycle rows:
`block_created`, `block_closed`, `block_removed`, `block_exited`,
`block_owner_changed`, `block_renamed`, `block_focused`, `block_state_changed`,
`block_title_changed`, `custom`, plus `session_created` / `session_removed` /
`session_closed`. Client connect/disconnect and view/layout revisions are
dropped: they are noise, not attention. `--stdin` replays a capture through the
same filter.

## Task traces (`tasktrace traces`)

A *task* is one `(workspace, project root)` pair, so coming back to the same pair
continues the same task. A *trace* is one run of attention inside a task. Every
span gets `task_id`, the key of the task it joined.

- `task_id` = `sha256(workspace \x1f project)[:12]`, so the key is stable across
  days, restarts and re-imports.
- The project root is parsed from the window title: a path-shaped segment names
  its first component (`~/dotfiles/src/cli.py` → `dotfiles`), otherwise the first
  segment that is not the app's own name (`leaf - Google Chrome - Aviral (Mohzi)`
  → `leaf`). A title that names nothing is recorded as a null project, never
  guessed; the span keeps that null, and `tasktrace traces` shows the task the
  span joined.
- A gap under 120 s merges into the open trace; 120 s or more splits it.
- A workspace change, a project change or an explicit `done` row splits too.
- A workspace that goes from unknown to known, or a project that does, adopts the
  open trace: the first titled span in a titleless run is evidence, not a change.
- Wall time is attention time: a trace runs from its first span to its last, and
  a task's wall time sums its traces, so the gaps between traces never count.

```
$ tasktrace traces
tasks:
key                             task_id      spans  traces  wall_s
1/captain-fleet-provisioning-api 5eccee54da1d 3      2       2.137
2/leaf                          35de7701bafc 4      2       0.173
2/dotfiles                      01f37fbbaccd 1      1       0.0

traces:
key                             trace  start  end  spans  wall_s  apps
1/captain-fleet-provisioning-api 1      …      …    2      2.137   Rex Beta
1/captain-fleet-provisioning-api 2      …      …    1      0.0     Rex Beta
2/leaf                          3      …      …    3      0.173   Google Chrome,Microsoft AutoUpdate
2/leaf                          4      …      …    1      0.0     Google Chrome
2/dotfiles                      5      …      …    1      0.0     Google Chrome
```

`--json` prints one object per task with its runs and rows, and `--limit N` keeps
only the newest N spans.

## Recorded sample

`tasktrace/samples/2026-11-26/` holds a real recording: `events/` (collector
output), `spans.tsv` (the same rows from sqlite), `input/rex-capture.jsonl` (the
raw rex lines replayed) and a README saying which parts ran live. Re-record with:

```sh
uv run --project tasktrace python tasktrace/scripts/record_sample.py
```

The recorder runs the real agent, activates the named apps, runs the shim through
`/bin/bash -c` exactly as `exec-and-forget` does (with the live AeroSpace window
id, then two workspace switches), and replays the rex capture. It does not
switch the live workspace: AeroSpace's focus callbacks on this host would move
the user's screen mid-recording, so the hook is fed the environment AeroSpace
passes instead.

## Tests

```sh
uv run --project tasktrace pytest -q
```

All offline: no live pi sessions, no nvim, no multiplexer servers. Servers listen
on a socket under `/tmp`, probes are injected, and the sample test only reads
committed files.

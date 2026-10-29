# Repository Agent Instructions

## Python packaging

- Use `uv` for every Python project and command.
- Every `pyproject.toml` build system must use `requires = ["uv_build"]` and `build-backend = "uv_build"`.
- Do not introduce Hatch or Hatchling.

## Sidekick and Herdr session invariants

Treat repository, worktree, and session identity as three distinct concepts:

- For Herdr server replacement from Codex, follow the
  [color-safe live handoff procedure](README.md#herdr-server-handoff).
- A Git repository owns exactly one Herdr Workspace. Resolve repository identity from Git's shared common directory,
  so the primary checkout and every linked worktree reuse that same Herdr Workspace.
- A non-`main` Git worktree owns at most one durable Sidekick session. The session runs with that worktree as its cwd,
  inside the repository's Herdr Workspace. The `main` checkout may own multiple named durable sessions.
- If a user asks to launch a session in a non-`main` worktree that already owns one, focus and reuse the existing
  session. On `main`, reuse only an exact session-name match.
- If a user needs another durable session from a non-`main` worktree, create or select a different worktree first.
  Short-lived subagents may run beneath the owning session, but they do not become additional durable Sidekick picker
  sessions for that worktree.
- Do not create one Herdr Workspace per worktree, branch, feature, task, backend, or session label.
- Keep internal Herdr agent names available for routing and lifecycle operations, but do not use them as the primary
  picker identity.

## Worktree tool for change work

Agents making repo changes do not work from `main`. `pi/.pi/agent/extensions/worktree.ts` registers the `worktree`
tool: it creates or reuses `~/.herdr/worktrees/<repo>/<type>-<slug>` from local `main` (always `--no-focus`) and
launches an auto-exit `worker` subagent in the worktree session's first tab, via `executeSubagent` with an internal
`pane` override (guarded against the parent pane, agent-hosting panes, and cwd mismatches). The worker's result
steers back automatically; on clean completion its tab closes and the picker row folds until `herdr worktree open`.
Branches are ownership-marked (`branch.<b>.piWorktree` in git config, the gh-dash-open-pr pattern); anything the tool
does not own is refused. Teardown after ship stays with `/cleanup`.

## Remote subagents on devbox

`pi/.pi/agent/extensions/remote.ts` registers `/remote <task>`: it spawns a pi subagent on the saved Herdr SSH
machine `devbox` — chosen over homelab because its public IP answers from any network (a plane), while homelab needs
Tailscale plus a healthy home uplink. The flow is machine API forwarding only: `agent list` (collision check) →
`tab create --cwd ~ --no-focus` → `agent start --kind pi` → `agent prompt` (fire and forget). No cross-machine steer
exists: results live on devbox and are read by attaching (`herdr --remote devbox` from a Mac, `ssh devbox` then `herdr`
from a phone); bare `/remote` lists remote agents. The extension closes only tabs it created in the same run, and only
when no agent ever started in them. devbox runs its own herdr server (`herdr machine add devbox` prepared it); its pi
credentials are synced from the Mac (`auth.json`, `mcp*.json` under `/root/.pi/agent/`, tokens in `/root/.env`).
Offline suite: `docs/ci-tests/remote.md`.

## Homelab STT and the RTX 3060

The pi-stt speech-to-text worker runs natively on the homelab host; the libvirt VM / vfio-pci passthrough path was
decommissioned. The RTX 3060 belongs to the host NVIDIA driver and is shared between native CUDA STT and Steam.
See `ops/pi-stt/README.md` for the runbook, GPU-return script, and the VM preservation/rollback contract
(`/var/lib/libvirt/images/pi-stt.qcow2` and `~/homelab-pi-stt-decommission/` are preserved; deleting them needs
captain approval).

## Sidekick picker presentation

- Group durable sessions as `repository -> worktree`.
- Render one row per durable session. Non-`main` worktrees have one row; `main` may have multiple session-named rows.
  Do not repeat a session name that restates a non-`main` worktree name.
- Prefix every non-`main` Git branch row with `` and color both the marker and branch name with the existing Gruvbox
  pink `SidekickBranch` highlight; do not color non-`main` branch identity by agent backend. Retain the Herdr status
  glyph.
- Treat a `main` branch row as the neutral checkout: show its durable Sidekick session name with agent backend chrome,
  but render it without the branch marker and without line-diff totals. Non-Git session rows also retain their agent
  backend chrome.
- For non-`main` branches, show tracked line additions and removals against local `main` as `+<added> −<removed>`;
  show `clean` when both are zero.
- Keep the current-worktree session rows in the picker alongside the repository hierarchy. Selection, preview, rename,
  kill, and focus actions must continue to target the exact underlying Herdr agent identity.
- Preserve exact cwd behavior for non-Git directories instead of inventing repository identity.

## herdr-nvim sidebar

`prefix+t` toggles the per-tab persistent nvim sidebar; `prefix+o` opens its
agent-touched file picker (ChmaraX/herdr-nvim — Herdr half machine-installed via
`herdr plugin install`, nvim half at `nvim/.config/nvim/lua/plugins/herdr-nvim.lua`).
A live sidebar daemon is the tab's editor: `nvim_open`/`/nvim` attach to it through
its registry socket (`<tab key>.sock` — tab id with `:`→`_` — under
`$XDG_RUNTIME_DIR/herdr-nvim`, else the temp dir) instead of launching a duplicate
split, and focus-buffer drives lesson buffers through the same socket. When the
sidebar pane is hidden, the agent only reports it (press prefix+t): a plugin
action invoke resolves to the focused tab and can land in another workspace, and
a raw `plugin pane open` bypasses the plugin's state/layout machinery and
corrupts the next toggle. The user's own prefix+t is the only correct show path.
Every nvim editor launch (extension tool, `/nvim`, md-log/quiz library call, skill
script) appends a provenance line to `~/.cache/pi/nvim-open-launches.log` — read it
to attribute orphan editor panes; panes with no log line were launched outside pi
(Herdr plugin layer).
`annotate-review.open` lost its chord to the picker; the reply reviewer keeps
`prefix+shift+o`.

## terminal-browser

The agent skill is repo-owned at `agents/.agents/skills/terminal-browser` (vendored
from upstream v0.13.4). The binary's own skill linking is declined via
`~/.local/state/terminal-browser/skills-choice`, so it never replaces the
stow-managed symlink — keep `TERMINAL_BROWSER_SKIP_SETUP=1` on any installer or
`herdr plugin install` run (the plugin's build step runs the installer, whose
explicit `setup` ignores the decline). The pinned herdr plugin
(`zenbu-labs/terminal-browser/herdr-plugin`) and the macOS cask are provisioned
by `install.sh`, which also pins `render.fps=30` (upstream issue #102: fps 60
silently disables throttling and renders at the display rate; keep
`TERMINAL_BROWSER_FPS` unset everywhere). Ubuntu 24.04 hosts need one
interactive `terminal-browser setup`
(sudo) for the AppArmor userns profile.

## Patched herdr graphics (flemx patch)

The local herdr binary is patched with `flemx/herdr-graphics-patch` (macOS
file transport for Kitty graphics, 64 MiB export cap, foldhash fingerprints).
Reason: terminal-browser panes died with `pixel engine: unexpected end of file`
within minutes on herdr 0.9.3 (upstream zenbu-labs/terminal-browser#165, #221;
herdrdev/herdr#3946). Measured 2026-10-30 on a 126-col Retina pane (~22 MB
frames): herdr server CPU halved, and the pane survived past the pre-patch
death window. Restore or rebuild after any `herdr update` replaces the binary:
`/tmp/herdr-graphics-patch/update-herdr.sh --restore|` rerun (needs Zig 0.16 +
Rust 1.96.1, staged under `~/.cache/herdr-graphics-patch/tools/`). Drop the
patch once herdr ships these fixes upstream (watch zenbu-labs #221).

## visualization and artifact skills

`artifact` (vendored from upstream careerhackeralex/visualize v0.3.0, MIT, renamed)
builds single-file HTML artifacts — decks, dashboards, infographics — and routes
graph-shaped requests to `visualize` by default. `visualize` is the ratatui-only skill:
live node graphs from a JSON spec through `rataflow-view` (crate in `rataflow/`, a thin
wrapper on the `rataflow` crate) in a herdr pane (`pane split` + `pane run`) — gruvbox
styling, plain background, and animated flow dots on edges with a `flow` speed. Chat
replies use the mermaid tool; static ANSI and PNG belong to the mermaid skill. Open
panes through the herdr CLI, never raw tmux, and never paste pane art into chat.
install.sh builds the binary (`cargo install --path rataflow --locked`);
`scripts/test-rataflow.py` is the offline CI suite, with `RATAFLOW_BUILD=1` adding the
cargo tests as a local pre-merge gate.

## no-mistakes Herdr bridge invariants

The no-mistakes daemon's step agents run as visible Herdr subagent tabs when the triggering
session is inside Herdr (`scripts/install-nm-herdr-bridge`, upstream `agent_path_override.pi`).
These rules are load-bearing:

- Every step invocation owns a fresh tab and closes it after delivery; fixer rounds resume
  the durable session file in a fresh tab. Teardown (run terminal, session shutdown, extension
  reload) also closes panes so a later headless `--session` resume never meets a second writer;
  the shim then passthroughs to real pi with unchanged argv and stdin.
- Auto-exit subagents that finish cleanly close their whole Herdr tab (interactive subagents
  keep parking for the user), so an orphaned sibling pane can never hold the tab open after
  its session is done; the nvim-open extension likewise closes editor panes it created when
  a subagent session shuts down, while captain sessions leave editor panes open for the human.
- Subagent tab ownership is durable: the spawner's name registry (`subagent-registry.json`)
  marks each child `running` with its pane id until its result steer lands. A parent process
  death (deadline tab close, crash) leaves children ownerless — session_start adoption probes
  each still-marked pane: alive re-adopts it under a fresh watcher (result delivered, tab
  closed on real completion), dead finalizes it now (harvest, deliver, close the tab).
  `subagent_message` probes the same mark before resuming, so a live orphan is steered, never
  duplicated onto one session file.
- Pane state surfaces are Herdr's sanctioned ones only: `pane report-metadata --state-label`
  for display and the `herdr:blocked` event for the CI red state. Never report pane state
  from another source or impersonate a `herdr:` source - a second source cannot override the
  holder, and a seq-locked `herdr:` source mutes the managed reporter for the whole session.
- Step-agent tabs run `pi --no-extensions` with one closed set loaded explicitly
  (`STEP_AGENT_EXTENSIONS` in `pi/.pi/agent/extensions/no-mistakes-pane/bridge.ts`):
  pane-state reporters, capability tools (python, web-fetch, web-search, mermaid), and tab
  chrome. The parent's pipeline machinery (no-mistakes-gate, no-mistakes-pane,
  interactive-subagents, tuicr) and human-blocking tools never load inside a step agent -
  keep it that way when adding extensions. Every pi subagent spawned by interactive-subagents
  gets the parent's tool-call renderer as a baseline explicit `-e` (deduped by pi; skipped when
  absent) - the curated step-agent set above stays curated and unchanged.
- A run started from a Herdr captain session is owned by the `nm-orchestrator` subagent tab
  (tuicr-review architecture, `no-mistakes-pane/orchestrate.ts` + the bundled agent). It drives
  axi run/respond and owns the attach pane, gate panels, pane labels, and the step-agent
  bridge; the captain keeps read-only status/logs, abort as the escape hatch, and the
  orchestrator's final summary steer. Delegation never nests (subagent sessions execute
  directly) and falls back to direct driving without a TUI or spawn API - headless behavior
  is unchanged. The bundled nm-orchestrator declares `agent-dir: parent`, keeping the
  captain's configured agent dir instead of a repo-local `.pi/agent` redirect.
- Step-agent tab closes are clean exits: the tab's pi is asked to quit (Ctrl+D, Ctrl+C
  fallback); after confirmed exit, `pane release-agent --source herdr:pi --agent pi` clears
  its identity before `pane close`. A terminated step agent must never surface as an
  agent-killed notification in the hosting session.

## no-mistakes gate test and lint runners

The gate's Test and Lint steps run the pinned offline runners from `.no-mistakes.yaml`
(`scripts/nm-test.sh`, `scripts/nm-lint.sh`) — the same offline suite as
`.github/workflows/ci.yml`. Gate/step agents must never improvise tests that launch live
sessions: no real pi sessions, no nvim, no tmux/multiplexer servers. The 2026-10-11
professor-test incident (run 01M4NRT2XKCHANREB6YFBPX6Q9) improvised a live harness,
timed out, and leaked nvim processes on the host.

Both runners discover targets with `git ls-files` — every `scripts/test-*` entry and
`pi/.pi/agent/extensions/**/*.test.mjs` joins automatically; never hand-list tests.
Per-component coverage, runtime SLA, and the full rules live in `docs/ci-tests/README.md`;
the no-mistakes runbook (commands, skip-vs-fail semantics, how to add coverage) is
`docs/ci-tests/no-mistakes-ci.md`. A new suite is a `scripts/test-<name>.*` entry with a
`# Paths:` header (`// Paths:` for .mjs) plus a `/simple` doc in `docs/ci-tests/`.

## CUDA LSP host invariant

NVIDIA ships no CUDA Toolkit for macOS Apple Silicon. `.cu` files get
local-symbol LSP only on the Mac (document symbols, local go-to-def/hover
work; CUDA-API symbols like `cudaMalloc`/`__nv_bfloat16` do not). Full
CUDA LSP needs the homelab/Linux CUDA Toolkit + a compile database.
`helpers/cuda_lsp.lua` detects this and notifies once per session; do not
try to stub CUDA headers or silence the clangd CUDA diagnostics. Authoritative
setup + homelab command: `docs/neovim-cuda-lsp.md`.

## Herdr pane tty sever and the stdin-reattach guard

Herdr (0.9.3; unfixed in 0.9.4/0.9.5) can reset a pane's tty to cooked mode
mid-session and let a Ctrl+D byte EOF the pane program's stdin — pi then
becomes an input-dead zombie (the "mermaid stuck input" incident; mermaid
itself is exonerated — see BUGS.md). `pi/.pi/agent/extensions/stdin-reattach.ts`
rescues the live session in place: it re-opens the pane tty path, restores
raw mode, feeds pi's own StdinBuffer, patches stdout/stderr onto the fresh
fds, re-negotiates terminal modes, and force-repaints. Keep that extension
loaded in every interactive session; it arms only when stdin is a real tty,
so rpc/json/print modes are unaffected, and it exits 129 only when no tty
can be re-opened at all (a real pane close). Note `node:fs` no longer exports
`execFileSync` on node 26 — take it from `node:child_process`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

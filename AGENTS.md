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

## CUDA LSP host invariant

NVIDIA ships no CUDA Toolkit for macOS Apple Silicon. `.cu` files get
local-symbol LSP only on the Mac (document symbols, local go-to-def/hover
work; CUDA-API symbols like `cudaMalloc`/`__nv_bfloat16` do not). Full
CUDA LSP needs the homelab/Linux CUDA Toolkit + a compile database.
`helpers/cuda_lsp.lua` detects this and notifies once per session; do not
try to stub CUDA headers or silence the clangd CUDA diagnostics. Authoritative
setup + homelab command: `docs/neovim-cuda-lsp.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

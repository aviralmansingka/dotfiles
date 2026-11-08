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
opens that checkout as a **user-driven tab in the repository's own session** — `herdr pane run <pane> pi` under
Herdr, `rex window new -s $REX_SESSION "π <slug>" --focus=false -c <checkout> -- pi` under Rex. A Rex session is
the analogue of a Herdr workspace, not of a worktree row, so a worktree never gets a session of its own; the tab
is keyed by that label and reused on a repeat call. It launches no subagent, registers no name, and reports no
completion steer; it takes only `branch` and `base`, so a caller that wants a worker uses `subagent` instead. A
reused worktree never starts a second pi. Branches are ownership-marked (`branch.<b>.piWorktree` in git config,
the gh-dash-open-pr pattern); anything the tool does not own is refused.
Teardown after ship stays with `/cleanup`.

`/worktree` is the human entry point, and it is a prompt template, not an extension command:
`pi/.pi/agent/prompts/worktree.md`. The text after the command is either a branch (`feat/build-skill`) or a theme
("the changes in this conversation"). The agent derives the type and slug from that text and the conversation. It
asks no questions and always passes `base: "main"`, so a worktree never starts from the current branch. It then
reports the branch, the path, and the new tab; the human drives that tab.

## Captain prompt budget: deferred tools

Extension tools captains rarely call register with `exposure: "deferred"`: `quiz`, `explain`,
`problem`, `conclude`, `lesson`, `run-command`, `nvim_open`, `tuicr`, `tuicr_review`, `tuicr_reply`.
Deferred tools stay out of the captain's system prompt, tool list, and rules. Subagent profiles
activate what they need through their `tools:` allowlist — professor and tuicr-review already
name these. Captains reach the rest through `tool_search`, enabled via
`defaultTools` in `settings.json` (which also pins `+worktree`). Register new rarely-used tools
deferred and name them in the profiles that need them. The MCP namespace proxies
(`mcp__browserbase`, `mcp__oreilly`, `mcp__mcp`) stay direct: the adapter re-activates them and
`mcp:<server>` references in tool-groups and slow-mode rely on them.

## pi-mcp-adapter OAuth URL patch

The pi-mcp-adapter OAuth URL must reach the TUI through `onAuthorizationUrl` (notification plus
transcript message), never `console.log`: in an interactive session a raw stdout write corrupts
the footer. `scripts/pi-mcp-adapter-patch` re-applies the vendored fix and `install.sh` runs it;
after an adapter upgrade, `--check` reports drift and the anchors need re-deriving.

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

## herdr version and presenter

`herdr` is a profile tool in `nix/modules/shared/default.nix`, so every host runs the version
the flake lock names. The locally patched `0.9.3` build with the flemx graphics patch and
its update script are retired, so do not re-apply them. Leave `render.presenter` unset: the
engine default is `auto`, and `patched` was rejected for partial frames (upstream zenbu-labs
PRs #157/#191).

## visualization and artifact skills

`artifact` (vendored from upstream careerhackeralex/visualize v0.3.0, MIT, renamed)
builds single-file HTML artifacts — decks, dashboards, infographics — and routes
graph-shaped requests to `visualize` by default. `visualize` is the ratatui-only skill:
live node graphs from a JSON spec through `rataflow-view` (crate in `rataflow/`, a thin
wrapper on the `rataflow` crate) in a herdr pane (`pane split` + `pane run`). The renderer
owns the character grid: `rataflow/src/router.rs` gives every edge its own port and an
A*-planned corridor (no shared runs), `group` gives related concepts a hue family
(geometry never groups), declared `trunks` draw one bus that splits, `dots: 1` keeps one live
dot per route, `style: "dashed"` marks an unconfirmed link, edges stay muted, and the accent
is reserved for selection and flow dots, the fit never zooms below 100% (an oversize graph says so instead
of clipping labels), a `diagrams` canvas stacks described sections on one pannable view, `containers`
boxes wrap a zoom parent, and `--check` reports extent, shared corridors, dropped labels, label cells on
routes, group/trunk membership, dot violations, and enclosure boxes/entrances.
Chat replies use the mermaid tool; static ANSI and PNG belong to the mermaid skill. Open
panes through the herdr CLI, never raw tmux, and never paste pane art into chat.
The eval harness binds claims to code: `scripts/viz-evidence.sh` captures one view (binary hash,
`viewport:` line, text/ANSI, `--select-all`, `--frames`) and proves its pane close,
`scripts/viz-validate.py` rejects an over-budget or evidence-poor sample,
`scripts/viz-aggregate.py` recomputes `matrix.json` from verified judge results, and
`scripts/viz-review-panes.sh` opens the blocking human-review tabs (one per case, baseline
round left, evaluated round right, each drawn by its own binary) with the feedback file at
`docs/visualize-eval/rounds/<r>/human-review/feedback.md`.
install.sh builds the binary (`cargo install --path rataflow --locked`);
`scripts/test-rataflow.py` is the offline CI suite, with `RATAFLOW_BUILD=1` adding the
cargo tests as a local pre-merge gate.

## Subagent tabs and pane state

These Herdr rules are load-bearing:

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
  for display and the `herdr:blocked` event for a blocked agent. Never report pane state
  from another source or impersonate a `herdr:` source - a second source cannot override the
  holder, and a seq-locked `herdr:` source mutes the managed reporter for the whole session.
- Subagent tab closes are clean exits: the tab's pi is asked to quit (Ctrl+D, Ctrl+C
  fallback); after confirmed exit, `pane release-agent --source herdr:pi --agent pi` clears
  its identity before `pane close`. A terminated subagent must never surface as an
  agent-killed notification in the hosting session.

## Test suites and lint runners

`.github/workflows/ci.yml` owns every offline check. Both CI discovery and the local run
use `git ls-files` — every `scripts/test-*` entry and
`pi/.pi/agent/extensions/**/*.test.mjs` joins automatically; never hand-list tests.
Per-component coverage, runtime SLA, and the full rules live in `docs/ci-tests/README.md`.
A new suite is a `scripts/test-<name>.*` entry with a `# Paths:` header (`// Paths:` for
.mjs) plus a `/simple` doc in `docs/ci-tests/`. Test agents must never improvise tests that
launch live sessions: no real pi sessions, no nvim, no tmux/multiplexer servers.

## Merge queue

`main` lands through a Mergify merge queue. Submit by adding the `queue` label: `M`
in gh-dash, or `gh-dash-enqueue-pr <owner>/<repo> <pr>` from a shell; both end in a
squash merge with no further watching. When the PR's `CI result` check is green, add the
label before you report the outcome — that is the closeout step.

`merge_group` in `.github/workflows/ci.yml` stays even though Mergify does not use it:
the native queue is the fallback, and it needs an organization-owned repository. Do not
add a trigger `paths:` filter. Full flow, requirements, and failure modes:
`docs/merge-queue.md`.

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

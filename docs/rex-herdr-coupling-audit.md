# Rex ↔ Herdr coupling audit

**Scope:** everything in `~/dotfiles` that links to Herdr.
**Question:** can it work under Rex, and what must change?
**Method:** five parallel read-only scout passes (nvim, pi extensions, skills, install/config, tests/docs), plus two live checks against the running Rex server.

## Verdict scale

| Verdict | Meaning |
| --- | --- |
| `yes` | Portable; the change is mechanical (rename env vars, swap CLI verbs). |
| `partial` | Portable, but needs a mechanism Rex does not have and someone must build. |
| `no` | Not portable; retire or archive rather than port. |
| `n/a` | No coupling, or nothing to change. |

**97 items audited:** 27 `yes`, 39 `partial`, 19 `no`, 12 `n/a`.

## Verified corrections to scout findings

Two claims were tested live and changed:

1. **`pane wait-output` does have a Rex replacement.** `rex wait BLOCK` "returns the child process's exit status", and `rex block call -b BLOCK process` returns `last_exit.exit_code`, which survives `--keep-open`. Verified: a block running `sh -c 'exit 7'` reported `exit_code: 7`. The tuicr wrapper port is therefore `yes`, not `partial`.
   *Caveat:* `rex wait` also returns `1` when it cannot determine a status, so exit code 1 is ambiguous.
2. **`rex skill setup` replaces Herdr's agent integration.** `rex skill status` reports Codex `skill current` / `hook current` and Pi `skill current`. Claude Code is simply not installed here.

## Cross-cutting gaps

Three themes account for most `partial` verdicts:

- **Agent registry.** Herdr is agent-aware (`agent list/prompt/get/report-agent`); Rex is terminal-aware only. Sidekick's durable agent model, the nvim pickers, `remote.ts`, `no-mistakes-pane/bridge.ts`, and `herdr-agent-state.ts` all depend on it. This must be rebuilt as an nvim/pi-side registry keyed on block id.
- **Workspace and worktree.** Herdr owns workspace identity and worktree rows. Rex has sessions only. The worktree tool already covers the worktree half; the "one workspace per repo" invariant does not carry over.
- **Remote hosts.** `herdr --machine` has no equivalent. `remote.ts` needs a redesign around ssh plus cross-session `rex -s SESSION` addressing.

---

## 1. Install, configuration, ops

| Path | Herdr coupling | Possible? | Change needed |
| --- | --- | --- | --- |
| `install.sh` (stow + plugin block) | Stows `herdr`; installs integrations, Flash, annotate, nm-herdr bridge | yes | Replace the guarded Herdr block with `rex server start`, and drop the `stow herdr` line. |
| `install.sh` (lines 51-56) | Curl-installs the Herdr binary | yes | Delete; Rex installs as a macOS app. |
| `herdr/.config/herdr/config.toml` | Entire file: keybindings, theme, workspace picker | no | Delete; Rex config is the stowed `rex/.config/rex/init.lua`. |
| `herdr/.../herdr-flash/config.toml` | Flash plugin colours | no | Delete with the rest of `herdr/`. |
| `herdr/.local/bin/herdr-clean-handoff` | Execs `herdr server live-handoff` | no | Delete; Rex owns its server lifecycle. |
| `herdr/.local/bin/wl-copy` | None — pure OSC52 adapter | yes | **Relocate** to a multiplexer-neutral stow package before deleting `herdr/`, or clipboard breaks. |
| `ops/packer/scripts/deploy_dotfiles.sh` | `herdr` in stow list; integration block | yes | Drop both; Rex is macOS-only. |
| `ops/herdr-annotate-review/**` | Full Herdr plugin (manifest, patch, docs) | partial | Delete the Herdr binding; keep the TUI only if it runs standalone. |
| `launchd/Library/LaunchAgents/**` | None | n/a | No change. |
| `Brewfile` | None | n/a | No change. |
| `dependencies.json` | None | n/a | No change. |
| `terminfo/**` | None; `xterm-rex` comes from `rex terminfo setup` | n/a | No change. |

Fresh Rex-only install would miss: the nvim sidebar and annotate-review workflows, and the OSC52 clipboard unless `wl-copy` moves. All Herdr steps are already guarded by `command -v herdr`, so removal is cleanup, not unblocking.

## 2. Agent skills

| File | Kind | Herdr coupling | Possible? | Change needed |
| --- | --- | --- | --- | --- |
| `tuicr/tuicr-wrapper-herdr.sh` | code | `pane split/run/close`, `pane wait-output --match` | yes (corrected) | Rewrite against `rex split/send/close`; replace `wait-output` with `rex wait` plus `last_exit`, guarding the ambiguous exit code 1. |
| `nvim/nvim-open.sh` | code | `workspace list`, `pane current/list/process-info/send-text/neighbor/focus/split/run` | partial | Map to `rex block ls/inspect`, `rex split`, `rex send`; `pane neighbor` geometry has no Rex equivalent. |
| `nvimr/nvimr` | code | `pane list/process-info/current` for socket discovery | yes | Swap to `rex block ls/inspect`; the socket-glob fallback already covers Herdr-absent. |
| `visualize/SKILL.md` | prose recipe | `pane split/run/close/read`, keyed on `HERDR_ENV` | yes | Replace with `rex split/send/capture/close`, gated on `REX_BLOCK`. |
| `tuicr/SKILL.md` | prose + dispatch | Routes on `$HERDR_ENV=1` to the Herdr wrapper | yes | Add a Rex row keyed on `REX_SESSION` pointing at a new wrapper. |
| `nvim/SKILL.md` | prose | Documents Herdr verbs and sidebar daemon | yes | Reword to Rex; the sidebar story needs a Rex answer or removal. |
| `nvimr/SKILL.md` | prose | Discovery order, `HERDR_TIMEOUT` | yes | Rewrite discovery order to Rex blocks. |
| `no-mistakes/SKILL.md` | prose | Herdr-bridge subagent-tab delegation, red blocked state | partial | Reword is cheap; the install script behind it is the real port and assumes agent-aware tabs. |
| `vault/SKILL.md` | prose | One line about workspace renames | yes | One-line reword. |
| `professor`, `research` | prose | None | n/a | No change. |

## 3. Tests and documentation

| Path | Kind | Herdr coupling | Possible? | Change needed |
| --- | --- | --- | --- | --- |
| `scripts/test-gh-dash-open-pr.sh` | CI | Fake `herdr` records `create/open/pane-run` argv | partial | Fake `rex` covering `window new/split/send` instead. |
| `scripts/test-install-smoke.sh` | CI | Guards for integration install and nm bridge | partial | Drop Herdr guards, add Rex guards; keep the dynamic PATH-fake pattern. |
| `scripts/verify-nvim.lua` | CI | Asserts backend == `herdr` and its methods | partial | Assert a rex-backed backend; needs the backend module first. |
| `scripts/verify-nvim` | runner | `sidekick-herdr-live` needs a running Herdr server | partial | Add `sidekick-rex-live` using `rex events`/`rex block ls`. |
| `scripts/test-nvim-headless.sh` | CI | Runs `herdr_agent_send_spec.lua` | partial | Add a Rex adapter spec. |
| `scripts/test-nvim-picker.sh` | CI | Stubs herdr workspace resolution | partial | Stub rex session/block resolution. |
| `scripts/test-nvim-send.sh` | CI | Tests Herdr adapter verbs | partial | Port to `rex send`/`send-key` payloads. |
| `scripts/test-nvim-workspaces.sh` | CI | Stubs `herdr.call`, workspace snapshot/reconcile | partial | Workspace-per-repo is Herdr-specific; test Rex tab bookkeeping instead. |
| `scripts/test-sidekick-view-focus.lua` | CI | Stubs `Herdr.call`, registers `backends.herdr` | partial | Retarget to a `backends.rex` stub. |
| `scripts/test-child-stdio.py` | CI | Fake herdr, `HERDR_ENV` dispatch | partial | Fake `rex`, dispatch on `REX_SESSION`/`REX_BLOCK`. |
| `scripts/test-ci-self.mjs` | CI | Declares herdr config as a trigger | partial | Remove or repoint to the rex config path. |
| `scripts/test-repo-parity.py` | CI | Checks herdr TOML keys | partial | Swap for rex config checks; drop the stale hook reference. |
| `scripts/test-config-lint.py` | CI | Vendored herdr TOML key allow-list | no | Delete with the herdr config. |
| `scripts/test-herdr-clean-handoff.sh` | CI | Exercises the handoff helper | no | Retire with Herdr; no Rex equivalent. |
| `scripts/test-herdr-flash-copy.sh` | CI | Tests the Flash OSC52 bridge | no | Retire, or re-home `wl-copy` without herdr paths. |
| `scripts/test-herdr-annotate-install.py` | CI | Fake herdr plugin link/install | no | Retire with the pilot. |
| `scripts/install-herdr-annotate`, `install-nm-herdr-bridge` | runtime | Install Herdr plugins/bridges | no | Remove with the migration. |
| `scripts/verify-herdr-attachment-leases-*` | CI | Execute frozen lease scenarios | no | Retire with the contract family. |
| `scripts/fixtures/herdr-attachment-leases-{v1,v2,v3}` | fixture | Herdr session-source ids | no | Archive with the contracts. |
| `docs/contracts/herdr-attachment-leases-v{0..3}.json` | contract | Herdr as session authority | no | Archive; the authority model is unimplemented under Rex. |
| `docs/adr/0002-share-herdr-workspace-per-repository.md` | ADR | One workspace per repo, worktree cardinality | partial | Mark superseded; the worktree half now lives in the worktree tool. |
| `docs/adr/0003-keep-attachment-authority-in-herdr.md` | ADR | Herdr owns session identity and arbitration | no | Record as superseded; the premise is contradicted. |
| `docs/adr/0004-require-holder-consent...` | ADR | Lease transfer consent | no | Supersede; Rex has no lease concept. |
| `docs/herdr-attachment-leases-*.md` | spec | Full lease language | no | Archive, marked superseded. |
| `docs/ci-test-surfaces.md` | prose | `HERDR_ENV`/`HERDR_PANE_ID` dispatch matrix | partial | Rewrite dispatch rows to `REX_SESSION`/`REX_BLOCK`; keep the hermetic fake-binary rule. |
| `docs/ci-tests/*.md` | prose | Document fake herdr and env dispatch | partial | Update where the fake binary and dispatch change. |
| `docs/neovim-current-features.md` | prose | Sidekick uses Herdr as mux backend | partial | Rewrite the Sidekick/workspace sections. |
| `docs/evidence/sidekick-.../README.md` | evidence | References `verify-nvim sidekick-herdr` | partial | Update the case name after the backend swap. |
| `README.md` | prose | Herdr install, Flash, handoff, scrollback, annotate | partial | Replace with Rex CLI; scrollback becomes `rex capture -b`. |
| `AGENTS.md` | prose | Herdr session/workspace/bridge invariants | partial | Rewrite invariants for `REX_SESSION`/`REX_BLOCK`; worktree identity via the worktree tool. |
| `CONTEXT.md` | prose | Herdr glossary: Workspace, Binding, Lease | partial | Drop Herdr-specific terms, add Rex terms. |
| `docs/code-enhancements-from-testing.md` | prose | Historical findings | yes | Add a note that findings predate the migration. |
| `scripts/test-tmux.sh` | CI | Comment only | n/a | Optionally update the comment. |
| `BUGS.md` | prose | Closed Herdr tty-sever record | n/a | No change. |

## 4. Neovim

| Path | Herdr coupling | Possible? | Change needed |
| --- | --- | --- | --- |
| `plugins/sidekick/herdr.lua` | Central adapter over every `herdr` verb | partial | Rewrite as `rex.lua`: `send`→`rex send`, `read`→`rex capture`, list→`rex session inspect`. |
| `plugins/sidekick/herdr_backend.lua` | Agent/workspace/pane/tab verbs | partial | Rewrite over the rex adapter plus a local agent registry. |
| `plugins/herdr/workspaces.lua` | `workspace list/focus/create/rename/close`, `pane list`, `agent list` | partial | Remap workspaces to Rex sessions; create/rename/close become nvim-side management. |
| `plugins/sidekick/cwd_picker.lua` | `agent list/read/rename`, workspace list | partial | Enumerate from the new registry; previews via `rex capture`. |
| `plugins/herdr/agent_send.lua` | `$HERDR_PANE_ID`, `pane current/list/send-text`, `agent_status` | partial | Use `$REX_BLOCK` + `rex send`; replace the agent-status filter with a heuristic. |
| `helpers/herdr_scrollback.lua` | `$HERDR_ENV`, `$HERDR_ACTIVE_PANE_ID`, `pane read`, captures dir | partial | Gate on Rex env, capture with `rex capture --unwrap`; identity comes from agent session files. |
| `plugins/sidekick/internal.lua` | `herdr:` session ids, `agent_for_worktree`, tab vars | partial | Switch ids to `rex:<block-id>`; resolve via the registry. |
| `plugins/sidekick/registry.lua` | `herdr.list_agents` rehydration | partial | Feed from the nvim-side registry. |
| `helpers/vault_work_items.lua` | `herdr.start`, `agent_for_worktree`, tab rename | partial | Route through the rewritten backend; label tabs with `rex window new`. |
| `plugins/sidekick/search.lua` | `herdr.read(name, "recent", 1000)` | yes | `rex capture -b BLOCK --trim --unwrap`. |
| `plugins/sidekick.lua` | `backend = "herdr"`, `herdr_backend.apply()` | yes | Point at the rex backend; drop the validation shim. |
| `plugins/herdr-agent.lua` | Keymaps with Sidekick fallback | yes | Keep; the fallback already covers Herdr-absent. |
| `plugins/sidekick/view_focus.lua` | Checks `backend == "herdr"` only | yes | Rename the backend tag; no CLI to port. |
| `helpers/workspace.lua` | Tab vars, no CLI | yes | Rename vars or store the Rex session id. |
| `plugins/markdown.lua` | `vim.b.herdr_scrollback` flag | yes | Rename the buffer flag when scrollback lands. |
| `plugins/dashboard.lua` | Opens the workspace picker | yes | Works once workspaces is ported. |
| `plugins/herdr-workspaces.lua` | Keymap → workspaces.open | yes | Needs only the rewritten module. |
| `lazy-lock.json` | Pins `herdr-nvim` | yes | Drop the entry with the plugin. |
| `plugins/herdr-nvim.lua` | Loads the ChmaraX sidebar plugin | no | Remove; Rex has no nvim-sidebar annotation channel. |
| `helpers/herdr/term_send.lua` | None | n/a | No change. |
| `nvim/.config/nvim/tests/**` | Pin `pane` verbs and `HERDR_PANE_ID` | partial | Rewrite specs against rex argv and `$REX_BLOCK`. |

Blast radius: keymaps degrade gracefully, but `sidekick.lua` backend startup errors on `M:start` once Herdr is gone.

## 5. Pi extensions

| Path | Herdr coupling | Possible? | Change needed |
| --- | --- | --- | --- |
| `run-command.ts` | `pane current/list/split/run/close` | yes | `rex block ls/inspect`, `rex split -b $REX_BLOCK`, `rex send -b`. |
| `no-mistakes-pane.ts` | `HERDR_ENV`, `pane current/get/split/rename/run/close/neighbor/focus/zoom`, `tab focus` | yes | `rex split/send/block close/focus/window focus`; it already degrades headless, so the failure mode is soft. |
| `tuicr-core.mjs` | `WRAPPER_MARKERS` maps `HERDR_ENV` → wrapper | yes | Add a `{kind:"rex", marker:"REX_SESSION"}` entry. |
| `stdin-reattach.ts` | None; works around a Herdr pty-swap bug | yes | Keep as-is; possibly obsolete under Rex. |
| `herdr-prompt-state.ts` | Emits `herdr:blocked` only | yes | Rename the event. |
| `no-mistakes-pane/orchestrate.ts` | None functionally | yes | Update user-facing labels. |
| `nvim-open.ts` | `pane current/list/process-info/split/run/send-text/neighbor/focus`, sidebar sockets | partial | Map panes to blocks; `neighbor` focus needs redesign; tmux fallback stays. |
| `no-mistakes-pane/bridge.ts` | `agent prompt/get`, `tab create`, `pane run/release-agent` | partial | Tabs via `rex window new` + `rex split`; `agent prompt/get` becomes session-file tail + `rex capture`. |
| `focus-buffer.ts` | Imports nvim-open's pane scan | partial | Works once nvim-open learns Rex blocks. |
| `tuicr.ts` | Spawns the Herdr wrapper | partial | Spawn `tuicr-wrapper-rex.sh` instead. |
| `no-mistakes-pane/herdr-report.ts` | `pane report-agent` labels, `herdr:blocked` | partial | Needs a Rex label channel; the event just needs renaming. |
| `pi/bin/nm-herdr-pi.mjs` | `$NM_HOME/herdr-bridge/<run-id>/sock` | partial | Rename the bridge dir; passthrough is already mux-free. |
| `remote.ts` | `herdr --machine devbox agent list/start/prompt`, `tab create/close` | no | Redesign around ssh plus cross-session `rex -s SESSION`; no remote forwarding or agent registry in Rex. |
| `herdr-agent-state.ts` | `HERDR_SOCKET_PATH`, JSON-RPC `pane.report_agent` | no | Drop, or add a Rex-side reporting mechanism; it is a no-op today. |
| `no-mistakes-pane/capture.ts` | None | n/a | No change. |
| `no-mistakes-pane/status.ts` | None | n/a | No change. |
| `tool-call-renderer-public.ts` | None | n/a | No change. |
| `cleanup.ts` | None; git-only | n/a | No change. |

Note: `herdr-agent-state.ts` is overwritten by Herdr's own installer, so a Rex replacement must live outside that path.

---

## Recommended order

1. **Relocate `wl-copy`**, then delete the `herdr/` stow package and its install steps. Cheap, and stops a silent clipboard break.
2. **Port the small pi tools** (`run-command`, `no-mistakes-pane`, `tuicr-core`) — mechanical, high confidence, `yes` verdicts.
3. **Write the nvim `rex.lua` adapter plus an agent registry**, then rewrite `herdr_backend` on top. This unblocks the largest cluster of `partial`s.
4. **Retire the lease-contract family** (ADRs 0003/0004, contracts v0–v3, fixtures, verifiers) as superseded, and rewrite `AGENTS.md`/`CONTEXT.md` invariants.
5. **Decide `remote.ts` and `herdr-agent-state.ts` explicitly**: rebuild on ssh plus capture, or drop the features.

## Limits of this audit

- Verdicts come from static reading plus two live checks; no port was attempted.
- `partial` means "a mechanism must be built", not an estimate of size.
- Several `no` verdicts are cheap deletions; they are marked `no` because the Herdr concept has no Rex counterpart, not because the work is large.

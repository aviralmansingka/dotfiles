# Sidekick Herdr Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tmux as Sidekick's persistent process backend with Herdr while preserving Neovim session creation, listing, preview, search, send, attach, and close behavior.

**Architecture:** Keep Sidekick's editor context and Snacks UI. Add one local Herdr CLI adapter shared by a Sidekick session backend and the custom pickers; use Herdr agent records as the source of truth and map exact project cwd values to Herdr workspaces. Keep compatibility glue limited to registering the local backend and accepting `herdr` in Sidekick's upstream backend validator.

**Tech Stack:** Lua, Neovim headless verification, Sidekick.nvim session API, Herdr 0.7.1 JSON CLI, Bash integration harness.

## Global Constraints

- The installed Herdr 0.7.1 CLI is authoritative: `agent start NAME --cwd PATH --workspace ID --no-focus -- <argv>`, `agent send`, `pane send-keys`, and JSON `agent read`.
- Do not nest tmux inside Herdr.
- Sidekick continues to own `{this}`, file/selection context, keymaps, window presentation, and Snacks pickers.
- Herdr owns process launch, persistence, workspaces, semantic agent status, notifications, scrollback, and pane closure.
- Project workspaces match exact normalized cwd values; a broad home workspace must not absorb child projects.
- No new runtime dependency beyond the already-installed Herdr binary.

---

### Task 1: Red verifier for the backend contract

**Files:**
- Modify: `scripts/verify-nvim`
- Modify: `scripts/verify-nvim.lua`

**Interfaces:**
- Consumes: existing `scripts/verify-nvim CASE` dispatch.
- Produces: `sidekick-herdr` for deterministic configuration/adapter checks and `sidekick-herdr-live` for real Herdr transport checks.

- [ ] **Step 1: Add a deterministic case that requires the Herdr adapter and backend**

```lua
local herdr = require("plugins.sidekick.herdr")
local backend = require("plugins.sidekick.herdr_backend")
assert(herdr.agent_name("codex", cwd):match("^sk%-codex%-"))
assert(backend.backend == "herdr")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `scripts/verify-nvim sidekick-herdr`

Expected: FAIL because `plugins.sidekick.herdr` does not exist.

- [ ] **Step 3: Add the live harness contract**

The live case must create a disposable shell-backed named agent through the adapter, send and submit a sentinel, read it back, verify registry/cwd/status fields, and close only the created pane in cleanup.

- [ ] **Step 4: Leave the cases red until Tasks 2-4 implement the behavior**

---

### Task 2: Herdr CLI adapter and Sidekick session backend

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/herdr.lua`
- Create: `nvim/.config/nvim/lua/plugins/sidekick/herdr_backend.lua`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua`

**Interfaces:**
- Produces: `list_agents()`, `read(target, source, lines, ansi)`, `close(pane_id)`, `workspace_for_cwd(cwd)`, `ensure_workspace(cwd)`, and `agent_name(tool, cwd)`.
- Produces a Sidekick backend implementing `sessions`, `start`, `attach`, `send`, `submit`, `dump`, and `is_running`.

- [ ] **Step 1: Implement strict JSON command execution**

Use `vim.system({ "herdr", ... }, { text = true }):wait()`. Decode exactly one JSON response and surface Herdr's stderr through Sidekick notifications on errors.

- [ ] **Step 2: Implement exact-cwd workspace resolution**

Read `herdr pane list`, compare normalized `foreground_cwd or cwd` exactly, and create `basename(cwd)` with `workspace create --cwd ... --label ... --no-focus` only when no matching workspace exists.

- [ ] **Step 3: Implement Sidekick session operations**

Start with a unique `sk-<tool>-<cwd hash>` name for base tools and exact tool names for named sessions. Pass tool environment with repeated `--env KEY=VALUE`, launch in the resolved workspace, attach with `herdr agent attach`, send literal text with `agent send`, submit with `pane send-keys ... enter`, and dump decoded recent ANSI text.

- [ ] **Step 4: Register the backend before Sidekick setup**

Call `herdr_backend.apply()` before `require("sidekick").setup(opts)`, set `opts.cli.mux.backend = "herdr"`, and narrowly accept only that value in Sidekick's hard-coded backend validation.

- [ ] **Step 5: Run the deterministic verifier**

Run: `scripts/verify-nvim sidekick-herdr`

Expected: PASS.

---

### Task 3: Replace tmux discovery, preview, search, and close

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/registry.lua`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/picker.lua`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/search.lua`

**Interfaces:**
- Consumes: Herdr `AgentInfo` fields `name`, `agent`, `agent_status`, `cwd`, `foreground_cwd`, `workspace_id`, `pane_id`, and `terminal_id`.
- Produces: named-session entries with `agent_name`, `status`, `workspace_id`, and `pane_id` for all custom UIs.

- [ ] **Step 1: Make registry discovery read Herdr agents**

Only names matching `<known-tool>-<slug>` are custom named sessions. Rehydrate their Sidekick tool definitions with the correct native Pi/Claude `--name <slug>` argument.

- [ ] **Step 2: Replace preview and close commands**

Decode `agent read` text into preview buffers and call `pane close` for the selected agent pane. Show Herdr semantic status alongside label and cwd.

- [ ] **Step 3: Replace transcript snapshots**

Use `agent read --source recent --lines 1000` and keep the existing temporary-file ripgrep UI.

- [ ] **Step 4: Run deterministic and live cases**

Run: `scripts/verify-nvim sidekick-herdr && scripts/verify-nvim sidekick-herdr-live`

Expected: both PASS; live cleanup leaves no verifier agent.

---

### Task 4: Remove tmux branch bookkeeping and enable Herdr lifecycle delivery

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/internal.lua`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/branch.lua`
- Create: `~/.config/herdr/config.toml`
- Managed install: `~/.pi/agent/extensions/herdr-agent-state.ts`
- Managed install: `~/.codex/herdr-agent-state.sh`
- Managed update: `~/.codex/hooks.json`
- Managed update: `~/.codex/config.toml`

**Interfaces:**
- Consumes: Git cwd for display-only branch lookup.
- Produces: Herdr system toasts, done/request sounds, and Pi/Codex lifecycle hook installation.

- [ ] **Step 1: Delete tmux session environment helpers**

Remove session-id lookup, async branch capture, tmux cwd reads, and `SIDEKICK_BRANCH` storage. Compute branch labels directly from each discovered agent cwd.

- [ ] **Step 2: Configure notifications and sound**

```toml
[ui.toast]
delivery = "system"
delay_seconds = 1

[ui.sound]
enabled = true
```

- [ ] **Step 3: Install primary-agent integrations**

Run: `herdr integration install pi && herdr integration install codex && herdr server reload-config`

Expected: both integrations report installed and the server reload succeeds.

- [ ] **Step 4: Verify lifecycle transport and sound command**

The live verifier reports `working` then `idle` for its disposable pane, confirms the state response, and executes a Herdr notification with the `done` sound.

---

### Task 5: Completion audit

**Files:**
- Inspect every file above and the source Lavish artifact at `/Users/aviral/vault/.lavish/neovim-herdr-backend-comparison.html`.

**Interfaces:**
- Produces: fresh evidence for every acceptance-gate behavior.

- [ ] **Step 1: Run all focused verification**

Run: `scripts/verify-nvim sidekick-herdr`

Run: `scripts/verify-nvim sidekick-herdr-live`

Run: `scripts/verify-nvim sidekick-pi`

Run: `scripts/verify-nvim agent-keymaps`

- [ ] **Step 2: Check configuration and absence of active tmux calls**

Run: `rg -n 'tmux|SIDEKICK_BRANCH' nvim/.config/nvim/lua/plugins/sidekick nvim/.config/nvim/lua/plugins/sidekick.lua`

Expected: no active runtime tmux dependency in the migrated layer.

- [ ] **Step 3: Verify external state**

Run: `herdr status && herdr integration status && herdr agent list && herdr workspace list`

Expected: compatible running server, Pi and Codex installed, no disposable verifier agents left, and project workspaces represented in Herdr.

- [ ] **Step 4: Audit the Lavish acceptance gate item by item**

Confirm start, hide/reattach command construction, context send transport, preview scrollback, close, semantic state transition, and sound delivery each have direct evidence rather than inference.

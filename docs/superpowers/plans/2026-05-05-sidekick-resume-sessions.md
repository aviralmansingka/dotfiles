# Sidekick Resume Agent Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `<leader>ar` keymap to resume previously-stored agent sessions (claude + cursor), and extend `<leader>an` so claude's own session manager learns the session label via `--name`.

**Architecture:** New module `plugins/sidekick/resume.lua` with two entry points: a custom snacks picker for claude (parses `~/.claude/projects/<encoded-cwd>/*.jsonl`), and a thin TUI delegator for cursor (spawns `cursor-agent resume` in a sidekick pane). `internal.lua` gains a `tool_command_for_named_session()` helper that splices `--name <slug>` into the claude command for `<leader>an`-spawned sessions.

**Tech Stack:** Neovim Lua, `sidekick.nvim` plugin (folke), `Snacks.picker`, tmux (via existing `registry.lua`).

**Spec:** `docs/superpowers/specs/2026-05-05-sidekick-resume-sessions-design.md`

**Testing convention for this repo:** the existing sidekick modules have no automated tests — this is a personal dotfiles repo and the established pattern is manual smoke testing. Pure helper functions are verified by invoking them via `:lua` from inside nvim with hard assertions. UI flows are smoke-tested manually with explicit pass/fail checklists. Do not introduce a new test framework.

---

## File Plan

| File | Status | Responsibility |
|---|---|---|
| `nvim/.config/nvim/lua/plugins/sidekick/resume.lua` | **new** | `parse_session(path)`, `list_claude_sessions()`, `claude_picker()`, `cursor_resume()`, `open()` |
| `nvim/.config/nvim/lua/plugins/sidekick/internal.lua` | edit | Add `tool_command_for_named_session(tool, slug)`; route `start_named_session()` through it |
| `nvim/.config/nvim/lua/plugins/sidekick.lua` | edit | Add `<leader>ar` keymap calling `require("plugins.sidekick.resume").open()` |

---

## Task 1: Discover where claude `--name` is persisted

**Why:** The spec leaves this open ("which event type carries `name`"). Before writing the parser, we need to know where `--name <foo>` actually shows up on disk. This task is a 5-minute exploration that writes nothing — its output informs Task 3.

**Files:** none

- [ ] **Step 1: Spawn a named session interactively and exit cleanly**

Run in a separate terminal:
```bash
cd /Users/aviral/dotfiles
claude --name plan-discovery-test
```
Type a single message like `hello` so the session writes events. Then exit with `/exit` or `Ctrl-D`. This produces a fresh `.jsonl` with a known name to grep for.

- [ ] **Step 2: Locate where the name was written**

Run:
```bash
grep -l "plan-discovery-test" ~/.claude/projects/-Users-aviral-dotfiles/*.jsonl
```
Expected: at least one matching file path.

- [ ] **Step 3: Find the event line carrying the name**

Run:
```bash
grep -n "plan-discovery-test" ~/.claude/projects/-Users-aviral-dotfiles/*.jsonl | head -5
```
Note the line number(s) and the JSON shape. The relevant field is most likely a top-level `"name":"plan-discovery-test"` on a metadata-style event near the start of the file, but confirm by reading the actual line.

- [ ] **Step 4: Record findings in a comment for Task 3**

Write a short note (just for yourself, not committed) capturing:
- The event line: full JSON of the line that holds `name`
- The field name and nesting level (top-level? nested under `metadata`?)
- An example: e.g., `{"type":"...", "name":"plan-discovery-test", "sessionId":"..."}`

This becomes the parser logic in Task 3. If `--name` turns out *not* to be persisted to the jsonl (search returns no hits), proceed with Task 3 using only `id` and `preview` — the label falls back to `claude-r-<short-id>` per the spec, and the feature still works.

- [ ] **Step 5: Clean up the test session**

```bash
rm "$(grep -l 'plan-discovery-test' ~/.claude/projects/-Users-aviral-dotfiles/*.jsonl)"
```

No commit for this task — it produces no code.

---

## Task 2: Add `tool_command_for_named_session()` helper

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/internal.lua`

- [ ] **Step 1: Add the helper function above `start_named_session`**

Insert before line 117 (the `---@param tool string` header for `start_named_session`):

```lua
--- Build the spawn command for a named session, splicing per-tool name flags
--- where supported. Claude takes `--name <slug>` so the slug appears in
--- claude's /resume picker and terminal title; other tools have no
--- equivalent and fall through unchanged.
---@param tool string
---@param slug string
---@return string[]
function M.tool_command_for_named_session(tool, slug)
  local cmd = vim.deepcopy(M.tool_commands[tool] or { tool })
  if tool == "claude" and slug and slug ~= "" then
    table.insert(cmd, "--name")
    table.insert(cmd, slug)
  end
  return cmd
end
```

- [ ] **Step 2: Route `start_named_session()` through the helper**

In `start_named_session()`, replace this line (currently line 128):

```lua
  local command = M.tool_commands[tool] or { tool }
```

with:

```lua
  local command = M.tool_command_for_named_session(tool, slug)
```

- [ ] **Step 3: Verify with `:lua` from inside nvim**

Open nvim in this repo and run:

```vim
:lua local m = require("plugins.sidekick.internal"); local c = m.tool_command_for_named_session("claude", "tutorial"); print(vim.inspect(c))
```

Expected output (the exact `claude_bin` path may differ):
```
{ "/Users/aviral/.local/bin/claude", "--ide", "--dangerously-skip-permissions", "--name", "tutorial" }
```

Then verify cursor is unchanged:

```vim
:lua local m = require("plugins.sidekick.internal"); print(vim.inspect(m.tool_command_for_named_session("cursor", "tutorial")))
```

Expected:
```
{ "/Users/aviral/.local/bin/cursor-agent", "--force" }
```

And empty-slug guard:

```vim
:lua local m = require("plugins.sidekick.internal"); print(vim.inspect(m.tool_command_for_named_session("claude", "")))
```

Expected (no `--name` flag because slug is empty):
```
{ "/Users/aviral/.local/bin/claude", "--ide", "--dangerously-skip-permissions" }
```

- [ ] **Step 4: Smoke test `<leader>an` end-to-end**

In nvim:
1. Press `<leader>an`, choose `claude`, label `smoke-test-1`, accept default cwd
2. After the session opens, in another terminal run: `pgrep -af claude.*smoke-test-1`
3. Expected: process line includes `--name smoke-test-1`
4. Press `<leader>al` and confirm `claude-smoke-test-1` appears in the named-session picker
5. Kill the session: in the picker, select it and press `<C-x>`

- [ ] **Step 5: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/internal.lua
git commit -m "$(cat <<'EOF'
Pass --name to claude for sidekick named sessions

Adds tool_command_for_named_session() helper and routes named-session
spawning through it so claude's --name flag is set to the slug. Cursor
and other tools are unchanged (no --name equivalent).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `resume.lua` with the jsonl parser

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/resume.lua`

- [ ] **Step 1: Create the file with the parser**

Write `nvim/.config/nvim/lua/plugins/sidekick/resume.lua`:

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/resume.lua
-- Resume previously-stored agent sessions. Backend-first selection, then
-- per-backend behavior: claude shows a custom snacks picker over its
-- ~/.claude/projects/<cwd>/*.jsonl files; cursor delegates to its own TUI.

local M = {}

local CLAUDE_SCAN_LINES = 50  -- how many lines to read at the top of each .jsonl
local PREVIEW_MAX = 80

---@return string e.g. "/Users/aviral/dotfiles" -> "-Users-aviral-dotfiles"
local function encode_cwd(cwd)
  return (cwd or vim.fn.getcwd()):gsub("/", "-")
end

---@param path string
---@return string[]
local function read_head_lines(path, n)
  local out = {}
  local fh = io.open(path, "r")
  if not fh then
    return out
  end
  for _ = 1, n do
    local line = fh:read("*l")
    if not line then
      break
    end
    out[#out + 1] = line
  end
  fh:close()
  return out
end

--- Decode JSON safely; return nil on error so callers can skip the line.
local function safe_decode(line)
  local ok, obj = pcall(vim.json.decode, line)
  if ok then
    return obj
  end
  return nil
end

--- Pull the first plain-text user-message snippet out of an event.
--- Claude's user events have shape: { message = { role = "user", content = "..." } }
--- or content = { { type = "text", text = "..." }, ... }.
local function extract_user_text(obj)
  if type(obj) ~= "table" then
    return nil
  end
  local msg = obj.message
  if type(msg) ~= "table" or msg.role ~= "user" then
    return nil
  end
  local content = msg.content
  if type(content) == "string" then
    return content
  end
  if type(content) == "table" then
    for _, part in ipairs(content) do
      if type(part) == "table" and part.type == "text" and type(part.text) == "string" then
        return part.text
      end
    end
  end
  return nil
end

--- Pull a session display name out of an event.
--- Per Task 1's discovery, claude persists --name as the very first two
--- lines of the .jsonl, as two distinct event types:
---   {"type":"custom-title","customTitle":"<name>","sessionId":"..."}
---   {"type":"agent-name","agentName":"<name>","sessionId":"..."}
--- Either is sufficient; we accept whichever appears first.
local function extract_session_name(obj)
  if type(obj) ~= "table" then
    return nil
  end
  if obj.type == "custom-title" and type(obj.customTitle) == "string" and obj.customTitle ~= "" then
    return obj.customTitle
  end
  if obj.type == "agent-name" and type(obj.agentName) == "string" and obj.agentName ~= "" then
    return obj.agentName
  end
  return nil
end

local function shorten(s, n)
  if not s then
    return ""
  end
  s = s:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
  if #s <= n then
    return s
  end
  return s:sub(1, n - 1) .. "…"
end

---@param path string Absolute path to a .jsonl session file
---@return { id: string, name: string|nil, preview: string, mtime: integer }|nil
function M.parse_session(path)
  local id = vim.fn.fnamemodify(path, ":t:r")
  if id == "" then
    return nil
  end
  local mtime = vim.fn.getftime(path)
  if mtime < 0 then
    return nil
  end
  local lines = read_head_lines(path, CLAUDE_SCAN_LINES)
  local name, preview
  for _, line in ipairs(lines) do
    local obj = safe_decode(line)
    if obj then
      if not name then
        name = extract_session_name(obj)
      end
      if not preview then
        preview = extract_user_text(obj)
      end
      if name and preview then
        break
      end
    end
  end
  return {
    id = id,
    name = name,
    preview = shorten(preview or "(no preview)", PREVIEW_MAX),
    mtime = mtime,
  }
end

---@return { id, name, preview, mtime, path }[]
function M.list_claude_sessions()
  local dir = vim.fn.expand("~/.claude/projects/" .. encode_cwd())
  if vim.fn.isdirectory(dir) ~= 1 then
    return {}
  end
  local out = {}
  for _, path in ipairs(vim.fn.globpath(dir, "*.jsonl", false, true)) do
    local item = M.parse_session(path)
    if item then
      item.path = path
      out[#out + 1] = item
    end
  end
  table.sort(out, function(a, b)
    return a.mtime > b.mtime
  end)
  return out
end

return M
```

- [ ] **Step 2: Verify the parser against real session files**

Open nvim in `/Users/aviral/dotfiles` and run:

```vim
:lua print(vim.inspect(require("plugins.sidekick.resume").list_claude_sessions()))
```

Expected: a Lua table with one entry per `.jsonl` in `~/.claude/projects/-Users-aviral-dotfiles/`. Each entry should have `id` (a UUID), `mtime` (integer timestamp), `preview` (a non-empty string), and either `name` (string) or `name = nil`. The list is sorted most-recent first.

If `name` is nil for every entry but you set names in Task 1, revisit `extract_session_name()` — adjust the heuristic based on the actual JSON shape you recorded in Task 1 step 4.

- [ ] **Step 3: Verify graceful handling of an empty cwd**

```vim
:lua vim.cmd("cd /tmp"); print(vim.inspect(require("plugins.sidekick.resume").list_claude_sessions())); vim.cmd("cd /Users/aviral/dotfiles")
```

Expected: `{}` (empty table) — `/tmp` typically has no claude session history, so the parser returns an empty list without errors.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/resume.lua
git commit -m "$(cat <<'EOF'
Add sidekick resume.lua with claude jsonl parser

Pure helpers: parse_session() reads a .jsonl head and extracts session
id, --name (if persisted), first user-message preview, and mtime;
list_claude_sessions() globs ~/.claude/projects/<cwd>/ and returns
sorted entries. UI integration follows in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Implement `claude_picker()` (snacks UI + tool registration)

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/resume.lua`

- [ ] **Step 1: Add the picker function**

Append to `resume.lua` *above* the final `return M`:

```lua
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")

---@param secs integer Unix mtime
---@return string e.g. "5m ago", "2h ago", "3d ago"
local function relative_time(secs)
  local delta = os.time() - secs
  if delta < 60 then
    return delta .. "s ago"
  elseif delta < 3600 then
    return math.floor(delta / 60) .. "m ago"
  elseif delta < 86400 then
    return math.floor(delta / 3600) .. "h ago"
  else
    return math.floor(delta / 86400) .. "d ago"
  end
end

---@param item { id, name, preview, mtime, path }
---@return string The label used as the sidekick tool key + tmux session prefix
local function label_for(item)
  if item.name and item.name ~= "" then
    local slug = internal.normalize_label(item.name)
    if slug ~= "" then
      return "claude-" .. slug
    end
  end
  return "claude-r-" .. item.id:sub(1, 8)
end

---@param item { id, name, preview, mtime, path }
---@return string[]
local function preview_lines(item)
  if not item or not item.path then
    return { "(no session)" }
  end
  local out = vim.fn.systemlist({ "tail", "-n", "200", item.path })
  if vim.v.shell_error ~= 0 then
    return { "(failed to read " .. item.path .. ")" }
  end
  return out
end

--- Spawn or focus the resumed session as a sidekick tool entry.
local function resume_claude(item)
  local label = label_for(item)
  if registry.discover()[label] then
    internal.toggle_tool_session(label, true)
    return
  end
  local config = require("sidekick.config")
  local cmd = vim.deepcopy(internal.tool_commands.claude)
  table.insert(cmd, "--resume")
  table.insert(cmd, item.id)
  config.cli.tools[label] = internal.merged_tool_config(
    "claude",
    internal.make_tool(cmd, nil, internal.tool_urls.claude)
  )
  internal.toggle_tool_session(label, true)
end

function M.claude_picker()
  local items = M.list_claude_sessions()
  if #items == 0 then
    vim.notify("Sidekick: no claude sessions for this cwd", vim.log.levels.INFO)
    return
  end
  local picker_items = {}
  for _, item in ipairs(items) do
    local display_name = item.name or item.id:sub(1, 8)
    picker_items[#picker_items + 1] = vim.tbl_extend("force", item, {
      text = string.format("[claude] %-30s  %-10s  %s", display_name, relative_time(item.mtime), item.preview),
    })
  end
  Snacks.picker.pick({
    source = "sidekick_resume_claude",
    title = "Sidekick Resume Claude Session",
    items = picker_items,
    format = "text",
    preview = function(ctx)
      vim.api.nvim_buf_set_lines(ctx.buf, 0, -1, false, preview_lines(ctx.item))
      return true
    end,
    confirm = function(picker, item)
      picker:close()
      if item then
        resume_claude(item)
      end
    end,
  })
end
```

- [ ] **Step 2: Smoke test the picker**

In nvim, run:

```vim
:lua require("plugins.sidekick.resume").claude_picker()
```

Verify in order:
1. Picker opens with one row per claude session in this cwd, most-recent first
2. Preview pane on the right shows the tail of the selected `.jsonl`
3. Pressing `<Enter>` on a session spawns a sidekick pane running `claude --resume <id>` (verify in another terminal: `pgrep -af 'claude.*--resume'`)
4. The tmux pane border shows the session name (e.g., `claude-r-bf65af47` or `claude-<your-name>` if Task 1 found a name)

- [ ] **Step 3: Smoke test the idempotency check**

With the sidekick pane from Step 2 still running, press `<leader>al`. Note the label of the running session. Now run `:lua require("plugins.sidekick.resume").claude_picker()` again, pick the same session, and press `<Enter>`.

Expected: the existing pane is focused, no second pane is spawned. Verify with `tmux list-panes -a | grep <label>` — should show one pane only.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/resume.lua
git commit -m "$(cat <<'EOF'
Add claude resume picker to sidekick resume.lua

Snacks picker over current-cwd claude sessions with name/time/preview
columns, tail-of-jsonl preview pane, and idempotent re-attach when the
selected session is already running in tmux.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Implement `cursor_resume()` (TUI delegation)

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/resume.lua`

- [ ] **Step 1: Add the cursor delegator and the `open()` dispatcher**

Append to `resume.lua` above the final `return M`:

```lua
local CURSOR_RESUME_LABEL = "cursor-resume"

function M.cursor_resume()
  if registry.discover()[CURSOR_RESUME_LABEL] then
    internal.toggle_tool_session(CURSOR_RESUME_LABEL, true)
    return
  end
  local config = require("sidekick.config")
  local cmd = vim.deepcopy(internal.tool_commands.cursor)
  table.insert(cmd, "resume")
  config.cli.tools[CURSOR_RESUME_LABEL] = internal.merged_tool_config(
    "cursor",
    internal.make_tool(cmd, nil, internal.tool_urls.cursor)
  )
  internal.toggle_tool_session(CURSOR_RESUME_LABEL, true)
end

function M.open()
  vim.ui.select({ "claude", "cursor" }, { prompt = "Resume agent backend:" }, function(choice)
    if choice == "claude" then
      M.claude_picker()
    elseif choice == "cursor" then
      M.cursor_resume()
    end
  end)
end
```

- [ ] **Step 2: Smoke test cursor delegation**

In nvim:

```vim
:lua require("plugins.sidekick.resume").cursor_resume()
```

Verify:
1. A sidekick pane opens with cursor-agent's TUI showing its native session picker
2. Selecting a session (in cursor's TUI, with its own keys) resumes that chat
3. The tmux pane border shows `cursor-resume`

Run again from another nvim or `:lua` invocation while the pane is still up — should focus the existing pane, not spawn a duplicate.

- [ ] **Step 3: Smoke test the dispatcher**

```vim
:lua require("plugins.sidekick.resume").open()
```

Verify:
1. `vim.ui.select` shows the choice between `claude` and `cursor`
2. Choosing `claude` opens the snacks picker from Task 4
3. Choosing `cursor` opens the cursor TUI from Step 2
4. Cancelling the select (Esc) does nothing

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/resume.lua
git commit -m "$(cat <<'EOF'
Add cursor resume delegation and open() dispatcher to resume.lua

Cursor has no machine-readable session list, so we spawn a sidekick
pane running 'cursor-agent resume' and let its TUI handle picking.
The new open() entry point first prompts for backend, then dispatches
to claude_picker() or cursor_resume().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `<leader>ar` keymap

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua`

- [ ] **Step 1: Add the keymap entry**

In `nvim/.config/nvim/lua/plugins/sidekick.lua`, find the `keys = { ... }` block. After the `<leader>al` block (lines 170–176) and before `<leader>a/`, insert:

```lua
    {
      "<leader>ar",
      function()
        require("plugins.sidekick.resume").open()
      end,
      desc = "Sidekick Resume Agent Session",
    },
```

- [ ] **Step 2: Reload nvim and verify the binding**

Restart nvim (the LazyVim spec reloads on restart). Then:

```vim
:verbose nmap <leader>ar
```

Expected output mentions `Sidekick Resume Agent Session` and points at `plugins/sidekick.lua`.

- [ ] **Step 3: End-to-end smoke**

In nvim, press `<leader>ar`. Expected: backend picker shows `claude` / `cursor`. Pick `claude` — verify the snacks resume picker opens with this cwd's sessions.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick.lua
git commit -m "$(cat <<'EOF'
Bind <leader>ar to sidekick resume picker

Routes <leader>ar through plugins.sidekick.resume.open() — backend
select followed by per-backend resume (custom picker for claude, TUI
delegation for cursor).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final smoke tests (from spec §Testing)

**Files:** none (verification only)

- [ ] **Step 1: Test 1 — `<leader>an` claude with name `test-named`**

In nvim, `<leader>an` → `claude` → label `test-named` → accept default cwd.

In another terminal: `pgrep -af 'claude.*--name test-named'`

Expected: process line includes `--name test-named`. Pass.

- [ ] **Step 2: Test 2 — quit and resume that session**

In the sidekick pane, exit claude (`/exit` or Ctrl-D). The pane closes.

Then in nvim: `<leader>ar` → `claude`.

Expected: a row labeled `test-named` (or with that as the display name) appears. Pressing Enter spawns `claude --resume <id>` and the conversation resumes with prior context. Pass.

- [ ] **Step 3: Test 3 — cursor resume**

In nvim: `<leader>ar` → `cursor`.

Expected: cursor's TUI opens in a sidekick pane. Selecting a session resumes it. Pass.

- [ ] **Step 4: Test 4 — idempotency on running session**

With a `claude-test-named` pane already running (re-create from Step 1 if needed), invoke `<leader>ar` → `claude` → pick `test-named`.

Expected: focuses existing pane; `tmux list-panes -a | grep test-named` shows exactly one pane. Pass.

- [ ] **Step 5: Test 5 — empty cwd**

```bash
mkdir -p /tmp/sidekick-empty-test && cd /tmp/sidekick-empty-test
nvim
```

In nvim: `<leader>ar` → `claude`.

Expected: notification "Sidekick: no claude sessions for this cwd" — picker does not open. Pass.

- [ ] **Step 6: Cleanup**

Kill any leftover test panes via `<leader>al` → `<C-x>`. Remove `/tmp/sidekick-empty-test` if created.

No commit for this task — verification only.

---

## Self-Review Notes

**Spec coverage:** All five spec sections covered:
- Goal / `<leader>ar` flow → Tasks 3–6
- Named-session naming change → Task 2
- File plan → matches Tasks 2/3/6
- Edge cases → Task 3 (no sessions, malformed jsonl), Task 4 (idempotency), Task 5 (cursor unauth handled by TUI)
- Testing → Task 7

**Type consistency:** `M.tool_commands` and `internal.tool_commands` refer to the same table; `internal.normalize_label` exists at line 94 of internal.lua; `registry.discover()` returns a table keyed by label; `internal.toggle_tool_session(name, focus)` matches existing signature; `internal.merged_tool_config(base, made)` matches existing signature.

**Open implementation question:** The exact JSON path for claude's `--name` is determined empirically in Task 1. If `--name` turns out to be ephemeral (not persisted), the parser still works — `name` is nil for all sessions and labels fall back to `claude-r-<id>`, with the `<leader>an` → claude integration still passing `--name` to the running process (showing in terminal title and `/resume` picker even if our nvim picker can't read it back). Feature is degraded but not broken.

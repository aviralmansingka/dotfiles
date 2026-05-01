# Sidekick Named Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sidekick-spawned named tmux sessions persist across nvim restarts, give them a dedicated picker with scrollback preview, add cross-session live grep, and make the session name visible inside every sidekick pane via tmux pane-border.

**Architecture:** Refactor `nvim/.config/nvim/lua/plugins/sidekick.lua` into a thin LazyVim spec + a `sidekick/` subdirectory with one helper module (`internal.lua`) and three feature modules (`registry.lua`, `picker.lua`, `search.lua`). Tmux is the source of truth for session existence — labels are rehydrated from tmux on demand. A `session-created` hook in `tmux/.tmux.conf` enables `pane-border-status top` only on sidekick-pattern sessions.

**Tech Stack:** Neovim Lua, sidekick.nvim, snacks.nvim picker, tmux 3.6.

**Spec:** `docs/superpowers/specs/2026-05-01-sidekick-named-sessions-design.md`.

**Branch:** `sidekick-named-sessions`.

**Note on testing:** This is a personal dotfiles repo with no Lua test framework. Each task replaces TDD's "write failing test → make pass" loop with **manual smoke verification**: each task includes an explicit `:lua` probe or keymap trigger with the exact expected output. Run it. If output matches, the task is done.

---

## File Structure

```
nvim/.config/nvim/lua/plugins/sidekick.lua            -- LazyVim spec + keymaps (modified, slimmed)
nvim/.config/nvim/lua/plugins/sidekick/internal.lua   -- shared helpers (new; relocation)
nvim/.config/nvim/lua/plugins/sidekick/registry.lua   -- tmux discovery + rehydration (new)
nvim/.config/nvim/lua/plugins/sidekick/picker.lua     -- <leader>al picker (new)
nvim/.config/nvim/lua/plugins/sidekick/search.lua     -- <leader>a/ grep (new)
tmux/.tmux.conf                                       -- session-created hook (modified)
```

Each module has one clear responsibility. `internal.lua` is the only place that knows about `tool_commands`, `tool_urls`, and the `start_named_session` flow; everything else depends on it.

---

## Task 1: Extract helpers into `internal.lua`

**Goal:** Pure relocation of helpers from `sidekick.lua` into a new module. No behavior change. This unblocks the feature modules that need to call `start_named_session` and friends.

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/internal.lua`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua` (replace inline helpers with `require` of new module)

- [ ] **Step 1: Create the new module with all relocated helpers**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/internal.lua
local M = {}

M.tool_urls = {
  claude = "https://github.com/anthropics/claude-code",
  opencode = "https://github.com/sst/opencode",
}

M.claude_bin = vim.fn.executable(vim.fn.expand("~/.local/bin/claude")) == 1
    and vim.fn.expand("~/.local/bin/claude")
  or "claude"

M.tool_commands = {
  claude = { M.claude_bin, "--ide" },
  opencode = { "opencode" },
  codex = { "codex" },
}

function M.command_to_shell(cmd)
  if type(cmd) ~= "table" then
    return tostring(cmd)
  end
  local escaped = {}
  for _, part in ipairs(cmd) do
    escaped[#escaped + 1] = vim.fn.shellescape(part)
  end
  return table.concat(escaped, " ")
end

function M.is_claude_tool(name)
  return type(name) == "string" and name:match("^claude") ~= nil
end

function M.ensure_claude_bridge()
  local ok, claudecode = pcall(require, "claudecode")
  if not ok then
    local lazy_ok, lazy = pcall(require, "lazy")
    if lazy_ok and type(lazy.load) == "function" then
      lazy.load({ plugins = { "claudecode.nvim" } })
      ok, claudecode = pcall(require, "claudecode")
    end
  end
  if not ok then
    vim.notify("Sidekick: failed to load claudecode.nvim", vim.log.levels.ERROR)
    return false
  end
  if claudecode.state and claudecode.state.server then
    return true
  end
  local started, err = claudecode.start(false)
  if started or err == "Already running" then
    return true
  end
  vim.notify("Sidekick: failed to start Claude IDE bridge: " .. tostring(err), vim.log.levels.ERROR)
  return false
end

function M.toggle_tool_session(name, focus)
  if M.is_claude_tool(name) and not M.ensure_claude_bridge() then
    return
  end
  require("sidekick.cli").toggle({ name = name, focus = focus ~= false })
end

function M.make_tool(cmd, cwd, url)
  if cwd and cwd ~= "" then
    return {
      cmd = { "sh", "-c", string.format("cd %s && exec %s", vim.fn.shellescape(cwd), M.command_to_shell(cmd)) },
      url = url,
    }
  end
  if type(cmd) == "table" then
    return { cmd = vim.deepcopy(cmd), url = url }
  end
  return { cmd = { cmd }, url = url }
end

function M.normalize_label(label)
  return (label or "")
    :gsub("^%s+", "")
    :gsub("%s+$", "")
    :lower()
    :gsub("[^%w_-]+", "-")
    :gsub("-+", "-")
    :gsub("^-+", "")
    :gsub("-+$", "")
end

function M.normalize_cwd(cwd)
  if not cwd or cwd == "" then
    return nil
  end
  local expanded = vim.fs.normalize(vim.fn.fnamemodify(cwd, ":p"))
  local current = vim.fs.normalize(vim.fn.fnamemodify(vim.fn.getcwd(), ":p"))
  if expanded == current then
    return nil
  end
  return expanded
end

---@param tool string
---@param label string
---@param cwd? string
function M.start_named_session(tool, label, cwd)
  local slug = M.normalize_label(label)
  if slug == "" then
    vim.notify("Sidekick: session label cannot be empty", vim.log.levels.WARN)
    return
  end
  local name = tool .. "-" .. slug
  local config = require("sidekick.config")
  local command = M.tool_commands[tool] or { tool }
  config.cli.tools[name] = M.make_tool(command, M.normalize_cwd(cwd), M.tool_urls[tool])
  M.toggle_tool_session(name, true)
end

function M.prompt_named_session(tool)
  vim.ui.input({ prompt = string.format("%s session label: ", tool) }, function(session_label)
    if not session_label then
      return
    end
    vim.ui.input({
      prompt = "Working directory (leave empty for current): ",
      default = vim.fn.getcwd(),
      completion = "dir",
    }, function(cwd)
      M.start_named_session(tool, session_label, cwd)
    end)
  end)
end

return M
```

- [ ] **Step 2: Replace inline helpers in `sidekick.lua` with `require`**

Rewrite `nvim/.config/nvim/lua/plugins/sidekick.lua` so all helper code is gone and the keymap callbacks use the module:

```lua
-- nvim/.config/nvim/lua/plugins/sidekick.lua
local internal = require("plugins.sidekick.internal")

return {
  "folke/sidekick.nvim",
  dependencies = {
    "coder/claudecode.nvim",
  },
  opts = {
    cli = {
      win = {
        split = {
          width = 0.4,
          height = 20,
        },
      },
      mux = {
        backend = "tmux",
        enabled = true,
      },
      tools = {
        claude = internal.make_tool(internal.tool_commands.claude, nil, internal.tool_urls.claude),
        opencode = internal.make_tool(internal.tool_commands.opencode, nil, internal.tool_urls.opencode),
      },
    },
  },
  keys = {
    {
      "<c-;>",
      function()
        internal.toggle_tool_session("claude", true)
      end,
      desc = "Sidekick Toggle Claude",
      mode = { "n", "x" },
    },
    {
      "<tab>",
      function()
        if not require("sidekick").nes_jump_or_apply() then
          return "<Tab>"
        end
      end,
      expr = true,
      desc = "Goto/Apply Next Edit Suggestion",
    },
    {
      "<c-.>",
      function()
        require("sidekick.cli").toggle()
      end,
      desc = "Sidekick Toggle",
      mode = { "n", "t", "i", "x" },
    },
    {
      "<leader>aa",
      function()
        require("sidekick.cli").toggle()
      end,
      desc = "Sidekick Toggle CLI",
    },
    {
      "<leader>as",
      function()
        require("sidekick.cli").select({
          focus = true,
          cb = function(state)
            if not state then
              return
            end
            local tool_name = state.tool and state.tool.name or nil
            if internal.is_claude_tool(tool_name) and not internal.ensure_claude_bridge() then
              return
            end
            require("sidekick.cli.state").attach(state, { show = true, focus = true })
          end,
        })
      end,
      desc = "Select CLI",
    },
    {
      "<leader>ad",
      function()
        require("sidekick.cli").close()
      end,
      desc = "Detach a CLI Session",
    },
    {
      "<leader>at",
      function()
        require("sidekick.cli").send({ msg = "{this}" })
      end,
      mode = { "x", "n" },
      desc = "Send This",
    },
    {
      "<leader>af",
      function()
        require("sidekick.cli").send({ msg = "{file}" })
      end,
      desc = "Send File",
    },
    {
      "<leader>av",
      function()
        require("sidekick.cli").send({ msg = "{selection}" })
      end,
      mode = { "x" },
      desc = "Send Visual Selection",
    },
    {
      "<leader>ap",
      function()
        require("sidekick.cli").prompt()
      end,
      mode = { "n", "x" },
      desc = "Sidekick Select Prompt",
    },
    {
      "<leader>ac",
      function()
        internal.toggle_tool_session("claude", true)
      end,
      desc = "Sidekick Toggle Claude",
    },
    {
      "<leader>ag",
      function()
        internal.toggle_tool_session("codex", true)
      end,
      desc = "Sidekick Toggle Codex (G)PT",
    },
    {
      "<leader>ao",
      function()
        require("sidekick.cli").toggle({ name = "opencode", focus = true })
      end,
      desc = "Sidekick Toggle OpenCode",
    },
    {
      "<leader>an",
      function()
        local tools = { "claude", "opencode", "codex" }
        vim.ui.select(tools, { prompt = "Select CLI tool:" }, function(tool)
          if not tool then
            return
          end
          internal.prompt_named_session(tool)
        end)
      end,
      desc = "Sidekick New Named Session",
    },
  },
}
```

- [ ] **Step 3: Smoke verify — open nvim, confirm existing keymaps still work**

In a fresh nvim session inside this repo:

```
:Lazy reload sidekick.nvim
:lua print(vim.inspect(require("plugins.sidekick.internal").tool_commands))
```

Expected output: a table showing `claude`, `opencode`, `codex` entries, e.g.:
```
{
  claude = { "/Users/aviral/.local/bin/claude", "--ide" },
  codex = { "codex" },
  opencode = { "opencode" }
}
```

Then trigger `<leader>ac` (toggle Claude). Expected: a sidekick split opens with claude attached, no errors in `:messages`.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick.lua nvim/.config/nvim/lua/plugins/sidekick/internal.lua
git commit -m "$(cat <<'EOF'
Extract sidekick helpers into internal module

Pure relocation: tool_commands, tool_urls, make_tool, normalize_label,
normalize_cwd, start_named_session, prompt_named_session,
is_claude_tool, ensure_claude_bridge, toggle_tool_session move from
sidekick.lua into a new sidekick/internal.lua. No behavior change.
Unblocks the feature modules that need shared access to these helpers.
EOF
)"
```

---

## Task 2: Add `parse_session_name` to `registry.lua`

**Goal:** Pure function that parses a tmux session name into `{ tool, slug, label }` for sidekick named sessions, returning `nil` otherwise. The atom on which discovery is built.

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/registry.lua`

- [ ] **Step 1: Write the parser**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/registry.lua
local internal = require("plugins.sidekick.internal")

local M = {}

--- Parse a tmux session name into its sidekick components.
--- Default sidekick sessions look like `claude <hash>`; named ones like
--- `claude-tutorial <hash>`. Only named sessions return a non-nil result —
--- defaults are already registered in Config.cli.tools.
---
--- The tool prefix list is derived from internal.tool_commands so adding
--- a new tool there is the only change needed.
---@param name string
---@return { tool: string, slug: string, label: string }|nil
function M.parse_session_name(name)
  if type(name) ~= "string" then
    return nil
  end
  for tool, _ in pairs(internal.tool_commands) do
    -- Match `<tool>-<slug> <hash>` (named only; default `<tool> <hash>` returns nil).
    local pattern = "^" .. tool:gsub("%-", "%%-") .. "%-([%w_-]+)%s+%x+$"
    local slug = name:match(pattern)
    if slug and slug ~= "" then
      return { tool = tool, slug = slug, label = tool .. "-" .. slug }
    end
  end
  return nil
end

return M
```

- [ ] **Step 2: Smoke verify the parser**

```
:lua local r = require("plugins.sidekick.registry"); print(vim.inspect({
  r.parse_session_name("claude-tutorial abc123de"),
  r.parse_session_name("claude abc123de"),
  r.parse_session_name("opencode-foo deadbeef"),
  r.parse_session_name("modal"),
  r.parse_session_name("cursor xyz"),
}))
```

Expected:
```
{ {
    label = "claude-tutorial",
    slug = "tutorial",
    tool = "claude"
  }, vim.NIL, {
    label = "opencode-foo",
    slug = "foo",
    tool = "opencode"
  }, vim.NIL, vim.NIL }
```

(`vim.NIL` shows as `vim.NIL` in `vim.inspect`; positions 2/4/5 must be nil.)

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/registry.lua
git commit -m "$(cat <<'EOF'
Add session-name parser to sidekick registry

parse_session_name turns a tmux session name into
{ tool, slug, label } for named sidekick sessions. Default sessions
(no slug) and non-sidekick sessions return nil. Tool prefixes are
derived from internal.tool_commands.
EOF
)"
```

---

## Task 3: Add `discover` to `registry.lua`

**Goal:** List every running named sidekick session by shelling out to tmux. Returns a label-indexed table with `{ tool, slug, label, cwd, pane_id, session_id }`.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/registry.lua`

- [ ] **Step 1: Add `discover` to the module**

Append to `registry.lua`:

```lua
-- Format string passed to tmux list-panes; mirrors sidekick.nvim's PANE_FORMAT
-- but adds a literal separator we control. Layout:
-- <session_id>|<session_name>|<pane_id>|<cwd>
local PANE_FORMAT =
  "#{session_id}|#{session_name}|#{pane_id}|#{?pane_current_path,#{pane_current_path},#{pane_start_path}}"

---@return string[] lines, string? err
local function tmux_list_panes()
  if vim.fn.executable("tmux") ~= 1 then
    return {}
  end
  local out = vim.fn.systemlist({ "tmux", "list-panes", "-a", "-F", PANE_FORMAT })
  if vim.v.shell_error ~= 0 then
    return {}, table.concat(out, "\n")
  end
  return out
end

--- Walk all tmux panes; return a label-indexed map of named sidekick sessions.
--- One entry per label — if multiple panes share a session_name (multi-pane
--- session), the first wins. Sidekick spawns one pane per session so this is
--- the typical case.
---@return table<string, { tool: string, slug: string, label: string, cwd: string, pane_id: string, session_id: string }>
function M.discover()
  local out = {}
  for _, line in ipairs(tmux_list_panes()) do
    local session_id, session_name, pane_id, cwd = line:match("^([^|]+)|([^|]+)|([^|]+)|(.*)$")
    if session_id and session_name and pane_id then
      local parsed = M.parse_session_name(session_name)
      if parsed and not out[parsed.label] then
        out[parsed.label] = {
          tool = parsed.tool,
          slug = parsed.slug,
          label = parsed.label,
          cwd = cwd or "",
          pane_id = pane_id,
          session_id = session_id,
        }
      end
    end
  end
  return out
end
```

- [ ] **Step 2: Smoke verify against live tmux**

First, ensure at least one named tmux session exists. From a shell:
```bash
tmux new-session -d -s "claude-smoketest abc123de" || true
```

Then in nvim:
```
:lua print(vim.inspect(require("plugins.sidekick.registry").discover()))
```

Expected: a table containing at least `claude-smoketest = { tool = "claude", slug = "smoketest", ... }` plus any pre-existing labeled sessions (e.g. `claude-tutorial`, `claude-sidekick`). Default sessions (`claude <hash>`, `modal`, etc.) must not appear.

Cleanup:
```bash
tmux kill-session -t "claude-smoketest abc123de"
```

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/registry.lua
git commit -m "$(cat <<'EOF'
Add discover() to sidekick registry

Shells out to tmux list-panes -a, filters by parse_session_name, and
returns a label-indexed map of named sidekick sessions with their
cwd, pane_id, and session_id.
EOF
)"
```

---

## Task 4: Add `rehydrate` to `registry.lua`

**Goal:** Replay discovered labels back into `Config.cli.tools` so sidekick's existing pickers/keymaps recognize them. Idempotent — never overwrites.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/registry.lua`

- [ ] **Step 1: Add `rehydrate`**

Append:

```lua
--- For every discovered label not already in Config.cli.tools, register a
--- tool entry. Idempotent: existing tools are never overwritten (so explicit
--- registrations from <leader>an at runtime stay authoritative).
function M.rehydrate()
  local ok, config = pcall(require, "sidekick.config")
  if not ok then
    return
  end
  config.cli.tools = config.cli.tools or {}
  for label, entry in pairs(M.discover()) do
    if config.cli.tools[label] == nil then
      local cmd = internal.tool_commands[entry.tool] or { entry.tool }
      config.cli.tools[label] =
        internal.make_tool(cmd, internal.normalize_cwd(entry.cwd), internal.tool_urls[entry.tool])
    end
  end
end
```

- [ ] **Step 2: Smoke verify rehydration registers labels**

```
:lua require("plugins.sidekick.registry").rehydrate()
:lua local t = require("sidekick.config").cli.tools; for k, _ in pairs(t) do print(k) end
```

Expected: output includes `claude`, `opencode` (default), plus any labeled sessions from your live tmux (e.g. `claude-tutorial`, `claude-sidekick`). Each named-session label appears as a tool key.

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/registry.lua
git commit -m "$(cat <<'EOF'
Add rehydrate() to sidekick registry

Iterates discover() and registers any unknown labels into
Config.cli.tools, deferring to existing entries. Lets sidekick's
existing select/toggle entry points recognize labeled sessions
that were spawned in a prior nvim instance.
EOF
)"
```

---

## Task 5: Wire `rehydrate` to nvim startup

**Goal:** Call `registry.rehydrate()` once at startup so labels are available before any picker opens.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua`

- [ ] **Step 1: Add a `config` function to the LazyVim spec**

In `nvim/.config/nvim/lua/plugins/sidekick.lua`, the file currently contains an `opts = { cli = { ... } },` table followed immediately by `keys = { ... }`. Insert the following `config` field on a new line **between** the closing `},` of `opts = { ... }` and the start of `keys = { ... }`. Do not modify `opts` or `keys`.

```lua
  config = function(_, opts)
    require("sidekick").setup(opts)
    require("plugins.sidekick.registry").rehydrate()
  end,
```

After the edit, the surrounding region should read (only the lines shown here are relevant; everything inside `opts.cli` from Task 1 stays untouched):

```lua
  opts = {
    cli = {
      win = { split = { width = 0.4, height = 20 } },
      mux = { backend = "tmux", enabled = true },
      tools = {
        claude = internal.make_tool(internal.tool_commands.claude, nil, internal.tool_urls.claude),
        opencode = internal.make_tool(internal.tool_commands.opencode, nil, internal.tool_urls.opencode),
      },
    },
  },
  config = function(_, opts)
    require("sidekick").setup(opts)
    require("plugins.sidekick.registry").rehydrate()
  end,
  keys = {
```

- [ ] **Step 2: Smoke verify rehydrate fires on plugin load**

Restart nvim. Without invoking `rehydrate` manually, run:

```
:lua local t = require("sidekick.config").cli.tools; for k, _ in pairs(t) do print(k) end
```

Expected: labels from live tmux (e.g. `claude-tutorial`) appear in the list without you having called `rehydrate` explicitly. (sidekick.nvim is lazy-loaded on its keys, so you may need to fire any `<leader>a*` keymap first to trigger the plugin to load — that's expected.)

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick.lua
git commit -m "$(cat <<'EOF'
Rehydrate sidekick named sessions on plugin load

Adds a config callback that runs registry.rehydrate() right after
sidekick.nvim's own setup. Labels from prior nvim sessions become
visible in <leader>as without further user action.
EOF
)"
```

---

## Task 6: Create `picker.lua` with basic list + confirm

**Goal:** A snacks picker bound to `<leader>al` that lists named sessions and toggles to one on `<CR>`. No preview or kill keymap yet — those come in Tasks 7 and 8.

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/picker.lua`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua` (add keymap)

- [ ] **Step 1: Write the picker module**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/picker.lua
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")

local M = {}

---@return snacks.picker.finder.Item[]
function M.list_items()
  local items = {}
  local home = vim.fn.fnamemodify(vim.fn.expand("~"), ":p"):gsub("/$", "")
  for label, entry in pairs(registry.discover()) do
    local cwd_display = entry.cwd or ""
    if cwd_display:sub(1, #home) == home then
      cwd_display = "~" .. cwd_display:sub(#home + 1)
    end
    items[#items + 1] = {
      text = string.format("[%s] %s  %s", entry.tool, label, cwd_display),
      label = label,
      tool = entry.tool,
      slug = entry.slug,
      pane_id = entry.pane_id,
      session_id = entry.session_id,
      cwd = entry.cwd,
    }
  end
  table.sort(items, function(a, b)
    if a.tool ~= b.tool then
      return a.tool < b.tool
    end
    return a.label < b.label
  end)
  return items
end

function M.open()
  registry.rehydrate()
  local items = M.list_items()
  if #items == 0 then
    vim.notify("Sidekick: no named sessions", vim.log.levels.INFO)
    return
  end
  Snacks.picker.pick({
    source = "sidekick_named_sessions",
    title = "Sidekick Named Sessions",
    items = items,
    format = "text",
    preview = "none",
    confirm = function(picker, item)
      picker:close()
      if item and item.label then
        internal.toggle_tool_session(item.label, true)
      end
    end,
  })
end

return M
```

- [ ] **Step 2: Add the `<leader>al` keymap**

In `nvim/.config/nvim/lua/plugins/sidekick.lua`, inside the `keys = { ... }` block, immediately before the existing `<leader>an` entry, add:

```lua
    {
      "<leader>al",
      function()
        require("plugins.sidekick.picker").open()
      end,
      desc = "Sidekick List Named Sessions",
    },
```

- [ ] **Step 3: Smoke verify the picker opens, lists, and confirms**

Restart nvim. Trigger `<leader>al`. Expected:
- A snacks picker opens titled "Sidekick Named Sessions".
- Each row shows `[tool] label  cwd~` format.
- Pressing `<CR>` on a row closes the picker and toggles to that sidekick session (a sidekick split opens in the foreground).

If you have zero named sessions, expected: a notification "Sidekick: no named sessions" and no picker.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/picker.lua nvim/.config/nvim/lua/plugins/sidekick.lua
git commit -m "$(cat <<'EOF'
Add sidekick named-session picker on <leader>al

Snacks-based picker that lists every named tmux session via
registry.discover(), formats each row as [tool] label  cwd~, and
toggles to the chosen session on <CR>. No preview or inline kill
yet — added in subsequent commits.
EOF
)"
```

---

## Task 7: Add scrollback preview to picker

**Goal:** Show the last 200 lines of the chosen session's tmux scrollback in the picker preview window so the user can identify "which one was that?" before jumping.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/picker.lua`

- [ ] **Step 1: Add a custom preview function**

Replace the `M.open` function in `picker.lua` with:

```lua
---@param item table
---@return string[]
local function preview_lines(item)
  if not item or not item.pane_id then
    return { "(no pane)" }
  end
  local out = vim.fn.systemlist({
    "tmux",
    "capture-pane",
    "-p",
    "-S",
    "-200",
    "-E",
    "-",
    "-t",
    item.pane_id,
  })
  if vim.v.shell_error ~= 0 then
    return { "(capture-pane failed)" }
  end
  return out
end

function M.open()
  registry.rehydrate()
  local items = M.list_items()
  if #items == 0 then
    vim.notify("Sidekick: no named sessions", vim.log.levels.INFO)
    return
  end
  Snacks.picker.pick({
    source = "sidekick_named_sessions",
    title = "Sidekick Named Sessions",
    items = items,
    format = "text",
    preview = function(ctx)
      local lines = preview_lines(ctx.item)
      vim.api.nvim_buf_set_lines(ctx.buf, 0, -1, false, lines)
      return true
    end,
    confirm = function(picker, item)
      picker:close()
      if item and item.label then
        internal.toggle_tool_session(item.label, true)
      end
    end,
  })
end
```

- [ ] **Step 2: Smoke verify preview renders**

Trigger `<leader>al`. Move the cursor through rows. Expected: the preview pane on the right shows the last 200 lines of scrollback for the highlighted session — the actual content of the running CLI tool. Empty/idle sessions may show only a few lines.

If preview shows `(capture-pane failed)`, it means the pane disappeared between list and preview — re-open the picker.

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/picker.lua
git commit -m "$(cat <<'EOF'
Add scrollback preview to sidekick named-session picker

Previewer captures the last 200 lines of each session's tmux pane
via tmux capture-pane -p -S -200 -E - and renders them in the
picker preview buffer.
EOF
)"
```

---

## Task 8: Add `<C-x>` kill keymap inside picker

**Goal:** Inside the picker, `<C-x>` kills the highlighted session via `tmux kill-session` and refreshes the list.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/picker.lua`

- [ ] **Step 1: Add a kill action and bind it**

Replace the `M.open` function with:

```lua
---@param session_id string
local function kill_session(session_id)
  if not session_id or session_id == "" then
    return false
  end
  local out = vim.fn.systemlist({ "tmux", "kill-session", "-t", session_id })
  -- Treat "session not found" as success — the session already went away.
  if vim.v.shell_error == 0 then
    return true
  end
  for _, line in ipairs(out) do
    if line:match("can't find session") or line:match("no such session") then
      return true
    end
  end
  vim.notify("Sidekick: tmux kill-session failed: " .. table.concat(out, " "), vim.log.levels.WARN)
  return false
end

function M.open()
  registry.rehydrate()
  local items = M.list_items()
  if #items == 0 then
    vim.notify("Sidekick: no named sessions", vim.log.levels.INFO)
    return
  end
  Snacks.picker.pick({
    source = "sidekick_named_sessions",
    title = "Sidekick Named Sessions",
    items = items,
    format = "text",
    preview = function(ctx)
      local lines = preview_lines(ctx.item)
      vim.api.nvim_buf_set_lines(ctx.buf, 0, -1, false, lines)
      return true
    end,
    confirm = function(picker, item)
      picker:close()
      if item and item.label then
        internal.toggle_tool_session(item.label, true)
      end
    end,
    win = {
      input = {
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n", "i" } },
        },
      },
      list = {
        keys = {
          ["<c-x>"] = { "sidekick_kill_session", mode = { "n" } },
        },
      },
    },
    actions = {
      sidekick_kill_session = function(picker, item)
        if not item or not item.session_id then
          return
        end
        if kill_session(item.session_id) then
          picker:close()
          vim.schedule(function()
            M.open()
          end)
        end
      end,
    },
  })
end
```

- [ ] **Step 2: Smoke verify kill + refresh**

Create a disposable session:
```bash
tmux new-session -d -s "claude-killtest abc123de"
```

Trigger `<leader>al`. Highlight the `claude-killtest` row. Press `<C-x>`. Expected: picker closes, then re-opens; `claude-killtest` is no longer in the list. Verify in shell:
```bash
tmux list-sessions | grep killtest || echo "gone"
```
Expected: prints `gone`.

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/picker.lua
git commit -m "$(cat <<'EOF'
Add <C-x> kill action to sidekick named-session picker

Inside the picker, <C-x> on a row runs tmux kill-session and
re-opens the picker. Treats 'session not found' as success so
double-press is harmless.
EOF
)"
```

---

## Task 9: Create `search.lua` snapshot + grep entry point

**Goal:** Capture every named-session pane to `/tmp/sidekick-search-<pid>/<label>.txt` and hand the directory to `Snacks.picker.grep`. Bind to `<leader>a/`.

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/sidekick/search.lua`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua` (add keymap, register cleanup)

- [ ] **Step 1: Write `search.lua`**

```lua
-- nvim/.config/nvim/lua/plugins/sidekick/search.lua
local internal = require("plugins.sidekick.internal")
local registry = require("plugins.sidekick.registry")

local M = {}

---@return string
local function tmpdir()
  local pid = vim.fn.getpid()
  return string.format("/tmp/sidekick-search-%d", pid)
end

--- Capture every named-session pane to <tmpdir>/<label>.txt.
--- Wipes the directory first so each invocation starts clean.
---@return string dir, integer captured count
function M.snapshot()
  local dir = tmpdir()
  vim.fn.delete(dir, "rf")
  vim.fn.mkdir(dir, "p")
  local count = 0
  for label, entry in pairs(registry.discover()) do
    local out = vim.fn.systemlist({
      "tmux",
      "capture-pane",
      "-p",
      "-S",
      "-",
      "-E",
      "-",
      "-t",
      entry.pane_id,
    })
    if vim.v.shell_error == 0 then
      local path = string.format("%s/%s.txt", dir, label)
      vim.fn.writefile(out, path)
      count = count + 1
    end
  end
  return dir, count
end

function M.grep()
  registry.rehydrate()
  local dir, count = M.snapshot()
  if count == 0 then
    vim.notify("Sidekick: no named sessions to search", vim.log.levels.INFO)
    return
  end
  Snacks.picker.grep({
    title = "Sidekick Search",
    dirs = { dir },
    confirm = function(picker, item)
      picker:close()
      if not item or not item.file then
        return
      end
      local fname = vim.fn.fnamemodify(item.file, ":t:r") -- strip dir + .txt
      if fname and fname ~= "" then
        internal.toggle_tool_session(fname, true)
      end
    end,
  })
end

function M.cleanup()
  vim.fn.delete(tmpdir(), "rf")
end

return M
```

- [ ] **Step 2: Wire keymap and cleanup autocmd in `sidekick.lua`**

In the `keys = { ... }` block, immediately after the `<leader>al` entry, add:

```lua
    {
      "<leader>a/",
      function()
        require("plugins.sidekick.search").grep()
      end,
      desc = "Sidekick Search Named Sessions",
    },
```

Update the `config` function to register a `VimLeavePre` autocmd:

```lua
  config = function(_, opts)
    require("sidekick").setup(opts)
    require("plugins.sidekick.registry").rehydrate()
    vim.api.nvim_create_autocmd("VimLeavePre", {
      group = vim.api.nvim_create_augroup("plugins.sidekick.search", { clear = true }),
      callback = function()
        pcall(function()
          require("plugins.sidekick.search").cleanup()
        end)
      end,
    })
  end,
```

- [ ] **Step 3: Smoke verify search end-to-end**

In a labeled session, run `echo SIDEKICK_SEARCH_TOKEN_$$` inside the CLI (or just in any shell pane within that tmux session) so there's a unique string. Then in nvim:

```
<leader>a/
```

Type `SIDEKICK_SEARCH_TOKEN_`. Expected: snacks grep picker opens, your unique line appears as a result, the row's path looks like `/tmp/sidekick-search-<pid>/<label>.txt`. Press `<CR>`. Expected: picker closes and a sidekick split opens for that label.

Then exit nvim and verify cleanup:
```bash
ls /tmp/sidekick-search-* 2>/dev/null && echo "still there" || echo "cleaned"
```
Expected: `cleaned`.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick/search.lua nvim/.config/nvim/lua/plugins/sidekick.lua
git commit -m "$(cat <<'EOF'
Add cross-session scrollback search on <leader>a/

Snapshots every named-session pane to /tmp/sidekick-search-<pid>/
and hands the directory to Snacks.picker.grep. Confirming a result
toggles to the source session. VimLeavePre autocmd cleans up
the tmpdir on nvim exit.
EOF
)"
```

---

## Task 10: Add tmux pane-border title for sidekick sessions

**Goal:** Show the session name as the first line of every sidekick pane via `pane-border-status top`. Scoped via `session-created` hook so non-sidekick sessions are untouched.

**Files:**
- Modify: `tmux/.tmux.conf`

- [ ] **Step 1: Append the hook + bootstrap to `tmux/.tmux.conf`**

Open `tmux/.tmux.conf` and find the end of the file (just before the final `run '#{TMUX_PLUGIN_MANAGER_PATH}/tpm/tpm'` line). Insert this block immediately above that final `run` line:

```tmux
# Sidekick: show session name as the first line of every sidekick pane.
# Sidekick disables the per-session status bar, so we use pane-border instead.
# Matches both default (`claude <hash>`) and named (`claude-foo <hash>`) sessions.
set-hook -g session-created 'if-shell -F "#{r:^(claude|opencode|codex)( |-),#{session_name}}" "set -t #S pane-border-status top ; set -t #S pane-border-format \" #S \""'

# Apply to sessions that already exist when this config is sourced.
run-shell 'for s in $(tmux list-sessions -F "#S" | grep -E "^(claude|opencode|codex)( |-)"); do tmux set -t "$s" pane-border-status top; tmux set -t "$s" pane-border-format " #S "; done'
```

- [ ] **Step 2: Re-stow tmux config and verify**

```bash
cd ~/dotfiles && stow tmux
tmux source-file ~/.tmux.conf
```

Then attach to an existing sidekick-pattern session and confirm the pane border shows the session name:

```bash
tmux attach -t "claude-tutorial c" 2>/dev/null || tmux attach -t "$(tmux list-sessions -F '#S' | grep -E '^(claude|opencode|codex)' | head -1)"
```

Expected: the pane has a top border line displaying ` claude-tutorial c ` (or whichever session name). Detach with `<prefix> d`.

For the `session-created` hook, spawn a new test session:
```bash
tmux new-session -d -s "claude-hooktest abc123"
tmux attach -t "claude-hooktest abc123"
```
Expected: same pane-border behavior on the brand-new session. Detach and clean up:
```bash
tmux kill-session -t "claude-hooktest abc123"
```

Negative check: an unrelated session (e.g. `modal`) should NOT have the pane-border header:
```bash
tmux attach -t modal 2>/dev/null
```
Expected: no top border line; the session looks exactly as it did before this change. Detach.

- [ ] **Step 3: Commit**

```bash
git add tmux/.tmux.conf
git commit -m "$(cat <<'EOF'
Show session name as pane-border header for sidekick sessions

session-created hook enables pane-border-status top with a format
of ' #S ' for sessions matching the sidekick name pattern
(claude|opencode|codex prefix). A bootstrap run-shell applies the
same options to sessions that already exist when the config is
sourced. Non-sidekick sessions are untouched.
EOF
)"
```

---

## Task 11: Adversarial smoke pass

**Goal:** Run the spec's Tier 2 adversarial cases end-to-end as a final sanity check. No code changes; if anything fails, fix in a follow-up commit.

**Files:** none.

- [ ] **Step 1: Empty case — no labeled sessions**

```bash
tmux list-sessions -F '#S' | grep -E '^(claude|opencode|codex)-' | xargs -I{} tmux kill-session -t '{}'
```

In nvim, trigger `<leader>al`. Expected: notification "Sidekick: no named sessions"; no picker opens.

Then trigger `<leader>a/`. Expected: notification "Sidekick: no named sessions to search"; no picker opens.

- [ ] **Step 2: Mid-session creation flow**

Inside nvim, trigger `<leader>an`. Choose `claude`, label `smoke`, accept default cwd. Expected: a sidekick split opens for `claude-smoke`. Now trigger `<leader>al`. Expected: `claude-smoke` appears in the picker.

- [ ] **Step 3: Verify pane-border on the just-created session**

From the sidekick split, the topmost line of the pane should show ` claude-smoke <hash> ` as the pane-border. Confirm visually.

- [ ] **Step 4: Two nvim instances**

Open a second nvim instance in another terminal. In each, trigger `<leader>a/` simultaneously. Expected: each grep picker shows results from its own `/tmp/sidekick-search-<pid>/` — no cross-contamination, no errors.

- [ ] **Step 5: Cleanup**

```bash
tmux kill-session -t "claude-smoke $(tmux list-sessions -F '#S' | grep '^claude-smoke ' | head -1 | awk '{print $2}')" 2>/dev/null || true
```

(If that's awkward, just `tmux kill-session -t <full-name>` for any leftover smoke sessions.)

- [ ] **Step 6: No commit needed if all passed**

If something failed, fix it inline and commit with a message describing the regression and the fix. Otherwise, this task is complete with no changes.

---

## Task 12: Update file documentation reference

**Goal:** The `nvim/.config/nvim/lua/plugins/sidekick.lua` file used to contain a long block of helper code; future readers will wonder where it went. Add a one-line comment at the top of the LazyVim spec pointing at the `sidekick/` subdir.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/sidekick.lua`

- [ ] **Step 1: Add a header comment**

At the very top of `sidekick.lua` (above the existing `local internal = require(...)` line), add:

```lua
-- LazyVim spec for sidekick.nvim. Helpers and feature modules live in
-- ./sidekick/ (internal, registry, picker, search).
```

- [ ] **Step 2: Smoke verify nothing broke**

Restart nvim. Trigger `<leader>ac`, `<leader>al`, `<leader>a/`. Each should work as in prior tasks. No `:messages` errors.

- [ ] **Step 3: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/sidekick.lua
git commit -m "$(cat <<'EOF'
Point sidekick.lua at its sibling modules

One-line header comment so a future reader knows internal/registry/
picker/search live under ./sidekick/.
EOF
)"
```

---

## Done criteria

After all tasks pass:

- [ ] `<leader>al` opens a snacks picker with all live named sidekick sessions, scrollback preview, and `<C-x>` to kill.
- [ ] `<leader>a/` opens a snacks grep over the scrollback of every live named session; selecting a match jumps to that session.
- [ ] After restarting nvim, labels from prior tmux sessions are visible in `<leader>as` without any user action.
- [ ] Every sidekick pane shows ` <session-name> ` as the first line via `pane-border-status top`. Non-sidekick sessions are unchanged.
- [ ] `<leader>an`, `<leader>ac`, `<leader>ag`, `<leader>ao`, `<leader>as` and the rest of the existing keymaps still work exactly as before.

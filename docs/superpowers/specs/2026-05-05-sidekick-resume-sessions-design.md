# Sidekick: Resume Agent Sessions (`<leader>ar`)

**Status:** Design
**Date:** 2026-05-05
**Scope:** Neovim sidekick plugin layer (`nvim/.config/nvim/lua/plugins/sidekick/`)

## Goal

Add a keymap `<leader>ar` that resumes a previously-stored agent session, with two selection dialogs:

1. Pick the agent backend (claude or cursor)
2. Pick a session belonging to that backend

Resumption uses each agent's *native* session store — distinct from `<leader>al`, which lists currently-running tmux panes via the sidekick registry. `<leader>ar` finds sessions even when no tmux pane is currently running them.

Additionally, when a named session is created via `<leader>an`, the agent's own session-management layer should learn the name where the agent supports it.

## Non-Goals

- opencode and codex backends. Only claude and cursor in v1.
- Cross-cwd session listing. v1 lists claude sessions for the current working directory only.
- Deleting/forgetting sessions from the resume picker (`.jsonl` files are claude-managed).
- Naming cursor sessions. cursor-agent has no `--name` flag, so the asymmetry is accepted.
- Setting a deterministic claude session id via `--session-id`. Claude requires a valid UUID; deriving one from a slug adds no benefit because resume targets are picked from a list, not constructed by name.

## Backend Capabilities (Reference)

### Claude

- `claude --resume <id>` — resume by session id
- `claude --resume` (no arg) — interactive picker
- `claude --name <name>` — display name shown in claude's `/resume` picker and terminal title
- `claude --session-id <uuid>` — set session id (UUID format required)
- Session storage: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, where `<encoded-cwd>` is the absolute cwd with `/` replaced by `-` (e.g., `/Users/aviral/dotfiles` → `-Users-aviral-dotfiles`)
- Each `.jsonl` contains a stream of typed events; the session id appears in event records, and `--name` (when set) appears in early metadata events

### Cursor

- `cursor-agent resume` — interactive TUI picker (no machine-readable list)
- `cursor-agent --resume <chatId>` — resume by id
- `cursor-agent ls` — also an interactive picker, not a list
- **No** `--name` flag for naming on creation
- Session storage on disk is not in a documented stable format; we do not parse it

## Design

### `<leader>ar` flow

```
<leader>ar
  └─ vim.ui.select({"claude", "cursor"}, prompt = "Resume agent backend:")
       ├─ claude  → resume.claude_picker()
       └─ cursor  → resume.cursor_resume()
```

### claude_picker()

1. Compute encoded cwd: `vim.fn.getcwd():gsub("/", "-")`
2. Glob `~/.claude/projects/<encoded-cwd>/*.jsonl`
3. If none, `vim.notify("Sidekick: no claude sessions for this cwd")` and return
4. For each file, build a session item:
   - `id` — basename without `.jsonl`
   - `mtime` — `vim.fn.getftime(path)`
   - `name` — scan the first ~20 jsonl lines for a record carrying a `name` field set by `--name`; nil if absent
   - `preview` — first user-message text content from the jsonl, truncated to ~80 chars
5. Sort items by `mtime` descending (most-recent first)
6. Open `Snacks.picker.pick` with:
   - `text` per item: `[claude] <name-or-short-id>  <relative-time>  <preview>`
   - preview pane: tail of the jsonl rendered as readable lines (or empty if too large)
7. On confirm:
   - Compute label: `claude-<slug>` if `name` was found (slug via `internal.normalize_label(name)`), else `claude-r-<id:1,8>`
   - If `registry.discover()[label]` exists, call `internal.toggle_tool_session(label, true)` and return (idempotency: don't spawn a duplicate)
   - Otherwise register a new tool entry in `sidekick.config.cli.tools[label]` whose command is:
     ```
     { claude_bin, "--ide", "--dangerously-skip-permissions", "--resume", id }
     ```
     (No `--name` re-injection — claude already has the name stored in the session)
   - Call `internal.toggle_tool_session(label, true)`

### cursor_resume()

No nvim-side picker. Register a transient tool entry whose command is `{ cursor_agent_bin, "--force", "resume" }` and toggle into it. Cursor's own TUI then handles selection.

- Label: `cursor-resume` (single transient entry; reused across invocations)
- If `registry.discover()["cursor-resume"]` exists, just toggle (re-attach to the existing TUI pane)
- Otherwise register and toggle as in the claude branch

### Named-session naming change (`<leader>an`)

Add a small helper in `internal.lua`:

```lua
function M.tool_command_for_named_session(tool, slug)
  local cmd = vim.deepcopy(M.tool_commands[tool] or { tool })
  if tool == "claude" and slug and slug ~= "" then
    table.insert(cmd, "--name")
    table.insert(cmd, slug)
  end
  return cmd
end
```

`start_named_session()` calls `tool_command_for_named_session(tool, slug)` instead of indexing `M.tool_commands` directly.

Cursor, opencode, and codex command construction is unchanged.

Effect: a session created with `<leader>an` and label `tutorial` runs

```
claude --ide --dangerously-skip-permissions --name tutorial
```

so the name shows up in claude's `/resume` picker, terminal title, and (consequently) in our `<leader>ar` claude picker. The two views become reflective of each other.

## File Plan

| File | Status | Description |
|---|---|---|
| `nvim/.config/nvim/lua/plugins/sidekick/resume.lua` | **new** | `claude_picker()`, `cursor_resume()`, jsonl parser. ~100 lines. |
| `nvim/.config/nvim/lua/plugins/sidekick/internal.lua` | edit | Add `tool_command_for_named_session()`; route `start_named_session()` through it. |
| `nvim/.config/nvim/lua/plugins/sidekick.lua` | edit | Add `<leader>ar` keymap that calls `require("plugins.sidekick.resume").open()`. |

## Edge Cases

- **No sessions in cwd:** notify and return early (claude branch).
- **Malformed `.jsonl`:** skip the file silently with a debug log; don't fail the whole picker.
- **Already-running session:** check `registry.discover()` for the target label; if present, toggle/focus instead of spawning a duplicate.
- **Resume of a session created before this change** (no `--name`): label falls back to `claude-r-<short-id>`. The resume still works; only the label cosmetic differs.
- **cursor not authenticated:** cursor's own TUI handles auth prompts.

## Open Questions

None at design time. Implementation may reveal small jsonl-parsing details (which event type carries `name`, exact UTF-8 handling of preview snippets) — those are fine to settle in code rather than spec.

## Testing

Manual smoke tests after implementation:

1. `<leader>an` with claude, label `test-named` → confirm `--name test-named` is in the spawned command (e.g., visible in `ps -ef | grep claude` or terminal title)
2. Quit that session, then `<leader>ar` → claude → confirm `test-named` appears in the picker, resumes correctly
3. `<leader>ar` → cursor → confirm cursor's TUI opens, pick a session, confirm it resumes
4. With an existing `claude-test-named` tmux pane running, `<leader>ar` → claude → pick `test-named` → should focus the running pane, not spawn a duplicate
5. In a fresh cwd with no claude sessions, `<leader>ar` → claude → expect "no sessions" notification

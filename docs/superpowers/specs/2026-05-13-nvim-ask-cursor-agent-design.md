# Inline "Ask Cursor-Agent" feature for Neovim

Date: 2026-05-13
Status: Approved

## Goal

A keybinding-driven flow that lets the user ask cursor-agent a focused question about code from inside Neovim, see a loading indicator in the gutter, and read the answer in a hover dialog when the cursor lands on the anchored line. Normal mode asks about the smallest enclosing function/class via treesitter; visual mode asks about the highlighted range. Both enrich the prompt with LSP `textDocument/hover` for every identifier in the code, in first-use order.

## Non-goals

- Persistence across nvim restarts. State is in-memory per session.
- Multiple Q&A per line. New question replaces the previous one on that line.
- Cost in USD. We surface latency + token counts only.
- Automated tests in v1. Manual verification only (UI-heavy).
- Cancellation of in-flight requests via keybind. They run to completion; results are dropped if the anchor was cleared.

## User-visible behavior

### Keybindings

All under the `<leader>a` ("AI") prefix.

| Key | Mode | Behavior |
|---|---|---|
| `<leader>aa` | n, x | Open prompt floating window above the cursor. On submit, fire a cursor-agent request with context from the smallest enclosing scope (normal) or the selection (visual). Spinner appears in the gutter; 🤖 replaces it on completion. **Replaces** existing "Sidekick Toggle CLI" mapping. |
| `<leader>ac` | n | Clear the completed answer on the current line. In-flight requests are left untouched. **Replaces** existing "Sidekick Toggle Claude" mapping. |
| `<leader>ay` | n | Yank the answer on the current line to the system clipboard (`+` register). No-op if no completed answer. |
| `<leader>at` | n, x | Send code or AI answer (markdown-blockquoted) to a sidekick named session selected via `vim.ui.select`. Normal mode sends the AI answer on the current line; visual mode sends the selected text. **Replaces** existing "Send This" mapping. |

### Prompt dialog

Single-line floating window above the cursor, rounded border, title ` ask cursor-agent `. Width 60 cols, height 1 line. Auto-enters insert mode. `<CR>` submits. `<Esc>` cancels. Empty input is treated as cancel. If the cursor sits within 2 rows of the top of the screen, the window flips to render below the cursor instead.

### Loading & completion indicators

Per-anchor gutter sign managed via extmark:

- **Pending**: animated Braille spinner. One global `vim.uv.new_timer` ticks at 100ms; per-anchor `spinner_frame` index advances each tick. Frames: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`.
- **Done**: `🤖`.
- **Error**: extmark cleared entirely (`vim.notify` carries the message).

Visual-mode answers additionally render a blue range bar (`│`, highlight `SidekickAskRange` linked to `DiagnosticInfo`) on every line of the original selection.

### Hover dialog

Triggered by `CursorHold` (uses Neovim's `updatetime`); closed on `CursorMoved` or buffer change. Only one hover open at a time. Position chosen per-render:

- Anchor line in top half of the **visible window** → hover renders **below** the line (or below the selection's last line for range anchors).
- Otherwise → hover renders **above** (above the first line of a range).

Float opts: `relative='win'`, `style='minimal'`, `border='rounded'`, `wrap=true`, `filetype='markdown'`, `width=min(80, columns-4)`, height clamped to `[1, 20]`. Body:

```
> **Q:** <question>

<answer>

---
*<duration>s · in:<input_tokens> out:<output_tokens>*
```

While pending, the body shows `*working...*` instead of `<answer>`, and the footer shows elapsed seconds instead of duration.

### Context assembly

`context.build({mode, bufnr, range?})` returns `{code, scope_kind, symbols}`:

**Code block:**

- Visual mode: selected lines verbatim. `scope_kind='selection'`.
- Normal mode: smallest enclosing `@function.outer` (then `@class.outer`) via `nvim-treesitter-textobjects` queries. `scope_kind='function'|'class'`. If neither query matches, fall back to whole buffer and set `scope_kind='buffer'`.

**Symbol walk:**

Parse the `code` region with treesitter; collect nodes of types `identifier`, `property_identifier`, `type_identifier`, `field_identifier` (set is parser-agnostic — missing types are ignored). Order by first source position. Dedupe by `name`.

**LSP hover:**

For each unique symbol, `vim.lsp.buf_request_sync(bufnr, 'textDocument/hover', params, 200)` using the first-occurrence position. If the response is nil / empty / errored, the symbol is **omitted from the symbols block** (it still appears in the code itself). Markdown content from `MarkupContent` is included verbatim — cursor-agent handles the fencing.

**Fallback chain:**

- No treesitter parser for the filetype → skip symbol walk, set `code = whole_buffer` (normal) or `selection` (visual), `symbols = {}`. One-time `vim.notify(WARN)` per buffer.
- No LSP attached → symbol walk still runs (for dedupe order) but `hover` returns empty for all; `symbols = {}`. No notify (this is common).

### Prompt template

```
answer the question: {{prompt}}

with code:
{{code}}

symbols:
{{symbols_block}}

Keep the answer to 2-4 sentences at most.
```

`{{symbols_block}}` format:

```
name1, name2, name3

name1:
<hover content for name1>

name2:
<hover content for name2>

name3:
<hover content for name3>
```

If `symbols` is empty, the entire `symbols:` section (label + block) is omitted.

### cursor-agent invocation

```lua
vim.system(
  { 'cursor-agent', '-p', '--mode', 'ask', '--output-format', 'json', prompt },
  { cwd = vim.fn.getcwd(), text = true },
  on_exit
)
```

`on_exit` parses `stdout` as one JSON object:
- Success path: extract `result`, `duration_ms`, `usage.inputTokens`, `usage.outputTokens`.
- Failure: non-zero `code`, `is_error=true`, missing `result`, or JSON parse failure → callback gets `{ok=false, err=<trimmed stderr or message>}`.

No timeout. Unlimited concurrency (one `vim.system` handle per question).

### Concurrency

Each `<leader>aa` invocation spawns an independent `vim.system` handle. No queue. Process handles are stored on the state entry so cleanup hooks can `:kill('sigterm')` them.

### Send-to-sidekick (`<leader>at`)

1. Compute payload:
   - Visual mode: selected lines via `vim.fn.getregion(vim.fn.getpos("'<"), vim.fn.getpos("'>"))` (fall back to line-based `nvim_buf_get_lines` between `'<.line` and `'>.line` if `getregion` unavailable). Trim trailing blanks.
   - Normal mode: `entry.answer` of the completed answer on the cursor line. If none, `vim.notify('ask: no answer on this line', WARN)` and exit.
2. Wrap each line with `> ` prefix; preserve blank lines as `>`.
3. `local sessions = require('plugins.sidekick.registry').discover()`. If empty, `vim.notify('ask: no named sidekick sessions', WARN)` and exit.
4. `vim.ui.select(vim.tbl_keys(sessions), { prompt = 'Send to which session?' }, function(label) … end)`.
5. On selection: `require('sidekick.cli').send({ name = label, msg = blockquoted })`.

## Architecture

### Module layout

All under `nvim/.config/nvim/lua/plugins/sidekick/ask/`:

```
ask/
  init.lua      -- Public API: ask(), clear_line(), yank_line(), send_to_session(). Wires global autocmds.
  state.lua     -- In-memory state store keyed by bufnr; anchor lookup helpers.
  context.lua   -- Pure context.build({mode, bufnr, range?}) → {code, scope_kind, symbols}.
  cli.lua       -- spawn(prompt, on_done) using vim.system; JSON parsing.
  signs.lua     -- Extmark namespace; spinner timer; sign/range-bar rendering.
  ui.lua        -- open_prompt(), open_hover(), close_hover().
```

Plugin spec lives in `nvim/.config/nvim/lua/plugins/sidekick.lua`. The four keymaps replace existing `<leader>aa`, `<leader>ac`, `<leader>at` entries and add `<leader>ay`.

### Data model (state.lua)

```lua
M.state = {
  [bufnr] = {
    [anchor_id] = {
      kind = 'line' | 'range',
      extmark_id = <int>,             -- anchor extmark (first line); tracks edits.
      range_extmarks = { <int>, ... },-- per-line blue-bar extmarks; range only.
      question = '<user prompt>',
      answer = '<cursor-agent result>' | nil,
      err = '<stderr>' | nil,
      status = 'pending' | 'done' | 'error',
      started_at = <ns>,              -- vim.uv.hrtime() at fire time.
      duration_ms = <int> | nil,
      tokens = { input = <int>, output = <int> } | nil,
      sysobj = <vim.system handle> | nil, -- only while pending.
      spinner_frame = <int>,          -- index into spinner chars.
    },
  },
}

M.by_extmark = { [bufnr] = { [extmark_id] = anchor_id } }
M.next_anchor_id = <int>  -- monotonic
```

Lookup `find_at(bufnr, line)`: iterate `M.state[bufnr]`; for each entry, call `nvim_buf_get_extmark_by_id` on `extmark_id` (and `range_extmarks[1]` / `range_extmarks[#]` for `kind='range'`); return entry whose live range covers `line`. If the anchor extmark has been deleted (line wiped), drop the entry on the spot.

Cleanup:

- `BufDelete` / `BufWipeout` for bufnr → kill all `sysobj`, drop the bufnr key.
- `VimLeavePre` → kill all pending `sysobj`.

### Signs (signs.lua)

One namespace via `vim.api.nvim_create_namespace('sidekick.ask')`. Anchor extmark created with `sign_text`, `sign_hl_group='DiagnosticInfo'`, and `invalidate=true` (so the extmark drops when its line is deleted).

Spinner: lazy-started global `vim.uv.new_timer`. On tick (100ms), walk `M.state`, find pending entries, advance `spinner_frame`, rewrite the anchor extmark via `nvim_buf_set_extmark` (overwriting `sign_text`). Timer stops when no pending entries remain.

Range bar: for `kind='range'`, lay one extmark per line in `[start, end]` with `sign_text='│'` and `sign_hl_group='SidekickAskRange'`. Created with `invalidate=true`. Highlight defined in `init.lua`'s `config` function via `vim.api.nvim_set_hl(0, 'SidekickAskRange', { link = 'DiagnosticInfo', default = true })`.

### UI

**open_prompt({on_submit, on_cancel}):**

- Create scratch buf (`buftype=nofile`, `bufhidden=wipe`).
- Float opts: `relative='cursor'`, `row=-2`, `col=0`, `width=60`, `height=1`, `style='minimal'`, `border='rounded'`, `title=' ask cursor-agent '`, `title_pos='center'`.
- If cursor screen-row < 2, flip `row=1`.
- `vim.cmd('startinsert')`.
- Buffer-local maps: `<CR>` (n+i) → grab line 1, close, `on_submit(text)`. `<Esc>` (n+i) → close, `on_cancel()`.
- `BufLeave` autocmd closes the window (treats as cancel).

**open_hover({entry, anchor_line, range_end?}):**

- Compute window-relative position of `anchor_line`: `local view = vim.fn.winsaveview(); local height = vim.api.nvim_win_get_height(0); local screen_row = anchor_line - view.topline`. If `screen_row < height / 2` → render below (`row = (range_end or anchor_line) + 1 - view.topline`), else render above.
- Build markdown body (see "Hover dialog" above).
- `width = math.min(80, vim.o.columns - 4)`. Pre-wrap body with `vim.fn.split(body, '\n')` to compute `height = math.min(20, #lines)`.
- Open float with `relative='win'`, `style='minimal'`, `border='rounded'`. Set `vim.wo[winid].wrap = true`, `vim.bo[buf].filetype = 'markdown'`.
- Store `entry.hover_winid`.

**close_hover():** close the currently-open hover (single global handle), clear `entry.hover_winid` on whichever entry holds it.

### Autocmds (init.lua)

- `CursorHold` (any buffer) → look up `find_at(bufnr, cursor_line)`. If found and entry has `status='done'`, `open_hover`.
- `CursorMoved`, `CursorMovedI`, `BufLeave`, `WinLeave` → `close_hover`.
- `BufDelete`, `BufWipeout` → cleanup that buffer's state.
- `VimLeavePre` → kill all pending `sysobj`.

Augroup: `sidekick.ask`.

## Error handling

| Case | Behavior |
|---|---|
| `cursor-agent` exits non-zero | Clear sign + range extmarks; drop entry; `vim.notify(stderr, ERROR)`. |
| `cursor-agent` returns `is_error=true` or no `result` | Same as above with the JSON's `result` (often an error message) or "cursor-agent: unexpected output". |
| JSON parse failure | Same; message is "cursor-agent: unexpected output". |
| Empty user prompt | Cancel; no work fired. |
| Buffer wiped while pending | `BufDelete` kills `sysobj`, drops state silently. |
| Nvim quit while pending | `VimLeavePre` kills all in-flight processes. |
| `<leader>aa` on a line with a **completed** answer | Replace: drop the old entry, fire a new one. |
| `<leader>aa` on a line with an **in-flight** entry | `vim.notify('ask: still working on this line', WARN)`; no new request. |
| LSP hover times out (>200ms) | Symbol omitted; no error. |
| Treesitter parser missing | Fallback to whole-buffer / selection-only; one-time `vim.notify(WARN)` per buffer. |
| Visual mode but selection is zero-width | Treat as normal mode. |
| User edits the answered line | Extmark moves with the edit; answer stays attached. |
| User deletes the answered line entirely | `invalidate=true` drops the extmark; `find_at` returns nil; entry is GC'd on next access. |

## Manual verification plan

1. **Smoke (normal mode)**: open a Go function, `<leader>aa`, type "what does this do?", `<CR>`. Verify: spinner in gutter → 🤖 within a few seconds → hover appears on `CursorHold` → cursor moves, hover closes.
2. **Smoke (visual mode)**: select 5 lines, `<leader>aa`, ask. Verify: blue range bar on all 5 lines, 🤖 on first line. Hover triggers anywhere in the range.
3. **Hover position**: ask on a line near top of buffer → hover below. Ask near bottom → hover above. Scroll the window so the same answered line moves; verify position recomputes.
4. **Concurrency**: fire 3 questions on 3 different lines within ~1s. All three spinners run; resolve independently as 🤖.
5. **Edit tracking**: ask on line 20. `O<Esc>O<Esc>O<Esc>O<Esc>O<Esc>` to add 5 lines above. Cursor to line 25 (where the original code now lives). Verify hover triggers.
6. **Line delete**: ask on line 20. `dd` on line 20. Verify sign disappears; state is GC'd; no errors.
7. **Clear**: `<leader>ac` on a done line clears it. `<leader>ac` on an in-flight line: no-op (spinner continues).
8. **Yank**: `<leader>ay` on a done line → clipboard has the answer. `<leader>ay` on an unanswered line → notify "no answer".
9. **Send-to-session (visual)**: select 3 lines, `<leader>at` → vim.ui.select picker → choose a named session → verify message arrives in that tmux session blockquoted.
10. **Send-to-session (normal)**: on an answered line, `<leader>at` → picker → message arrives. On an unanswered line, `<leader>at` → notify "no answer to send".
11. **Send-to-session with no sessions**: kill all named tmux sessions, `<leader>at` → notify "no named sidekick sessions".
12. **CLI error**: temporarily move `cursor-agent` out of `$PATH` (or `chmod -x` for the duration). Fire question; observe error notify with stderr; sign cleared.
13. **No treesitter**: open a `.txt` file. Fire question; verify fallback notify; verify cursor-agent still receives the whole-buffer text.
14. **No LSP**: open a `.lua` file without LSP attached (e.g., `:LspStop`). Fire question; verify `symbols:` section is absent (or empty) in the prompt; answer still arrives.
15. **Reload**: `:Lazy reload sidekick.nvim`. Verify either signs survive (if module state persists) or are dropped cleanly (no stale extmarks); document the actual behavior.

## Out of scope / future work

- Per-project answer persistence (file → restored on `BufRead`).
- `<leader>aA` clear-all-in-buffer keybind.
- Cancellation via `<leader>aa` re-press on an in-flight line.
- Pretty `a.b(c)` call-shape derivation for the symbols header (v1 uses comma-separated names).
- Cost in USD (requires hardcoded per-model price table).
- Automated tests against pure-function helpers in `context.lua` / `cli.lua`.

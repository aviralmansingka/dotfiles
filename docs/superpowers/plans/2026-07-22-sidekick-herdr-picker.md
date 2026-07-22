# Sidekick Herdr Session Picker — Implementation Plan

> **For agentic workers:** Execute each task test-first and keep the commits small. Do not add a second session model, event subscriber, or agent-specific transcript parser.

**Goal:** Make `<leader>al` prioritize Herdr `blocked`/`done` sessions and show a readable, unwrapped conversation preview without changing Herdr's lifecycle semantics.

**Architecture:** Keep the existing Snacks cwd picker. Reuse `registry.discover()` for `agent_status` and the existing `herdr.read()` adapter for `recent-unwrapped` text. Add one local status-priority table and one local presentation table in `cwd_picker.lua`; verify behavior through the existing `sidekick-herdr` and `sidekick-herdr-live` cases.

**Tech Stack:** Neovim Lua, Snacks.nvim, existing Herdr CLI adapter, `scripts/verify-nvim`.

**Spec:** `docs/superpowers/specs/2026-07-22-sidekick-herdr-picker-design.md`

---

## Scope

**Modify:**

- `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua`
- `scripts/verify-nvim.lua`

**Reuse unchanged:**

- `nvim/.config/nvim/lua/plugins/sidekick/herdr.lua` already accepts `recent-unwrapped`, a line limit, and optional ANSI.
- `nvim/.config/nvim/lua/plugins/sidekick/registry.lua` already exposes `agent_status` as `item.status`.
- `nvim/.config/nvim/lua/plugins/sidekick/internal.lua` already owns the focus/toggle path.

**Explicitly skip in v1:** ANSI screen toggle, socket subscriptions, polling, JSONL parsing, global-picker changes, and Neovim-owned unread state.

---

## Task 1: Sort local sessions by Herdr attention state

**Files:**

- Modify: `scripts/verify-nvim.lua:156-249`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua:41-78`

- [ ] **Step 1: Extend the existing mocked agent list**

In `validate_sidekick_herdr()`, keep the ignored base session and replace the single named session with four same-cwd named agents whose statuses are deliberately out of order:

```lua
{ name = "pi-idle", agent_status = "idle", ... },
{ name = "pi-working", agent_status = "working", ... },
{ name = "pi-done", agent_status = "done", ... },
{ name = "pi-blocked", agent_status = "blocked", ... },
```

Give every agent unique pane/terminal identifiers. Keep the existing registry assertions against `pi-blocked` so discovery coverage remains intact.

The global picker is out of scope, but its existing assertion must no longer assume there is only one mocked named agent. Scan `picker.list_items()` for `pi-blocked` and continue asserting that its status is exposed unchanged.

- [ ] **Step 2: Add an exact ordering assertion**

After `cwd_picker.list_items()`:

```lua
local ordered = {}
for _, item in ipairs(local_items) do
  ordered[#ordered + 1] = item.status
end
assert_sequence(ordered, { "blocked", "done", "working", "idle" }, "cwd picker Herdr status order")
```

- [ ] **Step 3: Run the focused verification and observe failure**

```bash
scripts/verify-nvim sidekick-herdr
```

Expected: failure showing the current tool/name ordering instead of the required Herdr status order.

- [ ] **Step 4: Add the smallest status-rank comparator**

Near the top of `cwd_picker.lua`:

```lua
local status_rank = { blocked = 1, done = 2, working = 3, idle = 4 }
```

Make the existing sort compare ranks first, with unknown states after the four known states, then retain the current tool and label tie-breakers:

```lua
local ar = status_rank[a.status] or math.huge
local br = status_rank[b.status] or math.huge
if ar ~= br then
  return ar < br
end
```

- [ ] **Step 5: Re-run the focused verification**

```bash
scripts/verify-nvim sidekick-herdr
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-nvim.lua nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
git commit -m "nvim: prioritize Herdr sessions needing attention"
```

---

## Task 2: Render readable state rows and an unwrapped preview

**Files:**

- Modify: `scripts/verify-nvim.lua:156-249`
- Modify: `nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua:31-38,92-109`

- [ ] **Step 1: Capture the Snacks picker specification in the headless test**

Temporarily replace `Snacks.picker.pick`, `herdr.read`, and `internal.toggle_tool_session`, restoring all three before `validate_sidekick_herdr()` returns. Capture:

- the picker options passed by `cwd_picker.open()`
- the arguments passed to `herdr.read()`
- calls to `internal.toggle_tool_session()`

Use `xpcall` or an explicit cleanup helper so failed assertions do not leave mocks installed for later checks.

- [ ] **Step 2: Assert the row presentation**

Call the captured `format` function with representative items and flatten its text chunks. Assert the row includes both the marker and literal state label for each state:

```text
blocked -> ! and blocked
done    -> ● and done
working -> › and working
idle    -> · and idle
```

Do not assert exact colors; the test should protect meaning, ordering, and readable labels without coupling to a colorscheme.

- [ ] **Step 3: Assert preview source and non-mutation**

Create a scratch buffer, invoke the captured preview callback for `pi-done`, and assert:

```lua
target == "pi-done"
source == "recent-unwrapped"
lines == 120
ansi == nil or ansi == false
```

Also assert that previewing made zero calls to `internal.toggle_tool_session`. Then call the captured confirm callback and assert exactly one call with `("pi-done", true)`.

- [ ] **Step 4: Assert readable failure behavior**

Make the `herdr.read` mock return `nil`, invoke preview again, and assert the buffer contains `(agent read failed)` while the picker object remains usable.

- [ ] **Step 5: Run the focused verification and observe failure**

```bash
scripts/verify-nvim sidekick-herdr
```

Expected: failure because the current preview requests `visible` with no bounded line count and row formatting has no state markers.

- [ ] **Step 6: Switch the existing preview call**

Change only the existing read invocation:

```lua
local text = herdr.read(item.agent_name, "recent-unwrapped", 120)
```

Keep the current plain `vim.split` rendering. Do not add ANSI parsing or a terminal buffer.

- [ ] **Step 7: Add local state presentation data**

Add a local table beside `status_rank`:

```lua
local status_display = {
  blocked = { "!", "DiagnosticError" },
  done = { "●", "DiagnosticWarn" },
  working = { "›", "DiagnosticInfo" },
  idle = { "·", "Comment" },
}
```

Update `format_item()` to prepend the mapped marker and retain the literal `[status]` text. Unknown states use `?` plus `Comment`.

- [ ] **Step 8: Re-run focused verification**

```bash
scripts/verify-nvim sidekick-herdr
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add scripts/verify-nvim.lua nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua
git commit -m "nvim: add readable Herdr session previews"
```

---

## Task 3: Verify Herdr owns the seen transition

**Files:**

- Modify: `scripts/verify-nvim.lua:252-368`

**Precondition:** A running Herdr server with current Pi/Codex integrations. The installed Herdr is currently `0.7.1`; if the focus assertion hits the known already-focused-session bug, update to `0.7.3` or newer rather than adding a Neovim workaround.

- [ ] **Step 1: Tighten the live settled-state setup**

After reporting `working`, report `idle` as the harness already does. Wait briefly for the agent to become `done` while it is not focused. Replace the current `idle or done` assertion with an exact `done` assertion for this pre-focus point.

- [ ] **Step 2: Focus through Herdr and assert seen**

Use the public adapter path:

```lua
if not herdr.call({ "agent", "focus", label }) then
  fail("Herdr agent focus failed")
end
local seen = vim.wait(3000, function()
  local agent = herdr.get_agent(label)
  return agent and agent.agent_status == "idle"
end, 50)
if not seen then
  fail("focused done agent did not become idle")
end
```

This verifies the ownership boundary; do not write any status back from Neovim.

- [ ] **Step 3: Run the live verification**

```bash
scripts/verify-nvim sidekick-herdr-live
```

Expected: pass, including exact `working -> done -> focus -> idle` behavior.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-nvim.lua
git commit -m "test: verify Herdr seen transition on focus"
```

---

## Task 4: Final regression and visual check

**Files:** No production changes expected.

- [ ] **Step 1: Run all relevant headless cases**

```bash
scripts/verify-nvim agent-keymaps
scripts/verify-nvim sidekick-pi
scripts/verify-nvim sidekick-herdr
scripts/verify-nvim sidekick-herdr-live
```

Expected: all pass.

- [ ] **Step 2: Inspect the final diff**

```bash
git diff HEAD~3 --check
git diff HEAD~3 -- nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua scripts/verify-nvim.lua
```

Expected: only the state ordering/presentation, readable preview source, and verification changes described above.

- [ ] **Step 3: Verify the visible picker**

With at least one `done` or `blocked` Herdr-backed named session in the current cwd:

1. Open Neovim and press `<leader>al`.
2. Confirm `blocked` and `done` rows sort above `working` and `idle`.
3. Confirm each row has a marker plus literal state text.
4. Move selection onto a conversation with long wrapped output.
5. Confirm the preview rewraps cleanly at the preview width and contains no raw escape sequences.
6. Confirm moving selection does not clear `done`.
7. Press `<CR>` on `done`; reopen the picker and confirm Herdr now reports it as `idle`.

- [ ] **Step 4: Record evidence**

Capture the Neovim picker surface showing mixed statuses and readable preview. Keep the capture scoped to Neovim; no extra demo project or sample corpus is needed.

---

## Completion Criteria

- `<leader>al` sorts `blocked`, `done`, `working`, `idle` exactly in that order.
- Rows expose both a state marker and literal status text.
- Preview uses bounded plain-text `recent-unwrapped` output.
- Selection/preview never marks a session seen.
- Focus leaves lifecycle ownership in Herdr and changes `done` to `idle`.
- No new files, dependencies, timers, subscribers, caches, or transcript parsers are added beyond this plan and verification documentation.

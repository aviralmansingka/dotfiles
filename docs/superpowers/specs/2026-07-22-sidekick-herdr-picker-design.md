# Sidekick Herdr Session Picker — Design

**Date:** 2026-07-22
**Status:** Approved for implementation planning
**Scope:** Personal Neovim configuration in `~/dotfiles`; replaces the data and preview path behind `<leader>al` without embedding Herdr's TUI.

## Problem

`<leader>al` already opens a useful Snacks picker for Sidekick sessions, but the picker still treats tmux/Sidekick discovery as its primary model. Herdr now owns the richer agent lifecycle state and can distinguish sessions that need attention:

- `blocked`: waiting for input or approval
- `done`: finished, but not yet seen
- `working`: actively running
- `idle`: finished and seen

The picker should expose those states and let the user read enough of each conversation to choose the right session. The preview must prioritize readable conversation text; reproducing a terminal viewport at a different width can preserve stale soft wraps and TUI chrome, making the text look mangled.

## Decisions

| Axis | Choice |
|---|---|
| UI shell | Keep the existing Snacks picker |
| Backend | Read sessions and lifecycle state through the existing Herdr adapter/socket API |
| Attention states | Treat `blocked` and `done` exactly as Herdr reports them |
| Sort order | `blocked`, `done`, `working`, `idle`, then the existing stable name ordering |
| Default preview | Plain-text `recent-unwrapped`, limited to a useful recent window |
| Exact terminal view | Optional ANSI `visible` preview mode; never the default |
| Seen transition | Previewing does not mark seen; confirming/opening a `done` agent does |
| Refresh model | Snapshot when the picker opens; no persistent socket subscription in v1 |
| Source reuse | Use Herdr's public API, not copied Rust TUI components or internal state |

## User Experience

Pressing `<leader>al` opens the current cwd-scoped Snacks picker. Each row begins with a compact Herdr state marker and continues to show the existing tool, label, and cwd information.

Sessions that need attention appear first:

```text
!  blocked  codex-auth       ~/dotfiles
●  done     claude-picker    ~/dotfiles
›  working  codex-refactor   ~/dotfiles
·  idle     pi-notes         ~/dotfiles
```

The exact glyphs and highlights should reuse Herdr's established state vocabulary where that maps cleanly onto Neovim highlight groups. Text labels remain present so meaning does not depend on color or glyph recognition.

Moving the selection updates the preview without changing agent state. The default preview reads recent logical lines, so terminal soft wrapping is discarded and Snacks/Neovim performs wrapping for the actual preview width.

Confirming with `<CR>` closes the picker and focuses the selected session through the existing Sidekick/Herdr path. Herdr remains responsible for transitioning a focused `done` session to seen/`idle`. A `blocked` session remains `blocked` until the agent actually resumes or otherwise changes state.

## Preview Sources

### Default: readable transcript

Use:

```text
agent read <name> --source recent-unwrapped --format text --lines 120
```

The Lua call should go through the existing `plugins.sidekick.herdr.read` helper rather than invoking the CLI from the picker directly. The precise line count may be adjusted during implementation if the existing picker layout makes 120 excessive, but it must remain bounded.

Why this is the default:

- logical lines do not contain terminal soft-wrap breaks
- plain text avoids leaking cursor movement and styling escape sequences into a normal preview buffer
- Neovim can wrap for the preview's real width
- the source is agent-neutral and works for every agent Herdr manages

### Optional: exact screen

An explicit picker action may switch the selected item to:

```text
agent read <name> --source visible --format ansi
```

This is a diagnostic/exact-screen view. It may include prompts, status bars, and layout artifacts from the original terminal dimensions, so it is not the primary reading experience. If rendering ANSI faithfully requires more machinery than the existing preview buffer supports, the toggle is deferred rather than adding a new dependency or terminal emulator in v1.

### Sources not used for the default preview

- `recent` preserves physical terminal rows and therefore stale wrapping.
- `visible` plain text still includes viewport chrome and physical wrapping.
- `detection` is Herdr's agent-detection snapshot, not a human transcript.
- Agent-native Codex/Claude/Pi JSONL could provide semantic messages, but would require a parser and compatibility contract per agent. That remains a future adapter only if `recent-unwrapped` proves insufficient.

## Architecture

The change stays inside the existing Sidekick modules:

```text
nvim/.config/nvim/lua/plugins/sidekick/herdr.lua      existing Herdr API adapter
nvim/.config/nvim/lua/plugins/sidekick/registry.lua   existing session discovery/model
nvim/.config/nvim/lua/plugins/sidekick/cwd_picker.lua existing <leader>al UI
```

No new service, cache, event loop, or persistent state file is introduced.

### Data flow

```text
<leader>al
  -> discover/rehydrate current cwd sessions
  -> attach Herdr agent name and agent_status to each picker item
  -> sort by Herdr state priority, then stable existing fields
  -> render readable preview with herdr.read(name, "recent-unwrapped", 120)

<CR>
  -> close picker
  -> focus/toggle selected session through the existing integration
  -> Herdr owns done -> idle when the session is seen
```

The picker consumes `agent_status`; it does not infer unread state from output timestamps, tmux activity, or local Neovim bookkeeping. This keeps `done` and `blocked` semantically identical to Herdr.

## Failure Handling

| Failure | Behavior |
|---|---|
| Herdr is unavailable | Preserve the existing Sidekick session list and show a neutral/unknown state |
| Agent has no Herdr name | Fall back to the existing pane/session preview path for that item |
| `recent-unwrapped` read fails | Show a short preview error; keep the picker usable |
| Session disappears while picker is open | Existing confirm behavior handles the stale item |
| Unknown future Herdr state | Sort after known attention states and display the raw state text |
| ANSI screen rendering is unsupported | Omit/defer the optional toggle; readable preview remains complete |

## Verification

Extend the existing `scripts/verify-nvim` Sidekick/Herdr coverage before changing production behavior.

Automated cases should prove:

1. A mixed list sorts `blocked`, `done`, `working`, `idle` in that order.
2. Row formatting exposes the textual Herdr state.
3. The default preview requests `recent-unwrapped`, text format, and a bounded line count.
4. Merely selecting/previewing a `done` session performs no focus or seen mutation.
5. Confirming a selection still calls the existing focus/toggle path.
6. A Herdr read failure leaves the picker open with a readable error.
7. A session without Herdr metadata retains the existing fallback behavior.

The live `sidekick-herdr-live` case should additionally verify that focusing a real `done` session yields Herdr's seen/`idle` transition. This checks the ownership boundary without recreating Herdr's state machine in Lua.

## Out of Scope

- Reimplementing or embedding Herdr's Rust TUI.
- Parsing Codex, Claude, or Pi transcript JSONL in v1.
- A long-lived `events.subscribe` connection in Neovim.
- Polling while the picker remains open.
- Neovim-owned unread flags or timestamps.
- Treating preview as seen.
- Changing `<leader>aL`, session creation, or other Sidekick keymaps.

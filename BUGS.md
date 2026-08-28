# Known Bugs

This file documents known issues with the current dotfiles configuration.

## Neovide Issues

### 1. Background Color Inconsistency

**Status:** Open
**Severity:** Medium
**Component:** Neovide GUI

**Description:**
In Neovide, editing windows display with a dark/black background instead of the expected gruvbox colorscheme background. Terminal windows correctly show the proper gruvbox colors.

**Expected Behavior:**
- All windows (editing and terminal) should use consistent gruvbox colorscheme background
- Background should match the configured colorscheme

**Actual Behavior:**
- Editing windows: Dark/black background
- Terminal windows: Correct gruvbox background colors

**Environment:**
- GUI: Neovide
- Colorscheme: Gruvbox
- Terminal emulator works correctly

**Potential Causes:**
- Neovide-specific transparency/background settings
- Colorscheme not properly applied to GUI windows
- Conflict between Neovide settings and nvim colorscheme

---

### 2. OSC52 Clipboard Errors

**Status:** Open
**Severity:** High
**Component:** Neovide + OSC52 Integration

**Description:**
Intermittent OSC52 clipboard errors occur when using Neovide, disrupting copy/paste functionality especially for SSH workflows.

**Expected Behavior:**
- OSC52 clipboard integration should work seamlessly
- Copy/paste should work reliably across local and SSH connections
- No errors when using clipboard functionality

**Actual Behavior:**
- Occasional OSC52 errors appear
- Copy/paste becomes unreliable
- Errors disrupt SSH clipboard sharing workflow

**Impact:**
- Breaks desired workflow of using Neovide as frontend for SSH connections
- Reduces reliability of clipboard operations
- Affects productivity when working across multiple systems

**Environment:**
- GUI: Neovide
- Use case: SSH connections with clipboard sharing
- OSC52 integration enabled

**Notes:**
- OSC52 is critical for SSH clipboard sharing functionality
- Goal is to use Neovide as primary frontend for remote development
- Error occurs "every now and then" (intermittent)

---

### 3. Duplicated LSP Signature-Help Popup

**Status:** Fixed (branch `fm/nvim-signature-help-dupe`)
**Severity:** Medium
**Component:** Neovim LSP / blink.cmp / noice.nvim

**Description:**
While typing a function call (e.g. `matmul_kernel(A, B,` with clangd attached),
two signature-help floats rendered simultaneously: a bordered float with
active-parameter highlight (blink.cmp) and a second unhighlighted float
(noice.nvim). Both auto-triggered on LSP trigger characters (`(`, `,`).

**Root Cause:**
`noice.nvim`'s `lsp.signature.auto_open` (enabled by default) and
`blink.cmp`'s `signature.enabled = true` both auto-request
`textDocument/signatureHelp` on trigger characters, each rendering its own
float. The `vim.lsp.handlers["textDocument/signatureHelp"]` override in
`lsp.lua` (border only) was not the duplicate source — both providers bypass
the handler with their own callbacks.

**Fix:**
Disabled noice's signature handler (`lsp.signature.enabled = false` in the
noice spec in `neovide.lua`). Blink.cmp remains the sole signature-help
provider, with `treesitter_highlighting = true` (explicit) and
`border = "rounded"`. The `lsp.lua` handler override is retained for manual
`<C-k>` triggers.

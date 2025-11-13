# OSC52 Clipboard Sharing Setup

This documentation covers how OSC52 (Operating System Command 52) enables seamless clipboard sharing across nested terminal environments: local Ghostty → SSH → Tmux → Neovim.

## Overview

OSC52 is an ANSI escape sequence that allows terminal applications to read/write the system clipboard. It's particularly powerful for remote development because it works through SSH tunnels, making clipboard operations work the same whether you're developing locally or on a remote server.

## Architecture

```
Ghostty Terminal (Local)
  ↓ supports OSC52
SSH Connection
  ↓ passes through escape sequences
Tmux (Local or Remote)
  ↓ forwards OSC52 sequences
Neovim
  ↓ generates OSC52 commands for copy
System Clipboard (Local macOS)
```

## Current Configuration

### 1. Ghostty (Terminal Emulator)

**File:** `ghostty/.config/ghostty/config`

**Key Settings:**
```bash
clipboard-read = allow        # Allow programs to read clipboard
clipboard-write = allow       # Allow programs to write to clipboard
shell-integration = detect    # Auto-detect shell (bash, zsh, fish, etc.)
shell-integration-features = cursor,sudo,title,ssh-env,ssh-terminfo
```

**What these do:**
- `clipboard-read/write`: Enable OSC52 without prompts
- `ssh-env`: Automatically converts TERM on remote hosts for compatibility
- `ssh-terminfo`: Auto-installs Ghostty's terminfo on remote servers

### 2. Tmux (Terminal Multiplexer)

**File:** `tmux/.tmux.conf`

**Key Settings:**
```bash
set -g allow-passthrough on                      # Allow escape sequences through tmux
set -s set-clipboard on                          # Let apps inside tmux use OSC52
set -as terminal-features ',xterm-256color:clipboard'
set -as terminal-features ',xterm-ghostty:clipboard'
set -ag terminal-overrides ',xterm-256color*:RGB'
set -ag terminal-overrides ',xterm-ghostty:RGB'
```

**What these do:**
- `allow-passthrough`: Critical for tmux 3.3a+ - forwards OSC52 to parent terminal
- `set-clipboard on`: **Critical setting** - allows Neovim to use OSC52 (not just tmux itself)
- `terminal-features`: Declares clipboard capability for different terminal types
- `terminal-overrides`: Provides RGB color support and proper OSC52 sequencing

### 3. Neovim (Text Editor)

**File:** `nvim/.config/nvim/lua/config/options.lua`

**Configuration:**
```lua
vim.o.clipboard = "unnamedplus"

local function paste()
  return {
    vim.split(vim.fn.getreg(""), "\n"),
    vim.fn.getregtype(""),
  }
end

if vim.env.SSH_TTY then
  -- SSH session: OSC52 for copy, local buffer for paste (avoids timeouts)
  vim.g.clipboard = {
    name = "OSC 52",
    copy = {
      ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
      ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
    },
    paste = {
      ["+"] = paste,
      ["*"] = paste,
    },
  }
end
```

**Why this configuration:**
- **Local sessions**: Uses native `unnamedplus` for system clipboard
- **SSH sessions**: Detects `SSH_TTY` and enables OSC52 copy mode
- **Copy-only paste**: Avoids 10-second timeouts when terminal doesn't support OSC52 paste
- The paste function reads from Neovim's unnamed buffer instead of the terminal

### 4. SSH Configuration

**File:** `~/.ssh/config`

**Status:** No special configuration needed for OSC52!

OSC52 works transparently through SSH. The escape sequences pass through the SSH connection without requiring special directives. Your existing SSH config handles this automatically.

## How It Works

### Copy (Yank) in Neovim

```
Neovim: User presses "+y to yank to clipboard
↓
Neovim generates OSC52 escape sequence:
  \033]52;c;<base64-encoded-text>\007
↓
Tmux receives the sequence (via allow-passthrough on)
↓
Tmux forwards it to Ghostty (via allow-passthrough on)
↓
Ghostty decodes base64 and copies to macOS clipboard
↓
Text appears in system clipboard (Cmd+V works in browser, notes, etc.)
```

### Paste in Neovim

```
User presses "+p to paste
↓
Local development: Uses system clipboard directly (native)
↓
Remote SSH development: Reads from Neovim's unnamed buffer
  (avoids terminal timeouts for paste responses)
↓
Text appears in Neovim buffer
```

## Usage

### Local Development (Ghostty on macOS)

Everything works automatically:
- **Copy**: Select text in Neovim and press `"+y`
- **Paste**: Press `"+p` or use Cmd+V from system clipboard
- Works seamlessly with tmux sessions

### Remote Development (SSH → Tmux → Neovim)

**Copy (Yank):**
```vim
"+y          " Copy to system clipboard (OSC52 passes through SSH)
"+Y          " Copy line to clipboard
```

The text you copy will appear in your local macOS clipboard (Cmd+V works immediately in local apps).

**Paste:**
```vim
"+p          " Paste from Neovim buffer
```

Or use terminal paste (Cmd+V on macOS, Ctrl+Shift+V on Linux) to paste text that was copied locally.

### Example Workflow

```bash
# On local machine
ssh remote-server
tmux attach        # or tmux new-session

# Inside remote tmux + Neovim
# Copy text from a file
nvim file.txt
# Select text in visual mode
# Press "+y to copy

# Local macOS - text is now in clipboard!
# Open browser, notes, or any app
# Cmd+V to paste
```

## Testing OSC52

### Test 1: Direct OSC52 Sequence

```bash
# Send OSC52 test to clipboard
printf "\033]52;c;$(printf 'Hello OSC52' | base64)\007"

# Try to paste in another app
# If it works, your terminal supports OSC52
```

### Test 2: SSH Over OSC52

```bash
# On local machine
ssh remote-server

# On remote machine
printf "\033]52;c;$(printf 'copied from remote' | base64)\007"

# Back on local machine
# Try to paste - should work!
```

### Test 3: Neovim Copy

```bash
# In local or remote Neovim inside tmux
# Select some text
v
# Move to select more
# Copy to clipboard
"+y

# In another local app (browser, notes, etc.)
# Cmd+V should paste the text
```

### Test 4: Verify Configuration

```bash
# Check tmux clipboard capability
tmux info | grep Ms

# Expected output should include Ms capability

# Check TERM variable
echo $TERM

# In tmux: should be screen-256color or tmux-256color
# Outside tmux: should be xterm-ghostty or xterm-256color
```

## Troubleshooting

### Issue: Yank Freezes for 10 Seconds

**Symptom:** Neovim says "Waiting for OSC 52 response from the terminal"

**Cause:** Terminal doesn't support OSC52 paste responses, but Neovim is waiting for one

**Solution:** Already handled by our configuration! The copy-only mode with local paste function avoids this.

### Issue: Nothing Copied to Clipboard

**Possible Causes:**
1. **Tmux not configured**: Make sure `set -s set-clipboard on` is in your tmux config
2. **SSH connection**: Verify OSC52 works with direct test: `printf "\033]52;c;$(printf 'test' | base64)\007"`
3. **Terminal support**: Ensure you're using Ghostty, Kitty, iTerm2, or another OSC52-capable terminal

**Solution:**
1. Re-run `stow ssh tmux ghostty nvim` to deploy updated configs
2. Restart tmux: `tmux kill-server && tmux new-session`
3. Test with direct OSC52 sequence

### Issue: Neovim Shows Different Term Variable

**In SSH session:**
```vim
:echo $TERM
```

May show `xterm-256color` or `screen-256color` instead of `xterm-ghostty`. This is expected and correct - Ghostty's `ssh-env` feature converts it for remote compatibility.

### Issue: Remote Server Doesn't Recognize Term

**Error:** "terminal type 'xterm-ghostty' not recognized"

**Solution:** Ghostty's `ssh-terminfo` feature handles this automatically. If it doesn't work:

```bash
# On remote server, install terminfo manually
infocmp -x xterm-ghostty | tic -x -
```

## Advanced Configuration

### Nested Tmux Sessions

If you run tmux both locally and remotely (tmux in tmux):

```bash
# In outer tmux config
set -s set-clipboard on
set -g allow-passthrough on

# In inner tmux config (or override with nested-tmux session)
set -as terminal-overrides ',screen*:Ms=\\E]52;%p1%s;%p2%s\\007'
```

### Kitty Terminal

If using Kitty instead of Ghostty, add to `~/.config/kitty/kitty.conf`:
```
clipboard_control write-clipboard write-primary no-append
```

### iTerm2

Enable OSC52 in iTerm2 Preferences:
- Profiles → Terminal → Enable "Application in Terminal may access clipboard"

### Performance Optimization

For faster copy operations, you can add to tmux config:
```bash
# Increase OSC52 max length if needed (default varies by terminal)
set -s set-clipboard-max 1000000  # 1MB
```

## References

- [Ghostty Documentation](https://ghostty.org/docs)
- [Ghostty Shell Integration](https://ghostty.org/docs/features/shell-integration)
- [Tmux Clipboard Wiki](https://github.com/tmux/tmux/wiki/Clipboard)
- [Neovim Clipboard](https://neovim.io/doc/user/provider.html#clipboard)
- [On Tmux OSC-52 Support](https://kalnytskyi.com/posts/on-tmux-osc52-support/)

## Summary

Your system is now configured for seamless clipboard sharing:

✅ **Ghostty**: OSC52 support with SSH terminfo handling
✅ **Tmux**: Clipboard passthrough with `allow-passthrough` and `set-clipboard on`
✅ **Neovim**: Copy works over SSH via OSC52, paste is instant (no timeouts)
✅ **SSH**: Transparent OSC52 support (no config needed)

The configuration prioritizes reliability and performance, using copy-only OSC52 in SSH sessions to avoid timeout issues while maintaining full clipboard functionality.

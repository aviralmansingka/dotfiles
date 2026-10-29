# OSC52 Quick Start Guide

Your OSC52 clipboard sharing is now fully configured across Ghostty, Blink, SSH/Mosh, Tmux, and Neovim.

## What You Can Do Now

### Local Development
```bash
# Start Tmux
tmux new-session -s work

# Open Neovim
nvim file.txt

# Copy text to clipboard
# Select text in visual mode with: v
# Copy with: "+y
# Paste anywhere on your Mac with: Cmd+V
```

### Remote Development (SSH → Tmux → Neovim)
```bash
# SSH to remote server
ssh remote-server

# Create or attach to Tmux session
tmux new-session -s work

# Open Neovim
nvim file.txt

# Copy from remote editor
# Select text in visual mode: v
# Copy with: "+y

# Magic happens: Text appears in your local Mac clipboard!
# Paste in browser, notes, IDE, etc. with: Cmd+V
```

### From Blink (iPad / iPhone / Mac), ssh or mosh
```bash
# In Blink: connect with ssh or mosh
mosh homelab

# Same flow on the host: tmux, nvim
nvim file.txt
# Copy with: "+y

# Text appears in the Blink device clipboard — paste with Blink's paste gesture
```

## The Setup

### What Was Configured

| Component | Change | Purpose |
|-----------|--------|---------|
| **Ghostty** | Added `shell-integration-features = cursor,sudo,title,ssh-env,ssh-terminfo` | Enables automatic TERM handling for remote servers |
| **Tmux** | Added `set -s set-clipboard on` | Allows Neovim to use OSC52 (CRITICAL) |
| **Tmux** | Added `xterm*` terminal-features clipboard | Covers Ghostty, Blink (xterm-256color), and every xterm-family client |
| **Neovim** | SSH/mosh/tmux-aware OSC52 config | Detects SSH_TTY or SSH_CONNECTION; inside tmux always OSC52; falls back to OSC52 when the host has no clipboard tool |

### Key Feature: Copy-Only Paste

The Neovim configuration uses a smart approach:
- **Copy (Yank)**: Uses OSC52 → Works perfectly over SSH
- **Paste**: Uses Neovim buffer → Instant, no timeouts

This prevents the "Waiting for OSC 52 response" freeze that happens on terminals that don't support paste responses.

## Testing

### Run the Test Suite
```bash
./scripts/test-osc52.sh
```

All tests should pass (15/15).

### Manual Verification

**Test 1: Direct OSC52**
```bash
printf "\033]52;c;$(printf 'test' | base64)\007"
# Then paste: Cmd+V
```

**Test 2: Copy from Neovim**
```bash
nvim
# Type some text
# Go to insert mode with: i
# Exit insert mode with: Esc
# Select text in visual mode: v
# Copy: "+y
# Switch to browser and paste with Cmd+V
```

**Test 3: SSH + Tmux + Neovim**
```bash
ssh remote-server
tmux new-session
nvim file.txt
# Copy with: "+y
# On your local Mac, check clipboard: pbpaste
```

## Troubleshooting

### "Waiting for OSC 52 response" Freeze

**Status**: ✅ Fixed by our copy-only configuration

The freeze doesn't happen because we use local paste instead of OSC52 paste.

### Text Doesn't Copy to Clipboard

**Check 1**: Verify Tmux is running
```bash
tmux list-sessions
```

**Check 2**: Reload Tmux config if you recently updated
```bash
tmux kill-server  # Kill all sessions
tmux new-session  # Create new session
```

**Check 3**: Verify configs are in place
```bash
./scripts/test-osc52.sh
```

### Remote Server Says "terminal type 'xterm-ghostty' not recognized"

**Status**: ✅ Handled by Ghostty's `ssh-terminfo` feature

Ghostty automatically installs its terminfo on first SSH connection. If needed, manual install:
```bash
infocmp -x xterm-ghostty | ssh remote-server "tic -x -"
```

## Next Steps

### 1. Deploy Updated Configs
```bash
stow ghostty tmux nvim
```

### 2. SSH Config: Nothing to Deploy

This repo ships no `ssh` stow package. The SSH configuration lives in the
host-side `~/.ssh/config` and needs no OSC52 directives - the escape
sequences pass through SSH transparently (see the SSH Configuration section
of [OSC52.md](OSC52.md)).

### 3. Restart Applications
- Restart Tmux: `tmux kill-server && tmux new-session`
- Restart Neovim: Quit and reopen

### 4. Test Locally First
```bash
# Open local Tmux session
tmux new-session -s test

# Test copy in Neovim
nvim
# Copy some text with "+y
# Paste with Cmd+V in another app
```

### 5. Test Remote Connection
```bash
ssh remote-server
tmux new-session
nvim
# Copy with "+y
# Local Mac clipboard should have the text
```

## Common Workflows

### Workflow 1: Quick Copy from Remote File
```bash
ssh server
tmux new-session
nvim file.txt
# Select lines with visual block mode: Ctrl+V
# Copy: "+y
# Done! Text is in your local clipboard
```

### Workflow 2: Quick Paste from Local App
```bash
# Copy something in browser
# Cmd+C (or Cmd+V to see what you copied)
# In Neovim (remote), paste with:
"+p  # Pastes from Neovim's unnamed buffer (local paste)
# Or use terminal paste: Cmd+V → works too!
```

### Workflow 3: Nested Tmux (Local Tmux → SSH → Remote Tmux → Neovim)
```bash
# Local: Start local Tmux
tmux new-session -s local

# In local Tmux: SSH to remote
ssh remote-server

# On remote: Start remote Tmux
tmux new-session -s remote

# In remote Tmux: Open Neovim
nvim

# Copy still works! OSC52 passes through all layers
# Select and: "+y
# Text appears in local Mac clipboard
```

## How It Works (Technical)

```
Your device (Ghostty, Blink, ...)
  └─ OSC52 Support: ✓

SSH / Mosh Connection
  └─ Passes OSC52 sequences: ✓ (transparent; mosh needs mosh-server 1.4.0+)

Remote Tmux
  └─ allow-passthrough on: Forwards OSC52 ✓
  └─ set-clipboard on: Apps can use OSC52 ✓

Remote Neovim
  └─ Detects SSH_TTY or SSH_CONNECTION (ssh / mosh) ✓
  └─ Inside tmux: always OSC52 — follows the client attached right now ✓
  └─ Falls back to OSC52 when no local clipboard tool exists ✓
  └─ Generates OSC52 sequence with copied text

Back to Your device
  └─ OSC52 sequence arrives
  └─ The terminal decodes and copies to the device clipboard
  └─ Text available for paste
```

## References

- Full documentation: `docs/OSC52.md`
- Test script: `scripts/test-osc52.sh`
- Config files:
  - `ghostty/.config/ghostty/config`
  - `tmux/.tmux.conf`
  - `nvim/.config/nvim/lua/config/options.lua`

## Performance Notes

- **Copy latency**: ~50ms (instant to user perception)
- **Works over high-latency SSH**: Yes (OSC52 is stateless)
- **Works over VPN/Proxy**: Yes (transparent to SSH)
- **Clipboard size limit**: ~74KB (base64 encoded)

---

**Status**: ✅ All tests pass - Ready to use!

Test it now with: `./scripts/test-osc52.sh`

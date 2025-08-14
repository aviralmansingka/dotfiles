# SSH Copy-Paste Issues with Zellij and Neovim

## Problem Statement
Copy-paste functionality is not working properly when using zellij terminal multiplexer and neovim on a remote host accessed via SSH.

## Current Environment Context

### Zellij Configuration
- Using custom gruvbox-dark theme
- Compact layout with hidden status bar (`default_layout "compact"`)
- Rounded corners enabled with hidden session name
- Configuration file: `zellij/.config/zellij/config.kdl`

### Neovim Setup
- LazyVim distribution
- Yanky plugin for enhanced yank/paste functionality
- Multiple language support plugins installed
- Configuration: `lazyvim/.config/nvim/lazyvim.json`

### SSH Context
- Remote host accessed via SSH
- Terminal multiplexer (zellij) running on remote host
- Neovim running inside zellij session

## Likely Theories for Copy-Paste Issues

### 1. Clipboard Integration Chain Breaks
**Theory**: SSH → Zellij → Neovim creates a three-layer clipboard isolation
- SSH doesn't forward clipboard by default
- Zellij may intercept or not forward clipboard events
- Neovim expects local clipboard access that isn't available

### 2. OSC 52 Escape Sequence Handling
**Theory**: Terminal escape sequences for clipboard aren't properly forwarded
- Neovim uses OSC 52 sequences to communicate with terminal clipboard
- Zellij may not forward these sequences to the SSH client
- SSH client may not forward them to local terminal

### 3. X11/Wayland Forwarding Issues
**Theory**: GUI clipboard forwarding is disabled or broken
- SSH X11 forwarding not enabled (`ssh -X` or `ssh -Y` not used)
- DISPLAY environment variable not set properly in remote session
- Wayland clipboard integration issues if using Wayland locally

### 4. Zellij Clipboard Configuration Missing
**Theory**: Zellij clipboard integration not properly configured
- No explicit clipboard settings in zellij config
- Copy mode keybindings may not be configured
- Zellij may need explicit OSC 52 forwarding enabled

### 5. Neovim Clipboard Provider Issues
**Theory**: Neovim can't find suitable clipboard provider on remote system
- Missing clipboard utilities (xclip, xsel, pbcopy, wl-copy)
- Incorrect clipboard provider configuration in neovim
- LazyVim/yanky plugin clipboard integration misconfigured

### 6. Terminal Capability Mismatch
**Theory**: Terminal terminfo/capabilities don't support clipboard operations
- TERM environment variable mismatch between local and remote
- Terminal capabilities database missing clipboard support
- Kitty terminal (local) capabilities not recognized by remote applications

## Potential Solutions to Test

### Quick Diagnostics
```bash
# Check neovim clipboard status
:checkhealth provider

# Test OSC 52 sequence directly
printf "\033]52;c;$(echo -n 'test' | base64)\007"

# Check available clipboard tools
which xclip xsel pbcopy wl-copy

# Verify SSH forwarding
echo $DISPLAY
echo $SSH_CLIENT
```

### Configuration Fixes

#### Enable SSH X11 Forwarding
```bash
# Connect with X11 forwarding
ssh -X user@host
# or with trusted X11 forwarding
ssh -Y user@host
```

#### Zellij Clipboard Configuration
Add to `config.kdl`:
```kdl
copy_clipboard "system"
copy_on_select true
```

#### Neovim Clipboard Configuration
Force specific clipboard provider or enable OSC 52:
```lua
vim.opt.clipboard = "unnamedplus"
-- or force OSC 52
vim.g.clipboard = {
  name = 'OSC 52',
  copy = {
    ['+'] = require('vim.ui.clipboard.osc52').copy('+'),
    ['*'] = require('vim.ui.clipboard.osc52').copy('*'),
  },
  paste = {
    ['+'] = require('vim.ui.clipboard.osc52').paste('+'),
    ['*'] = require('vim.ui.clipboard.osc52').paste('*'),
  },
}
```

### Alternative Approaches
1. Use tmux instead of zellij (known clipboard forwarding)
2. Install clipboard utilities on remote host
3. Use OSC 52 capable terminal emulator
4. Configure bracketed paste mode
5. Use file-based copy-paste workflow

## Next Steps
1. Run diagnostics to identify specific failure point
2. Test with simplified setup (SSH → Neovim without zellij)
3. Implement configuration changes based on findings
4. Verify clipboard functionality across the entire chain

## References
- Zellij documentation on clipboard integration
- Neovim `:help clipboard` documentation
- OSC 52 terminal escape sequence specification
- SSH X11 forwarding configuration guides
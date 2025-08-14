# OSC52 Clipboard Timeout Issue: Neovim + Zellij + SSH

## Problem Summary

Neovim hangs with OSC52 timeout error when attempting clipboard operations inside Zellij over SSH. Clipboard sharing works fine when Neovim runs outside of Zellij.

## Environment Analysis

### Current Configuration

- **Terminal**: Kitty with OSC52 support enabled
  - `clipboard_control write-clipboard write-primary read-clipboard read-primary` (at `kitty/.config/kitty/kitty.conf:24`)
  - **POTENTIAL ISSUE**: Kitty prompts for clipboard read permission by default
- **Zellij Version**: [TO BE DETERMINED]
- **Neovim Config**: LazyVim with OSC52 clipboard enabled
  - `vim.o.clipboard = "unnamedplus"`  
  - `vim.g.clipboard = "osc52"` (at `lazyvim/.config/nvim/lua/config/options.lua:3`)
- **Zellij Config**: Custom gruvbox theme, compact layout, no explicit OSC sequence configuration
- **Remote Host**: SSH connection to EC2 instance

### Key Observations

- ✅ **Works**: Neovim clipboard operations outside of Zellij
- ❌ **Fails**: Neovim clipboard operations inside Zellij (OSC52 timeout)
- **Error**: Timeout on OSC52 sequence transmission

## Root Cause Analysis

### Likely Issues

1. **Kitty Permission Prompt**: Kitty requires user confirmation for clipboard reads, causing timeout
2. **OSC52 Sequence Blocking**: Zellij may not be forwarding OSC52 escape sequences to the terminal  
3. **Terminal Multiplexer Interference**: Zellij's mouse mode may interfere with clipboard operations
4. **Timeout Configuration**: OSC52 timeout settings may be too aggressive for SSH + Zellij latency

## Diagnostic Questions (PENDING ANSWERS)

### System Configuration

- [ ] **Terminal Emulator**: What terminal are you using locally?
- [ ] **SSH Setup**: Any special SSH flags (`-X`, `-Y`) or ForwardX11 settings?
- [ ] **Zellij Version**: Output of `zellij --version`

### Behavior Details  

- [ ] **Timeout Duration**: How long does Neovim hang before error?
- [ ] **Specific Commands**: Which Neovim clipboard commands trigger timeout?
- [ ] **Working Scenario**: Exactly how are you testing "outside of zellij"?

## Troubleshooting Steps (ACTION ITEMS)

### Immediate Tests

1. **Check for Kitty permission prompts**:
   - Look for clipboard access prompts in Kitty when Neovim hangs
   - These prompts may appear as notifications or dialog boxes

2. **Test OSC52 Direct**:

   ```bash
   # In Zellij, test if OSC52 works at shell level
   printf "\033]52;c;$(echo 'test' | base64)\007"
   ```

2. **Check Zellij OSC Settings**:

   ```bash
   # Look for OSC-related configuration
   grep -i osc ~/.config/zellij/config.kdl
   ```

3. **Compare Multiplexers**:

   ```bash
   # Test with tmux for comparison
   tmux new-session -d && tmux attach
   nvim # test clipboard operations
   ```

### Configuration Fixes

#### Option 1: Fix Kitty Clipboard Permissions (MOST LIKELY FIX)

Your Kitty config allows clipboard reads but prompts for permission. Add to `kitty/.config/kitty/kitty.conf`:

```
# Disable clipboard read confirmation (security risk - consider carefully)
clipboard_control write-clipboard write-primary no-append
# OR allow without prompts (less secure):
# clipboard_control write-clipboard write-primary read-clipboard-ask read-primary-ask
```

#### Option 2: Configure Zellij Options

1. **Disable mouse mode** (if interfering):

   ```bash
   zellij --disable-mouse-mode
   ```

2. **Alternative copy command** (if OSC52 fails):

   ```kdl
   copy_command "pbcopy"    // macOS
   copy_command "xclip -selection clipboard"  // X11
   copy_command "wl-copy"   // Wayland
   ```

#### Option 2: Adjust Neovim OSC52 Timeout

Add to Neovim config:

```lua
vim.g.clipboard = {
  name = 'osc52',
  copy = {
    ['+'] = require('osc52').copy('+'),
    ['*'] = require('osc52').copy('*'),
  },
  paste = {
    ['+'] = require('osc52').paste('+'),
    ['*'] = require('osc52').paste('*'),
  },
}
-- Increase timeout
vim.g.osc52_timeout = 10000  -- 10 seconds
```

#### Option 3: Alternative Clipboard Solutions

- Use X11 forwarding instead of OSC52
- Configure SSH with clipboard forwarding
- Use tmux with proper OSC52 support

### Verification Commands

```bash
# Test Zellij version
zellij --version

# Test basic clipboard functionality
echo "test" | pbcopy  # or xclip/wl-clipboard
pbpaste

# Test SSH clipboard
ssh -X user@host "echo 'test' | pbcopy"
```

## Next Steps

1. Answer diagnostic questions above
2. Run immediate tests
3. Apply appropriate configuration fix
4. Verify solution works
5. Update documentation with working solution

## References

- [Zellij OSC52 Documentation](https://zellij.dev)
- [Neovim OSC52 Plugin](https://github.com/ojroques/nvim-osc52)
- [Terminal OSC52 Support Matrix](https://github.com/ojroques/nvim-osc52#terminal-compatibility)


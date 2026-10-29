#!/bin/bash

# OSC52 Clipboard Configuration Testing Script
# Tests OSC52 support across terminals (Ghostty, Blink), Tmux, and Neovim.
# Live-env manual suite (excluded from CI — see scripts/ci-tier2-exclusions.txt).
# Usage: ./scripts/test-osc52.sh

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         OSC52 Clipboard Configuration Tests                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test counters
PASS=0
FAIL=0

test_result() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $2"
    ((PASS++))
  else
    echo -e "${RED}✗${NC} $2"
    ((FAIL++))
  fi
}

# Test 1: Terminal Emulator
echo "1. Terminal Emulator"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TERM_VALUE="$TERM"
if [ "$TERM_VALUE" = "xterm-ghostty" ] || [ "$TERM_VALUE" = "xterm-256color" ]; then
  test_result 0 "Terminal TERM variable set: $TERM_VALUE"
else
  test_result 1 "Terminal TERM variable: $TERM_VALUE (expected xterm-ghostty or xterm-256color)"
fi

if [ -f ~/.config/ghostty/config ]; then
  test_result 0 "Ghostty config file exists"

  grep -q "clipboard-read = allow" ~/.config/ghostty/config
  test_result $? "Ghostty: clipboard-read = allow"

  grep -q "clipboard-write = allow" ~/.config/ghostty/config
  test_result $? "Ghostty: clipboard-write = allow"

  grep -q "shell-integration-features" ~/.config/ghostty/config
  test_result $? "Ghostty: shell-integration-features configured"
else
  echo -e "${YELLOW}⚠${NC} Ghostty config not found (Ghostty is macOS-only; checks skipped)"
fi

echo ""

# Test 2: Tmux Configuration
echo "2. Tmux Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMUX_VERSION=$(tmux -V | grep -oE '[0-9]+\.[0-9]+[a-z]?')
echo "Tmux version: $TMUX_VERSION"

TMUX_CONF="$HOME/.tmux.conf"
if [ ! -f "$TMUX_CONF" ] && [ -f "$HOME/.config/tmux/.tmux.conf" ]; then
  TMUX_CONF="$HOME/.config/tmux/.tmux.conf"
fi
# Prefer the repo checkout when present, so a worktree run tests the branch's
# config; fall back to the stowed $HOME file on hosts without a checkout.
REPO_CONF="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/tmux/.tmux.conf"
[ -f "$REPO_CONF" ] && TMUX_CONF="$REPO_CONF"

if [ -f "$TMUX_CONF" ]; then
  test_result 0 "Tmux config file found: $TMUX_CONF"

  grep -q "allow-passthrough on" "$TMUX_CONF"
  test_result $? "Tmux: allow-passthrough on"

  grep -q "set-clipboard on" "$TMUX_CONF"
  test_result $? "Tmux: set-clipboard on (CRITICAL)"

  grep -q "terminal-features.*clipboard" "$TMUX_CONF"
  test_result $? "Tmux: terminal-features clipboard"

  grep -q "xterm\*:clipboard" "$TMUX_CONF"
  test_result $? "Tmux: xterm* clipboard support (Ghostty, Blink, plain ssh)"
else
  test_result 1 "Tmux config file not found"
fi

echo ""

# Test 3: Neovim Configuration
echo "3. Neovim Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

NVIM_PATH=$(which nvim 2>/dev/null)
if [ -n "$NVIM_PATH" ]; then
  NVIM_VERSION=$($NVIM_PATH --version | head -1)
  echo "$NVIM_VERSION"

  NVIM_MINOR=$(echo "$NVIM_VERSION" | sed -n '1s/^NVIM v0\.\([0-9][0-9]*\).*/\1/p')
  NVIM_MAJOR=$(echo "$NVIM_VERSION" | sed -n '1s/^NVIM v\([1-9][0-9]*\)\..*/\1/p')
  if [ -n "$NVIM_MAJOR" ] || { [ -n "$NVIM_MINOR" ] && [ "$NVIM_MINOR" -ge 10 ]; }; then
    test_result 0 "Neovim 0.10+ (has native OSC52 support)"
  else
    test_result 1 "Neovim version may not support native OSC52"
  fi
else
  test_result 1 "Neovim not found"
fi

NVIM_CONF="$HOME/.config/nvim/lua/config/options.lua"
# Prefer the repo checkout when present (worktree runs test the branch's
# config); fall back to the stowed file on hosts without a checkout.
REPO_NVIM_CONF="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/nvim/.config/nvim/lua/config/options.lua"
[ -f "$REPO_NVIM_CONF" ] && NVIM_CONF="$REPO_NVIM_CONF"
if [ -f "$NVIM_CONF" ]; then
  test_result 0 "Neovim config file found"

  grep -q "OSC52 Clipboard Configuration" "$NVIM_CONF"
  test_result $? "Neovim: OSC52 configuration present"

  grep -q "ssh-termtty" "$NVIM_CONF" || grep -q "SSH_TTY" "$NVIM_CONF"
  test_result $? "Neovim: SSH detection configured"

  grep -q "SSH_CONNECTION" "$NVIM_CONF"
  test_result $? "Neovim: mosh detection (SSH_CONNECTION survives into mosh sessions)"

  grep -q "vim.env.TMUX" "$NVIM_CONF"
  test_result $? "Neovim: OSC52 inside tmux (clipboard follows the attached client, no restart)"

  grep -q "osc52_copy" "$NVIM_CONF" && grep -q "pbcopy" "$NVIM_CONF"
  test_result $? "Neovim: provider fallback (OSC52 when host has no clipboard tool)"
else
  test_result 1 "Neovim config file not found"
fi

echo ""

# Test 4: SSH Configuration
echo "4. SSH Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f ~/.ssh/config ]; then
  test_result 0 "SSH config file exists"
  echo "Note: SSH requires NO special OSC52 configuration"
  echo "      OSC52 sequences pass through SSH transparently"
else
  echo -e "${YELLOW}⚠${NC} SSH config not found (but not required for OSC52)"
fi

echo ""

# Test 5: Environment Check
echo "5. Runtime Environment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "TERM: $TERM"
echo "COLORTERM: ${COLORTERM:-not set}"

if [ -n "$SSH_TTY" ]; then
  echo -e "${GREEN}✓${NC} In SSH session (SSH_TTY=$SSH_TTY)"
  ((PASS++))
else
  if [ -n "$SSH_CONNECTION" ]; then
    echo -e "${GREEN}✓${NC} Likely mosh session (SSH_CONNECTION set, no SSH_TTY) — OSC52 gate still fires"
    ((PASS++))
  else
    echo -e "${YELLOW}⚠${NC} Not in SSH session (local development)"
  fi
fi

if [ -n "$TMUX" ]; then
  echo -e "${GREEN}✓${NC} In Tmux session (TMUX=$TMUX)"
  ((PASS++))
else
  echo "Not in Tmux session"
fi

echo ""

# Test 6: Direct OSC52 Test
echo "6. Direct OSC52 Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TEST_TEXT="OSC52-Test-$(date +%s)"
printf "\033]52;c;$(printf "$TEST_TEXT" | base64)\007"

echo "Sent OSC52 sequence with text: $TEST_TEXT"
echo "To verify: Check your system clipboard"
echo "  macOS:  pbpaste"
echo "  Linux:  xclip -o or wl-paste"

echo ""

# Summary
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Test Summary                            ║"
echo "╚════════════════════════════════════════════════════════════╝"

TOTAL=$((PASS + FAIL))
echo ""
echo -e "${GREEN}Passed: $PASS${NC} / ${RED}Failed: $FAIL${NC} (Total: $TOTAL)"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed! OSC52 is properly configured.${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. If using a Tmux session, reload: tmux source-file ~/.tmux.conf"
  echo "  2. If using Neovim, restart the editor"
  echo "  3. Test copy in Neovim: Select text and press \"+y"
  echo "  4. Verify text appears in system clipboard"
  exit 0
else
  echo -e "${RED}✗ Some tests failed. Review the configuration above.${NC}"
  echo ""
  echo "Common issues:"
  echo "  • Missing 'set-clipboard on' in tmux.conf (CRITICAL)"
  echo "  • Neovim version < 0.10 (no native OSC52 support)"
  echo "  • Terminal doesn't support OSC52"
  exit 1
fi

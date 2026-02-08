#!/bin/bash
set -euo pipefail

# Validates that all expected tools are installed and accessible on the devbox.
# Exit code 0 = all tools present, non-zero = missing tools.

AVIRAL_HOME="/home/aviralmansingka"

# Ensure cargo and local bin are in PATH (tools installed under aviralmansingka)
export PATH="$AVIRAL_HOME/.cargo/bin:$AVIRAL_HOME/.local/bin:$AVIRAL_HOME/.opencode/bin:$PATH"
[ -f "$AVIRAL_HOME/.cargo/env" ] && source "$AVIRAL_HOME/.cargo/env"

ERRORS=0

check_command() {
  local cmd="$1"
  local description="${2:-$1}"
  if command -v "$cmd" &>/dev/null; then
    echo "[OK] $description: $(command -v "$cmd")"
  else
    echo "[FAIL] $description: not found"
    ERRORS=$((ERRORS + 1))
  fi
}

check_path() {
  local path="$1"
  local description="$2"
  if [ -e "$path" ]; then
    echo "[OK] $description: $path"
  else
    echo "[FAIL] $description: $path not found"
    ERRORS=$((ERRORS + 1))
  fi
}

echo "=== System packages ==="
check_command git
check_command curl
check_command zsh
check_command tmux
check_command stow
check_command gcc
check_command make
check_command go "golang"
check_command python3
check_command node "nodejs"
check_command fdfind "fd-find"
check_command rg "ripgrep"
check_command fzf
check_command jq
check_command aws "awscli"

echo ""
echo "=== Rust toolchain ==="
check_command rustc
check_command cargo
check_command eza
check_command bob "bob-nvim"

echo ""
echo "=== CLI tools ==="
check_command starship
check_command zoxide
check_command lazygit
check_command yq
check_command kubectl
check_command kubectx
check_command kubens
check_command k9s
check_command uv
check_command direnv
check_command claude "claude-code"
check_command opencode

echo ""
echo "=== Neovim ==="
if [ -x "$AVIRAL_HOME/.local/share/bob/nvim-bin/nvim" ]; then
  echo "[OK] neovim via bob: $("$AVIRAL_HOME/.local/share/bob/nvim-bin/nvim" --version | head -1)"
else
  echo "[FAIL] neovim not found at $AVIRAL_HOME/.local/share/bob/nvim-bin/nvim"
  ERRORS=$((ERRORS + 1))
fi

check_path "$AVIRAL_HOME/.local/share/nvim/lazy/lazy.nvim" "lazy.nvim plugin manager"
check_path "$AVIRAL_HOME/.local/share/nvim/lazy/LazyVim" "LazyVim distribution"

echo ""
echo "=== Shell configuration ==="
check_path "$AVIRAL_HOME/.oh-my-zsh" "Oh My Zsh"
check_path "$AVIRAL_HOME/.oh-my-zsh/custom/plugins/zsh-autosuggestions" "zsh-autosuggestions"
check_path "$AVIRAL_HOME/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting" "zsh-syntax-highlighting"
check_path "$AVIRAL_HOME/.tmux/plugins/tpm" "TPM"

echo ""
echo "=== Dotfiles ==="
check_path "$AVIRAL_HOME/.zshrc" ".zshrc"
check_path "$AVIRAL_HOME/.tmux.conf" ".tmux.conf"
check_path "$AVIRAL_HOME/.config/nvim" "nvim config"
check_path "$AVIRAL_HOME/.config/starship.toml" "starship config"
check_path "$AVIRAL_HOME/.terminfo" "terminfo directory"

echo ""
echo "=== aviralmansingka user ==="
if id aviralmansingka &>/dev/null; then
  echo "[OK] aviralmansingka user exists"
else
  echo "[FAIL] aviralmansingka user does not exist"
  ERRORS=$((ERRORS + 1))
fi

SHELL_PATH=$(getent passwd aviralmansingka | cut -d: -f7)
if [ "$SHELL_PATH" = "/usr/bin/zsh" ]; then
  echo "[OK] Default shell is zsh"
else
  echo "[FAIL] Default shell is $SHELL_PATH, expected /usr/bin/zsh"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "All checks passed!"
else
  echo "$ERRORS check(s) failed"
  exit 1
fi

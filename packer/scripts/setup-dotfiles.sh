#!/bin/bash
# Clone dotfiles repository and deploy configurations
set -euo pipefail

DOTFILES_REPO="${DOTFILES_REPO:-https://github.com/aviralmansingka/dotfiles.git}"
DOTFILES_BRANCH="${DOTFILES_BRANCH:-develop}"
HOME="${HOME:-/home/devuser}"

echo "=== Setting up dotfiles ==="
echo "Repository: ${DOTFILES_REPO}"
echo "Branch: ${DOTFILES_BRANCH}"
echo "Home directory: ${HOME}"

cd "${HOME}"

# Add GitHub to known hosts (avoids SSH host key verification failures)
mkdir -p "${HOME}/.ssh"
ssh-keyscan -t ed25519,rsa github.com >> "${HOME}/.ssh/known_hosts" 2>/dev/null || true
chmod 600 "${HOME}/.ssh/known_hosts"

# Force HTTPS for all GitHub operations (avoids SSH issues in CI/packer)
git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

# Clone dotfiles repository
echo "Cloning dotfiles repository..."
if [ -d "${HOME}/dotfiles" ]; then
    echo "Dotfiles already exist, pulling latest..."
    cd "${HOME}/dotfiles"
    git pull origin "${DOTFILES_BRANCH}" || true
else
    git clone --branch "${DOTFILES_BRANCH}" "${DOTFILES_REPO}" "${HOME}/dotfiles"
    cd "${HOME}/dotfiles"
fi

# ===== Install Oh-My-Zsh =====
echo "Installing Oh-My-Zsh..."
if [ ! -d "${HOME}/.oh-my-zsh" ]; then
    RUNZSH=no CHSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" || true
fi

# Install zsh plugins
ZSH_CUSTOM="${HOME}/.oh-my-zsh/custom"

echo "Installing zsh-autosuggestions..."
if [ ! -d "${ZSH_CUSTOM}/plugins/zsh-autosuggestions" ]; then
    git clone https://github.com/zsh-users/zsh-autosuggestions "${ZSH_CUSTOM}/plugins/zsh-autosuggestions"
fi

echo "Installing zsh-syntax-highlighting..."
if [ ! -d "${ZSH_CUSTOM}/plugins/zsh-syntax-highlighting" ]; then
    git clone https://github.com/zsh-users/zsh-syntax-highlighting "${ZSH_CUSTOM}/plugins/zsh-syntax-highlighting"
fi

# ===== Deploy dotfiles with stow =====
echo "Deploying dotfiles with stow..."
cd "${HOME}/dotfiles"

# Remove any existing configs that would conflict
rm -f "${HOME}/.zshrc" 2>/dev/null || true
rm -f "${HOME}/.tmux.conf" 2>/dev/null || true
rm -rf "${HOME}/.config/nvim" 2>/dev/null || true
rm -f "${HOME}/.gitconfig" 2>/dev/null || true
rm -rf "${HOME}/.config/starship.toml" 2>/dev/null || true

# Stow the relevant packages (skip macOS-specific ones)
STOW_PACKAGES="zsh tmux git"

# Check if nvim directory exists (could be lazyvim or nvim)
if [ -d "lazyvim" ]; then
    STOW_PACKAGES="${STOW_PACKAGES} lazyvim"
elif [ -d "nvim" ]; then
    STOW_PACKAGES="${STOW_PACKAGES} nvim"
fi

# Check for starship config
if [ -d "starship" ]; then
    STOW_PACKAGES="${STOW_PACKAGES} starship"
fi

echo "Stowing packages: ${STOW_PACKAGES}"
for pkg in ${STOW_PACKAGES}; do
    echo "Stowing ${pkg}..."
    stow -v --target="${HOME}" "${pkg}" || echo "Warning: Failed to stow ${pkg}"
done

# Remove stowed git SSH→HTTPS rewrite (no SSH key available in packer builds)
# The dotfiles git config rewrites HTTPS to SSH which breaks keyless packer builds
sed -i '/\[url "git@github.com:"\]/,/insteadOf/d' "${HOME}/.config/git/config"

# ===== Install TPM (Tmux Plugin Manager) =====
echo "Installing TPM..."
TPM_PATH="${HOME}/.local/share/tmux/plugins/tpm"
mkdir -p "$(dirname "${TPM_PATH}")"
if [ ! -d "${TPM_PATH}" ]; then
    git clone https://github.com/tmux-plugins/tpm "${TPM_PATH}"
fi

# Install tmux plugins
echo "Installing tmux plugins..."
"${TPM_PATH}/bin/install_plugins" || true

# ===== Change default shell to zsh =====
echo "Setting zsh as default shell..."
# This needs to be done by root, so we'll just ensure .zshrc exists
if [ -f "${HOME}/.zshrc" ]; then
    echo "Zsh configuration deployed successfully."
fi

echo "=== Dotfiles setup complete ==="

# Verify deployment
echo "=== Verifying deployment ==="
ls -la "${HOME}/.zshrc" 2>/dev/null && echo "zshrc: OK" || echo "zshrc: MISSING"
ls -la "${HOME}/.tmux.conf" 2>/dev/null && echo "tmux.conf: OK" || echo "tmux.conf: MISSING"
ls -la "${HOME}/.config/nvim/init.lua" 2>/dev/null && echo "nvim config: OK" || echo "nvim config: MISSING"
ls -la "${HOME}/.config/starship.toml" 2>/dev/null && echo "starship config: OK" || echo "starship config: MISSING"
echo "=== Verification complete ==="

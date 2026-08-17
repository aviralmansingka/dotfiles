#!/usr/bin/env bash
# Install the pi-stt worker natively on the homelab host (no VM).
#
# Layout it creates (all user-level, no root):
#   ~/bin/pi-stt-worker.py            symlink into this checkout's pi/bin
#   ~/bin/pi-stt-worker-run           symlink into this checkout's pi/bin
#   ~/.config/systemd/user/pi-stt-worker.service  symlink into this checkout
#   ~/.local/share/pi-stt/requirements.txt        copied from ops/pi-stt
#   ~/.local/share/pi-stt/.venv                   uv venv (python 3.13, cu12 pins)
#   ~/.config/pi-stt-worker.env       created from the example if absent (0600)
#
# The worker stays stopped until ~/.config/pi-stt-tokens (mode 0600,
# "client-id:token" per line) exists and the GPU is on the host NVIDIA driver.
set -euo pipefail

if [[ $(uname -s) != Linux ]]; then
  printf 'pi-stt native install targets the Linux homelab host.\n' >&2
  exit 1
fi

DOTFILES_DIR=${DOTFILES_DIR:-$HOME/dotfiles}
repo_root=$(cd "$(dirname "$0")" && pwd)
uv_bin=$(command -v uv) || {
  printf 'uv is required on the homelab host.\n' >&2
  exit 1
}

install -d -m 0755 "$HOME/bin" "$HOME/.config/systemd/user" "$HOME/.local/share/pi-stt"

ln -sfn "$repo_root/pi/bin/pi-stt-worker.py" "$HOME/bin/pi-stt-worker.py"
ln -sfn "$repo_root/pi/bin/pi-stt-worker-run" "$HOME/bin/pi-stt-worker-run"
ln -sfn "$repo_root/systemd/.config/systemd/user/pi-stt-worker.service" \
  "$HOME/.config/systemd/user/pi-stt-worker.service"
cp "$repo_root/ops/pi-stt/requirements.txt" "$HOME/.local/share/pi-stt/requirements.txt"

[[ $repo_root == "$DOTFILES_DIR"* ]] || printf \
  'note: symlinks point at %s, not %s; keep this checkout in place.\n' \
  "$repo_root" "$DOTFILES_DIR" >&2

"$uv_bin" venv --python 3.13 "$HOME/.local/share/pi-stt/.venv"
"$uv_bin" pip install \
  --python "$HOME/.local/share/pi-stt/.venv/bin/python" \
  --requirement "$HOME/.local/share/pi-stt/requirements.txt"

if [[ ! -e $HOME/.config/pi-stt-worker.env ]]; then
  install -m 0600 "$repo_root/pi/.config/pi-stt-worker.env.example" \
    "$HOME/.config/pi-stt-worker.env"
fi

sudo loginctl enable-linger "$USER" 2>/dev/null || loginctl enable-linger "$USER" 2>/dev/null || true
systemctl --user daemon-reload

printf 'Worker installed. Next steps:\n'
printf '  1. Ensure ~/.config/pi-stt-tokens exists with mode 0600.\n'
printf '  2. Ensure the GPU is on the host NVIDIA driver (nvidia-smi).\n'
printf '  3. systemctl --user enable --now pi-stt-worker.service\n'

#!/usr/bin/env bash
set -euo pipefail

target=${1:-}
if [[ -z $target ]]; then
  printf 'usage: %s avirus@<vm-address>\n' "$0" >&2
  exit 2
fi
if [[ $(uname -s) != Linux ]]; then
  printf 'Run this on the Linux homelab host so its uv binary matches the VM.\n' >&2
  exit 1
fi

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
uv_bin=$(command -v uv) || {
  printf 'uv is required on the homelab host.\n' >&2
  exit 1
}

ssh "$target" 'sudo cloud-init status --wait; install -d -m 0755 "$HOME/bin" "$HOME/.local/bin" "$HOME/.config/systemd/user" "$HOME/.local/share/pi-stt"'

if ! ssh "$target" 'nvidia-smi >/dev/null 2>&1'; then
  ssh "$target" 'sudo ubuntu-drivers --gpgpu install'
  printf 'The guest GPU driver was installed. Reboot %s, then rerun this command.\n' "$target"
  exit 10
fi

scp "$uv_bin" "$target:~/.local/bin/uv"
scp "$repo_root/pi/bin/pi-stt-worker.py" "$target:~/bin/pi-stt-worker.py"
scp "$repo_root/pi/bin/pi-stt-worker-run" "$target:~/bin/pi-stt-worker-run"
scp "$repo_root/ops/pi-stt-vm/requirements.txt" "$target:~/.local/share/pi-stt/requirements.txt"
scp "$repo_root/systemd/.config/systemd/user/pi-stt-worker.service" \
  "$target:~/.config/systemd/user/pi-stt-worker.service"
scp "$repo_root/pi/.config/pi-stt-worker.env.example" "$target:~/.config/pi-stt-worker.env.example"

ssh "$target" '
set -eu
chmod 0755 "$HOME/.local/bin/uv" "$HOME/bin/pi-stt-worker.py" "$HOME/bin/pi-stt-worker-run"
"$HOME/.local/bin/uv" venv --python 3.13 "$HOME/.local/share/pi-stt/.venv"
"$HOME/.local/bin/uv" pip install \
  --python "$HOME/.local/share/pi-stt/.venv/bin/python" \
  --requirement "$HOME/.local/share/pi-stt/requirements.txt"
if [ ! -e "$HOME/.config/pi-stt-worker.env" ]; then
  install -m 0600 "$HOME/.config/pi-stt-worker.env.example" "$HOME/.config/pi-stt-worker.env"
fi
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
printf "Worker installed but not started. Add ~/.config/pi-stt-tokens with mode 0600, then enable the service.\n"
'

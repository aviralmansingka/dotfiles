# Pi STT worker (host-native)

The speech-to-text worker runs natively on the homelab host. The checked-in worker
(`pi/bin/pi-stt-worker.py`), launcher, and systemd user unit are the single
implementation; this directory only packages install and GPU operations.

History: the worker previously ran in a dedicated `pi-stt` libvirt VM with the RTX
3060 passed through via `vfio-pci` (see git history under `ops/pi-stt-vm/`). That
path was decommissioned in August 2026 so the same GPU can serve Steam and native
CUDA STT. The VM's qcow2 disk was preserved in place under
`/var/lib/libvirt/images/`; per-host preservation evidence (domain XML, worker
journal, parity transcription) lives in `~/homelab-pi-stt-decommission/` on the
host.

## 1. Return the GPU to the host (one-time, root)

Done once when migrating off the VM path. Shuts nothing down by itself — stop the
VM first:

```sh
virsh shutdown pi-stt
virsh autostart pi-stt --disable
```

Then:

```sh
./ops/pi-stt/return-gpu-to-host.sh
```

The script removes `/etc/modprobe.d/pi-stt-vfio.conf`, strips the vfio module lines
from `/etc/initramfs-tools/modules`, rebuilds the initramfs, unbinds both RTX 3060
functions from `vfio-pci`, loads the host NVIDIA driver, and verifies with
`nvidia-smi`. No reboot is required for the current session; the boot-path changes
take effect on the next boot.

## 2. Install the worker (user-level)

```sh
./ops/pi-stt/install-host.sh
```

This symlinks the worker scripts and unit from the checkout into `~/bin` and
`~/.config/systemd/user/`, builds `~/.local/share/pi-stt/.venv` with `uv`
(Python 3.13, pinned CUDA 12 runtime), and installs a mode-0600
`~/.config/pi-stt-worker.env` from the example if absent.

Auth: the worker refuses to start without `~/.config/pi-stt-tokens` (mode 0600,
`client-id:token` per line). Tokens are deployment secrets and are intentionally
absent from this repo.

## 3. Run

```sh
systemctl --user enable --now pi-stt-worker.service
curl -s http://127.0.0.1:8767/healthz
```

The worker listens on `127.0.0.1:8767` by default (see
`pi/.config/pi-stt-worker.env.example`) and transcribes with
`faster-whisper large-v3-turbo` on CUDA. The model is read from the standard
Hugging Face cache (`~/.cache/huggingface`); it downloads on first use if absent.

Clients POST audio to `/transcribe` with a bearer token; `pi/bin/pi-stt-client.py`
is the reference client and defaults to `http://127.0.0.1:8767/transcribe`.
`scripts/test-pi-stt.py` covers the auth and HTTP contract with a mock model.

## VM decommission reference (already done)

The domain was shut down, autostart-disabled, and undefined **without** deleting
storage:

```sh
virsh shutdown pi-stt
virsh autostart pi-stt --disable
virsh dumpxml pi-stt > ~/homelab-pi-stt-decommission/vm-config/pi-stt-domain.xml
virsh undefine pi-stt --nvram
```

`/var/lib/libvirt/images/pi-stt.qcow2` and `pi-stt-seed.img` were left on disk.
Do not delete them (or the preservation directory) without the captain's explicit
approval. To recreate the domain for rollback, re-define from the preserved XML.

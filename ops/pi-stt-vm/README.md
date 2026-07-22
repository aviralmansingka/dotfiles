# Pi STT Worker VM

This is the minimal packaging path for the dedicated `pi-stt` VM. It reuses the checked-in worker and systemd unit;
there is no second worker implementation or image-building framework.

## 1. Prepare the host

Run on `homelab` during a maintenance window:

```sh
cd ~/dotfiles
./ops/pi-stt-vm/prepare-host.sh
sudo reboot
```

Reconnect over SSH and require this to pass:

```sh
./ops/pi-stt-vm/prepare-host.sh --check
```

The script installs libvirt tooling and binds both RTX 3060 PCI functions to `vfio-pci` in the initramfs. It does not
change the IOMMU kernel command line because the host already exposes an isolated IOMMU group for both functions.

## 2. Create the VM

```sh
./ops/pi-stt-vm/create-vm.sh
sudo virsh domifaddr pi-stt --source lease
```

Defaults: Ubuntu 24.04, UEFI/Q35, 4 vCPU, 8 GiB RAM, 40 GiB qcow2 disk, libvirt's private NAT network, both RTX
functions, user `avirus`, and the host's `~/.ssh/id_ed25519.pub`. The Ubuntu cloud image is checked against Canonical's
published SHA-256 before use.

## 3. Install the guest driver and worker

Run on `homelab`, replacing the address:

```sh
./ops/pi-stt-vm/deploy-worker.sh avirus@192.168.122.X
```

On the first run, the script installs Ubuntu's recommended headless NVIDIA driver and exits with code `10`; reboot the
guest and run it again. The second run copies the worker, copies the host's Linux `uv` binary, creates the venv with `uv`,
and installs the compiled `uv` requirements. The CUDA 12 runtime libraries are pinned because the worker launcher uses
their venv paths; this fixes the missing-`libcublas.so.12` failure found in the live bare-metal service.

The service remains stopped until a mode-`0600` `~/.config/pi-stt-tokens` file exists. Tokens are deployment secrets and
are intentionally absent from this package.

## 4. Resume validation

Continue at V2 in the vault's `projects/pi-agent/issues/stt-worker-vm-validation.md`. Do not point Telegram at the VM
until V2-V8 pass. The current bare-metal transcription command remains the rollback path through V13.

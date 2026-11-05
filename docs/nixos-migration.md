# NixOS migration plan: homelab, then devbox

This document is the plan, not the change. The homelab and the devbox stay on
Ubuntu for the whole of this mission: S02 adds a NixOS configuration and S03
proves it on a disposable AWS box. The two cutovers below run after C02, each as
its own mission step with its own artifact.

`docs/nix-profiles.md` stays the profile model until the last Ubuntu host is
gone. Fence 1 of that document ("Ubuntu stays on the homelab and the devbox.
Nix is not NixOS.") is the one statement this plan supersedes, and it is
amended in the devbox cutover commit.

## Current state

The flake has two constructors and four targets (`nix/lib/fleet.nix:15-23`,
`flake.nix:47-56`):

| Target | Output | Constructor | Managed user | Host OS |
| --- | --- | --- | --- | --- |
| `homelab` | `homeConfigurations.remote` | `mkRemote "homelab"` | `avirus` (`nix/modules/remote/homelab.nix:12-13`) | Ubuntu 24.04 |
| `devbox` | `homeConfigurations.remote-devbox` | `mkRemote "devbox"` | `aviral`, dialled as `root` (`flake.nix:86-93`) | Ubuntu 24.04 (Packer AMI) |
| `probe` | `homeConfigurations.remote-probe` | `mkRemote "probe"` | `ubuntu` (`nix/modules/remote/probe.nix:12-13`) | vanilla Ubuntu 24.04 EC2 |
| `mac` | `darwinConfigurations.macbook` | `mkMacbook` | `aviral` | macOS |

On the three Linux hosts Nix owns **only the user layer**:

- `nix/modules/shared/default.nix` — the common user environment (`home.packages`,
  session variables, `EDITOR`, ghostty terminfo). `targets.genericLinux.enable`
  at line 27 is what tells Home Manager the host is not NixOS.
- `nix/modules/remote/default.nix` — the Linux user layer: `home.packages` from
  `owned-tools.nix` plus chrome and tailscale, `FLEET_PROFILE = "remote"`, the
  activation that writes `~/.local/state/fleet-owned-tools`, and the import of
  `nix/services` (the eight user units; six here, the semianalysis pair in
  `nix/services/homelab.nix`).
- `nix/modules/remote/{homelab,devbox,probe}.nix` — per-host deltas only.

Everything a user profile cannot own stays with apt: kernel, NVIDIA driver,
firmware, Docker, k3s, libvirt/QEMU, the display stack (`docs/nix-profiles.md`
ownership table, line 53). The reason is written down twice: `ops/pi-stt/README.md:3-11`
for the GPU worker that shares the RTX 3060 with Steam, and `nix/services/default.nix:1-4`
for the user units.

`nix/lib/owned-tools.nix` exists because of that split. It maps 23 apt names to
store paths, `nix/modules/remote/default.nix:23-32` writes the mapping to
`~/.local/state/fleet-owned-tools`, and the deploy check compares it with
`command -v` on the host (`docs/ec2-bringup.md:111-112`). `scripts/apt-accounting.py`
audits every other `apt-mark showmanual` package against the same rule.

`nix/lib/libvirt-domains.nix` no longer exists. It was deleted in `545a94d4`
("refactor(libvirt): retire the nine homelab domain definitions", PR #486,
2026-11-05) together with `scripts/capture-libvirt-domains.sh` and the
`fleet.libvirtDomains` output, after all nine guests were undefined. The XML
dumps are preserved on the host under `~/libvirt-dumps/2026-11-04` and
`~/libvirt-dumps/2026-11-05`. `nix/modules/remote/homelab.nix:20-23` keeps only
the `libvirt` client as a capability.

## Module layout

The NixOS module tree sits next to `nix/modules/macbook`, and mirrors the shape
that already works there: one system module, one per-host delta, Home Manager
for the user layer.

```
nix/modules/
  shared/                 the Home Manager user layer, every host
  remote/                 Ubuntu user layer; retires with the devbox cutover
  macbook/                nix-darwin system layer + macbook/home.nix user layer
  nixos/                  NEW: NixOS system layer
    default.nix           S02: what every NixOS host has in common
    probe.nix             S02: probe deltas
    homelab.nix           homelab cutover: homelab deltas
    devbox.nix            devbox cutover: devbox deltas
  services/               the eight user units, unchanged
```

`nix/modules/nixos/default.nix` (S02) owns the system layer that apt owns today:

- `system.stateVersion`, `networking.hostName` (per host, `mkDefault`),
- `nix.settings.experimental-features = [ "nix-command" "flakes" ]` and
  `nixpkgs.config.allowUnfree = true`, the same allowance `mkRemote` sets at
  `nix/lib/fleet.nix:46-49` and `mkMacbook` sets at line 71,
- `services.openssh.enable = true` with the owner's key,
- `users.users.<managed user>.isNormalUser = true` and
  `users.users.<managed user>.extraGroups` (wheel, docker where the host needs
  it), since a NixOS user is a system user and not a Home Manager assumption,
- `programs.zsh.enable`, `environment.systemPackages = [ ]` (tools stay in the
  user layer; the system layer carries only what a user cannot own),
- `go` and `nodejs` in the `home.packages` of that layer's Home Manager user.
  `nix/modules/shared` carries lazygit and herdr but neither of these, and the
  Ubuntu hosts took both from apt, so every NixOS host declares them here rather
  than in `shared` (which the Ubuntu and macOS profiles also import) or in a
  per-host module,
- a gc policy mirroring `nix/modules/macbook/default.nix:23-31`.

`nix/modules/nixos/probe.nix` (S02) carries only: `networking.hostName = "probe"`,
the UEFI boot setup (systemd-boot with `boot.loader.efi.canTouchEfiVariables =
false`, because the EC2 Nitro firmware keeps no EFI variables; see "Probe
proof" for the measurement), the two filesystems the hand-partitioned disk
carries by label (`/` ext4 on label `nixos`, `/boot` the vfat ESP on label
`ESP`), and the probe user. It sets `fleet.services.enableUnits = false` for the
same reason `nix/modules/remote/probe.nix:8-10` does.

The per-host modules for the two real hosts arrive with their cutovers, not with
S02: `nix/modules/nixos/homelab.nix` owns `hardware.nvidia` (the RTX 3060 is
shared by native CUDA STT and Steam), `virtualisation.docker`,
`services.k3s`, `virtualisation.libvirtd` and the Steam module;
`nix/modules/nixos/devbox.nix` owns the cloud tooling and the devbox user.

### `nix/modules/shared` becomes the Home Manager user layer

No file moves. `home-manager.nixosModules.home-manager` makes Home Manager a
NixOS module, and the existing `shared` module is imported as
`home-manager.users.<user>.imports` exactly as `mkMacbook` does for
`nix/modules/macbook/home.nix` (`nix/lib/fleet.nix:79-84`). So:

- `home.packages`, `home.sessionVariables`, `home.activation.ghosttyTerminfo`
  in `shared` are untouched and keep working.
- `targets.genericLinux.enable` (line 27) must be **false** on NixOS; the Ubuntu
  value exists only to teach Home Manager how to reach a non-NixOS system. The
  `mkNixos` wrapper pins it with `lib.mkForce false`, so `shared` itself needs no
  edit and the Ubuntu hosts keep the default.
- `home.username` / `home.homeDirectory` come from the per-host NixOS module, the
  same way `nix/modules/remote/homelab.nix` and `devbox.nix` set them today, and
  must agree with `users.users.<name>`.
- `rataflowSrc` still reaches the module as `extraSpecialArgs`, so
  `nix/pkgs/rataflow-view.nix` is unchanged.

## The `mkNixos` constructor

`nix/lib/fleet.nix` gains one constructor beside `mkRemote` and `mkMacbook`:

```nix
# The managed user for a NixOS target. `users.users.<name>` in the per-host
# module must name the same account.
users = {
  homelab = "avirus";
  devbox = "aviral";
  probe = "aviral";
};

mkNixos = host: nixpkgs.lib.nixosSystem {
  system = systems.${host};
  specialArgs = crateArgs;
  modules = [
    # System layer: boot, users, networking, the host's daemons.
    (modules + "/nixos")
    (modules + "/nixos/${host}.nix")
    # User layer: Home Manager as a NixOS module, same shape as mkMacbook.
    home-manager.nixosModules.home-manager
    {
      home-manager.useGlobalPkgs = true;
      home-manager.useUserPackages = true;
      home-manager.extraSpecialArgs = crateArgs;
      home-manager.users.${users.${host}} = {
        imports = [ (modules + "/shared") ];
        targets.genericLinux.enable = lib.mkForce false;
      };
    }
  ];
};
```

Signature: `mkNixos :: hostName -> nixosSystem`, where `hostName` must be a key
of `systems` (`nix/lib/fleet.nix:15-23`) and of `users`. It composes the NixOS
system module, the per-host delta, `home-manager.nixosModules.home-manager` with
`useGlobalPkgs`/`useUserPackages`, and `nix/modules/shared` as the user layer.
`useGlobalPkgs` is what keeps `nixpkgs.config.allowUnfree` a single system-level
decision instead of a per-user package set.

Hosts declare it in `flake.nix` beside the existing outputs:

```nix
nixosConfigurations.probe = fleet.mkNixos "probe";     # S02
# later, one line per cutover:
# nixosConfigurations.homelab = fleet.mkNixos "homelab";
# nixosConfigurations.devbox  = fleet.mkNixos "devbox";
```

`mkRemote` stays for as long as one Ubuntu host remains. During the migration
both constructors coexist; that is what lets the homelab move without touching
the devbox. S02 exposes only `nixosConfigurations.probe` and leaves every Ubuntu
output and every macbook module unchanged, so `nixosConfigurations.probe` and
`homeConfigurations.remote-probe` describe the same box by two different
constructors until the retirement commit.

`fleet.targets` entries gain `kind = "nixos"`, and `scripts/nix-deploy` needs one
branch for it: build `nixosConfigurations.<attr>`, then `nixos-rebuild switch
--flake .#<attr>` (or a copy of the deploy tree on the target, as it does now).
`fleet.hosts` is unchanged: the target names stay `homelab`, `devbox`, `probe`,
`mac`.

## Retirements

| File or output | Replaced by | Retires at | Commit |
| --- | --- | --- | --- |
| `nix/lib/libvirt-domains.nix` (+ `fleet.libvirtDomains`, `scripts/capture-libvirt-domains.sh`) | already gone; the NixOS side uses `virtualisation.libvirtd` in `nix/modules/nixos/homelab.nix`. Guest definitions stay retired; the dumps in `~/libvirt-dumps/` are the record | already retired before this mission | `545a94d4` (PR #486, 2026-11-05) |
| `nix/modules/remote/homelab.nix` | `nix/modules/nixos/homelab.nix` | homelab cutover | the homelab cutover commit |
| `homeConfigurations.remote` = `mkRemote "homelab"` (`flake.nix:48`) and the `target == "homelab"` branch of `remoteOutput` (`nix/lib/fleet.nix:38`) | `nixosConfigurations.homelab` | homelab cutover | the homelab cutover commit |
| `homeConfigurations.remote-probe` (`flake.nix:51`), `nix/modules/remote/probe.nix` | `nixosConfigurations.probe`, `nix/modules/nixos/probe.nix` (S02) | homelab cutover, once S03 has proven the probe | the homelab cutover commit |
| `nix/lib/owned-tools.nix`, `fleet.ownedTools` (`flake.nix:110-115`), `home.activation.writeOwnedToolsList` (`nix/modules/remote/default.nix:23-32`) | nothing: on NixOS every one of the 23 tools is a `home.packages` entry from `shared` (ripgrep, fd, fzf, bat, tmux, git, jq) or a per-host module. The "23 apt names" check becomes a `command -v` → `/nix/store` check | **devbox cutover** — the devbox is the last Ubuntu consumer of `nix/modules/remote` | the devbox cutover commit |
| `nix/modules/remote/` (all four files), `mkRemote` and `remoteOutput` (`nix/lib/fleet.nix:38-63`), `homeConfigurations.remote-devbox` (`flake.nix:49`) | `nix/modules/nixos/{default,homelab,devbox}.nix` and `mkNixos` | devbox cutover | the devbox cutover commit |
| `scripts/apt-accounting.py`, `scripts/apt-base-packages.txt` | nothing: no host runs apt | devbox cutover | the devbox cutover commit |
| fence 1 of `docs/nix-profiles.md` ("Ubuntu stays on the homelab and the devbox") | this document, then `docs/nix-profiles.md` rewritten for three constructors | devbox cutover | the devbox cutover commit |
| `docs/nix-profiles.md` targets table rows for `probe` and `homelab` | the `nixos` constructor and `nixosConfigurations` | with each cutover | homelab commit, devbox commit |

The homelab cutover commit and the devbox cutover commit are two distinct
commits. `owned-tools.nix` cannot retire at the homelab cutover, because the
devbox still imports `nix/modules/remote`, and `nix/modules/remote/default.nix:8`
is its only in-module consumer.

## Cutover order

The homelab goes first, the devbox second.

The homelab is the host with the most system-layer surface — NVIDIA driver,
Steam, Docker, k3s, libvirt — and it is physically reachable, so a failure is
recoverable at the keyboard and rollback is a boot-order change. The devbox is
an EC2 instance rebuilt from an AMI, so its rollback is "start the old instance";
it also carries no unique state, which makes it the safer host to move last,
after the module tree has survived a real machine.

### Homelab cutover (H1-H7)

1. **H1 — preflight, on Ubuntu.** Record what apt owns now:
   `ssh homelab apt-mark showmanual | scripts/apt-accounting.py --input - --table own > /tmp/homelab-apt-baseline.txt`
   and `ssh homelab 'lsblk; efibootmgr -v; cat /etc/fstab'`. Capture
   `nvidia-smi` and `lspci -nn | grep -i nvidia` for the driver pin.
2. **H2 — image the Ubuntu root.** Write a full disk image to external storage
   (or install onto a second disk and leave the Ubuntu disk untouched). This
   image is the rollback artifact; record its path and sha256 in the artifact.
3. **H3 — export host state NixOS will not own:** `/home/avirus`,
   `/var/lib/docker`, `/var/lib/rancher/k3s`, `~/libvirt-dumps/`, the pi-stt
   venvs under `~/.local/share/`, `~/.ssh`, `~/.config/*.env` (by name; values
   come from 1Password), and the tailscale node name.
4. **H4 — build the closure off the box.** On the Mac:
   `nix build .#nixosConfigurations.homelab.config.system.build.toplevel` with an
   `x86_64-linux` builder configured. A failed build changes nothing; if no
   builder is available, build the same attribute inside the ISO instead.
5. **H5 — install.** Boot the NixOS ISO, clone the flake, and
   `nixos-install --flake .#homelab --no-root-passwd`. Restore `H3` state onto
   the new root, `tailscale up --hostname homelab`, and re-import secrets with
   `op`.
6. **H6 — first switch and verification** (the commands are in Verification
   commands below). Re-run the switch once: the second run must report no
   changes.
7. **H7 — commit.** Delete `homeConfigurations.remote`,
   `homeConfigurations.remote-probe`, `nix/modules/remote/{homelab,probe}.nix`,
   the `homelab` branch of `remoteOutput`; add `nix/modules/nixos/homelab.nix`;
   set `fleet.targets.homelab.kind = "nixos"` and
   `fleet.targets.probe.kind = "nixos"`. That commit is "the homelab cutover
   commit" every retirement row above names.

### Devbox cutover (D1-D6)

1. **D1 — preflight.** `aws ec2 create-image --instance-id <devbox> --name
   devbox-pre-nixos-$(date +%F) --no-reboot` and record the AMI id, the instance
   id, the volume id, and the `devbox` ssh alias. This AMI is the rollback
   artifact.
2. **D2 — launch the replacement.** Start an instance from that AMI in the same
   subnet and security group, sized for a build. Leave the old instance running
   but stop routing to it.
3. **D3 — install.** `nixos-anywhere` onto the replacement instance using the
   same command shape as the probe proof below, with `--flake .#devbox` and the
   instance's root device.
4. **D4 — verify** (see Verification commands), including the devbox-only tools
   (`awscli2`, `google-cloud-sdk`, `terraform`, `k9s` from
   `nix/modules/remote/devbox.nix:9-14`) and the six common user units.
5. **D5 — repoint.** Move the `devbox` ssh alias and any DNS or Elastic IP to
   the NixOS instance; keep the old Ubuntu instance stopped (not terminated) for
   a soak period.
6. **D6 — commit and cleanup.** Delete `nix/lib/owned-tools.nix`,
   `fleet.ownedTools`, `nix/modules/remote/`, `mkRemote`, `remoteOutput`,
   `homeConfigurations.remote-devbox`, `scripts/apt-accounting.py`,
   `scripts/apt-base-packages.txt`; rewrite fence 1 of `docs/nix-profiles.md`.
   Terminate the stopped Ubuntu instance only after the soak, from a separate
   action, not in this commit.

## Rollback

### Homelab rollback

The Ubuntu disk is intact (H2 installed to a second disk, or the preflight image
is on external storage), so rollback is a boot decision, not a rebuild:

```sh
# at the console, or over IPMI if the box has it
efibootmgr -v                 # list entries; the Ubuntu one is still there
efibootmgr -o 0001,0000       # boot the Ubuntu disk first
```

Then, once Ubuntu is up, re-apply the user layer and the data:

```sh
ssh homelab 'sudo tailscale up'        # the old node name resolves again
just deploy remote homelab             # home-manager switch, Ubuntu profile
# restore /var/lib/docker, /var/lib/rancher/k3s, ~/libvirt-dumps from H3
```

No repository change is needed: the homelab cutover commit is reverted with
`git revert <sha>` only if the plan is abandoned, not to roll a single host back.

If the Ubuntu root was overwritten instead of preserved, restore the H2 image to
the same disk (`dd` or `qemu-img convert`) and boot it; that is the whole
rollback.

### Devbox rollback

```sh
aws ec2 start-instances --instance-ids <old-instance-id>
# point the `devbox` ssh alias (and DNS/Elastic IP) back at its address
ssh devbox 'hostnamectl'      # Ubuntu 24.04 again
just deploy remote devbox     # home-manager switch, Ubuntu profile
```

If the old instance was terminated, `aws ec2 run-instances --image-id
<devbox-pre-nixos-AMI> --instance-type <recorded type> --subnet-id <recorded>
--security-group-ids <recorded> --key-name <recorded>` reproduces it, and the
profile deploy re-applies the user layer.

## Verification commands

Every command below is run from the Mac, against the target, after the cutover
switch.

### Homelab

```sh
ssh homelab 'nixos-version'                          # a NixOS release, not Ubuntu
ssh homelab 'nixos-rebuild switch --flake .#homelab' # second run: "no changes"
ssh homelab 'systemctl --failed'                     # 0 loaded failed units
ssh homelab 'systemctl --user list-units --type=service --state=running'
#   pi-stt-worker, pi-telegram, pi-whatsapp, whatsapp-bridge, vault-auto-sync,
#   semianalysis-sync.timer
ssh homelab 'command -v lazygit herdr go node just'  # every path under /nix/store
ssh homelab 'test ! -x /usr/bin/apt && echo apt-gone'
ssh homelab 'test ! -e ~/.local/state/fleet-owned-tools && echo accounting-retired'
ssh homelab 'readlink -f ~/.zshrc'                   # ~/dotfiles/zsh/.zshrc
ssh homelab 'nvidia-smi -L'                          # the RTX 3060, driver from Nix
ssh homelab 'docker info >/dev/null && systemctl is-active k3s'
ssh homelab 'virsh -c qemu:///system list --all'     # client works, no domains
nix eval --raw .#fleet.targets.homelab.kind          # nixos
```

`systemctl --failed` empty and the second `nixos-rebuild` reporting no changes
are the two that prove the cutover, not just the first boot.

### Devbox

```sh
ssh devbox 'nixos-version'
ssh devbox 'nixos-rebuild switch --flake .#devbox'    # second run: "no changes"
ssh devbox 'systemctl --failed'
ssh devbox 'systemctl --user is-active pi-stt-worker pi-telegram pi-whatsapp whatsapp-bridge vault-auto-sync'
ssh devbox 'command -v lazygit herdr go node just aws terraform kubectl k9s gcloud'
ssh devbox 'test ! -e ~/.local/state/fleet-owned-tools && echo accounting-retired'
ssh devbox 'readlink -f ~/.zshrc'
nix eval --raw .#fleet.targets.devbox.kind            # nixos
just targets                                          # no home-manager rows left for Linux
```

The last line is the retirement check: `just targets` prints one row per entry
in `fleet.targets` (`justfile:43-44`), so a `nixos` kind on every Linux target
and no `home-manager` row is the visible end of `mkRemote`.

## Probe proof

**Install path: `nixos-anywhere` onto a sandbox Ubuntu box launched with
`scripts/sandbox`.** Not a NixOS AMI.

Why this one:

- `scripts/sandbox up` already launches a vanilla Ubuntu 24.04 EC2 instance in
  the best-latency region, tags it `nix-fleet-sandbox`, writes the `probe` ssh
  alias with `User ubuntu`, and hard-stops it with `shutdown -P +N` plus
  `--instance-initiated-shutdown-behavior terminate`, so a killed laptop cannot
  leak a running instance (`scripts/sandbox:1-13,216-221`).
- No NixOS AMI has to be built, published, and tracked per region, and fence 3
  of `docs/nix-profiles.md` ("`ops/packer` and the devbox AMI stay as they are")
  stays true.
- The same install command is the devbox cutover path (D3), so S03 rehearses the
  devbox install on a throwaway box.

The S03 commands. `nixos-anywhere` is **1.13.0**, revision
`58132e1d1f813b845382a2aeca4203b18d2ac807` — `nix eval --raw
github:nix-community/nixos-anywhere#packages.aarch64-darwin.default.version`
prints the version; the tool itself has no `--version` flag. There is no `--disk`
flag in that release (only `--disk-encryption-keys`; an unknown option is taken
as the ssh host) and the flake carries no disko module, so the install is three
commands and a hand partitioning step instead of one:

```sh
# 1. a box that lives long enough for an OS install; no --nix, kexec replaces it
just sandbox --minutes 90 --type t3.medium

# The alias `scripts/sandbox` writes holds the address and the key. Read both
# once; every command below is dialled as root, which bypasses that alias and
# so needs the IdentityFile spelled out.
probe_ip=$(ssh -G probe | awk '/^hostname/{print $2}')
probe_key=$(ssh -G probe | awk '/^identityfile/{print $2}')

# 2. nixos-anywhere wants root; the Ubuntu image's `ubuntu` user has sudo
ssh probe 'sudo mkdir -p /root/.ssh && sudo cp ~/.ssh/authorized_keys /root/.ssh/ \
  && sudo chmod 700 /root/.ssh && sudo chmod 600 /root/.ssh/authorized_keys'

# 3. kexec into the NixOS installer. The AMI's 6.x/7.x AWS kernels return
# "Address not available" from kexec_file_load, so the installer is loaded with
# the legacy kexec_load syscall instead.
nix run github:nix-community/nixos-anywhere -- \
  --flake .#probe --target-host root@"$probe_ip" -i "$probe_key" \
  --build-on remote --kexec-extra-flags '--kexec-syscall' --phases kexec

# 4. partition by hand (the disko substitute): one GPT disk, a 512 MiB vfat ESP
# at p1, one ext4 root at p2, both mounted from the installer. The labels are
# what nix/modules/nixos/probe.nix mounts.
ssh root@"$probe_ip" -i "$probe_key" bash -s <<'EOS'
set -e
wipefs -a /dev/nvme0n1
parted -s /dev/nvme0n1 -- mklabel gpt \
  mkpart ESP fat32 1MiB 513MiB set 1 esp on \
  mkpart root ext4 513MiB 100%
mkfs.vfat -F32 -n ESP /dev/nvme0n1p1
mkfs.ext4 -L nixos /dev/nvme0n1p2
# A fresh label is not in /dev/disk/by-label until udev has re-read the disk
# (mounting too early fails with "Can't lookup blockdev").
udevadm settle
partprobe /dev/nvme0n1
udevadm settle
mount /dev/disk/by-label/nixos /mnt
mkdir -p /mnt/boot
mount /dev/disk/by-label/ESP /mnt/boot
lsblk -f /dev/nvme0n1
EOS

# 5. install onto the mounted disk and reboot into it
nix run github:nix-community/nixos-anywhere -- \
  --flake .#probe --target-host root@"$probe_ip" -i "$probe_key" \
  --build-on remote --phases install,reboot
```

`--build-on remote` builds the closure on the kexec'd NixOS installer, so the
aarch64 Mac needs no x86_64 builder for this step. Phase 5 prints `installing the
boot loader...` and then `Copied "…/systemd-bootx64.efi" to
"/boot/EFI/BOOT/BOOTX64.EFI"`; the reboot that follows comes from the installed
disk with no bootloader override on the command line. A new host key comes with
the new system: `ssh-keygen -R "$probe_ip"` before the first login. `t3.micro` and the default 30 minutes are too small for an install, which
is why the command names `--minutes 90 --type t3.medium`.

Step 2 dials the Ubuntu image's `ubuntu` user, which is the login the sandbox
writes into the alias. After step 5 the box runs the S02 configuration, and the
account `mkNixos` manages there is `aviral` — so the `probe` alias needs `User
aviral` (same hostname, same `IdentityFile`) for every later command and for the
evidence below.

Why UEFI, and why this loader: `scripts/sandbox` launches an Ubuntu AMI with
`BootMode=uefi-preferred` and a hybrid layout (p14 BIOS boot + p15 ESP), and the
kexec'd installer reports `/sys/firmware/efi/fw_platform_size = 64`. EC2's UEFI
firmware persists no EFI variables, so a bootloader that relies on a `Boot####`
entry does not survive its own boot. `boot.loader.systemd-boot` with
`canTouchEfiVariables = false` writes the loader to the ESP's removable-fallback
path (`bootctl --variables=no install` → `/EFI/BOOT/BOOTX64.EFI`) and needs no
entry; grub needs `efiSupport = true` + `efiInstallAsRemovable = true` +
`device = "nodev"` for the same effect, which is why systemd-boot is the one
option here. The S03 attempt that installed legacy-BIOS grub
(`efiSupport = false`, no ESP) did not boot until an out-of-repo override added
those three lines and a `/boot` filesystem.

### Evidence S03 must capture

All of it in `artifacts/<attempt>/step-03.md`, with the git sha the probe ran:

| Evidence | Command |
| --- | --- |
| NixOS is running, and which release | `ssh probe 'nixos-version'` |
| the configuration builds from the flake | `nix build .#nixosConfigurations.probe.config.system.build.toplevel` — store path, plus `nix path-info --json` or a package count for the closure |
| idempotence | `ssh probe 'nixos-rebuild switch --flake .#probe'` twice, second run reports no changes. The checkout on the box must be a Git repo that *tracks* the NixOS modules: a flake path inside a repo the branch is not committed to fails with `Path 'nix/modules/nixos' in the repository … is not tracked by Git` |
| the four tools resolve from the store | `ssh probe 'command -v lazygit herdr go node'` — every path under `/nix/store`. `command -v` alone shows `/etc/profiles/per-user/<user>/bin/…`, so read each one with `readlink -f` |
| dotfiles are stowed | `ssh probe 'readlink -f ~/.zshrc'` → `~/dotfiles/zsh/.zshrc`; `ssh probe 'stow --version'`. Stow the checkout under test: `main` since #501 hands `zsh` to Home Manager, so a probe of an older revision stows `scripts/stow-packages` itself (`./install.sh --stow-only` from that revision) and never sees `main`'s list |
| one user service runs | `ssh probe 'systemctl --user start dotfiles-auto-sync'` with no drop-in under `~/.config/systemd/user/*.d`, then `systemctl --user status dotfiles-auto-sync` and `journalctl --user -u dotfiles-auto-sync -n 20` |
| nothing failed | `ssh probe 'systemctl --failed'` and `ssh probe 'systemctl --user --failed'` |
| the box is gone | `scripts/sandbox list` shows no instance; the `aws ec2 terminate-instances` output and the instance id are recorded |

`dotfiles-auto-sync` is the service to prove: it is the one unit with no
`[Install]` section (`nix/services/default.nix:25-27`), so it is linked but never
enabled, which is exactly the "starts on demand, no secrets, no vault state"
shape the probe needs. It runs `scripts/auto-git-sync`; point its `REPO_DIR` at a
clone and its `TARGET_BRANCH` at a throwaway branch, or accept its no-op tick,
and record the journal lines either way.

The homelab and the devbox are not touched by S03. Their cutovers are separate
steps whose artifacts carry the H/D commands above.

# The probe deltas only. A disposable vanilla Ubuntu 24.04 EC2 box, launched by
# `scripts/sandbox`, that `nixos-anywhere` overwrites with this configuration
# (docs/nixos-migration.md, "Probe proof"). It exists to prove the NixOS
# configuration reproduces off the lab, not to mirror the devbox.
{ ... }:

{
  networking.hostName = "probe";

  # The box is a UEFI Nitro instance, and its firmware ignores EFI variables: an
  # entry written with efibootmgr is not persisted across the boot that wrote
  # it, so any loader that depends on one lands on a disk nothing boots. The
  # S03 probe measured exactly that: `scripts/sandbox` launches an Ubuntu AMI
  # that is hybrid (`BootMode=uefi-preferred`, p14 BIOS boot + p15 ESP), the
  # kexec'd installer reports `/sys/firmware/efi/fw_platform_size = 64`, and the
  # configuration it installed — legacy-BIOS grub, `efiSupport = false`, no ESP —
  # left a disk that only booted after a hand-written out-of-repo override.
  #
  # systemd-boot with `canTouchEfiVariables = false` is the loader for that
  # firmware: it writes the loader to the ESP's removable-fallback path
  # (`/EFI/BOOT/BOOTX64.EFI`, `bootctl --variables=no install`) and needs no
  # boot entry at all, so the box boots from the disk itself. It also replaces
  # grub's `device = "nodev"` + `efiInstallAsRemovable` workaround with one
  # option, and its kernels live on the ESP, which is the layout the firmware
  # can read without a bootloader-specific driver.
  boot.loader.grub.enable = false;
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = false;
  # A headless instance has no keyboard to answer the boot menu.
  boot.loader.timeout = 1;

  # The disk layout this configuration is installed onto. `nixos-anywhere` has
  # no `--disk` flag (1.13.0), and the flake carries no disko module, so the
  # installer's partitioning step (docs/nixos-migration.md, "Probe proof")
  # writes it by hand: one GPT disk `/dev/nvme0n1`, p1 the 512 MiB ESP labelled
  # `ESP` and formatted vfat (mounted at /boot), p2 the ext4 root labelled
  # `nixos`. Labels, not UUIDs, because the UUIDs do not exist before that step
  # runs.
  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
  };

  fileSystems."/boot" = {
    device = "/dev/disk/by-label/ESP";
    fsType = "vfat";
  };

  # The account this host manages is `aviral` (mkNixos's users map). Home is the
  # NixOS default `/home/aviral`; the Home Manager layer reads it back from
  # `users.users.aviral.home`, so the login account, the Home Manager profile
  # and the owner's ssh keys declared in `default.nix` all land on one user.
  users.users.aviral.home = "/home/aviral";

  # Nothing on this box has the runtime state the units need — no vault, no
  # checkout, no secrets — so the units ship as files and stay unenabled, the
  # same choice `nix/modules/remote/probe.nix:8-10` makes for the Ubuntu probe.
  home-manager.users.aviral.fleet.services.enableUnits = false;
}

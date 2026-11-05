# The probe deltas only. A disposable vanilla Ubuntu 24.04 EC2 box, launched by
# `scripts/sandbox`, that `nixos-anywhere` overwrites with this configuration
# (docs/nixos-migration.md, "Probe proof"). It exists to prove the NixOS
# configuration reproduces off the lab, not to mirror the devbox.
{ ... }:

{
  networking.hostName = "probe";

  # The Nitro root device the Ubuntu AMI boots from, and the disk
  # `nixos-anywhere --disk /dev/nvme0n1` overwrites. The box boots legacy BIOS,
  # so grub goes on the disk itself and no ESP is written.
  boot.loader.grub.device = "/dev/nvme0n1";
  boot.loader.grub.efiSupport = false;

  # A NixOS system does not evaluate without a root filesystem, so the disk
  # layout this box is installed onto belongs with the bootloader that names the
  # same disk. One ext4 root, no separate /boot: legacy BIOS boots it without an
  # ESP. The install labels the filesystem `nixos`, because the UUID does not
  # exist before `nixos-anywhere` partitions `/dev/nvme0n1`.
  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
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

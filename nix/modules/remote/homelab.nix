# Homelab deltas only. S01 proved the homelab is a bare-metal lab (MAAS, Ironic,
# a Redfish emulator, eight libvirt domains) with an RTX 3060. The lab daemons,
# GPU driver, Docker and k3s stay with apt; the profile carries the user side.
{ pkgs, lib, ... }:

{
  imports = [
    # The semianalysis sync pair is homelab-only (S01).
    ../../services/homelab.nix
  ];

  home.username = lib.mkDefault "avirus";
  home.homeDirectory = lib.mkDefault "/home/avirus";

  home.packages = with pkgs; [
    kubectl
    kubernetes-helm
    k9s

    # The libvirt client side. The daemon, QEMU and the kernel modules stay with
    # apt (root system service); `virsh` reads and defines the domains from the
    # profile, and nix/lib/libvirt-domains.nix pins all nine of them.
    libvirt
  ];
}

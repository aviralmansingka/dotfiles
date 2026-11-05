# Homelab deltas only. The lab has no libvirt guests today: libvirtd, QEMU and the
# kernel modules stay with apt, and the profile carries only the client package.
# The lab daemons, GPU driver, Docker and k3s stay with apt as well.
{ pkgs, lib, ... }:

{
  imports = [
    # The semianalysis sync pair is homelab-only (S01).
    ../../services/homelab.nix
  ];

  home.username = lib.mkDefault "avirus";
  home.homeDirectory = lib.mkDefault "/home/avirus";

  # This host's secrets file. The rule in .sops.yaml carries the admin age key
  # plus this host's SSH-host-key recipient, so `sops.secrets.<name>` on any
  # module below needs only its key name.
  sops.defaultSopsFile = ../../../secrets/homelab.yaml;

  home.packages = with pkgs; [
    kubectl
    kubernetes-helm
    k9s

    # The libvirt client side, kept as a capability. The daemon, QEMU and the
    # kernel modules stay with apt; guest definitions are no longer tracked here.
    libvirt
  ];
}

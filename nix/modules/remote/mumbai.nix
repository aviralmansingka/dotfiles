# The Mumbai EC2 box (ap-south-1): the fleet's Rex server host.
#
# Vanilla Ubuntu 24.04 like the probe, but long-lived. Rex is not installed by
# apt or a tarball here: the home-manager profile installs it from Superlogical's
# nix flake (flake input `rex`) and runs it as a systemd user unit, so the
# binary, the terminfo entry and the service all arrive through nix and move
# together with `nix flake update rex`.
#
# Everything Rex-shaped lives in `rex-host.nix`, the reusable managed-Rex
# profile: system Tailscale only (one tailnet device per host), a loopback Rex
# listener, publication through `tailscale serve`, linger, and the config file
# links. A numbered host gets the same profile with its own host name, and this
# file keeps only Mumbai's deltas. The flake target ops/provision ships,
# `.#homeConfigurations.remote-mumbai.activationPackage`, is this output.
{
  lib,
  ...
}:

{
  imports = [
    ((import ./rex-host.nix) "mumbai")
  ];

  # A fresh EC2 box has none of the runtime state the fleet's user units need
  # (no env files, no vault, no venvs), so the units ship unenabled. The Rex
  # service is not one of them: it comes from the Rex module and rex-host.nix
  # enables it.
  fleet.services.enableUnits = false;

  # The image's default login user; the deploy needs no user switch.
  home.username = lib.mkDefault "ubuntu";
  home.homeDirectory = lib.mkDefault "/home/ubuntu";

  # No sops secrets on this host: Rex needs none. The host's own tailscaled is
  # joined once by the enrollment step that hands it the tailnet, so no auth key
  # is stored in the profile. The `tailscale` client is already in the shared
  # remote profile (`nix/modules/remote/default.nix`), so this file adds none.
}

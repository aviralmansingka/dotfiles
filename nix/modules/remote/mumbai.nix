# The Mumbai EC2 box (ap-south-1): the fleet's Rex server host.
#
# Vanilla Ubuntu 24.04 like the probe, but long-lived. Rex is not installed by
# apt or a tarball here: the home-manager profile installs it from Superlogical's
# nix flake (flake input `rex`) and runs it as a systemd user unit, so the
# binary, the terminfo entry and the service all arrive through nix and move
# together with `nix flake update rex`.
#
# Nothing below is Mumbai-specific except the provider alias and the names: the
# same shared remote profile as every Linux host, plus the Rex module.
{
  pkgs,
  lib,
  rexFlake,
  ...
}:

{
  imports = [
    # programs.rex / services.rex, from the Rex flake itself.
    rexFlake.homeManagerModules.default
  ];

  # A fresh EC2 box has none of the runtime state the fleet's user units need
  # (no env files, no vault, no venvs), so the units ship unenabled — same
  # decision as the probe. The Rex service is not one of them: it comes from the
  # Rex module above and is enabled below.
  fleet.services.enableUnits = false;

  # The image's default login user; the deploy needs no user switch.
  home.username = lib.mkDefault "ubuntu";
  home.homeDirectory = lib.mkDefault "/home/ubuntu";

  # No sops secrets on this host: Rex needs none. Built-in Tailscale signs in
  # once through the link the server prints, so no auth key is stored anywhere.

  # The Rex CLI, the xterm-rex terminfo entry, and the SSH fallback in
  # ~/.ssh/config (home-manager owns that file, which is why programs.ssh is
  # on: the stow list ships no ssh package, so nothing else claims it).
  # programs.rex.config stays unset: the stowed rex/.config/rex owns init.lua.
  programs.rex.enable = true;
  programs.ssh.enable = true;

  # A personal server as the ubuntu account, in a systemd user unit named rex.
  # It listens on this account's own socket, so `rex ls` and `rex server
  # status` on the box reach it with no flags.
  #
  # Built-in Tailscale joins the tailnet as its own device, mumbai-rex, and
  # serves HTTPS at https://mumbai-rex.tail1b3b66.ts.net — the same shape as
  # homelab-rex, so the Mac and the iPhone connect by adding that address.
  # The first start prints a sign-in link in `rex server status` and the
  # journal; opening it once is the whole Tailscale setup, and no key is
  # committed anywhere.
  #
  # The unit starts at boot only with `loginctl enable-linger`, which the
  # instance's user_data runs once on first boot.
  services.rex = {
    enable = true;
    tailscale = {
      enable = true;
      hostname = "mumbai-rex";
    };
  };
}

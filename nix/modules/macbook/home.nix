{ pkgs, config, ... }:

{
  imports = [
    ../shared
    # The per-user launch agents, rendered from nix/services/jobs.nix — the same
    # job declaration the Linux systemd renderer folds. Home Manager's launchd
    # module writes them into ~/Library/LaunchAgents, which is why that path is
    # no longer stowed.
    ../../services/launchd.nix
  ];

  home.username = "aviral";
  home.homeDirectory = "/Users/aviral";

  # `go` and `node` come from ../shared and are pinned in neither place: two
  # node derivations in the profile collide on bin/node in buildEnv. `bun` stays
  # local because ../shared does not carry it.
  home.packages = with pkgs; [
    bun
  ];

  home.sessionVariables = {
    BUN_INSTALL = "/Users/aviral/.bun";
  };

  # The admin age identity: this machine is the workstation that edits and
  # re-encrypts the fleet, so it holds the one key every rule in .sops.yaml
  # carries. sops-nix fails activation when the file is missing, which is the
  # loud failure we want: no admin key, no editing. The Mac has no SSH host key
  # to derive an identity from, so keyFile is the whole story here.
  sops.age.keyFile = "${config.home.homeDirectory}/.config/sops/age/keys.txt";
}

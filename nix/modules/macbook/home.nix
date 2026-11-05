{ pkgs, config, ... }:

{
  imports = [ ../shared ];

  home.username = "aviral";
  home.homeDirectory = "/Users/aviral";

  home.packages = with pkgs; [
    go
    nodejs_22
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

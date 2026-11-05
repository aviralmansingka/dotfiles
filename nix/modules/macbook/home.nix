{ pkgs, ... }:

{
  imports = [ ../shared ];

  home.username = "aviral";
  home.homeDirectory = "/Users/aviral";

  # `node` comes from ../shared and must not be pinned per platform here: two
  # node derivations in the profile collide on bin/node in buildEnv.
  home.packages = with pkgs; [
    go
    bun
  ];

  home.sessionVariables = {
    BUN_INSTALL = "/Users/aviral/.bun";
  };
}

{ pkgs, ... }:

{
  imports = [ ../shared ];

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
}

{ pkgs, ... }:

{
  imports = [ ../shared ];

  home.username = "aviral";
  home.homeDirectory = "/Users/aviral";

  home.packages = with pkgs; [
    go
    nodejs_22
    bun
    herdr
  ];

  home.sessionVariables = {
    BUN_INSTALL = "/Users/aviral/.bun";
  };
}

# The macbook user layer. Home Manager owns packages, dotfile-adjacent config,
# and the launchd agents; nix-darwin owns the system layer next to it.
{ pkgs, ... }:

{
  imports = [ ../shared ];

  home.username = "aviral";
  home.homeDirectory = "/Users/aviral";

  home.packages = with pkgs; [
    # ubuntu-only tools from the remote profile are deliberately absent here.
    go
    nodejs_22
    bun
  ];

  # macOS keeps its own shell defaults; the profile only sets what Nix owns.
  home.sessionVariables = {
    BUN_INSTALL = "/Users/aviral/.bun";
  };
}

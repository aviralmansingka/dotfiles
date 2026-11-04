# The macbook user layer. Home Manager owns packages, dotfile-adjacent config,
# and the launchd agents; nix-darwin owns the system layer next to it.
{ pkgs, ... }:

{
  imports = [ ../shared ];

  home.username = "aviral";
  home.homeDirectory = "/Users/aviral";

  home.packages = with pkgs; [
    # ubuntu-only tools from the remote profile are deliberately absent here.
    just
    gnupg
    openssh
    rsync
    go
    nodejs_22
    bun
    uv
    rustup
    herdr
    mermaid-cli
  ];

  # macOS keeps its own shell defaults; the profile only sets what Nix owns.
  home.sessionVariables = {
    GOPATH = "/Users/aviral/go";
    RUSTUP_HOME = "/Users/aviral/.rustup";
    CARGO_HOME = "/Users/aviral/.cargo";
    BUN_INSTALL = "/Users/aviral/.bun";
  };
}

# The 23 apt manual names that S01 assigned to the remote profile, mapped to
# the Nix packages that own them. The apt name is the attribute name, so a
# deploy check can ask for "fd-find" and get the package that replaces it.
#
# One source of truth: nix/modules/remote installs these derivations and the
# flake exposes the same store paths as `fleet.ownedTools`.
{ pkgs }:
with pkgs;
{
  bat = bat;
  fd-find = fd;
  fzf = fzf;
  ripgrep = ripgrep;
  jq = jq;
  tmux = tmux;
  tree = tree;
  htop = htop;
  pandoc = pandoc;
  ffmpeg = ffmpeg;
  imagemagick = imagemagick;
  git = git;
  vim = vim;
  zsh = zsh;
  gh = gh;
  mosh = mosh;
  screen = screen;
  byobu = byobu;

  # Ubuntu ships `golang` and `golang-go`; both are the Go toolchain.
  golang = go;
  golang-go = go;

  nodejs = nodejs;
  luarocks = luarocks;
  openjdk-21-jdk-headless = jdk21_headless;
}

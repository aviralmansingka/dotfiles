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

  golang = go;
  golang-go = go;

  nodejs = nodejs;
  luarocks = luarocks;
  openjdk-21-jdk-headless = jdk21_headless;
}

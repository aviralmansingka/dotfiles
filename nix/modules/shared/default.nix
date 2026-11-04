# Shared user environment. Every host and every profile imports this module, so
# anything here must be true on Ubuntu 24.04 and on macOS alike.
{
  pkgs,
  lib,
  rataflowSrc ? null,
  ...
}:

let
  # In-repo crate: the visualize skill's renderer. It arrives as a flake input
  # argument; when the module is evaluated outside the flake (a bare nix-build)
  # the package is simply absent instead of failing the whole profile.
  rataflow-view =
    if rataflowSrc == null then
      null
    else
      pkgs.callPackage ../../pkgs/rataflow-view.nix { inherit rataflowSrc; };
in

{
  home.stateVersion = "24.11";

  # Generic Linux support tells Home Manager how to reach the system on a
  # non-NixOS box (XDG dirs, session variables). It is a no-op on Darwin.
  targets.genericLinux.enable = lib.mkDefault pkgs.stdenv.hostPlatform.isLinux;

  # `stow` comes from the profile: install.sh bootstraps Nix, the profile
  # installs stow, then install.sh stows the file packages with it.
  home.packages =
    lib.optional (rataflow-view != null) rataflow-view
    ++ (
      with pkgs;
      [
        stow
        git
        jq
        yq-go
        ripgrep
        fd
        fzf
        bat
        eza
        zoxide
        starship
        tmux
        less
        coreutils
        gnugrep
        gnused
        curl
        wget
        unzip
      ]
      # Owner batch two (S06): the headless browser and the tailscale CLI come
      # from the profile. The tailscaled daemon stays with apt (root service);
      # the CLI talks to it over the local socket.
      ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [
        google-chrome
        tailscale
      ]
    );

  # google-chrome is unfree; the pin is the flake's nixpkgs, so allow it here
  # and nowhere else.
  nixpkgs.config.allowUnfree = true;

  programs.home-manager.enable = true;

  # Ghostty's terminfo entry is a compiled file, not a stowed one. It used to be
  # a `tic` call in install.sh; the profile owns it now, so the activation
  # compiles it from the repo copy whenever `tic` is available.
  home.activation.ghosttyTerminfo = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if command -v tic >/dev/null 2>&1; then
      mkdir -p "$HOME/.terminfo"
      tic -x -w ${../../../terminfo/xterm-ghostty.terminfo} >/dev/null 2>&1 || true
    fi
  '';

  # A stable editor and pager contract for tools that do not read the shell rc.
  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
    PAGER = "less";
    LESS = "-R";
  };
}

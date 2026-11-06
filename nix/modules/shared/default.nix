# Shared user environment. Every host and every profile imports this module, so
# anything here must be true on Ubuntu 24.04 and on macOS alike.
{
  config,
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

  # In-repo script package: vim keys for terminal-browser tabs. The source
  # lives in scripts/tb-vim, so no flake input is needed.
  tb-vim = pkgs.callPackage ../../pkgs/tb-vim.nix { };
in

{
  imports = [ ./sops.nix ];

  home.stateVersion = "24.11";

  # Generic Linux support tells Home Manager how to reach the system on a
  # non-NixOS box (XDG dirs, session variables). It is a no-op on Darwin.
  targets.genericLinux.enable = lib.mkDefault pkgs.stdenv.hostPlatform.isLinux;

  # `stow` comes from the profile: install.sh bootstraps Nix, the profile
  # installs stow, then install.sh stows the file packages with it.
  home.packages =
    [ tb-vim ]
    ++ lib.optional (rataflow-view != null) rataflow-view
    ++ (
      with pkgs;
      [
        stow
        # gh is a profile tool on both platforms: the remote profile installed
        # it from the apt-owned set, and the Mac used to get it from Homebrew.
        # One package here covers both, and the `ghd` alias below assumes it is
        # on PATH.
        gh
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
        lazygit
        # User tools both profiles need; each profile used to declare its own
        # copy, and this module owns them once now.
        gnupg
        # The set the fleet used to install with apt from a hand-kept list. The
        # apt copies stay installed on the Ubuntu hosts, but these profile
        # packages are the ones a shell resolves, so one declaration serves
        # Ubuntu and NixOS alike. gh, git, jq, ripgrep, fd, fzf, bat and tmux
        # are already above; `go` and `nodejs` are what the NixOS module used to
        # add for itself.
        tree
        htop
        pandoc
        ffmpeg
        imagemagick
        vim
        zsh
        mosh
        screen
        byobu
        go
        nodejs
        luarocks
        jdk21_headless
        # The editor and the diff pager are profile tools, not version-managed
        # ones: the shell text calls plain `nvim`, and delta is on PATH on both
        # platforms.
        neovim
        delta
        # herdr comes from the flake pin like any other profile tool.
        herdr
        just
        mermaid-cli
        openssh
        rsync
        rustup
        uv
        # The 1Password CLI is how any host fetches the admin age key from
        # 1Password. Only the CLI is managed here, not the 1Password desktop
        # app. nixpkgs spells the attribute `_1password-cli` (leading
        # underscore) though the package name is plain `1password-cli`, and it
        # is unfree; both flake constructors set config.allowUnfree.
        _1password-cli
      ]
    );

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
  # Every machine-neutral export the tracked zsh files carried lives here now:
  # Home Manager writes them to hm-session-vars.sh, ~/.zprofile sources that at
  # login, and zsh/.zshenv sources it for shells that never read ~/.zprofile.
  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
    PAGER = "less";
    LESS = "-R";

    # Each profile declared these three before, and the MacBook copy hardcoded
    # /Users/aviral. Building them from the home directory is what lets one
    # declaration hold on both platforms.
    GOPATH = "${config.home.homeDirectory}/go";
    RUSTUP_HOME = "${config.home.homeDirectory}/.rustup";
    CARGO_HOME = "${config.home.homeDirectory}/.cargo";

    XDG_CONFIG_HOME = config.xdg.configHome;
    # Pi reads COLORTERM to decide whether to emit 24-bit colors under SSH/tmux.
    COLORTERM = "truecolor";
    # Also send copies over OSC 52 after the local clipboard write, so a remote
    # Herdr attach without SSH variables still copies.
    PI_CLIPBOARD_OSC52 = "1";
    HOMEBREW_NO_AUTO_UPDATE = "1";
  };

  # PATH, in Home Manager's one list: it prepends these to the inherited PATH in
  # this order, so the Nix profile comes first and beats a /usr/bin/nix a
  # distribution package may have left behind. Directories that belong to a
  # single platform are added by that platform's module (see nix/modules/remote).
  #
  # `~/.cargo/bin` is deliberately absent: it held only cargo-installed
  # duplicates of tools the profile now ships (`bob`, `delta`, `rataflow-view`),
  # and an earlier entry here kept shadowing the profile copies. `cargo` itself
  # is a profile package, so a `cargo install` is still possible; its output just
  # needs an explicit path, which is the point.
  home.sessionPath = [
    "$HOME/.nix-profile/bin"
    # pi and rex binaries; a login shell needs them for `sh -lc 'command -v rex'`.
    "$HOME/.pi/agent/bin"
    "$HOME/.local/bin"
    "$HOME/bin"
    "$HOME/go/bin"
    "$HOME/.bun/bin"
    "/usr/local/bin"
  ];

  # The shell is the profile's now: Home Manager writes ~/.zshenv, ~/.zprofile
  # and ~/.zshrc, so `stow` no longer links the zsh package. The editable text
  # stays in the repo and is read at evaluation time, which keeps the files the
  # single place a human edits them.
  programs.zsh = {
    enable = true;

    oh-my-zsh = {
      enable = true;
      # zsh-syntax-highlighting and zsh-autosuggestions are not oh-my-zsh
      # plugins upstream (the tracked .zshrc kept them in
      # ~/.oh-my-zsh/custom/plugins), so naming them here would only make
      # oh-my-zsh print "plugin not found" at every shell start. Their own
      # modules below load the same two features from real packages.
      plugins = [
        "git"
        "extract"
        "colored-man-pages"
        "history"
      ];
      # Read before oh-my-zsh.sh is sourced, which is when the framework decides
      # whether to program the terminal title.
      extraConfig = ''DISABLE_AUTO_TITLE="true"'';
    };
    syntaxHighlighting.enable = true;
    autosuggestion.enable = true;

    # zsh/.zshrc is the reference text for the interactive shell, zsh/.zshenv
    # for every zsh invocation. Both are read, never copied, so an edit in zsh/
    # lands on the next switch.
    initContent = builtins.readFile ../../../zsh/.zshrc;
    envExtra = builtins.readFile ../../../zsh/.zshenv;

    # The four aliases zsh/.zshrc used to define. Home Manager writes them at
    # the end of the generated ~/.zshrc, after every initContent line, so a
    # function of the same name in the shell text cannot shadow them.
    shellAliases = {
      ls = "eza --icons -l";
      rg = "rg --hidden";
      inv = "uv run inv";
      ghd = "gh dash";
    };
  };

  # The tool hooks zsh/.zshrc used to eval behind a `command -v` guard. Each
  # module writes the init line into programs.zsh.initContent itself, and its
  # zsh integration option defaults to `programs.zsh.enable`, so enabling the
  # program is the whole declaration.
  programs.starship.enable = true;
  programs.zoxide.enable = true;
  programs.direnv.enable = true;

  # FZF_DEFAULT_COMMAND, the same value .zshrc used to export. The module writes
  # it to the generated hm-session-vars.sh, so non-zsh callers keep it too.
  # enableZshIntegration brings fzf's completion and key bindings (`Ctrl-R`,
  # `Ctrl-T`, `Alt-C`), which no tracked file ever wired up.
  programs.fzf = {
    enable = true;
    defaultCommand = ''rg --hidden --ignore .git -g ""'';
  };
}

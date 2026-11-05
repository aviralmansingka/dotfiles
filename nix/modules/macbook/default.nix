{ pkgs, lib, ... }:

{
  imports = [
    ./fonts.nix
    ./system-defaults.nix
    # The per-user launch agents, rendered from nix/services/jobs.nix — the same
    # job declaration the Linux systemd renderer folds. nix-darwin writes them
    # into ~/Library/LaunchAgents, which is why that path is no longer stowed.
    ../../services/launchd.nix
  ];

  system.stateVersion = 6;
  system.primaryUser = "aviral";
  users.users.aviral.home = "/Users/aviral";

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
  nix.settings.build-users-group = "nixbld";

  nix.gc = {
    automatic = true;
    interval = {
      Weekday = 0;
      Hour = 3;
      Minute = 15;
    };
    options = "--delete-older-than 14d";
  };
}

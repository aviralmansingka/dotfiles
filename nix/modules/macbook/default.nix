{ pkgs, lib, ... }:

{
  imports = [
    ./fonts.nix
    ./system-defaults.nix
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

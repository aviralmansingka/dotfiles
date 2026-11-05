# The macbook system layer. nix-darwin owns what Home Manager alone cannot
# reach: fonts in /Library/Fonts, system and user defaults, launchd agents.
{ pkgs, lib, ... }:

{
  imports = [
    ./fonts.nix
    ./system-defaults.nix
  ];

  # nix-darwin tracks its own option-compatibility version as an integer.
  system.stateVersion = 6;

  # The account that owns the Home Manager profile and receives user defaults.
  # Home Manager reads the home directory from the system user, so both must
  # agree; a null here is the usual "cannot coerce to absolute path" failure.
  system.primaryUser = "aviral";
  users.users.aviral.home = "/Users/aviral";

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
  # The installer's /etc/nix/nix.conf carried this; nix-darwin has to keep
  # declaring it or the daemon loses its build users on the next switch.
  nix.settings.build-users-group = "nixbld";

  # Keep the store honest: the flake pins nixpkgs, so nothing else may write to
  # the user profile or to a second package manager's tree.
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

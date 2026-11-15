{ pkgs, lib, ... }:

{
  fleet.services.enableUnits = false;

  home.username = lib.mkDefault "aviral";
  home.homeDirectory = lib.mkDefault "/home/aviral";

  # The cloud CLIs (aws, az, gcloud, terraform) come from ../shared now. k9s
  # stays here: it is a devbox habit, not a fleet tool.
  home.packages = with pkgs; [
    k9s
  ];
}

{ pkgs, lib, ... }:

{
  fleet.services.enableUnits = false;

  home.username = lib.mkDefault "aviral";
  home.homeDirectory = lib.mkDefault "/home/aviral";

  # aws and terraform come from ../shared now. gcloud stays here: it was
  # never a fleet tool. k9s is a devbox habit for the same reason.
  home.packages = with pkgs; [
    google-cloud-sdk
    k9s
  ];
}

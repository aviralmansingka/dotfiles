{ pkgs, lib, ... }:

{
  fleet.services.enableUnits = false;

  home.username = lib.mkDefault "aviral";
  home.homeDirectory = lib.mkDefault "/home/aviral";

  home.packages = with pkgs; [
    awscli2
    google-cloud-sdk
    terraform
    k9s
  ];
}

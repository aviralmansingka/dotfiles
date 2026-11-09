{ pkgs, lib, ... }:

{
  fleet.services.enableUnits = false;

  home.username = lib.mkDefault "aviral";
  home.homeDirectory = lib.mkDefault "/home/aviral";

  # `aws` (awscli2) and `terraform` are profile tools in
  # nix/modules/shared/default.nix, pinned there for every host, so this module
  # does not declare them a second time.
  home.packages = with pkgs; [
    google-cloud-sdk
    k9s
  ];
}

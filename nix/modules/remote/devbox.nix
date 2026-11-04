# Devbox deltas only. The devbox has no Nix store, no Docker daemon and no snapd
# (S01), and its user is `aviral`, so it owns its own identity module.
{ pkgs, ... }:

{
  # Ship the shared units unenabled: aviral@devbox had the six unit files but
  # no enablement, no session, and none of the runtime state they need.
  fleet.services.enableUnits = false;

  home.username = "aviral";
  home.homeDirectory = "/home/aviral";

  home.packages = with pkgs; [
    awscli2
    google-cloud-sdk
    terraform
    k9s
  ];
}

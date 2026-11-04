# A vanilla Ubuntu 24.04 EC2 instance, not the Packer AMI: no pre-baked tools,
# no checkout, and the image's default login user `ubuntu`. The profile manages
# that same user, so the deploy needs no user switch (unlike the devbox, which
# is ssh'd as root while managing aviral).
{ pkgs, ... }:

{
  # Nothing on a fresh box has the runtime state the user units need, so the
  # units ship as files and stay unenabled.
  fleet.services.enableUnits = false;

  home.username = "ubuntu";
  home.homeDirectory = "/home/ubuntu";

  # Cloud work only: this host exists to prove the profile reproduces off the
  # lab, not to mirror the devbox's tooling.
  home.packages = with pkgs; [
    awscli2
  ];
}

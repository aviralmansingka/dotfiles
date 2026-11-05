{
  pkgs,
  lib,
  ...
}:

{
  imports = [
    ../shared
    # The eight user units, owned by the flake (S05).
    ../../services
  ];

  home.packages = [
    pkgs.google-chrome
    pkgs.tailscale
  ];

  # The host toolchains are the Linux half of PATH: apt owns /usr/local/go and
  # the CUDA toolkit, so these directories are host state, not profile state.
  # mkAfter keeps them behind the shared sessionPath, which starts with the Nix
  # profile.
  home.sessionPath = lib.mkAfter [
    "/usr/local/go/bin"
    "/usr/local/cuda/bin"
  ];

  home.sessionVariables = {
    FLEET_PROFILE = "remote";
    CUDA_HOME = "/usr/local/cuda";
  };

  home.sessionSearchVariables.LD_LIBRARY_PATH = [ "/usr/local/cuda/lib64" ];
}

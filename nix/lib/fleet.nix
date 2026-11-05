# Profile constructors. One place knows how a profile becomes a flake output, so
# the flake file stays a table of contents and the deploy script has one
# attribute name to look up per target.
{
  nixpkgs,
  home-manager,
  nix-darwin,
  rataflowSrc,
  lib,
}:

let
  # A profile is bound to a system, not to a machine. Both Linux hosts are
  # x86_64; the Mac is aarch64.
  systems = {
    homelab = "x86_64-linux";
    devbox = "x86_64-linux";
    # A vanilla Ubuntu 24.04 EC2 box, kept cheap and disposable. Its login user
    # is the image default (`ubuntu`), so the profile manages that user and no
    # `su` is needed the way the devbox needs it.
    probe = "x86_64-linux";
    mac = "aarch64-darwin";
  };

  modules = ../modules; # nix/modules, relative to nix/lib

  # Modules that need the in-repo crate receive it as an argument: the crate is
  # a flake input, so it is not reachable as a relative path from a module.
  crateArgs = { inherit rataflowSrc; };
in
rec {
  # Target -> system. The deploy script refuses a target absent here, so an
  # unknown host can never reach a switch.
  hostSystems = systems;

  # `remote` is the reference build for the shared Linux profile; every other
  # Linux target has its own attribute so its per-host module can differ.
  remoteOutput = target: if target == "homelab" then "remote" else "remote-${target}";

  mkRemote =
    host:
    home-manager.lib.homeManagerConfiguration {
      # google-chrome is unfree. The flag belongs where pkgs is instantiated,
      # not in a module: under nix-darwin Home Manager uses the global pkgs, so
      # `nixpkgs.config` in a module is an assertion failure.
      pkgs = import nixpkgs {
        system = systems.${host};
        config.allowUnfree = true;
      };
      extraSpecialArgs = crateArgs;
      modules = [
        # Shared user environment: shell, editor defaults, common CLI tools.
        (modules + "/shared")
        # Everything the two Linux hosts agree on.
        (modules + "/remote")
        # Only what this host proves different, including username and home.
        (modules + "/remote/${host}.nix")
      ]
      # A deploy to an ad-hoc ssh host stages its own identity module (the login
      # user is only known at deploy time), so pick it up when it is there. It
      # overrides the per-host defaults above.
      ++ lib.optional (builtins.pathExists ../adhoc/identity.nix) ../adhoc/identity.nix;
    };

  mkMacbook = nix-darwin.lib.darwinSystem {
    system = systems.mac;
    specialArgs = crateArgs;
    modules = [
      # google-chrome is unfree; the Mac gets the same allowance the Linux
      # profile gets, declared where nix-darwin instantiates pkgs.
      { nixpkgs.config.allowUnfree = true; }
      # System layer: fonts, captured defaults, launchd, macOS settings.
      (modules + "/macbook")
      home-manager.darwinModules.home-manager
      {
        home-manager.useGlobalPkgs = true;
        home-manager.useUserPackages = true;
        home-manager.extraSpecialArgs = crateArgs;
        home-manager.users.aviral = {
          imports = [
            (modules + "/shared")
            (modules + "/macbook/home.nix")
          ];
        };
      }
    ];
  };

  hostNames = builtins.attrNames systems;
}

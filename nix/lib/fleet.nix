# Profile constructors. One place knows how a profile becomes a flake output, so
# the flake file stays a table of contents and the deploy script has one
# attribute name to look up per target.
{
  nixpkgs,
  home-manager,
  nix-darwin,
  rataflowSrc,
}:

let
  # A profile is bound to a system, not to a machine. Both Linux hosts are
  # x86_64; the Mac is aarch64.
  systems = {
    homelab = "x86_64-linux";
    devbox = "x86_64-linux";
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
      pkgs = nixpkgs.legacyPackages.${systems.${host}};
      extraSpecialArgs = crateArgs;
      modules = [
        # Shared user environment: shell, editor defaults, common CLI tools.
        (modules + "/shared")
        # Everything the two Linux hosts agree on.
        (modules + "/remote")
        # Only what this host proves different, including username and home.
        (modules + "/remote/${host}.nix")
      ];
    };

  mkMacbook = nix-darwin.lib.darwinSystem {
    system = systems.mac;
    specialArgs = crateArgs;
    modules = [
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

# Profile constructors. One place knows how a profile becomes a flake output, so
# the flake file stays a table of contents and the deploy script has one
# attribute name to look up per target.
{
  nixpkgs,
  home-manager,
  sops-nix,
  rex,
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
    # The Mumbai EC2 box (ap-south-1): the fleet's Rex server host, same shape
    # as the probe — vanilla Ubuntu, image default user — but long-lived.
    mumbai = "x86_64-linux";
    mac = "aarch64-darwin";
  };

  modules = ../modules; # nix/modules, relative to nix/lib

  # Modules that need the in-repo crate receive it as an argument: the crate is
  # a flake input, so it is not reachable as a relative path from a module.
  # `rexFlake` follows the same pattern, so a host module can import the Rex
  # home-manager module without the flake knowing which hosts want Rex.
  crateArgs = {
    inherit rataflowSrc;
    rexFlake = rex;
  };

  # Every host that is not a Linux `remote` profile: the system its packages are
  # built for, and the one module that carries the host delta. A standalone Home
  # Manager configuration has no system layer to put anything else in, so this
  # stays a small explicit table rather than a hierarchy.
  homeHosts = {
    macbook = {
      system = systems.mac;
      module = modules + "/macbook/home.nix";
    };
  };
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
      # not in a module: a standalone Home Manager configuration evaluates one
      # pkgs set, so `nixpkgs.config` in a module would be a second, ignored
      # decision.
      pkgs = import nixpkgs {
        system = systems.${host};
        config.allowUnfree = true;
      };
      extraSpecialArgs = crateArgs;
      modules = [
        # Fleet secrets: the Home Manager module owns decryption at activation,
        # and nix/modules/shared/sops.nix says where the age identity is.
        sops-nix.homeManagerModules.sops
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

  # A macOS host: the same user layer as the Linux profile, built as a standalone
  # Home Manager configuration. Nothing is left for a system profile to own — no
  # fonts, no captured defaults, no per-user system profile — so the switch is a
  # plain `home-manager switch` as aviral, never a system activation.
  mkHome =
    host:
    home-manager.lib.homeManagerConfiguration {
      pkgs = import nixpkgs {
        system = homeHosts.${host}.system;
        config.allowUnfree = true;
      };
      extraSpecialArgs = crateArgs;
      modules = [
        # The sops module is a constructor argument, not something `shared`
        # pulls in, so it is listed here for the same reason mkRemote lists it:
        # nix/modules/shared/sops.nix sets `sops.*` options.
        sops-nix.homeManagerModules.sops
        (modules + "/shared")
        homeHosts.${host}.module
      ];
    };

  hostNames = builtins.attrNames systems;
}

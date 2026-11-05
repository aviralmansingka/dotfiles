{
  description = "Two-profile fleet: remote (Linux) and macbook (nix-darwin)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    nix-darwin = {
      url = "github:nix-darwin/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Fleet secrets. The encrypted files live in `secrets/` and .sops.yaml names
    # their recipients; the module decrypts them at Home Manager activation with
    # the host's own age identity, so no plaintext enters the repo, the store, or
    # the deploy tree.
    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # The in-repo rataflow crate needs no input: it is a tracked directory in
    # this flake's own tree, passed as a plain path. A `path:` input was tried
    # first and rejected, because Nix rewrote the lock entry for it on every
    # evaluation, so `flake.lock` was not stable. The flake therefore sits at
    # the repo root (Nix refuses an input that leaves the flake directory).
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      nix-darwin,
      sops-nix,
    }:
    let
      lib = nixpkgs.lib;
      fleet = import ./nix/lib/fleet.nix {
        inherit
          nixpkgs
          home-manager
          nix-darwin
          sops-nix
          lib
          ;
        rataflowSrc = ./rataflow;
      };
    in
    {
      # The remote profile, built once per Linux host. `remote` is the homelab
      # output and stays the reference shape the docs name; the devbox gets its
      # own attribute because the per-host module differs.
      homeConfigurations = {
        remote = fleet.mkRemote "homelab";
        remote-devbox = fleet.mkRemote "devbox";
        # A vanilla Ubuntu 24.04 EC2 box: the reproduction proof off the lab.
        remote-probe = fleet.mkRemote "probe";
      };

      # The macbook profile: nix-darwin for the system layer (fonts, defaults,
      # launchd) with Home Manager for the user layer.
      darwinConfigurations.macbook = fleet.mkMacbook;

      # The deploy tool, pinned to the flake's home-manager input. A host with no
      # `home-manager` binary runs it from here, so the switch uses the revision
      # the lock names instead of whatever nixpkgs ships that day.
      packages = {
        x86_64-linux.home-manager = home-manager.packages.x86_64-linux.home-manager;
        aarch64-darwin.home-manager = home-manager.packages.aarch64-darwin.home-manager;
      };

      # Cheap introspection for scripts and for a human at the terminal.
      fleet.hosts = fleet.hostNames;

      # The target table. `scripts/nix-deploy` reads this instead of keeping its
      # own case statements, so a new host is one entry here and nothing else.
      #   kind        which constructor the target belongs to
      #   attr        bare attribute name inside that constructor
      #   system      the platform the profile builds for
      #   ssh         the ssh alias the deploy dials, when it is not local
      #   localNames  hostnames that mean this target when deploying `local`
      #   managedUser the user the profile manages, when it differs from the
      #               ssh login user (the devbox is dialled as root)
      fleet.targets = {
        homelab = {
          kind = "home-manager";
          attr = "remote";
          system = "x86_64-linux";
          ssh = "homelab";
          localNames = [ "homelab" ];
        };
        devbox = {
          kind = "home-manager";
          attr = "remote-devbox";
          system = "x86_64-linux";
          ssh = "devbox";
          localNames = [ "devbox" "srv717581" ];
          managedUser = "aviral";
        };
        probe = {
          kind = "home-manager";
          attr = "remote-probe";
          system = "x86_64-linux";
          ssh = "probe";
          localNames = [ "probe" ];
        };
        mac = {
          kind = "darwin";
          attr = "macbook";
          system = "aarch64-darwin";
          ssh = "mac";
          localNames = [ "mac" "macbook" ];
        };
      };

      # The 23 apt names the remote profile owns, with the store path that owns
      # each one. A deploy check compares these with `command -v` on the host.
      fleet.ownedTools = builtins.mapAttrs (
        _: pkg: pkg.outPath
      ) (import ./nix/lib/owned-tools.nix { pkgs = nixpkgs.legacyPackages.x86_64-linux; });
    };
}

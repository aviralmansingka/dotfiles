{
  description = "Dotfiles for the fleet, deployed by Home Manager on Linux and macOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Fleet secrets. The encrypted files live in `secrets/` and .sops.yaml names
    # their recipients; the module decrypts them at Home Manager activation with
    # the host's own age identity, so no plaintext enters the repo, the store, or
    # the deploy tree. The in-repo rataflow crate needs no input: it is a tracked
    # directory in this flake's own tree, passed as a plain path (`rataflowSrc`
    # below), so the flake sits at the repo root.
    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Rex, from Superlogical's own flake. It packages the release binary, so no
    # source build and no apt repository: the server, the CLI and the terminfo
    # arrive through nix like every other package in the profile. The channel
    # URL always serves that channel's newest release; flake.lock pins the
    # exact one, and `nix flake update rex` moves to the next.
    rex.url = "https://pkgs.superlogical.com/rex/nix/preview.tar.gz";
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      sops-nix,
      rex,
    }:
    let
      lib = nixpkgs.lib;
      fleet = import ./nix/lib/fleet.nix {
        inherit
          nixpkgs
          home-manager
          sops-nix
          rex
          lib
          ;
        rataflowSrc = ./rataflow;
      };
    in
    {
      # Every host is a standalone Home Manager configuration: no system layer,
      # no NixOS, no macOS system module.
      homeConfigurations = {
        remote = fleet.mkRemote "homelab";
        remote-devbox = fleet.mkRemote "devbox";
        remote-probe = fleet.mkRemote "probe";
        # The Mumbai EC2 box: the fleet's Rex server host. Same shared remote
        # profile plus the Rex home-manager module.
        remote-mumbai = fleet.mkRemote "mumbai";
        macbook = fleet.mkHome "macbook";
      };

      packages = {
        x86_64-linux.home-manager = home-manager.packages.x86_64-linux.home-manager;
        aarch64-darwin.home-manager = home-manager.packages.aarch64-darwin.home-manager;
      };

      fleet.hosts = fleet.hostNames;

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
        mumbai = {
          kind = "home-manager";
          attr = "remote-mumbai";
          system = "x86_64-linux";
          ssh = "mumbai";
          localNames = [ "mumbai" ];
        };
        mac = {
          kind = "home-manager";
          attr = "macbook";
          system = "aarch64-darwin";
          ssh = "mac";
          localNames = [ "mac" "macbook" ];
        };
      };
    };
}

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
    # the deploy tree. The in-repo rataflow crate needs no input: it is a tracked
    # directory in this flake's own tree, passed as a plain path (`rataflowSrc`
    # below), so the flake sits at the repo root.
    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
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
      homeConfigurations = {
        remote = fleet.mkRemote "homelab";
        remote-devbox = fleet.mkRemote "devbox";
        remote-probe = fleet.mkRemote "probe";
      };

      darwinConfigurations.macbook = fleet.mkMacbook;

      nixosConfigurations.probe = fleet.mkNixos "probe";

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
        mac = {
          kind = "darwin";
          attr = "macbook";
          system = "aarch64-darwin";
          ssh = "mac";
          localNames = [ "mac" "macbook" ];
        };
      };
    };
}

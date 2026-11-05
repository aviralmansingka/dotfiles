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
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      nix-darwin,
    }:
    let
      lib = nixpkgs.lib;
      fleet = import ./nix/lib/fleet.nix {
        inherit
          nixpkgs
          home-manager
          nix-darwin
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

      fleet.ownedTools = builtins.mapAttrs (
        _: pkg: pkg.outPath
      ) (import ./nix/lib/owned-tools.nix { pkgs = nixpkgs.legacyPackages.x86_64-linux; });
    };
}

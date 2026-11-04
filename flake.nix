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
    }:
    let
      fleet = import ./nix/lib/fleet.nix {
        inherit
          nixpkgs
          home-manager
          nix-darwin
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

      # The 23 apt names the remote profile owns, with the store path that owns
      # each one. A deploy check compares these with `command -v` on the host.
      fleet.ownedTools = builtins.mapAttrs (
        _: pkg: pkg.outPath
      ) (import ./nix/lib/owned-tools.nix { pkgs = nixpkgs.legacyPackages.x86_64-linux; });

      # The nine libvirt domains the homelab runs. Definitions live outside the
      # repo; this table pins each dump by sha256 so a new host can define them.
      fleet.libvirtDomains = (import ./nix/lib/libvirt-domains.nix).domains;
    };
}

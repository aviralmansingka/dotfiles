# The NixOS system layer: everything apt owns on the Ubuntu hosts today,
# expressed once for every NixOS target, so a host module adds only its own
# deltas. Tools stay in the Home Manager user layer (`nix/modules/shared`); this
# file carries only what a user cannot own — boot, sshd, the account, the store.
{ config, lib, pkgs, ... }:

let
  # The one account the fleet manages on this host. mkNixos names it in the Home
  # Manager user layer, and `users.users.<name>` here must be the same account,
  # so the name is read back out of that layer instead of being repeated.
  managedUser = lib.head (builtins.attrNames config.home-manager.users);

  # The owner's keys. The personal key is the one the homelab and devbox aliases
  # dial with; the second is the sandbox key pair `scripts/sandbox` launches the
  # probe with (the `probe` alias points its IdentityFile at that private key).
  # They live here, once, because every managed account gets the same set.
  ownerKeys = [
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDUaAMz3iR8DfYD2lcxe+uU3fKOrUxRjciirpri0khwntE3DzjGb9edHc9aBthmBAQs8jgkyDQx+iDVa5ACxi7maV0f+aGSHhksR0kTtSDhHf6bVzdTHT90feGay4I5l8GvrrmYRU2T1NVaaqmdw8vdHhCLythgGFKnxXm4HULJ+hCR+x7y6F5iJBLJ6wAQUtN1A0waM1UlG+ukUVJ/oZ3SyRcqCM5q8Dsuey9kBVJSBQiZKwaFVeOHjhfQydWVVn2BwQHGyva1P9TDD3Dy4Rw3eIew6g6yJoHfGq8HK3VliCXESPIyXF9zqMqvSIlV6zfVKJXmp0Rz4St1ajOT2DHwytSBB+j6v2AQUIQvrM8XCpM/GUYD/ocD/he8ELye/uCYDdMaFr9zVut2KIMXZQAM8eMH3FW4dPWlFmk6WuKBUYal2Kc+/PmJjmCfLj2E5s7HYPvvMdPjkjzDaTEcZxVB+a0oyYnCiZxsvNqRVwF5VUwDYzCOUbu0Cc1RbYbjIws= aviralmansingka@Avirals-Air.localdomain"
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC5hqD2CFtJ0hqTt4ypf5MSO6ZoZ3vMKSMR7I7OpPk4Rh0kzCYU4XaIp7AuT0WvYWkv69IflXGmSA1+Aj6tl/ebL+6U8qVIYDlM++3b1F1ZqVCk3Mf9h3bqF8TOkNoVCzNXgPfn1wDRQyLDgJUTdDqYODFm9K1RlmubuSz6kgj0B3wEeIqu6pFRodCXjzpJOkWNimI0ThS8oA9DCYwWzTDc5lz93wycCTzOFnhtlDbGGPcxmRnXAPjezz1UurX857URfChG0wQw0JaMSsaScAV1g34Ga8DIPgFI3+YL+FXMtZdii87mzB4YqN8pVXsueoMZlAXMEZTXkzyAeDIS6ZEh sandbox-keypair"
  ];
in
{
  system.stateVersion = "24.11";

  # A host names itself in `nix/modules/nixos/<host>.nix`; this is the fallback
  # the real hosts always override.
  networking.hostName = lib.mkDefault "nixos";

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  # The same weekly policy `nix/modules/macbook/default.nix:23-31` sets: Sunday
  # 03:15, keep two weeks. nix-darwin writes a launchd interval, NixOS a systemd
  # calendar, so the expression differs and the schedule does not.
  nix.gc = {
    automatic = true;
    dates = "Sun 03:15";
    options = "--delete-older-than 14d";
  };

  # google-chrome is unfree, the allowance mkRemote (nix/lib/fleet.nix:46-49)
  # and mkMacbook (line 71) already make. `useGlobalPkgs` keeps it one
  # system-level decision instead of a per-user package set.
  nixpkgs.config.allowUnfree = true;

  services.openssh = {
    enable = true;
    settings = {
      # Key-only, like every other box in the fleet.
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      # A key gets root in: nixos-anywhere installs as root, and a box whose
      # owner key is the only way in must stay recoverable from a laptop.
      PermitRootLogin = "prohibit-password";
    };
  };

  users.users.${managedUser} = {
    isNormalUser = true;
    # wheel only: docker comes with the homelab's `virtualisation.docker`, and a
    # group that does not exist yet would be an activation warning on every
    # host that has no Docker.
    extraGroups = [ "wheel" ];
    openssh.authorizedKeys.keys = ownerKeys;
  };

  users.users.root.openssh.authorizedKeys.keys = ownerKeys;

  # `scripts/nix-deploy` and the cutover verification both run
  # `nixos-rebuild switch` over ssh as the managed user, which cannot answer a
  # sudo prompt. The fleet is single-owner and key-only.
  security.sudo.wheelNeedsPassword = false;

  programs.zsh.enable = true;

  # The Home Manager user layer for a NixOS target is `shared` (mkNixos) plus
  # what every Linux host needs: the fleet's user units, which belong to the
  # fleet and not to a host (the same module `nix/modules/remote` imports for the
  # Ubuntu profile), and the two tools `shared` does not carry. On Ubuntu both
  # came from apt; `shared` has lazygit and herdr but neither of these.
  # `sharedModules` applies them to whichever account mkNixos declared, which
  # this file cannot name before evaluation.
  home-manager.sharedModules = [
    ../../services
    {
      home.packages = [
        pkgs.go
        pkgs.nodejs_22
      ];
    }
  ];
}

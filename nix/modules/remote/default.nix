{
  pkgs,
  lib,
  ...
}:

let
  ownedTools = import ../../lib/owned-tools.nix { inherit pkgs; };
in

{
  imports = [
    ../shared
    # The eight user units, owned by the flake (S05).
    ../../services
  ];

  # A Linux box decrypts with the SSH host key it already has: the sops-nix
  # activation converts /etc/ssh/ssh_host_ed25519_key with ssh-to-age, so the
  # recipient in .sops.yaml is that host's public key and no new identity is
  # minted. The admin age key stays the fallback for every host.
  sops.age.sshKeyPaths = [ "/etc/ssh/ssh_host_ed25519_key" ];

  home.packages = lib.attrValues ownedTools ++ [
    pkgs.google-chrome
    pkgs.tailscale
  ];

  home.activation.writeOwnedToolsList = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    {
      ${lib.concatStrings (
        lib.mapAttrsToList (aptName: pkg: ''
          printf '${aptName} %s\n' '${pkg}'
        '') ownedTools
      )}
    } > "$HOME/.local/state/fleet-owned-tools"
    chmod 644 "$HOME/.local/state/fleet-owned-tools"
  '';

  home.sessionVariables = {
    FLEET_PROFILE = "remote";
  };
}

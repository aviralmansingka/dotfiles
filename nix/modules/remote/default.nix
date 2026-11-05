{
  config,
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

  # A Linux box decrypts with a user-readable age key file, not with
  # /etc/ssh/ssh_host_ed25519_key. That is the decision S01 left open, settled
  # here (S02): sops-nix's Home Manager module does the decryption in a *user*
  # oneshot unit (`sops-nix.service` runs `sops-install-secrets` as the login
  # user), and the SSH host key is 0600 root:root — sops-install-secrets only
  # *warns* when it cannot read an SSH identity (`Cannot read ssh key ...`) and
  # then fails to decrypt the host's secrets, so `sshKeyPaths` cannot work for
  # a Home-Manager-managed host. Naming a readable key file is the alternative
  # and it is the one this profile takes; the trade is recorded in the S02
  # artifact (a host-local identity in the user's home instead of the root-only
  # host key, in exchange for a switch that actually completes).
  #
  # The path is sops' own default lookup when `SOPS_AGE_KEY_FILE` is unset, so
  # interactive `sops`, `just secrets-edit`, `sops exec-env` and the activation
  # all read one identity on the host. Its content is
  # `ssh-to-age -private-key -i /etc/ssh/ssh_host_ed25519_key`, mode 0400, which
  # keeps the recipient already in .sops.yaml (age17swx…, the lab's host key) —
  # so no recipient changes and nothing has to be rotated in.
  sops.age.keyFile = "${config.home.homeDirectory}/.config/sops/age/keys.txt";

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

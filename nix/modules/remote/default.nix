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

  home.file.".local/state/fleet-libvirt-domains.json".text = builtins.toJSON (
    (import ../../lib/libvirt-domains.nix).domains
  );

  home.sessionVariables = {
    FLEET_PROFILE = "remote";
  };
}

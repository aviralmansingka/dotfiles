# The shared `remote` profile: everything the homelab and the devbox agree on.
# The per-host modules add only the differences the S01 audit proved.
{
  pkgs,
  lib,
  ...
}:

let
  # apt name -> Nix package, shared with the flake's `fleet.ownedTools` output.
  ownedTools = import ../../lib/owned-tools.nix { inherit pkgs; };
in

{
  imports = [
    ../shared
    # The eight user units, owned by the flake (S05).
    ../../services
  ];

  # Owner batch two (S06): the headless browser and the tailscale CLI come
  # from the profile. The tailscaled daemon stays with apt (root service);
  # the CLI talks to it over the local socket.
  home.packages = lib.attrValues ownedTools ++ [
    pkgs.google-chrome
    pkgs.tailscale
  ];

  # `fleet.ownedTools` gives the store path of every one of the 23 apt names the
  # remote profile took over. A host check compares these with `command -v`.
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

  # The nine libvirt domains, declared next to the profile so a host can read
  # them without the repo checkout. Only the definition dump is pinned; the
  # dumps themselves stay outside the repo (scripts/capture-libvirt-domains.sh).
  home.file.".local/state/fleet-libvirt-domains.json".text = builtins.toJSON (
    (import ../../lib/libvirt-domains.nix).domains
  );

  # uv owns the three interpreter venvs; the decision lives in the S05
  # artifact. FLEET_PROFILE names the active profile, so a shell (and a deploy
  # check) can tell which generation it runs under without reading the flake.
  home.sessionVariables = {
    FLEET_PROFILE = "remote";
  };
}

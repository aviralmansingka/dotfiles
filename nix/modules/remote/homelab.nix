# Homelab deltas only. The lab has no libvirt guests today: libvirtd, QEMU and the
# kernel modules stay with apt, and the profile carries only the client package.
# The lab daemons, GPU driver, Docker and k3s stay with apt as well.
{ config, pkgs, lib, ... }:

{
  imports = [
    # The semianalysis sync pair is homelab-only (S01).
    ../../services/homelab.nix
    # The fleet provisioning stack: PostgreSQL, Temporal, and the provision API and
    # worker as user units (S06). The module always declares the options; the flag
    # below decides whether anything is enabled, so a host without Docker carries no
    # failing units.
    ../../services/fleet-provision.nix
  ];

  # Off until the host has Docker and the two password files. The units are
  # otherwise complete: flip this to true, add the two sops keys named below, and
  # `systemctl --user start fleet-provision` brings the stack up in dependency
  # order. docs/provisioning.md §8 has the sequence, §10 the gates still blocked.
  fleet.services.fleetProvision.enable = true;

  home.username = lib.mkDefault "avirus";
  home.homeDirectory = lib.mkDefault "/home/avirus";

  # This host's secrets file. The rule in .sops.yaml carries the admin age key
  # plus this host's SSH-host-key recipient, so `sops.secrets.<name>` on any
  # module below needs only its key name.
  sops.defaultSopsFile = ../../../secrets/homelab.yaml;

  # The three units that used to read a plaintext env file under ~/.config now
  # read a sops-deployed copy. One sops key per file, holding that file's whole
  # text, so the unit contract does not change: systemd still parses KEY=value
  # lines, and the daemons never learn where their environment came from.
  #
  # The key name is the file name, so the deployed path is
  # ~/.config/sops-nix/secrets/<name>; nix/services/default.nix names exactly
  # that path in EnvironmentFile.
  #
  # `mode` is declared rather than inherited: 0400 is the acceptance item, and
  # sops-install-secrets writes the file with precisely this mode in
  # `%r/secrets.d/<generation>/<name>`. The ~/.config path is a symlink to that
  # file, so `stat "$(readlink -f ~/.config/sops-nix/secrets/pi-telegram.env)"`
  # is the check that it holds.
  sops.secrets = {
    "pi-stt-worker.env".mode = "0400";
    "pi-telegram.env".mode = "0400";
    "pi-whatsapp.env".mode = "0400";
    # The pi-mcp-adapter's encrypted OAuth store key (Notion and any other
    # OAuth MCP on this host). Headless Linux has no Secret Service, so the
    # adapter's `encrypted-file` backend is the only persistent store; this
    # file is the external secret mechanism the adapter's docs require.
    # Sourced from ~/.zshenv below so every shell — interactive pi sessions
    # and ssh commands alike — carries the key.
    "pi-mcp-oauth.env".mode = "0400";
  };

  # The fleet provisioning stack's two database passwords. Declared only when the
  # stack is enabled: a missing key then fails activation with a clear message,
  # which beats a unit that starts without its password and restarts in a loop —
  # but the declaration must not fire on a host that runs no stack.
  #
  # Add to secrets/homelab.yaml when enabling (values never enter this repo):
  #   fleet-provision-postgres.env   FLEET_POSTGRES_PASSWORD=<32 alnum chars>
  #   fleet-provision-temporal.env   FLEET_TEMPORAL_DB_PASSWORD=<32 alnum chars>
  #
  # 0400 because each file is read once by an ExecStartPre that copies the value
  # into a 0600 tmpfs file; no container ever reads the sops file itself.
  sops.secrets."fleet-provision-postgres.env" = lib.mkIf config.fleet.services.fleetProvision.enable {
    mode = "0400";
  };
  sops.secrets."fleet-provision-temporal.env" = lib.mkIf config.fleet.services.fleetProvision.enable {
    mode = "0400";
  };

  home.packages = with pkgs; [
    kubectl
    kubernetes-helm
    k9s

    # The libvirt client side, kept as a capability. The daemon, QEMU and the
    # kernel modules stay with apt; guest definitions are no longer tracked here.
    libvirt
  ];

  # Every zsh reads this, interactive or not, so the OAuth store key reaches
  # the environment wherever pi or the adapter CLI runs. The guard keeps a
  # missing deployment from breaking shells on a fresh box.
  programs.zsh.envExtra = ''
    if [ -f "$HOME/.config/sops-nix/secrets/pi-mcp-oauth.env" ]; then
      source "$HOME/.config/sops-nix/secrets/pi-mcp-oauth.env"
    fi
  '';
}

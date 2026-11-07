# Homelab deltas only. The lab has no libvirt guests today: libvirtd, QEMU and the
# kernel modules stay with apt, and the profile carries only the client package.
# The lab daemons, GPU driver, Docker and k3s stay with apt as well.
{ pkgs, lib, ... }:

{
  imports = [
    # The semianalysis sync pair is homelab-only (S01).
    ../../services/homelab.nix
  ];

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

# The Linux renderer for the user units, owned by the flake instead of stow.
#
# Two of these units are folds of nix/services/jobs.nix, the shared job
# declaration the Mac's launchd renderer (nix/services/launchd.nix) reads too.
# The four remaining units (the pi-* daemons and the WhatsApp bridge) are
# Linux-only and stay declared here. Rendering the shared jobs from that file
# must not change a single byte of what this module emitted before — `nix eval`
# of `systemd.user.services` diffs empty, and that is the safety net for the
# port to one declaration.
#
# S05 moved the eight units out of `systemd/.config/systemd/user` (a stow
# package) into this module; S06 split them: the six that run for aviral on
# both Linux hosts stay here, and the semianalysis-sync pair moved to
# homelab.nix (S01 proved the devbox has neither). Home Manager writes each unit into the store and
# symlinks it under `~/.config/systemd/user`, so a unit file resolves from
# /nix/store, and the enablement symlinks under `default.target.wants` /
# `timers.target.wants` point through that symlink. Home Manager reloads the
# user daemon whenever a unit changes, so no manual `daemon-reload` is needed
# after a switch.
#
# State policy, preserved from before the move (verified in the S04/S05
# artifacts):
#   enabled + active   pi-stt-worker, pi-telegram, pi-whatsapp, vault-auto-sync,
#                      whatsapp-bridge (homelab and devbox-aviral)
#   linked, inactive   dotfiles-auto-sync (no [Install] enablement; it was never
#                      started and the journal has no record of it — kept as-is)
#   homelab only       semianalysis-sync.service + .timer (nix/services/homelab.nix)
#
# The launchers under `~/bin` stay file-deployed (stow); the unit files move to
# the flake. The three env files these units read used to be plaintext stow/
# 1Password files under `~/.config`; S02 moved them to sops, so each unit reads
# `~/.config/sops-nix/secrets/<name>` (declared in nix/modules/remote/homelab.nix,
# decrypted by sops-nix's `sops-nix.service`).
{
  config,
  lib,
  pkgs,
  ...
}:

let
  # Every unit gets the profile on PATH first. Without it a unit sees only
  # /usr/local/bin:/usr/bin:/bin, so `git` and anything else the profile owns
  # would silently fall back to the apt copy. This is what makes retiring the
  # apt copies safe.
  unitPath = "%h/.nix-profile/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin";

  # The two auto-sync jobs, declared once in nix/services/jobs.nix.
  jobs = import ./jobs.nix;

  # @home@ is the shared placeholder for the user's home; systemd spells it %h.
  toHome = lib.replaceStrings [ "@home@" ] [ "%h" ];

  # The systemd half of a job record. `enable.linux` is three-valued:
  # "host" follows the per-host enablement switch, a boolean pins it.
  render =
    job:
    let
      wantedBy =
        if job.enable.linux == "host" then
          lib.optional config.fleet.services.enableUnits "default.target"
        else if job.enable.linux then
          [ "default.target" ]
        else
          [ ];
    in
    {
      Unit = {
        Description = job.description;
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
      };
      Service = {
        Type = "simple";
        WorkingDirectory = toHome job.workingDirectory;
        # PATH first, then the job's own variables in declared order.
        Environment = [ "PATH=${unitPath}" ]
          ++ map (e: "${e.name}=${toHome e.value}") job.environment;
        ExecStart = "${job.interpreter.linux} ${lib.concatStringsSep " " (map toHome job.argv)}";
        Restart = job.restart.policy;
        RestartSec = toString job.restart.delaySeconds;
        StandardOutput = "journal";
        StandardError = "journal";
      };
      Install.WantedBy = wantedBy;
    };
in

{
  # Enablement is per-host: the homelab runs these services today, so it
  # enables them; aviral@devbox carries the same unit files but has none of
  # their runtime state (no env files, no vault, no venvs — S01/S06), and its
  # copies were unenabled files. `false` ships the units unenabled, matching
  # the devbox's prior state exactly.
  options.fleet.services.enableUnits = lib.mkOption {
    type = lib.types.bool;
    default = true;
  };

  config.systemd.user.services = lib.mapAttrs' (
    _label: job: lib.nameValuePair job.name (render job)
  ) jobs // {
    pi-stt-worker = {
      Unit = {
        Description = "Pi speech-to-text worker";
        After = [
          "network-online.target"
          # The env file below lives in $XDG_RUNTIME_DIR/secrets.d (tmpfs, gone
          # at reboot) and is written by sops-nix's oneshot. `After` is what
          # stops this unit from racing the decryption at login, and `Wants`
          # pulls that unit in when only this one is started by hand.
          "sops-nix.service"
        ];
        Wants = [
          "network-online.target"
          "sops-nix.service"
        ];
      };
      Service = {
        Type = "simple";
        ExecStart = "/bin/bash %h/bin/pi-stt-worker-run";
        Restart = "always";
        RestartSec = "5";
        Environment = [ "PATH=${unitPath}" ];
        # Was %h/.config/pi-stt-worker.env (plaintext). The sops copy holds the
        # same KEY=value text; the key is declared in
        # nix/modules/remote/homelab.nix.
        EnvironmentFile = "%h/.config/sops-nix/secrets/pi-stt-worker.env";
      };
      Install.WantedBy = lib.optional config.fleet.services.enableUnits "default.target";
    };

    pi-telegram = {
      Unit = {
        Description = "Pi over Telegram daemon";
        After = [
          "network-online.target"
          "sops-nix.service"
        ];
        Wants = [
          "network-online.target"
          "sops-nix.service"
        ];
      };
      Service = {
        Type = "simple";
        WorkingDirectory = "%h/vault";
        # Explicit interpreter: the venv carries the daemon's only third-party
        # dependency (Telethon); see the venv decision in the S05 artifact.
        ExecStart = "%h/.local/share/pi-telegram/.venv/bin/python %h/bin/pi-telegram-daemon.py";
        Restart = "always";
        RestartSec = "5";
        TimeoutStopSec = "10";
        Environment = [ "PATH=%h/.nix-profile/bin:%h/.nvm/versions/node/v22.22.3/bin:%h/.local/bin:%h/go/bin:/usr/local/bin:/usr/bin:/bin" ];
        # Was -%h/.config/pi-telegram.env (plaintext, `-` because a missing
        # file was tolerated). The sops copy is declared, so a missing file now
        # means the decryption failed — the unit should fail loudly instead of
        # starting without its bot token.
        EnvironmentFile = "%h/.config/sops-nix/secrets/pi-telegram.env";
      };
      Install.WantedBy = lib.optional config.fleet.services.enableUnits "default.target";
    };

    pi-whatsapp = {
      Unit = {
        Description = "Pi over WhatsApp daemon";
        After = [
          "network-online.target"
          "whatsapp-bridge.service"
          "sops-nix.service"
        ];
        Wants = [
          "network-online.target"
          "whatsapp-bridge.service"
          "sops-nix.service"
        ];
      };
      Service = {
        Type = "simple";
        WorkingDirectory = "%h/vault";
        # The daemon's only third-party dependency (cryptography) lives in a
        # uv venv, same method as the other two daemons; system python is
        # PEP 668-managed. The venv is host state, documented in the S05
        # artifact; a missing venv fails this line instead of crashing later.
        ExecStart = "%h/.local/share/pi-whatsapp/.venv/bin/python %h/bin/pi-whatsapp-daemon.py";
        Restart = "always";
        RestartSec = "5";
        Environment = [
          "PATH=%h/.nix-profile/bin:%h/.nvm/versions/node/v22.22.3/bin:%h/.local/bin:%h/go/bin:/usr/local/bin:/usr/bin:/bin"
          # The daemon hard-codes ~/.nvm/versions/node/v22.22.3/bin/pi as its
          # default pi binary, but nvm no longer carries a global `pi`; the
          # live one is ~/.local/bin/pi (symlink into ~/.pi/agent/bin). The
          # daemon's own override variable points it at the real binary.
          "PI_WHATSAPP_PI_BIN=%h/.local/bin/pi"
        ];
        EnvironmentFile = "%h/.config/sops-nix/secrets/pi-whatsapp.env";
      };
      Install.WantedBy = lib.optional config.fleet.services.enableUnits "default.target";
    };

    whatsapp-bridge = {
      Unit = {
        Description = "WhatsApp MCP bridge";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
      };
      Service = {
        Type = "simple";
        WorkingDirectory = "%h/projects/whatsapp-mcp/whatsapp-bridge";
        ExecStart = "%h/projects/whatsapp-mcp/whatsapp-bridge/whatsapp-bridge";
        Restart = "always";
        RestartSec = "5";
        Environment = [ "PATH=%h/.nix-profile/bin:%h/.nvm/versions/node/v22.22.3/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin" ];
      };
      Install.WantedBy = lib.optional config.fleet.services.enableUnits "default.target";
    };
  };
}

# The user units, owned by the flake instead of stow.
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
# The launchers under `~/bin` and the env files under `~/.config/*.env` stay
# file-deployed (stow and 1Password-managed); only the units move to the flake.
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

  config.systemd.user.services = {
    dotfiles-auto-sync = {
      Unit = {
        Description = "Auto-sync dotfiles with remote every 5 minutes";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
      };
      Service = {
        Type = "simple";
        WorkingDirectory = "%h/dotfiles";
        Environment = [
          "PATH=${unitPath}"
          "REPO_DIR=%h/dotfiles"
          "TARGET_BRANCH=main"
          "SYNC_INTERVAL_SECONDS=300"
          "STATE_DIR=%h/.local/state/auto-git-sync/dotfiles"
        ];
        # Explicit interpreter: avoids the 203/EXEC failure class when the exec
        # bit is absent on the host.
        ExecStart = "/bin/bash %h/dotfiles/scripts/auto-git-sync --daemon";
        Restart = "always";
        RestartSec = "15";
        StandardOutput = "journal";
        StandardError = "journal";
      };
      # Deliberately no [Install] enablement: the unit was `linked`, not
      # `enabled`, before the move, and nothing on the host pulled it.
      Install.WantedBy = [ ];
    };

    vault-auto-sync = {
      Unit = {
        Description = "Auto-sync Obsidian vault with remote every 5 minutes";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
      };
      Service = {
        Type = "simple";
        WorkingDirectory = "%h/dotfiles";
        Environment = [
          "PATH=${unitPath}"
          "REPO_DIR=%h/vault"
          "TARGET_BRANCH=main"
          "SYNC_INTERVAL_SECONDS=300"
          "STATE_DIR=%h/.local/state/auto-git-sync/vault"
        ];
        ExecStart = "/bin/bash %h/dotfiles/scripts/auto-git-sync --daemon";
        Restart = "always";
        RestartSec = "15";
        StandardOutput = "journal";
        StandardError = "journal";
      };
      Install.WantedBy = lib.optional config.fleet.services.enableUnits "default.target";
    };

    pi-stt-worker = {
      Unit = {
        Description = "Pi speech-to-text worker";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
      };
      Service = {
        Type = "simple";
        ExecStart = "/bin/bash %h/bin/pi-stt-worker-run";
        Restart = "always";
        RestartSec = "5";
        Environment = [ "PATH=${unitPath}" ];
        EnvironmentFile = "%h/.config/pi-stt-worker.env";
      };
      Install.WantedBy = lib.optional config.fleet.services.enableUnits "default.target";
    };

    pi-telegram = {
      Unit = {
        Description = "Pi over Telegram daemon";
        After = [ "network-online.target" ];
        Wants = [ "network-online.target" ];
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
        EnvironmentFile = "-%h/.config/pi-telegram.env";
      };
      Install.WantedBy = lib.optional config.fleet.services.enableUnits "default.target";
    };

    pi-whatsapp = {
      Unit = {
        Description = "Pi over WhatsApp daemon";
        After = [
          "network-online.target"
          "whatsapp-bridge.service"
        ];
        Wants = [
          "network-online.target"
          "whatsapp-bridge.service"
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
        EnvironmentFile = "-%h/.config/pi-whatsapp.env";
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

# One declaration per auto-sync job, rendered twice.
#
# These two jobs used to be declared in two places, in two formats: systemd
# units here (nix/services/default.nix) and launchd plists in
# launchd/Library/LaunchAgents (a stow package). The copies drifted — the Mac
# plists ran with no Nix profile on PATH, so they could not see the tools a
# deploy installs. Both renderers now read this file: a job is described once,
# and the platforms differ only in how it is expressed.
#
# Rules for this file:
#   - plain data only. No `systemd.*`, no `launchd.*`, no `config`: a field a
#     renderer cannot express is the renderer's problem, not a reason to leak
#     one platform's vocabulary into the job data.
#   - `@home@` stands for the user's home directory. The systemd renderer
#     writes `%h`, the launchd renderer writes the absolute home from the
#     system config, so one record serves both.
let
  home = "@home@";
in
{
  # The launchd label is the attribute name, and the renderer keeps it, so
  # launchd sees exactly the labels the old plists carried and can never run
  # two copies of one job.
  "com.aviral.dotfiles-auto-sync" = {
    # systemd unit name; the launchd identity is the attribute name above.
    name = "dotfiles-auto-sync";
    description = "Auto-sync dotfiles with remote every 5 minutes";

    # argv, interpreter-free: each renderer prepends its own interpreter.
    argv = [ "${home}/dotfiles/scripts/auto-git-sync" "--daemon" ];
    workingDirectory = "${home}/dotfiles";
    interpreter = {
      # Explicit on both platforms. On Linux this avoids the 203/EXEC class
      # when the exec bit is absent on the host; on macOS a launchd agent
      # inherits no login shell environment, which is why the plists ran
      # `zsh -lc`.
      linux = "/bin/bash";
      darwin = "/bin/zsh";
    };

    # Ordered: the systemd renderer keeps this order in `Environment`, so the
    # rendered unit stays byte-identical to the one it replaced.
    environment = [
      {
        name = "REPO_DIR";
        value = "${home}/dotfiles";
      }
      {
        name = "TARGET_BRANCH";
        value = "main";
      }
      {
        name = "SYNC_INTERVAL_SECONDS";
        value = "300";
      }
      {
        name = "STATE_DIR";
        value = "${home}/.local/state/auto-git-sync/dotfiles";
      }
    ];

    restart = {
      policy = "always";
      delaySeconds = 15;
    };

    enable = {
      # Both agents load on the Mac.
      darwin = true;
      # Linux: installed, never enabled. The unit was `linked`, not `enabled`,
      # before it moved into the flake and nothing on the host pulled it in.
      linux = false;
    };
  };

  "com.aviral.vault-auto-sync" = {
    name = "vault-auto-sync";
    description = "Auto-sync Obsidian vault with remote every 5 minutes";

    argv = [ "${home}/dotfiles/scripts/auto-git-sync" "--daemon" ];
    workingDirectory = "${home}/dotfiles";
    interpreter = {
      linux = "/bin/bash";
      darwin = "/bin/zsh";
    };

    environment = [
      {
        name = "REPO_DIR";
        value = "${home}/vault";
      }
      {
        name = "TARGET_BRANCH";
        value = "main";
      }
      {
        name = "SYNC_INTERVAL_SECONDS";
        value = "300";
      }
      {
        name = "STATE_DIR";
        value = "${home}/.local/state/auto-git-sync/vault";
      }
    ];

    restart = {
      policy = "always";
      delaySeconds = 15;
    };

    enable = {
      darwin = true;
      # `"host"` defers to `fleet.services.enableUnits`: the homelab runs this
      # job, the devbox and probe ship it unenabled.
      linux = "host";
    };
  };
}

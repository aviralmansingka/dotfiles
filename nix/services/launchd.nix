# The Darwin renderer: the same job records, as Home Manager launch agents.
#
# Two jobs used to live here as stow-managed plists (launchd/Library/LaunchAgents,
# now deleted). Those plists carried a hand-written PATH with no Nix profile in
# it, so the Mac copies could not see the tools a deploy installs — the drift
# this renderer removes. Everything job-specific now comes from
# nix/services/jobs.nix; only platform policy lives here:
#
#   - PATH starts with the standalone Home Manager profile
#     (`~/.nix-profile/bin`, where a `home-manager switch` on this Mac puts every
#     tool), keeps `/etc/profiles/per-user/<user>/bin` behind it as a fallback,
#     then the system directories the plists already carried.
#   - an explicit interpreter stays: a launchd agent inherits no login shell
#     environment.
#   - launchd has no journal, so stdout and stderr go under `~/Library/Logs/`,
#     where a failed sync is visible instead of silent.
#
# The attribute name is the job's launchd label, so launchd sees the same
# `com.aviral.*` labels the plists had and never runs two copies. Home Manager
# would otherwise label the job `org.nix-community.home.<name>`, so `Label` is
# set from the same name explicitly.
{ config, lib, ... }:

let
  jobs = import ./jobs.nix;

  # A standalone Home Manager configuration owns the user, so both values come
  # from its own options instead of a system layer.
  user = config.home.username;
  home = config.home.homeDirectory;

  # The standalone profile leads, because that is where a
  # `home-manager switch` on this Mac installs every tool. The old system
  # layer's per-user profile follows as a fallback: it is the location that
  # layer used, so a host mid-migration still resolves a tool from it. The tail
  # is the order the stow plists used.
  agentPath = "${home}/.nix-profile/bin:/etc/profiles/per-user/${user}/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

  toHome = lib.replaceStrings [ "@home@" ] [ home ];

  # The command a login shell runs. `-l` sources /etc/zprofile, whose
  # path_helper puts the system directories first again, so the environment is
  # re-asserted at exec time rather than trusted from the plist.
  script =
    job:
    "exec /usr/bin/env ${lib.escapeShellArgs (
      [ "PATH=${agentPath}" ]
      ++ map (e: "${e.name}=${toHome e.value}") job.environment
      ++ map toHome job.argv
    )}";

  # `launchd.agents.<name>.config` carries the launchd.plist keys. The label,
  # the argv, the environment, the working directory, the run-at-load and
  # throttle policy and the log paths are the ones the previous agent carried.
  render =
    label: job:
    {
      Label = label;
      ProgramArguments = [
        job.interpreter.darwin
        "-lc"
        (script job)
      ];
      # The launchd-level environment. The command above re-asserts PATH after
      # the login shell's path_helper has run.
      EnvironmentVariables = lib.listToAttrs (
        map (e: lib.nameValuePair e.name (toHome e.value)) job.environment
      ) // {
        PATH = agentPath;
      };
      # Job field, honoured on both platforms (launchd would otherwise run
      # the agent with `/` as its working directory).
      WorkingDirectory = toHome job.workingDirectory;
      # `restart.policy = "always"`: start at load and keep it running.
      RunAtLoad = true;
      KeepAlive = job.restart.policy == "always";
      # launchd's own respawn floor, so a crash loop is throttled the way
      # systemd's RestartSec throttles it.
      ThrottleInterval = job.restart.delaySeconds;
      # Background work: no I/O priority boost, same as the plists asked for.
      ProcessType = "Background";
      StandardOutPath = "${home}/Library/Logs/${label}.log";
      StandardErrorPath = "${home}/Library/Logs/${label}.error.log";
    };
in
{
  launchd.agents = lib.mapAttrs' (
    label: job: lib.nameValuePair label {
      enable = true;
      config = render label job;
    }
  ) (lib.filterAttrs (_label: job: job.enable.darwin) jobs);
}

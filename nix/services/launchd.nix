# The Darwin renderer: the same job records, as nix-darwin user launch agents.
#
# Two jobs used to live here as stow-managed plists (launchd/Library/LaunchAgents,
# now deleted). Those plists carried a hand-written PATH with no Nix profile in
# it, so the Mac copies could not see the tools a deploy installs — the drift
# this renderer removes. Everything job-specific now comes from
# nix/services/jobs.nix; only platform policy lives here:
#
#   - PATH starts with the nix-darwin per-user profile
#     (`/etc/profiles/per-user/<user>/bin`, where the deploy actually puts every
#     tool), keeps `~/.nix-profile/bin` behind it as a standalone-Home-Manager
#     fallback, then the system directories the plists already carried.
#   - an explicit interpreter stays: a launchd agent inherits no login shell
#     environment.
#   - launchd has no journal, so stdout and stderr go under `~/Library/Logs/`,
#     where a failed sync is visible instead of silent.
#
# The attribute name is the job's launchd label, so launchd sees the same
# `com.aviral.*` labels the plists had and never runs two copies.
{ config, lib, ... }:

let
  jobs = import ./jobs.nix;

  # nix-darwin has no `home` option of its own; the managed user's home comes
  # from the Home Manager profile nix-darwin evaluates in the same system.
  user = config.system.primaryUser;
  home = config.home-manager.users.${user}.home.homeDirectory;

  # The directory every deployed tool actually lands in. nix-darwin manages the
  # per-user profile at /etc/profiles/per-user/<user> (225 binaries here) while
  # `~/.nix-profile` — the standalone Home Manager location — does not exist on
  # this host at all, so it follows the real profile as a fallback instead of
  # leading it. Leading with it was the inherited bug: the agent then fell
  # through to Homebrew and /usr/bin. The tail is the order the stow plists used.
  agentPath = "/etc/profiles/per-user/${user}/bin:${home}/.nix-profile/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

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

  render =
    label: job:
    {
      serviceConfig = {
        # nix-darwin would default this to `${launchd.labelPrefix}.${name}`.
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
    };
in
{
  config.launchd.user.agents = lib.mapAttrs' (
    label: job: lib.nameValuePair label (render label job)
  ) (lib.filterAttrs (_label: job: job.enable.darwin) jobs);
}

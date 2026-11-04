# Homelab-only services. S01 proved these exist on the homelab and not for
# aviral on the devbox: the sync needs ~/vault and an upstream credential that
# only the homelab carries.
{
  ...
}:

{
  systemd.user.services.semianalysis-sync = {
    Unit = {
      Description = "Sync new SemiAnalysis research into the vault";
      After = [ "network-online.target" ];
      Wants = [ "network-online.target" ];
    };
    Service = {
      Type = "oneshot";
      WorkingDirectory = "%h/vault";
      ExecStart = "/usr/bin/python3 %h/dotfiles/scripts/semianalysis_sync.py";
      # The script shells out to tools the profile owns.
      Environment = [ "PATH=%h/.nix-profile/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin" ];
      StandardOutput = "journal";
      StandardError = "journal";
    };
    # No [Install]: the timer pulls it. `linked` is its steady state.
    Install.WantedBy = [ ];
  };

  systemd.user.timers.semianalysis-sync = {
    Unit.Description = "Run the SemiAnalysis vault sync hourly";
    Timer = {
      OnCalendar = "hourly";
      Persistent = true;
      RandomizedDelaySec = 120;
      Unit = "semianalysis-sync.service";
    };
    Install.WantedBy = [ "timers.target" ];
  };
}

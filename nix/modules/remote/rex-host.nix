# The reusable managed-Rex host profile: one host, one tailnet device.
#
# A fleet host that serves Rex gets everything Rex needs from this module, so a
# numbered host module (a future `rex-01.nix`) is one line on top of its host
# deltas:
#
#   { imports = [ ((import ./rex-host.nix) "rex-01") ]; }
#
# `mumbai.nix` is the first user, and the flake target ops/provision ships
# (`.#homeConfigurations.remote-mumbai.activationPackage`) is that same output.
#
# Two decisions are the whole point of the profile:
#
# 1. System Tailscale, not Rex's embedded one. `services.rex.tailscale` makes the
#    server run its own Tailscale node, which joins the tailnet as a second
#    device (`<host>-rex` alongside `<host>`). A managed host has exactly one
#    identity: the host's own `tailscaled`, shipped by apt on Ubuntu, joined once
#    by the enrollment step. So Rex's embedded Tailscale stays off.
# 2. Rex listens on loopback and is published through `tailscale serve`. Without
#    the embedded node, the server's only transport is its local socket plus any
#    address in `extraListen`. A loopback TCP address that `tailscale serve`
#    proxies is a private HTTPS endpoint on the host's own tailnet name, and no
#    port is reachable from outside the tailnet.
#
# The pinned Rex (0.1.0-preview.13, `rex server run --help`) also knows two
# host-Tailscale transports: `tailnet://IP:port` and `tailnet-serve://<socket>`.
# Both identify callers through tailscaled's LocalAPI, and both expect Rex to run
# as the account that owns that socket — the shape a system unit gets. This
# profile is a Home Manager *user* service, and the operator grant that lets it
# talk to tailscaled at all (`tailscale set --operator=$USER`) is the very thing
# that takes the socket away from the account Rex would have to be. So the
# profile uses the transport that does not depend on that identity check, and the
# trade is recorded: on loopback, Rex cannot tell callers apart, and the tailnet
# ACL — not Rex — is the boundary.
hostName: {
  config,
  lib,
  pkgs,
  rexFlake,
  ...
}:

let
  # The loopback endpoint `tailscale serve` proxies. Rex's `--extra-listen`
  # accepts a TCP address, and the server speaks HTTP and WebSocket on it, which
  # is what Serve forwards. The number is Rex's own convention for that listener
  # (the module's `extraListen` example); nothing outside this file depends on
  # it, because Serve publishes it on the tailnet's HTTPS port and clients never
  # see the loopback port.
  listenPort = 7297;
  listenAddress = "127.0.0.1:${toString listenPort}";

  # Serve's HTTPS port: 443, so the returned address is the plain tailnet name
  # (`https://<host>.<tailnet>.ts.net`) and the owner adds no port. `serve` keeps
  # it tailnet-only; `funnel` is the public one, and this profile never calls it.
  servePort = 443;

  # The CLI that talks to the daemon it ships with. Ubuntu's `tailscale` package
  # installs the daemon and `/usr/bin/tailscale` together, so that pair matches;
  # the profile's own copy is the fallback for a host without it. A newer CLI
  # against an older daemon is how a Serve call fails for no visible reason.
  #
  # `tailscale wait` first: systemd starts a user unit as soon as the machine is
  # up, which can be before tailscaled has reconnected to the control server, and
  # `tailscale serve` fails in that window. A oneshot stays failed until someone
  # restarts it, so the wait is what makes this converge at boot (the same two
  # lines the upstream NixOS module uses for the same reason).
  tailscaleCommand = args:
    pkgs.writeShellScript "rex-serve" ''
      cli=/usr/bin/tailscale
      [ -x "$cli" ] || cli=${pkgs.tailscale}/bin/tailscale
      exec "$cli" ${lib.escapeShellArgs args}
    '';
  tailscaleServeStart = pkgs.writeShellScript "rex-serve-start" ''
    cli=/usr/bin/tailscale
    [ -x "$cli" ] || cli=${pkgs.tailscale}/bin/tailscale
    "$cli" wait
    exec "$cli" ${lib.escapeShellArgs [
      "serve"
      "--bg"
      "--https=${toString servePort}"
      "http://${listenAddress}"
    ]}
  '';
in
{
  imports = [
    # programs.rex / services.rex, from the Rex flake itself.
    rexFlake.homeManagerModules.default
  ];

  # The Rex CLI, the xterm-rex terminfo entry, and the ssh guard that keeps
  # TERM=xterm-rex from reaching a host with no entry for it. The guard is
  # written through programs.ssh, so that module is on: home-manager owns
  # ~/.ssh/config here, and no stow package ships one.
  programs.rex.enable = true;
  programs.ssh.enable = true;

  # The personal server, as a systemd user unit named rex. It listens on this
  # account's own socket (no --listen, no --state-dir), so `rex ls` and
  # `rex server status` on the box reach it with no flags, and it gains the one
  # loopback TCP address Serve proxies.
  #
  # allowAnonymous is required by Rex for a TCP address, because a TCP socket
  # cannot say who is calling. The address is 127.0.0.1 only, so the caller is
  # already a process on this host (the same trust the other host-local units
  # take); the tailnet, not the port, is what faces another machine.
  services.rex = {
    enable = true;
    tailscale.enable = false;
    extraListen = [ listenAddress ];
    allowAnonymous = true;
  };

  # The private address: system Tailscale Serve forwards the host's own tailnet
  # HTTPS port to the loopback listener above. One unit, one mapping, and it is
  # idempotent — `--bg` replaces the serve config for that port rather than
  # appending. It is deliberately not `PartOf=rex.service`: a stop of the server
  # would then take the mapping down until the unit was started again, and a
  # mapping with a closed backend is the less surprising state.
  #
  # `tailscale serve` needs to talk to tailscaled, which is root's. The operator
  # grants that once per host with
  #
  #   sudo tailscale set --operator=$USER
  #
  # and after that this unit converges at every boot. Without the grant the unit
  # fails and logs why, which is the honest state: Rex is up, its private
  # address is not published, and `tailscale serve status` on the host shows no
  # mapping.
  systemd.user.services.rex-serve = {
    Unit = {
      Description = "Publish the ${hostName} Rex server through Tailscale Serve";
      After = [
        "network-online.target"
        "rex.service"
      ];
      Wants = [ "network-online.target" ];
    };
    Service = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = tailscaleServeStart;
      # Turning off only this HTTPS port leaves the host's other Serve mappings
      # alone. The leading `-` keeps a stop from failing when tailscaled is
      # already gone.
      ExecStop = "-${tailscaleCommand [
        "serve"
        "--https=${toString servePort}"
        "off"
      ]}";
      Restart = "on-failure";
      RestartSec = 5;
    };
    Install.WantedBy = [ "default.target" ];
  };

  # The files a managed Rex host must have linked. No `install.sh` stow run
  # happens on a provisioned box — the profile owns what stow owns on the
  # workstations — so `init.lua` and the module it requires come from the repo
  # tree. `notify-ntfy.lua` sits in the same config directory and is read from
  # there when a notifier is configured.
  #
  # `ssh_config` is deliberately absent: `rex terminfo setup` generates it per
  # machine (its Match block names that account's home directory), and the guard
  # itself already arrives from programs.rex.
  home.file = {
    ".config/rex/init.lua".source = ../../../rex/.config/rex/init.lua;
    ".config/rex/missions.lua".source = ../../../rex/.config/rex/missions.lua;
    ".config/rex/notify-ntfy.lua".source = ../../../rex/.config/rex/notify-ntfy.lua;
  };

  # Rex is a user service, so it starts at boot only while the account lingers.
  # Lingering is logind state, not a profile file, so the switch asks for it when
  # it can: polkit lets a user enable linger for their own account, which is the
  # same call the AWS bootstrap makes in cloud-init (`loginctl enable-linger
  # ubuntu`). A switch that cannot grant it warns instead of failing, and
  # `systemctl --user is-active rex` on the host is the check that it happened.
  home.activation.rexLinger = lib.mkIf pkgs.stdenv.hostPlatform.isLinux (
    lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      if [ ! -e /var/lib/systemd/linger/${config.home.username} ]; then
        run ${pkgs.systemd}/bin/loginctl enable-linger ${config.home.username} 2>/dev/null \
          || echo "rex: loginctl enable-linger ${config.home.username} failed; the Rex service stops when the last session closes" >&2
      fi
    ''
  );
}

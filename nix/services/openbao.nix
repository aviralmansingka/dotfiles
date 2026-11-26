# OpenBao on the lab: one user unit, one rendered config, one snapshot pair.
#
# The shape is decided by the preflight facts in docs/secrets.md ("OpenBao
# preflight — lab facts"): the lab's login user keeps a session open (Linger=yes)
# but has neither root nor passwordless sudo, so the server is a
# `systemd.user.services` unit — not a system service, and not a NixOS module
# (every host in this fleet is a standalone Home Manager configuration).
#
# The confinement a system unit would carry is unavailable here: `ProtectSystem`,
# `PrivateTmp`, `ProtectHome`, `RestrictAddressFamilies`, `MemoryDenyWriteExecute`
# and a capability bounding set are all root-side settings, and a user manager
# applies none of them. What is left is a small, legible unit plus a config file
# a human can read in one screen.
#
# Two of the settings below are consequences of the same fact, worth naming:
#
#   - `disable_mlock = true` is not a preference. mlock needs CAP_IPC_LOCK, a
#     user unit holds no capabilities, and OpenBao refuses to start when it
#     cannot lock memory. The trade is that the server's heap can be swapped;
#     on a single-user lab box with no swap pressure that is the honest cost.
#   - both listeners are above 1024 — 8200/8201 were free on the lab when the
#     preflight checked — so binding them needs no privilege either.
#
# Unsealing is a separate oneshot (`openbao-unseal.service`, S03), not something
# the server does to itself. `bao operator init` output is custody material: the
# five shares live in secrets/homelab.yaml and in 1Password, and no file this
# module renders contains one. The unit runs unattended custody — approved by
# the human for this mission and recorded in docs/secrets.md, "Unattended
# unseal" — by reading the sops-deployed escrow and posting each share to
# `POST /v1/sys/unseal` on stdin, so no share ever appears in argv or in a
# process environment.
{
  config,
  lib,
  pkgs,
  ...
}:

let
  home = config.home.homeDirectory;
  configDir = "${config.xdg.configHome}/openbao";
  # Both under ~/.local on purpose: the raft directory is durable *data* and the
  # audit log and snapshots are *state*. Neither is host-state under a fleet
  # convention that could move, so the paths are absolute in the config file and
  # in the units — HCL expands neither `~` nor XDG variables.
  dataDir = "${home}/.local/share/openbao";
  stateDir = "${home}/.local/state/openbao";

  # Every unit in this tree starts with the profile on PATH, so a tool the
  # profile owns resolves instead of falling through to an apt copy.
  unitPath = "%h/.nix-profile/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin";

  # The admin age recipient, READ from .sops.yaml rather than copied into this
  # file. The rule that owns secrets/homelab.yaml lists the admin key first on
  # its `age:` block (.sops.yaml's header comment says every rule carries it, and
  # docs/secrets.md names it as the first entry), so the first `age1…` value
  # after that rule's `path_regex` line is the admin key. A parse that finds
  # nothing throws at evaluation time: a snapshot encrypted to the wrong person
  # is worse than a switch that stops.
  sopsLines = lib.splitString "\n" (builtins.readFile ../../.sops.yaml);

  afterHomelabRule =
    let
      drop =
        lines:
        if lines == [ ] then
          [ ]
        else if
          lib.hasInfix "path_regex" (builtins.head lines)
          && lib.hasInfix "secrets/homelab" (builtins.head lines)
        then
          lines
        else
          drop (builtins.tail lines);
    in
    drop sopsLines;

  # Trim the YAML indentation and the rule's trailing comma; an age recipient
  # has no internal whitespace, so stripping it everywhere is safe.
  recipientValue = line: lib.replaceStrings [ " " "\t" "," "\r" ] [ "" "" "" "" ] line;

  adminRecipient =
    let
      found = lib.lists.findFirst (line: lib.hasPrefix "age1" (recipientValue line)) null afterHomelabRule;
    in
    if found == null then
      throw "nix/services/openbao.nix: no age recipient found after the secrets/homelab.yaml rule in .sops.yaml"
    else
      recipientValue found;

  configText = ''
    # Rendered by Home Manager from nix/services/openbao.nix at every switch. An
    # edit on the host is overwritten; change the module instead. The unit names
    # this file as a reload trigger, so a change here is followed by a SIGHUP
    # rather than waiting for the next restart.

    ui = false

    # A user unit holds no capabilities, and mlock needs CAP_IPC_LOCK, so OpenBao
    # will not start with mlock enabled and unable. See the module header for the
    # trade this accepts.
    disable_mlock = true

    # Loopback, because every client is local: the CLI on this host, and the
    # AppRole consumer that S05 runs here too.
    api_addr     = "http://127.0.0.1:8200"
    cluster_addr = "http://127.0.0.1:8201"

    # TLS is OFF, and that holds only while every client is local. The listener
    # binds 127.0.0.1, so no packet leaves the loopback interface and nothing
    # off-box can observe the traffic or reach the API. The first client that is
    # not on this host — a remote agent, another machine's AppRole login, a proxy
    # in front of the API — makes this stanza wrong, and a certificate has to
    # exist before that client connects. Until then, reach the API from elsewhere
    # over an ssh tunnel (`ssh -L 8200:127.0.0.1:8200 homelab`), which keeps the
    # wire local.
    listener "tcp" {
      address         = "127.0.0.1:8200"
      cluster_address = "127.0.0.1:8201"
      tls_disable     = true
    }

    # The audit device is declarative, not an API call: OpenBao 2.7 refuses
    # `bao audit enable` outright ("cannot enable audit device via API; use
    # declarative, config-based audit device management instead"), and a stanza
    # here is the better contract anyway — it is in the flake, so every switch
    # re-asserts it and no operator has to remember a one-time command. The
    # device is attached when the node becomes active (unsealed), so it shows up
    # in `bao audit list` after every unseal, and it is blocking: if this file
    # cannot be opened the server refuses to serve rather than run unaudited.
    audit "file" "file" {
      description = "audit log, one JSON record per request"
      options {
        file_path = "${stateDir}/audit.log"
      }
    }

    # Integrated storage. One node: the lab is one host and there is no second
    # machine to form a quorum with. The path is host state — outside the Nix
    # store and outside the repo — so the snapshot timer below is its backup, not
    # git.
    storage "raft" {
      path    = "${dataDir}/raft"
      node_id = "homelab"
    }
  '';

  # The one capability openbao-snapshot.service needs: `bao operator raft
  # snapshot save` reads this endpoint and nothing else. Rendered beside the
  # config so the operator loads it from a file the flake owns, not from a
  # heredoc in a runbook that can drift.
  snapshotPolicy = ''
    # Loaded once, by the operator, right after init:
    #   bao policy write openbao-periodic-snapshot ${configDir}/policies/periodic-snapshot.hcl
    # It backs the periodic token that secrets/homelab.yaml holds as
    # `openbao-snapshot-token` (docs/secrets.md, "Runbook 5 — OpenBao on the lab").
    path "sys/storage/raft/snapshot" {
      capabilities = ["read"]
    }
  '';

  # The agents that own a secret, and therefore get an AppRole identity. One
  # list, because the policy document and the role are generated from the same
  # name: an entry here renders `~/.config/openbao/policies/agent-<name>.hcl`,
  # and `openbao-agents provision` loads that file and turns it into a role with
  # a 15 minute token. `pi-browserbase` is the S05 consumer; the other three are
  # the agent secrets that already exist in secrets/homelab.yaml.
  agents = [
    "pi-browserbase"
    "pi-stt-worker"
    "pi-telegram"
    "pi-whatsapp"
  ];

  # Least privilege, and the whole point of the AppRole: this identity reads its
  # own KV v2 entry and nothing else. Not a list, not a write, not another
  # agent's data — which is why the mission's 403 test (one agent's token
  # reading another agent's path) has a real answer rather than a 404.
  agentPolicy = agent: ''
    # Rendered by nix/services/openbao.nix, one file per entry in the `agents`
    # list there, and loaded into the cluster by `openbao-agents provision`.
    # The flake owns the document; the cluster is given a copy of it.
    #
    # One path of data and one path of metadata, both this agent's own. `read`
    # and nothing else: no create/update/delete, no `list`, and no path outside
    # `secret/`.
    path "secret/data/${agent}" {
      capabilities = ["read"]
    }

    # Version numbers and timestamps, which is how a consumer can tell a rotated
    # value from a stale one. It is not the data of any path, its own included.
    path "secret/metadata/${agent}" {
      capabilities = ["read"]
    }
  '';

  # The config the server reads, and the same derivation the unit names as a
  # reload trigger, so a change to any stanza actually reaches the running
  # process.
  configFile = pkgs.writeText "openbao.hcl" configText;

  # `writeShellApplication` renders the script body into a store path with a
  # shebang, `set -euo pipefail`, and a PATH built from runtimeInputs, so the
  # unit does not have to trust whatever `age` or `bao` the profile carries.
  # The unseal oneshot's body, rendered the same way. Its runtime inputs are the
  # three tools it is allowed to touch: `bao` for the sealed-state guard, `jq` to
  # cut the threshold worth of shares out of the escrow, and `curl` to post them
  # with the body on stdin.
  unsealScript = pkgs.writeShellApplication {
    name = "openbao-unseal";
    runtimeInputs = with pkgs; [
      openbao
      curl
      jq
      coreutils
    ];
    text = builtins.readFile ./openbao-unseal.sh;
  };

  snapshotScript = pkgs.writeShellApplication {
    name = "openbao-snapshot";
    runtimeInputs = with pkgs; [
      openbao
      age
      coreutils
      gnugrep
      findutils
    ];
    text = builtins.readFile ./openbao-snapshot.sh;
  };

  # The KV mount and the per-agent AppRole identities: one operator command, so
  # the cluster state is a script an operator runs rather than a set of `bao`
  # lines pasted into a runbook. It reads the policy files below, so the
  # documents it loads are the ones reviewed in git; `sops` is a runtime input
  # because `seed` reads the agent secrets through `sops exec-env`.
  agentsScript = pkgs.writeShellApplication {
    name = "openbao-agents";
    runtimeInputs = with pkgs; [
      openbao
      sops
      curl
      jq
      python3
      coreutils
    ];
    text = builtins.readFile ./openbao-agents.sh;
  };
in
{
  # `bao` on PATH is what makes the operator commands in the runbook — and the
  # mission's own check, `ssh homelab 'systemctl --user is-active openbao && bao
  # status'` — resolve over a non-interactive ssh command.
  home.packages = [
    pkgs.openbao
    # The tool that reads a snapshot back, and the only thing that can: without
    # an identity age refuses, which is the property the runbook proves.
    pkgs.age
    snapshotScript
    # In PATH so the recovery path in the runbook is a command a human can type
    # ("systemctl --user restart openbao-unseal.service" is the other one). It
    # reads the same 0400 escrow the login user can already read, so it hands out
    # no capability that user did not have.
    unsealScript
    # The operator half of the KV/AppRole layout (docs/secrets.md, "The KV mount
    # and the AppRoles"). It needs the root token, which is the escrow the login
    # user can already read, and the agent secrets, which come through
    # `sops exec-env` on this host.
    agentsScript
  ];

  xdg.configFile = {
    "openbao/openbao.hcl".source = configFile;
    "openbao/policies/periodic-snapshot.hcl".text = snapshotPolicy;
  } // lib.listToAttrs (
    map (agent: {
      name = "openbao/policies/agent-${agent}.hcl";
      value.text = agentPolicy agent;
    }) agents
  );

  # Every `bao` command on this host talks to the local server. Home Manager
  # writes this into hm-session-vars.sh, which ~/.zshenv sources for shells that
  # never read ~/.zprofile — including the one sshd starts for `ssh homelab
  # 'bao status'`.
  home.sessionVariables.BAO_ADDR = "http://127.0.0.1:8200";

  # Two secrets this module reads, both declared in nix/modules/remote/homelab.nix
  # (the file that names the secrets file they live in) at mode 0400:
  #   openbao-init.json         `bao operator init` output: five unseal shares,
  #                             threshold 3, and the root token. Escrowed the
  #                             minute it was produced. Read by
  #                             `openbao-unseal.service` below, by path only, and
  #                             never from argv or an environment variable.
  #   openbao-snapshot-token    the periodic, snapshot-only token the timer uses.

  systemd.user.services.openbao = {
    Unit = {
      Description = "OpenBao server with integrated raft storage";
      After = [ "network-online.target" ];
      Wants = [ "network-online.target" ];
      # A config change has to reach the running server. Home Manager restarts
      # only a unit whose *unit file* changed, and the HCL is a separate file, so
      # without a trigger the stanzas above would sit unapplied until the next
      # restart. SIGHUP is the reload OpenBao documents for exactly this
      # (listeners and audit devices); unlike a restart it does not re-seal the
      # node.
      X-Reload-Triggers = [ configFile ];
    };
    Service = {
      Type = "simple";
      # OpenBao creates the files it owns, never their directories.
      ExecStartPre = "/bin/mkdir -p ${dataDir}/raft ${stateDir}/snapshots";
      # The store path rather than `bao` from the profile: the unit then runs the
      # binary of the generation it was built with, even if the profile symlink
      # is flipped by a later switch before the service restarts.
      ExecStart = "${pkgs.openbao}/bin/bao server -config=${configDir}/openbao.hcl";
      # The reload half of X-Reload-Triggers above.
      ExecReload = "${pkgs.coreutils}/bin/kill -HUP $MAINPID";
      Restart = "always";
      RestartSec = "5";
      # No sops dependency on purpose: a server that cannot unseal itself needs
      # neither a share nor a token to run.
      Environment = [ "PATH=${unitPath}" ];
      StandardOutput = "journal";
      StandardError = "journal";
    };
    Install.WantedBy = [ "default.target" ];
  };

  # The unseal chain. Unattended custody is the human's recorded decision for
  # this mission (docs/secrets.md, "Unattended unseal"): a lab reboot ends with a
  # serving node and nobody at a terminal.
  #
  # Ordering alone is not the mechanism, and believing it was is the bug this
  # unit carried until S03's review: `After=` only *orders* two units, it does
  # not *pull* one in. If nothing else in the transaction happens to want
  # sops-nix.service, the escrow was never published and this unit failed after
  # a boot — the node stayed sealed. So every dependency below is named twice:
  # `Wants=` puts the unit in the same transaction, `After=` orders it before
  # this one. Starting this unit alone is then enough to bring the whole chain
  # up, which is what the cold-start proof exercises.
  #
  # `Wants`, not `Requires`: a sops-nix failure must not cancel the unseal. The
  # script already refuses loudly when the escrow is unreadable (exit 1, "the key
  # openbao-init.json is missing from sops"), so a broken sops shows up as a red
  # unseal unit either way, and `Requires` would only hide the reason. The script
  # also waits for the listener and skips an already-unsealed node, so a
  # start-order race degrades to a no-op rather than a failure.
  #
  # `RemainAfterExit = "yes"` keeps the unit green after it has done its job (the
  # oneshot exits once the node is unsealed, and an inactive unit after boot would
  # read as "the unseal did not happen"). The cost is that `start` is a no-op once
  # it has run, so restoring a node that was re-sealed later is
  # `systemctl --user restart openbao-unseal.service` — the idempotent guard makes
  # that safe when the node is already unsealed.
  systemd.user.services.openbao-unseal = {
    Unit = {
      Description = "Unseal OpenBao from the sops-deployed init escrow";
      After = [
        "sops-nix.service"
        "openbao.service"
      ];
      # See the comment above: the escrow comes from sops-nix.service and the
      # socket from openbao.service, so this oneshot pulls both rather than
      # trusting that `default.target` dragged them into the same transaction.
      Wants = [
        "sops-nix.service"
        "openbao.service"
      ];
    };
    Service = {
      Type = "oneshot";
      RemainAfterExit = "yes";
      ExecStart = "/bin/bash ${unsealScript}/bin/openbao-unseal";
      # The escrow reaches the script as a *path*, and the address is not a
      # secret. No share, threshold included, is ever an environment value.
      Environment = [
        "PATH=${unitPath}"
        "BAO_ADDR=http://127.0.0.1:8200"
        "OPENBAO_INIT_FILE=%h/.config/sops-nix/secrets/openbao-init.json"
      ];
      StandardOutput = "journal";
      StandardError = "journal";
    };
    Install.WantedBy = [ "default.target" ];
  };

  systemd.user.services.openbao-snapshot = {
    Unit = {
      Description = "Age-encrypt a raft snapshot of OpenBao";
      # The token arrives through sops-nix's oneshot. The server has to be up and
      # unsealed or there is nothing to save; the script says so and exits 0
      # rather than failing the timer, because a sealed server is a legal state
      # (S02 ends there) and a red unit every night would hide a real failure.
      After = [
        "sops-nix.service"
        "openbao.service"
      ];
      Wants = [ "sops-nix.service" ];
    };
    Service = {
      Type = "oneshot";
      # `/bin/bash` is explicit so the unit names its interpreter (the 203/EXEC
      # class); the script itself is a store path from the same generation.
      ExecStart = "/bin/bash ${snapshotScript}/bin/openbao-snapshot --recipient ${adminRecipient}";
      Environment = [
        "PATH=${unitPath}"
        "BAO_ADDR=http://127.0.0.1:8200"
        # The token is a periodic, snapshot-only token, not an unseal share: it
        # can read sys/storage/raft/snapshot and nothing else. It reaches the
        # script as a file path, so it never appears in the unit's argv.
        "BAO_TOKEN_FILE=%h/.config/sops-nix/secrets/openbao-snapshot-token"
      ];
      StandardOutput = "journal";
      StandardError = "journal";
    };
    # The timer pulls it. `linked` is its steady state, same as the
    # semianalysis pair in nix/services/homelab.nix.
    Install.WantedBy = [ ];
  };

  systemd.user.timers.openbao-snapshot = {
    Unit.Description = "Snapshot OpenBao once a day";
    Timer = {
      OnCalendar = "*-*-* 04:15:00";
      # A missed run happens at the next boot/login instead of silently skipping
      # a day, which matters because the lab is not always on.
      Persistent = true;
      RandomizedDelaySec = 600;
      Unit = "openbao-snapshot.service";
    };
    Install.WantedBy = [ "timers.target" ];
  };
}

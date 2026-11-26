# Fleet provisioning stack for the homelab: PostgreSQL, Temporal, and the
# provision API and worker as systemd *user* units.
#
# Why units and not `virtualisation.oci-containers`: the homelab is a Home Manager
# profile on Ubuntu, so there is no NixOS system layer to hold a container
# declaration, and Docker comes from apt (rootful) or from the user's own rootless
# install. Every container is therefore started by `docker run` from a unit, and
# the docker endpoint is resolved at run time (see `dockerShim`): a rootless socket
# in $XDG_RUNTIME_DIR wins when it exists, otherwise the default socket is used.
# One unit set covers both installation shapes.
#
# No secret is a Nix expression here. The PostgreSQL superuser password and the
# Temporal database password are read at start from sops-deployed files (mode 0400,
# decrypted outside the store) and written to 0600 files under $XDG_RUNTIME_DIR,
# from where they are bind-mounted or env-filed into the container. No password
# appears in a unit file, in an argument, or in a committed environment file.
#
# Ordering is explicit and every gate is its own unit, so `systemctl --user status`
# names the step that is stuck:
#
#   network -> postgres -> postgres-healthy -> temporal-schema -> temporal
#           -> temporal-ready -> fleet-provision (api) + fleet-provision-worker
#
# Images are pinned by digest. The PostgreSQL major is 16 rather than 17 on
# purpose: 16.6 is the newest major in Temporal's documented tested persistence
# matrix (13.18 / 14.15 / 15.10 / 16.6) and 16 is inside PostgreSQL's own support
# window, so 16 is the one major both projects claim.
#
# The enable flag defaults to false. The homelab has no Docker today, and a unit
# that starts against a missing docker binary only restarts until an operator
# notices; the owner flips `fleet.services.fleetProvision.enable` after installing
# Docker and placing the two password files. See docs/provisioning.md §8.
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.fleet.services.fleetProvision;

  # Container, volume, and network names are constants rather than options: the
  # docs, the backup procedure, and every operator command name them, so they must
  # not drift per host.
  postgresContainer = "fleet-provision-postgres";
  temporalContainer = "fleet-provision-temporal";
  postgresVolume = "fleet-provision-postgres-data";
  network = "fleet-provision-net";
  frontendPort = 7233;
  databaseUser = "temporal";
  databaseName = "temporal";
  visibilityDatabaseName = "temporal_visibility";

  # The profile's binaries first, exactly like every other unit in this repo: a
  # unit that resolves its own PATH sees only /usr/local/bin:/usr/bin:/bin.
  #
  # The two directory variables are passed through the environment because systemd
  # expands %t and %h in unit directives only — a script in the Nix store that
  # spelled "%t" itself would hand that literal string to bash.
  #
  # The AWS shared-credentials file is the host's one approved AWS identity: the
  # worker hands Terraform and the SSM CLI its own environment (the adapters pass no
  # key), and this host has no attached role and no unexpired SSO session, so the
  # profile there is the whole credential source. The file is a 0600 operator file,
  # never a Nix store path and never written by this module. AWS_PROFILE names the
  # section to read; a credentials file holding one non-`default` profile is not
  # found without it, and the SDK then reports a bare STS failure.
  unitEnvironment = [
    "PATH=%h/.nix-profile/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin"
    "FLEET_PROVISION_RUNTIME_DIR=%t/fleet-provision"
    "FLEET_PROVISION_STATE_DIR=${cfg.stateDir}"
    "AWS_SHARED_CREDENTIALS_FILE=%h/.config/fleet-provision/aws-credentials"
    "AWS_PROFILE=legacy-515647909264"
  ];

  # One docker entry point for both installation shapes. A rootless install
  # publishes its socket into the user runtime directory; a rootful install leaves
  # the socket where the client looks by default, and works when the user is in the
  # docker group. The shim only decides which socket to use, so no unit has to know
  # which install it is on.
  dockerShim = pkgs.writeShellScript "fleet-provision-docker" ''
    set -eu
    runtime="''${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    if [ -S "$runtime/docker.sock" ]; then
      export DOCKER_HOST="unix://$runtime/docker.sock"
    fi
    exec ${pkgs.docker-client}/bin/docker "$@"
  '';

  # Materialise the two passwords out of their sops files into 0600 runtime files.
  # Those files live on tmpfs, are recreated on every start, and are the only place
  # the values exist outside the decrypted sops material.
  postgresPassword = pkgs.writeShellScript "fleet-provision-postgres-password" ''
    set -eu
    runtime="''${FLEET_PROVISION_RUNTIME_DIR:?fleet-provision: the runtime directory is not set}"
    : "''${FLEET_POSTGRES_PASSWORD:?fleet-provision: the sops-deployed postgres password is missing}"
    ${pkgs.coreutils}/bin/install -d -m 0700 "$runtime"
    umask 077
    printf '%s' "$FLEET_POSTGRES_PASSWORD" > "$runtime/postgres-password"
  '';

  temporalPassword = pkgs.writeShellScript "fleet-provision-temporal-password" ''
    set -eu
    runtime="''${FLEET_PROVISION_RUNTIME_DIR:?fleet-provision: the runtime directory is not set}"
    : "''${FLEET_TEMPORAL_DB_PASSWORD:?fleet-provision: the sops-deployed temporal database password is missing}"
    ${pkgs.coreutils}/bin/install -d -m 0700 "$runtime"
    umask 077
    printf '%s' "$FLEET_TEMPORAL_DB_PASSWORD" > "$runtime/temporal-password"
    # docker --env-file reads KEY=value lines, so the server's password reaches the
    # container without passing through a command-line argument.
    printf 'POSTGRES_PWD=%s\nVISIBILITY_POSTGRES_PWD=%s\n' \
      "$FLEET_TEMPORAL_DB_PASSWORD" "$FLEET_TEMPORAL_DB_PASSWORD" > "$runtime/temporal-db.env"
    chmod 0600 "$runtime/temporal-db.env"
  '';

  createNetwork = pkgs.writeShellScript "fleet-provision-network" ''
    set -eu
    if ! ${dockerShim} network inspect ${network} >/dev/null 2>&1; then
      ${dockerShim} network create --label fleet-provision=1 ${network} >/dev/null
    fi
  '';

  startPostgres = pkgs.writeShellScript "fleet-provision-postgres-start" ''
    set -eu
    runtime="''${FLEET_PROVISION_RUNTIME_DIR:?fleet-provision: the runtime directory is not set}"
    ${dockerShim} volume inspect ${postgresVolume} >/dev/null 2>&1 \
      || ${dockerShim} volume create --label fleet-provision=1 ${postgresVolume} >/dev/null
    # The container is durable state, so it is created once and started afterwards;
    # systemd owns its lifecycle through ExecStop, and the named volume outlives
    # both. `docker rm` is the only thing that discards it.
    if ${dockerShim} container inspect ${postgresContainer} >/dev/null 2>&1; then
      ${dockerShim} start ${postgresContainer} >/dev/null
      exit 0
    fi
    # No -p at all. The database is reachable only from the private container
    # network, so there is no published port to close later; backup and restore run
    # through `docker exec` (docs/provisioning.md §9) and need none.
    # POSTGRES_PASSWORD_FILE is the image's file form, so the value comes from the
    # bind-mounted 0600 file rather than an environment variable or an argument.
    ${dockerShim} run -d \
      --name ${postgresContainer} \
      --network ${network} \
      --restart=no \
      --volume ${postgresVolume}:/var/lib/postgresql/data \
      --volume "$runtime/postgres-password:/run/secrets/postgres-password:ro" \
      --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password \
      --health-cmd "pg_isready -U postgres -d postgres" \
      --health-interval 10s \
      --health-timeout 5s \
      --health-retries 10 \
      --health-start-period 30s \
      ${cfg.postgresImage} >/dev/null
  '';

  # The health gate. It is a unit rather than a flag inside another unit, so a
  # stuck database is reported by name and nothing downstream starts.
  postgresHealthy = pkgs.writeShellScript "fleet-provision-postgres-healthy" ''
    set -eu
    timeout=${toString cfg.healthTimeoutSeconds}
    deadline=$(( $(${pkgs.coreutils}/bin/date +%s) + timeout ))
    while :; do
      status="$(${dockerShim} inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${postgresContainer} 2>/dev/null || echo missing)"
      case "$status" in
        healthy) exit 0 ;;
        unhealthy)
          echo "fleet-provision: ${postgresContainer} reports unhealthy" >&2
          exit 1
          ;;
      esac
      if [ "$(${pkgs.coreutils}/bin/date +%s)" -ge "$deadline" ]; then
        echo "fleet-provision: ${postgresContainer} was not healthy within ''${timeout}s (last status: $status)" >&2
        exit 1
      fi
      ${pkgs.coreutils}/bin/sleep 2
    done
  '';

  # Schema init is explicit and idempotent: the role and the two databases are
  # created only when missing, and the schema tool is versioned with the server
  # release it ships from. It runs before the server, so the server never boots
  # against an empty database.
  temporalSchema = pkgs.writeShellScript "fleet-provision-temporal-schema" ''
    set -eu
    : "''${FLEET_TEMPORAL_DB_PASSWORD:?fleet-provision: the sops-deployed temporal database password is missing}"

    psql() {
      ${dockerShim} exec -i ${postgresContainer} psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
    }

    # The role's password travels over stdin, never in an argument, so it does not
    # appear in a host process list. The schema tool below does take it as a flag;
    # docs/provisioning.md §8 records that limitation and why it is bounded.
    psql <<SQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${databaseUser}') THEN
        CREATE ROLE ${databaseUser} LOGIN PASSWORD '$FLEET_TEMPORAL_DB_PASSWORD';
      ELSE
        ALTER ROLE ${databaseUser} WITH LOGIN PASSWORD '$FLEET_TEMPORAL_DB_PASSWORD';
      END IF;
    END
    \$\$;
    SQL

    for db in ${databaseName} ${visibilityDatabaseName}; do
      exists="$(psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'")"
      if [ "$exists" != "1" ]; then
        psql -c "CREATE DATABASE $db OWNER ${databaseUser}"
      fi
    done

    sql_tool() {
      ${dockerShim} run --rm --network ${network} ${cfg.temporalAdminToolsImage} \
        temporal-sql-tool --plugin postgres12 --ep ${postgresContainer} --port 5432 \
        --user ${databaseUser} --password "$FLEET_TEMPORAL_DB_PASSWORD" "$@"
    }
    # setup-schema -v 0.0 creates only the version tables; update-schema then applies
    # every embedded migration up to the newest one the image ships. Both are no-ops
    # on a current database, so this unit is safe to re-run after an upgrade.
    for pair in "${databaseName}:/etc/temporal/schema/postgresql/v12/temporal/versioned" \
                "${visibilityDatabaseName}:/etc/temporal/schema/postgresql/v12/visibility/versioned"; do
      db="''${pair%%:*}"
      dir="''${pair#*:}"
      sql_tool --db "$db" setup-schema -v 0.0
      sql_tool --db "$db" update-schema -d "$dir"
    done
  '';

  startTemporal = pkgs.writeShellScript "fleet-provision-temporal-start" ''
    set -eu
    runtime="''${FLEET_PROVISION_RUNTIME_DIR:?fleet-provision: the runtime directory is not set}"
    if ${dockerShim} container inspect ${temporalContainer} >/dev/null 2>&1; then
      ${dockerShim} start ${temporalContainer} >/dev/null
      exit 0
    fi
    # The server renders its *static* config from the environment, but its dynamic
    # config is a file: temporal-server start defaults to
    # /etc/temporal/config/dynamicconfig/docker.yaml, and the pinned image ships no
    # config directory at all (/etc/temporal holds only entrypoint.sh). Without the
    # mount the container exits 1 on "unable to create dynamic config client" and
    # the frontend port never opens. An empty map is the whole dynamic config this
    # stack needs, so it is written here rather than baked into the image.
    #
    # The database password arrives through a 0600 env file; BIND_ON_IP is what lets
    # the published loopback port reach the frontend, and the frontend is the only
    # published port in the stack.
    printf '{}\n' > "$runtime/dynamicconfig.yaml"
    chmod 0644 "$runtime/dynamicconfig.yaml"
    ${dockerShim} run -d \
      --name ${temporalContainer} \
      --network ${network} \
      --restart=no \
      --publish 127.0.0.1:${toString frontendPort}:${toString frontendPort} \
      --env-file "$runtime/temporal-db.env" \
      --env DB=postgres12 \
      --env POSTGRES_SEEDS=${postgresContainer} \
      --env DB_PORT=5432 \
      --env DBNAME=${databaseName} \
      --env VISIBILITY_DBNAME=${visibilityDatabaseName} \
      --env POSTGRES_USER=${databaseUser} \
      --env BIND_ON_IP=0.0.0.0 \
      --volume "$runtime/dynamicconfig.yaml:/etc/temporal/config/dynamicconfig/docker.yaml:ro" \
      ${cfg.temporalServerImage} >/dev/null
  '';

  # A bounded readiness wait on the published frontend port: an accepted TCP
  # connection is the frontend's own listener. The wait is bounded so a dead server
  # fails the unit instead of hanging the boot target.
  temporalReady = pkgs.writeShellScript "fleet-provision-temporal-ready" ''
    set -eu
    timeout=${toString cfg.healthTimeoutSeconds}
    deadline=$(( $(${pkgs.coreutils}/bin/date +%s) + timeout ))
    while :; do
      if ( exec 3<>/dev/tcp/127.0.0.1/${toString frontendPort} ) 2>/dev/null; then
        exec 3>&-
        exit 0
      fi
      if [ "$(${pkgs.coreutils}/bin/date +%s)" -ge "$deadline" ]; then
        echo "fleet-provision: the temporal frontend on 127.0.0.1:${toString frontendPort} accepted no connection within ''${timeout}s" >&2
        exit 1
      fi
      ${pkgs.coreutils}/bin/sleep 2
    done
  '';

  # The unit's own state: the inventory document, the Terraform run directories,
  # and the bootstrap delivery directory. Host state, never the store.
  prepareState = pkgs.writeShellScript "fleet-provision-state-dir" ''
    set -eu
    state="''${FLEET_PROVISION_STATE_DIR:?fleet-provision: the state directory is not set}"
    ${pkgs.coreutils}/bin/install -d -m 0700 "$state" "$state/terraform-runs" "$state/bootstrap"
  '';

  # The API and the worker share one shape: the same binary, the same non-secret
  # config file, the same journal, and the same restart policy. They differ only in
  # the subcommand.
  mkService =
    { subcommand, description }:
    {
      Unit = {
        Description = description;
        After = [
          "network-online.target"
          "sops-nix.service"
          "fleet-provision-temporal-ready.service"
        ];
        Wants = [
          "network-online.target"
          "sops-nix.service"
          # Rootless Docker runs its socket from the user manager. A missing unit is
          # ignored here, so the same line is harmless on a rootful install.
          "docker.socket"
        ];
        Requires = [ "fleet-provision-temporal-ready.service" ];
      };
      Service = {
        Type = "simple";
        ExecStartPre = "${prepareState}";
        ExecStart = "${cfg.binaryPath} ${subcommand} --config ${cfg.configFile}";
        Restart = "always";
        RestartSec = "5";
        # A stop asks the process to finish its in-flight activity; the workflow and
        # its history stay in Temporal, so a restart never abandons a record.
        KillSignal = "SIGTERM";
        TimeoutStopSec = "30";
        Environment = unitEnvironment;
        StandardOutput = "journal";
        StandardError = "journal";
      };
      Install.WantedBy = [ "default.target" ];
    };
in
{
  options.fleet.services.fleetProvision = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Start the fleet provisioning stack (PostgreSQL, Temporal, the API, and the
        worker) as systemd user units. Off by default: the units need Docker and the
        two sops-deployed password files, and a unit that starts without them only
        restarts until an operator notices. See docs/provisioning.md.
      '';
    };

    binaryPath = lib.mkOption {
      type = lib.types.str;
      default = "%h/.local/bin/fleet-provision";
      description = ''
        The provision binary. It is built from ops/provision (`go build
        ./cmd/provision`) and installed by the operator rather than by this flake:
        the derivation would need a vendor hash, and a host-installed binary keeps a
        local rebuild from requiring a flake update.
      '';
    };

    configFile = lib.mkOption {
      type = lib.types.str;
      default = "%h/.config/fleet-provision/service.yaml";
      description = "The non-secret service configuration (docs/provisioning.md §8).";
    };

    stateDir = lib.mkOption {
      type = lib.types.str;
      default = "%h/.local/state/fleet-provision";
      description = ''
        Inventory document, Terraform run directories, and bootstrap delivery
        directory. Mode 0700, inside the user's home, never the Nix store.
      '';
    };

    postgresPasswordFile = lib.mkOption {
      type = lib.types.str;
      default = "%h/.config/sops-nix/secrets/fleet-provision-postgres.env";
      description = ''
        sops-deployed KEY=value file holding FLEET_POSTGRES_PASSWORD. Declared as a
        sops secret in nix/modules/remote/homelab.nix with mode 0400.
      '';
    };

    temporalPasswordFile = lib.mkOption {
      type = lib.types.str;
      default = "%h/.config/sops-nix/secrets/fleet-provision-temporal.env";
      description = ''
        sops-deployed KEY=value file holding FLEET_TEMPORAL_DB_PASSWORD, the
        password of the `temporal` database role.
      '';
    };

    postgresImage = lib.mkOption {
      type = lib.types.str;
      default = "postgres:16.16@sha256:07abc3f43c9395b0bdbbab36bc25ddb0e8d83cd4fcafb5fb7d6abe14ff156dd8";
      description = "Pinned PostgreSQL image. 16 is Temporal's newest tested major.";
    };

    temporalServerImage = lib.mkOption {
      type = lib.types.str;
      default = "temporalio/server:1.32.2@sha256:7bf69188a6232fea14869b9cef3d94aa82a1601d99517f7e86c71f22da4e0670";
      description = "Pinned Temporal server image. It renders its config from env.";
    };

    temporalAdminToolsImage = lib.mkOption {
      type = lib.types.str;
      default = "temporalio/admin-tools:1.32.2@sha256:4a95866efba29d7e17ab012df5232795e8b0ad0f7d5f9d1ec4df321f7792a754";
      description = ''
        Pinned schema tooling. The version must equal the server's: the schema it
        applies is the one that release expects.
      '';
    };

    healthTimeoutSeconds = lib.mkOption {
      type = lib.types.int;
      default = 300;
      description = "Bound on each readiness gate. A gate that exceeds it fails its unit.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services = {
      fleet-provision-network = {
        Unit.Description = "Private container network for the fleet provisioning stack";
        Service = {
          Type = "oneshot";
          RemainAfterExit = true;
          ExecStart = "${createNetwork}";
          Environment = unitEnvironment;
        };
      };

      fleet-provision-postgres = {
        Unit = {
          Description = "PostgreSQL holding Temporal persistence and the provisioning inventory";
          After = [ "fleet-provision-network.service" ];
          Requires = [ "fleet-provision-network.service" ];
          Wants = [ "docker.socket" ];
        };
        Service = {
          Type = "oneshot";
          RemainAfterExit = true;
          EnvironmentFile = cfg.postgresPasswordFile;
          ExecStartPre = "${postgresPassword}";
          ExecStart = "${startPostgres}";
          ExecStop = "${dockerShim} stop ${postgresContainer}";
          TimeoutStartSec = "300";
          Environment = unitEnvironment;
        };
        Install.WantedBy = [ "default.target" ];
      };

      fleet-provision-postgres-healthy = {
        Unit = {
          Description = "Gate: PostgreSQL reports healthy";
          After = [ "fleet-provision-postgres.service" ];
          Requires = [ "fleet-provision-postgres.service" ];
        };
        Service = {
          Type = "oneshot";
          RemainAfterExit = true;
          ExecStart = "${postgresHealthy}";
          TimeoutStartSec = toString (cfg.healthTimeoutSeconds + 30);
          Environment = unitEnvironment;
        };
      };

      fleet-provision-temporal-schema = {
        Unit = {
          Description = "Create the Temporal role, databases, and schemas";
          After = [ "fleet-provision-postgres-healthy.service" ];
          Requires = [ "fleet-provision-postgres-healthy.service" ];
        };
        Service = {
          Type = "oneshot";
          RemainAfterExit = true;
          EnvironmentFile = cfg.temporalPasswordFile;
          ExecStartPre = "${temporalPassword}";
          ExecStart = "${temporalSchema}";
          # A schema migration against a cold PostgreSQL is the slowest step.
          TimeoutStartSec = "900";
          Environment = unitEnvironment;
        };
      };

      fleet-provision-temporal = {
        Unit = {
          Description = "Temporal server on 127.0.0.1:7233";
          After = [ "fleet-provision-temporal-schema.service" ];
          Requires = [ "fleet-provision-temporal-schema.service" ];
          Wants = [ "docker.socket" ];
        };
        Service = {
          Type = "oneshot";
          RemainAfterExit = true;
          EnvironmentFile = cfg.temporalPasswordFile;
          ExecStartPre = "${temporalPassword}";
          ExecStart = "${startTemporal}";
          ExecStop = "${dockerShim} stop ${temporalContainer}";
          TimeoutStartSec = "300";
          Environment = unitEnvironment;
        };
        Install.WantedBy = [ "default.target" ];
      };

      fleet-provision-temporal-ready = {
        Unit = {
          Description = "Gate: the Temporal frontend accepts connections";
          After = [ "fleet-provision-temporal.service" ];
          Requires = [ "fleet-provision-temporal.service" ];
        };
        Service = {
          Type = "oneshot";
          RemainAfterExit = true;
          ExecStart = "${temporalReady}";
          TimeoutStartSec = toString (cfg.healthTimeoutSeconds + 30);
          Environment = unitEnvironment;
        };
      };

      # `systemctl --user restart fleet-provision` restarts the API, which is the
      # unit the service is named after. The worker is a separate unit so its
      # concurrency limits and its log stream stay separable.
      fleet-provision = mkService {
        subcommand = "api";
        description = "Fleet provisioning API (loopback, published through Tailscale Serve)";
      };

      fleet-provision-worker = mkService {
        subcommand = "worker";
        description = "Fleet provisioning Temporal worker";
      };
    };
  };
}

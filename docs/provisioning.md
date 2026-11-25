# Fleet provisioning: identity, deployment, and recovery

This document describes how a provisioned fleet host gets a restricted OpenBao
identity, how the homelab runs the provisioning service itself, and how the stack is
backed up, restored, restarted, and upgraded. It covers the implemented code paths,
the policy a host receives, the token and SecretID lifetimes, the reboot and rotation
procedures, and what an operator still has to do by hand.

The implementation lives in `ops/provision`, and the homelab units live in
`nix/services/fleet-provision.nix`:

| Layer | File | Responsibility |
|---|---|---|
| domain | `internal/domain/identity.go` | host identity, role and policy names, policy document, token and login-credential lifetimes |
| domain | `internal/domain/bundles.go` | the per-host bundle mapping from `config/profiles.yaml` |
| application | `internal/application/identity.go` | the authorization use case: policy, role, wrapped SecretID, out-of-band delivery |
| application | `internal/application/session.go` | the host-side use case: unwrap once, log in, renew, rotate |
| adapter | `internal/adapters/openbao/identity.go` | OpenBao HTTP mechanics, response wrapping, login and renewal |
| adapter | `internal/adapters/openbao/bootstrap.go` | the mode-0600 bootstrap file |
| wiring | `cmd/provision/main.go` | `newAuthorizer` builds the adapter for the worker |
| wiring | `nix/services/fleet-provision.nix` | the homelab systemd user units: PostgreSQL, Temporal, the API, and the worker |
| workflow | `internal/workflows/create_host.go` | the creation ladder, its cancellation outcome, and the milestone that keeps ownership |
| adapter | `internal/adapters/temporal/activities.go` | adoption of an allocation a crashed run already made, and the refusal to destroy an ambiguous one |
| application | `internal/application/redact_log.go` | the last-line log scrubber every service line passes through |

Domain code imports neither the adapter nor any HTTP client. The adapter owns every
OpenBao request shape, and the use case owns the order of operations.

## 1. Per-host AppRole creation

The role name is a pure function of the server-generated host id:

```
role   = fleet-host-<host id>       e.g. fleet-host-host-0001
policy = fleet-policy-<host id>     e.g. fleet-policy-host-0001
KV     = secret/data/hosts/<host id>/
```

`<host id>` is produced by the service (`host-0001`, …) and is never client input.
The name is validated against `^[a-z][a-z0-9-]{2,63}$`, so two host identities can
never produce the same role name, and no host name, profile name, or request field
participates in it.

Authorization (`IdentityService.AuthorizeHost`) does this, in this order:

1. derive the identity from the host id;
2. refuse every bundle reference that is not under the host's own KV tree;
3. write the ACL policy (`PUT /v1/sys/policies/acl/<policy>`);
4. create or update the AppRole (`POST /v1/auth/approle/role/<role>`);
5. write the ownership claim (`POST /v1/secret/data/fleet/identity/roles/<role>`
   with `cas: 0`);
6. mint a response-wrapped SecretID (`POST
   /v1/auth/approle/role/<role>/secret-id` with the `X-Vault-Wrap-TTL` header);
7. deliver the wrapping token as a mode-0600 file.

The ownership claim is a non-secret KV record. It is written create-only, and it is
read before the role is written. A second host that reaches an existing role name is
refused with `domain.RoleClaimError` instead of silently sharing the role; nothing
is minted for it. The claim is deleted when the role is revoked, so a host id can be
provisioned again after a clean teardown.

Revocation (`DeleteAppRole`, `DeletePolicy`) deletes the claim and the role (which
deletes every SecretID of the role) and then the policy. It is idempotent.

## 2. One-use wrapped SecretID delivery

The SecretID never exists on the provisioning host:

- the adapter asks OpenBao to wrap the SecretID (`X-Vault-Wrap-TTL: 600`), so the
  reply contains a wrapping token, not a SecretID;
- a reply without `wrap_info` is refused (`openbao: server did not response-wrap the
  secret id`), so a misconfigured server cannot hand over the value in the clear;
- the wrapping token travels to the host as the file
  `<bootstrap_dir>/<host id>/approle-wrap-token`, mode 0600, in a 0700 directory;
- the host unwraps it exactly once. The host client marks the token consumed before
  the request, so a replay is refused locally without a second call, and OpenBao
  refuses a second unwrap independently.

No SecretID, wrapping token, or session token is a field of `AuthorizeRequest`,
`AuthorizeHostInput`, any activity result, any workflow status, or any host record.
`application.Secret` renders as `[redacted]` for `%s`, `%v`, `%#v`, and
`encoding/json`, so even an accidental log line or payload carries a placeholder.

Bootstrap location rules are enforced twice (service configuration and the writer):
absolute path, never `/nix/store`, never a `.git` or `.terraform` directory, never a
`.tfstate` path, and never inside a Git checkout (the writer walks the parents).

The host reads the file, unwraps, logs in, and deletes the file:

```bash
# on the host, after the provisioning job reached "ready"
wrap="$(cat /var/lib/fleet-provision/bootstrap/<host id>/approle-wrap-token)"
# The token travels in the environment, never in argv, and the unwrap is one-use:
# the server refuses a second call. The host deletes the file afterwards.
BAO_TOKEN="$wrap" bao unwrap
```

The exact host command is owner-gated (see §12); the file must be deleted after use.
Because the delivery file is a credential, copying it into a repo, a Nix store path,
or a Terraform variable is always wrong.

## 3. Policy contents

`domain.HostPolicyDocument` builds the policy and `PolicyDocument.HCL()` renders it.
The document the adapter sends is exactly:

```hcl
# Fleet host policy for host-0001. Generated by the fleet provisioning service.
path "secret/data/hosts/host-0001/*" {
  capabilities = ["read"]
}
path "secret/metadata/hosts/host-0001/*" {
  capabilities = ["read", "list"]
}
path "auth/approle/role/*" {
  capabilities = ["deny"]
}
path "auth/approle/role/+/secret-id" {
  capabilities = ["deny"]
}
path "auth/token/create*" {
  capabilities = ["deny"]
}
path "auth/token/revoke*" {
  capabilities = ["deny"]
}
path "auth/token/roles/*" {
  capabilities = ["deny"]
}
path "sys/policies/acl*" {
  capabilities = ["deny"]
}
path "sys/auth*" {
  capabilities = ["deny"]
}
path "identity/*" {
  capabilities = ["deny"]
}
```

Properties, each with a test:

- reading the host's own canary (`secret/data/hosts/<host>/canary`) is allowed;
- reading another host's path is not granted at all — there is no allow rule that
  can match `secret/data/hosts/<other>/...`;
- creating or modifying an identity is explicitly denied (roles, SecretID minting,
  token creation, policies, auth mounts, entities), and OpenBao's deny precedence
  means a future broad grant cannot re-open them.

`PolicyDocument.AllowsRead` and `PolicyDocument.Denies` evaluate the same rules the
HCL renders, so the test asserts the policy's behaviour, not just its text.

## 4. Token TTL and renewal

The role is created with:

| Setting | Value |
|---|---|
| `token_ttl` | 600 s |
| `token_max_ttl` | 900 s |
| `token_explicit_max_ttl` | 900 s |
| `renewable` | true |
| `token_policies` | the host's own policy only |
| `token_no_default_policy` | true |
| `bind_secret_id` | true |

900 seconds is a hard maximum, not a default. `domain.TokenPolicy.Validate` refuses
a configuration above it, `application.NewIdentityService` refuses to start with
such a policy, and `SessionService` refuses a session whose reported TTL is zero,
negative, or above the maximum. Renewal asks for a 300-second increment and is
subject to the same validation, so renewal can never extend a token past the bound.

## 5. Reboot relogin

The bootstrap SecretID is one-use, so it cannot be the credential a host uses after
a reboot. The AppRole therefore carries a second, rotating SecretID policy:

| Setting | Value |
|---|---|
| `secret_id_ttl` | 12 h |
| `secret_id_num_uses` | 8 |

Eight uses means a host that reboots several times still logs in; one use per boot
consumes the credential slowly. If the SecretID runs out or expires before rotation,
the host logs in with the material it last saved (see §6) or an operator re-runs the
authorization step, which delivers a fresh wrapping token.

A host keeps its rotating SecretID in a mode-0600 file on the host (outside the Nix
store), not in the repository, not in a job record, and never on a command line:

1. on first boot, unwrap the bootstrap token once and log in;
2. rotate immediately: mint a new wrapped SecretID, unwrap it, save it 0600, and
   retire the bootstrap file;
3. on later boots, log in with the saved SecretID (this consumes one use);
4. renew the token when the session is still running (`RenewSelf`).

Reboot survival means the host identity (AppRole + policy + rotating SecretID) is
durable; the session token is explicitly not, and a reboot costs one login.

## 6. Rotation and recovery

Rotation (`SessionService.Rotate` →
`HostIdentityClient.RotateSecretID`):

1. mint a new response-wrapped SecretID;
2. destroy the previous SecretID by accessor
   (`POST /v1/auth/approle/role/<role>/secret-id-accessor/destroy`);
3. deliver the new wrapping token, unwrap, and replace the host's saved credential.

`LoginCredentialPolicy` fixes the schedule: rotate every 6 hours, keep the previous
credential usable for a 30-minute grace window, and always rotate before the 12-hour
expiry. `LoginCredentialPolicy.Validate` refuses a policy whose rotation interval is
not shorter than the lifetime.

Recovery, in order of least privilege:

1. **Expired token, live host**: renew, or log in again with the saved SecretID.
2. **Exhausted or expired SecretID**: mint a wrapped SecretID as the operator
   (`provision`'s adapter, or `bao write -wrap-ttl=10m
   auth/approle/role/<role>/secret-id`), copy the wrapping token to the host by
   hand, unwrap once, and rotate.
3. **Lost bootstrap file**: the file is one-use and short-lived (10 minutes). If it
   is gone, its token is useless; re-run the authorization step for that host to
   mint a new one. The role and policy are idempotent, so a re-run changes nothing
   else.
4. **Role claimed by the wrong host**: do not delete the claim by hand. Revoke the
   host (`RevokeHost`), which removes role, claim, and policy, then authorize again.
   A claim conflict is a permanent refusal and never a retryable failure.
5. **Full teardown**: `RevokeHost` removes the role (with every SecretID), the claim,
   and the policy. The host's files must be deleted on the host.

## 7. Deployment: the homelab stack

The service runs as systemd **user** units generated by the flake. NixOS
`virtualisation.oci-containers` is deliberately not used: the homelab is a Home
Manager profile on Ubuntu with no system layer, and Docker is either rootful (apt,
user in the `docker` group) or rootless (the user's own install). Every container
unit calls a small `docker` shim that prefers a rootless socket in
`$XDG_RUNTIME_DIR` and falls back to the default socket, so one unit set is correct
for both installs.

`nix/services/fleet-provision.nix` is imported by `nix/modules/remote/homelab.nix`
in two parts:

- the module always declares its options under `fleet.services.fleetProvision`;
- `fleet.services.fleetProvision.enable` (default `false`) decides whether any unit
  exists at all. With the flag off a host renders exactly the units it rendered
  before this module landed, which is what makes shipping it safe.

### 7.1 Units, in dependency order

| Unit | Type | Role |
|---|---|---|
| `fleet-provision-network.service` | oneshot | creates the private bridge network `fleet-provision-net` if it is missing |
| `fleet-provision-postgres.service` | oneshot | runs the `fleet-provision-postgres` container on the named volume `fleet-provision-postgres-data`; no published port |
| `fleet-provision-postgres-healthy.service` | oneshot | gate: polls the container's own healthcheck (`pg_isready`) until `healthy`, bounded by `healthTimeoutSeconds` |
| `fleet-provision-temporal-schema.service` | oneshot | creates the `temporal` role and both databases if missing, then applies the Temporal schema with `temporal-sql-tool`; idempotent |
| `fleet-provision-temporal.service` | oneshot | runs the `fleet-provision-temporal` container, published on `127.0.0.1:7233` only |
| `fleet-provision-temporal-ready.service` | oneshot | gate: waits, bounded, for the frontend port to accept a connection |
| `fleet-provision.service` | simple | the API (`provision api`), loopback listener, restarted on failure |
| `fleet-provision-worker.service` | simple | the Temporal worker (`provision worker`), restarted on failure |

`systemctl --user restart fleet-provision` restarts the API, which is the unit the
service is named after; the worker is its own unit so its concurrency limits and its
log stream stay separable. `Requires=` plus `After=` on each gate means
`systemctl --user start fleet-provision` walks the whole chain and a stuck step is
reported under its own name.

### 7.2 What is published

Only two loopback ports exist: `127.0.0.1:7233` (Temporal frontend, for the API and
worker on the host) and the API's own `api.listen` from the service config
(`127.0.0.1:8080` in the example). The database publishes **nothing**: it is
reachable only from `fleet-provision-net`, so there is no port to close later. Even
backups run through `docker exec` (§9) rather than through a host port, which is why
this delivery deliberately drops the `127.0.0.1:5434` binding an earlier plan
mentioned.

### 7.3 Images

| Image | Pin |
|---|---|
| PostgreSQL | `postgres:16.16@sha256:07abc3f43c9395b0bdbbab36bc25ddb0e8d83cd4fcafb5fb7d6abe14ff156dd8` |
| Temporal server | `temporalio/server:1.32.2@sha256:7bf69188a6232fea14869b9cef3d94aa82a1601d99517f7e86c71f22da4e0670` |
| Temporal schema tooling | `temporalio/admin-tools:1.32.2@sha256:4a95866efba29d7e17ab012df5232795e8b0ad0f7d5f9d1ec4df321f7792a754` |

Three decisions are load-bearing here.

1. **PostgreSQL 16, not 17.** Temporal's documented tested persistence matrix stops
   at 16.6, and 16 is still inside PostgreSQL's own support window, so 16 is the one
   major both projects claim. `16.16` is the current 16.x minor.
2. **`temporalio/server`, not `temporalio/auto-setup`.** `auto-setup` is deprecated
   upstream and has no release past its 1.29 line. The server image renders its own
   config from the environment, so no config file is mounted; the schema tool from
   `admin-tools` initialises the databases, and its version must equal the server's
   because the schema it applies is the one that release expects.
3. **Digests, not tags.** The digests above were read from the Docker Hub registry
   API (tag metadata) while this section was written. A tag moves; a digest does not.
   Pulling these pins is a live gate (§12).

### 7.4 Secrets

| Value | Source | What the container sees |
|---|---|---|
| PostgreSQL superuser password | sops key `fleet-provision-postgres.env` under `~/.config/sops-nix/secrets/`, mode 0400 | `POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password`, a bind mount of a 0600 tmpfs file |
| `temporal` database role password | sops key `fleet-provision-temporal.env`, mode 0400 | `docker --env-file` of a 0600 tmpfs file (`POSTGRES_PWD`, `VISIBILITY_POSTGRES_PWD`) |

No password is a Nix expression, a unit-file argument, or a committed environment
file. An `ExecStartPre` copies each value from the decrypted sops file into
`$XDG_RUNTIME_DIR/fleet-provision/` (tmpfs, 0700, recreated on every start) and the
container reads it from there.

One limitation is worth naming: `temporal-sql-tool` accepts the database password
only as `--password`, so the schema unit's argument vector carries it for the
duration of that one `docker run --rm`. The exposure is bounded — the role can reach
only the two Temporal databases, the container is removed on exit, and the step runs
once per boot at most — but it is real, and it is the reason that step is not
something to run while other users are on the host.

### 7.5 Enabling it

```bash
# One time, on the homelab, as the fleet user:
#   1. install Docker (rootful with the user in the `docker` group, or rootless so
#      the user manager owns docker.socket).
#   2. add the two sops keys named above to secrets/homelab.yaml
#      (`just secrets-edit homelab`).
#   3. build and install the binary. It is host state, not a flake output, so no
#      vendor hash and no flake update is involved:
cd ops/provision && go build -o ~/.local/bin/fleet-provision ./cmd/provision
#   4. place the non-secret config (from config/service.example.yaml), the token
#      digests (mode 0600), and profiles.yaml under ~/.config/fleet-provision/.
#   5. flip `fleet.services.fleetProvision.enable = true;` in
#      nix/modules/remote/homelab.nix and run `home-manager switch`.

systemctl --user start fleet-provision          # walks the whole chain
systemctl --user list-units 'fleet-provision*'  # each step, by name
journalctl --user -u fleet-provision-worker -f
```

## 8. Databases, roles, and schemas

One PostgreSQL server, one role, two databases. Nothing else is created.

| Database | Owner | Purpose |
|---|---|---|
| `temporal` | `temporal` | Temporal persistence: executions, history, tasks |
| `temporal_visibility` | `temporal` | Temporal advanced visibility |

The schema inside each database is PostgreSQL's default `public`, which is where
Temporal's own migrations write. Version state lives in the `schema_version` and
`schema_update` tables that `temporal-sql-tool setup-schema -v 0.0` creates before
`update-schema` applies the migrations, and those two tables are also how an operator
reads which schema version a database is actually on.

Two absences are deliberate and must not be papered over:

- **No `fleet_provision` database, and no `hosts` / `jobs` / `idempotency_keys` /
  `client_tokens` tables.** The service's durable inventory is still the JSON
  document named by `storage.state_file` (`internal/adapters/store/jsonstore`),
  because the PostgreSQL store adapter is not part of this delivery. Creating the
  database now would document a store nothing writes to. It belongs in the step that
  ships that adapter, with its migrations; until then the JSON document is part of
  the backup set (§9.1).
- **No schema version pinned by hand.** The migrations under
  `/etc/temporal/schema/postgresql/v12/` are the ones that ship inside the pinned
  `admin-tools` image, and `update-schema` applies them to the newest version that
  image carries. Because the image is digest-pinned, so is the resulting schema.

The `postgres` superuser exists only because the image creates it. The schema unit
uses it through `docker exec` on the container's local socket, so its password never
has to be typed, and neither the API nor the worker connects as it.

## 9. Backup and restore

Backups run through `docker exec`: no published port, no host `pg_dump`, no client
credentials on the host. The dump is compressed and encrypted before it touches the
disk, so a backup directory is never a plaintext copy of the fleet's state.

### 9.1 What is in the backup set

| Item | Why |
|---|---|
| database `temporal` | every workflow execution, its history, and its task queues |
| database `temporal_visibility` | the visibility store; without it a restore loses search and listing |
| `storage.state_file` (JSON inventory) | host ownership: the resource and device ids a restore needs in order to adopt instead of recreate |
| the service config and `profiles.yaml` | non-secret; needed with the data, never a secret |

Not in the backup set, on purpose: the bootstrap delivery directory (its files hold
one-use, ten-minute wrapping tokens) and every credential. The management token and
the client tokens are re-issued by their own procedures, not restored from a dump.

### 9.2 Dump

```bash
set -eu
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$HOME/.local/state/fleet-provision/backups"
mkdir -p "$out"
recipient="$(cat "$HOME/.config/sops/age/recipients.txt")"

for db in temporal temporal_visibility; do
  docker exec -i fleet-provision-postgres \
    pg_dump -U postgres --format=custom --no-owner "$db" \
  | gzip -c \
  | age -r "$recipient" -o "$out/$db-$stamp.dump.gz.age"
done

# The inventory travels with the databases: a restore of the databases alone cannot
# say which instances the fleet owns.
tar -C "$HOME/.local/state/fleet-provision" -czf - store.json \
| age -r "$recipient" -o "$out/inventory-$stamp.tar.gz.age"

ls -l "$out"
```

`--format=custom` is what lets `pg_restore` do a selective, restartable restore.
`--no-owner` keeps role grants out of the dump so a restore into a differently named
role cannot fail halfway.

### 9.3 Restore into a separate test database (the rehearsal)

Never rehearse into a live database. The rehearsal target is
`temporal_restore_test`: created, filled, checked, dropped.

```bash
set -eu
stamp=<the stamp of the backup under test>
work="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/fleet-restore.XXXXXX")"
chmod 0700 "$work"

age -d -i "$HOME/.config/sops/age/keys.txt" \
    "$HOME/.local/state/fleet-provision/backups/temporal-$stamp.dump.gz.age" \
| gunzip -c > "$work/temporal.dump"

psql() { docker exec -i fleet-provision-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

psql -c 'DROP DATABASE IF EXISTS temporal_restore_test'
psql -c 'CREATE DATABASE temporal_restore_test'
docker exec -i fleet-provision-postgres \
  pg_restore -U postgres --no-owner --exit-on-error --dbname=temporal_restore_test \
  < "$work/temporal.dump"

# The check is a count and a version, not "it exited 0":
docker exec -i fleet-provision-postgres psql -U postgres -d temporal_restore_test \
  -c 'SELECT count(*) AS executions FROM executions' \
  -c 'SELECT curr_version FROM schema_version'

psql -c 'DROP DATABASE temporal_restore_test'
rm -rf "$work"
```

The decrypted dump exists only for the seconds the restore needs, in a 0700 directory
under the runtime dir (tmpfs, cleared by the reboot). If it has to be a file at all,
this is the shape to use.

### 9.4 Restore over a damaged stack

1. `systemctl --user stop fleet-provision fleet-provision-worker` — no activity may
   run against a database that is about to be replaced.
2. Restore `temporal` and `temporal_visibility` into fresh databases (`DROP DATABASE`,
   then `CREATE DATABASE ... OWNER temporal`, then `pg_restore`).
3. Put the backed-up `store.json` back at the configured `storage.state_file`, mode
   0600.
4. `systemctl --user start fleet-provision-temporal fleet-provision-worker
   fleet-provision`. The schema unit is not needed: the dump already carries the
   schema, and a `schema_version` newer than the image makes the server refuse to
   start — the loud failure, not a silent one.
5. Poll one known job (`GET /v1/jobs/<id>`) and confirm it reports the state the
   backup was taken in. Nothing is re-executed: Temporal resumes from history, and
   the adoption logic (§10.3) makes a resumed activity adopt rather than recreate.

Producing and restoring a real encrypted backup is a live gate (§12, gate 8).

## 10. Restart and recovery

### 10.1 What a restart costs

| Restart | Command | Cost |
|---|---|---|
| API | `systemctl --user restart fleet-provision` | none: an HTTP listener and a Temporal client, no durable state |
| worker | `systemctl --user restart fleet-provision-worker` | none: activities are redelivered from the task queue and the workflow keeps its history |
| PostgreSQL container | `systemctl --user restart fleet-provision-postgres` | seconds of downtime; data is in the named volume and survives the container being recreated |
| Temporal container | `systemctl --user restart fleet-provision-temporal` | seconds; all state is in PostgreSQL |
| whole host | reboot | the units return in dependency order; `sops-nix.service` runs before anything that reads a password, and the gates hold until the database and the frontend are actually ready |

Restart containers through `systemctl`, not `docker restart`: the unit's
`RemainAfterExit` state would otherwise claim a container was current when it was
not, and the next `systemctl start` would not notice.

### 10.2 Timeouts and bounds

| Bound | Value | Where |
|---|---|---|
| activity `ScheduleToStartTimeout` | 2 min | `internal/workflows/create_host.go` |
| activity `StartToCloseTimeout` | 5 min | same |
| activity retries | 3 attempts, 1 s initial, ×2 backoff | same |
| milestone write | 30 s, 2 attempts | same |
| workflow execution timeout | 45 min | `internal/adapters/temporal/orchestrator.go` |
| worker concurrency | `limits.max_concurrent_jobs` workflows, `limits.max_concurrent_provisioning` activities | `cmd/provision/main.go` |
| readiness gates | `fleet.services.fleetProvision.healthTimeoutSeconds` (300 s default) | `nix/services/fleet-provision.nix` |

### 10.3 The crash windows

A worker can die between doing a step and recording it. The record is written first
where it matters, and every step adopts what a previous run left behind.

| Killed | What happens on the next attempt |
|---|---|
| after the provider allocated, before the record | the resource id is written by the create activity itself, not by a later milestone; a retry that finds no recorded id asks the provider again, and the Terraform adapter returns the instance the host already owns instead of planning a second one |
| after the device joined, before the record | the enroll activity writes the device id immediately; with no recorded device it calls the enrollment use case, which looks the device up by host name and tailnet tag and resumes it instead of minting a second key |
| after authorization, before readiness | nothing is destroyed; the record stays `provisioning` until a run writes `ready`, and the role name is a pure function of the host id, so re-authorizing reaches the same role and the same ownership claim |
| cancellation at any point | the job reports `canceled` (not `failed`), keeps the record `provisioning`, and destroys nothing |
| a teardown whose record has no resource id | refused permanently (`domain.AmbiguousOwnershipError`), no destroy attempted: an ambiguous owner is a human decision, never an automatic deletion |

The offline proofs live in `internal/workflows/recovery_test.go`:
`TestRecoveryAfterCrashBetweenCreateAndRecord`,
`TestRecoveryAfterCrashBetweenEnrollmentAndDeploy`,
`TestRecoveryAfterCrashBetweenAuthorizationAndReady`,
`TestTeardownRefusesAmbiguousOwnership`, and
`TestCancellationKeepsOwnershipAndDropsNoResource`. Each injects the failure at the
write and runs on the Temporal test clock, so no assertion depends on a wall-clock
sleep.

## 11. Major-version upgrade

### 11.1 PostgreSQL

| Change | Procedure |
|---|---|
| patch (`16.16` → `16.17`) | change `fleet.services.fleetProvision.postgresImage` to the new digest, switch, restart the container. The volume is untouched: PostgreSQL upgrades itself within a major |
| major (`16` → `17`) | **blocked** until Temporal documents 17 as tested. When it does: back up (§9.2), start a second container on a new volume with the new major, restore both databases into it, run the schema unit, and remove the old container and volume only after the rehearsal restore (§9.3) succeeded |

In-place `pg_upgrade` inside the existing volume is not the procedure here: it needs
the old and new binaries side by side, and a container that dies mid-upgrade leaves a
volume no unit can start. Dump and restore keeps the old volume as the rollback.

### 11.2 Temporal

1. Bump `temporalServerImage` **and** `temporalAdminToolsImage` to the same new
   version in one change. A mismatched pair applies a schema the server does not know,
   or starts a server against a schema nobody migrated.
2. `systemctl --user stop fleet-provision fleet-provision-worker`.
3. `systemctl --user restart fleet-provision-temporal-schema` — `setup-schema -v 0.0`
   and `update-schema` are no-ops on a current database and applied migrations are
   recorded in `schema_update`, so this is the migration step and it is safe to re-run.
4. `systemctl --user start fleet-provision-temporal`, then the API and the worker.
5. A downgrade is not supported by Temporal: a server refuses a schema newer than
   itself. The rollback is a restore (§9.4), which is why a backup belongs before
   every major bump.

## 12. What is still owner-gated and live-untested


The offline suite proves the request shapes, the policy document, the delivery file
mode and location, the one-use unwrap, the TTL bounds, and the refusal paths against
a fake in-process server and an `httptest` substitute. It contacts no OpenBao or
Vault server, mints no real AppRole, SecretID, wrapped token, or token, and reads no
real secret. These gates remain **BLOCKED** and require an owner-approved live run:

1. **Own-canary read**: a real host with a real AppRole reads
   `secret/data/hosts/<host>/canary` and receives the approved non-sensitive value.
2. **Another host's 403**: the same host reads another host's canary and is denied
   with 403 and no data, without printing any value even on a policy bug.
3. **One approved real API call from a Rex session**: a live host, reachable over the
   tailnet, makes one explicitly approved call through the provisioning API.
4. **Real rotation and reboot**: rotation against a real server, then a reboot that
   logs in again with the rotating SecretID.
5. **Bao published over tailnet HTTPS** while the backend stays on loopback: a
   homelab-side operator change, not a code change in this repository.

An operator still owns: creating the management token the service reads, approving
which bundles a profile may name, placing the bootstrap directory, and running the
host-side commands. The service never prints a SecretID, so a live acceptance run
must never need one in a terminal, a job record, or a ticket.

The deployed stack is offline-proven and live-unproven. These gates stay **BLOCKED**,
each for an owner decision:

6. **Docker PostgreSQL healthy check**: pull the three pinned images and read
   `systemctl --user status fleet-provision-postgres-healthy` on a host with Docker.
7. **A real workflow surviving a container and worker restart**: one creation through
   `systemctl --user restart fleet-provision-postgres` and
   `systemctl --user restart fleet-provision-worker`, then one instance and one device
   afterwards, checked against the cloud and the tailnet.
8. **The encrypted backup restored into a separate database**: §9.3 run for real, with
   a row count compared against the live database.
9. **`systemctl --user restart fleet-provision`** on the homelab with a job in flight,
   showing the same job state before and after.
10. **The host reboot**, showing the units return in order and the gates hold instead
    of racing.
11. **The Rex client proof after reboot**: one approved API call from a Rex session on
    a live host — gate 3 repeated after a reboot.

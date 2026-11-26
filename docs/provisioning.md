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
| ports | `internal/ports/ports.go` | the contracts the use cases drive and the values they pass; a leaf, so an adapter implements them without importing the use cases |
| ports | `internal/ports/codes.go` | the job failure-code vocabulary the workflows and adapters share |
| domain | `internal/domain/identity.go` | host identity, role and policy names, policy document, token and login-credential lifetimes |
| domain | `internal/domain/bundles.go` | the per-host bundle mapping from `config/profiles.yaml` |
| application | `internal/application/identity.go` | the authorization use case: policy, role, wrapped SecretID, out-of-band delivery |
| hostsession | `internal/hostsession/session.go` | the host-side use case: unwrap once, log in, renew, rotate |
| adapter | `internal/adapters/openbao/identity.go` | OpenBao HTTP mechanics, response wrapping, login and renewal |
| adapter | `internal/adapters/openbao/bootstrap.go` | the mode-0600 bootstrap file |
| wiring | `cmd/provision/main.go` | `newAuthorizer` builds the adapter for the worker |
| wiring | `nix/services/fleet-provision.nix` | the homelab systemd user units: PostgreSQL, Temporal, the API, and the worker |
| workflow | `internal/workflows/create_host.go` | the creation ladder, its cancellation outcome, and the milestone that keeps ownership |
| adapter | `internal/adapters/temporal/activities.go` | adoption of an allocation a crashed run already made, and the refusal to destroy an ambiguous one |
| adapter | `internal/adapters/ssm/deploy.go` | the profile deploy: resolve the revision on the host, activate it, grant the operator role, publish Serve, poll it |
| adapter | `internal/adapters/ssm/readback.go` | the readback that proves what landed, and is the only source of a recorded revision and Rex address |
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

Credential revocation (`RevokeCredentials` → `DeleteAppRole`, `DeletePolicy`) deletes
the role (which deletes every SecretID of the role and the claim) and then the
policy. It is idempotent. It does **not** invalidate a token that was already
issued: `RevokeTokens` does that, by accessor, and runs first in a teardown (§16).

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
such a policy, and `hostsession.SessionService` (`internal/hostsession/session.go`)
refuses a session whose reported TTL is zero,
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

Rotation (`hostsession.SessionService.Rotate` →
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
   host (`RevokeCredentials`), which removes role, claim, and policy, then authorize
   again.
   A claim conflict is a permanent refusal and never a retryable failure.
5. **Full teardown**: `DELETE /v1/hosts/<id>` runs the four cleanup steps in order —
   revoke the issued tokens, revoke the role (with every SecretID) and the policy,
   remove the tailnet device, destroy this host's Terraform state — and writes a
   sanitized tombstone (§13). A stolen credential is not repaired by a teardown:
   §16.1. The host's own files must be deleted on the host, which nothing here can
   do remotely once the instance is gone.

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
| **deploy** `StartToCloseTimeout` | 45 min | same — a real deploy took 22 min on 2026-11-09, so the 5-minute step bound does not cover it |
| **deploy** retries | 2 attempts, 30 s initial, ×2 backoff | same — a second attempt adopts the record a first one wrote instead of building again |
| **readback** `StartToCloseTimeout` | 10 min | same — a handful of control-plane queries, not a build |
| **readback** retries | 3 attempts, 10 s initial, ×2 backoff | same |
| milestone write | 30 s, 2 attempts | same |
| workflow execution timeout | 3 h | `internal/adapters/temporal/orchestrator.go` — the deploy may take 45 min twice, so a 45-minute execution bound would kill a healthy job |
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

## 10.4 The profile deploy and its readback

The `deploying` stage is two activities, not one. `DeployProfile` activates the
approved flake target on the host over SSM Run Command; `ReadBackProfile` then asks
the host what landed, and only its answer is recorded as the flake revision and Rex
address. A job that reaches `ready` has had both.

The deploy, in order (`internal/adapters/ssm/deploy.go`):

1. refuse a request with no instance id, no approved flake target, or a bad name —
   before any remote call. Every control-plane call is addressed by instance id;
   there is no other transport, so a request that cannot name one is refused rather
   than guessed at;
2. wait for the host's SSM agent (the same gate enrollment uses);
3. ask the host which commit `nix flake metadata` resolves the target to, so the
   recorded revision is what the host actually built;
4. activate the profile as the account, unless the host already records this exact
   revision as activated;
5. write the deployment record: `/var/lib/fleet-profile/<revision>` is a symlink
   pointing at the rex binary that revision installed. It is written straight after
   the switch, so a retry after a Serve failure adopts it instead of rebuilding;
6. `tailscale set --operator=<account>`, then enable and restart `rex-serve` through
   the account's own user manager (`systemctl --user -M <account>@.host`). Without
   the grant the Serve unit fails, which is the module's own documented step;
7. poll `rex-serve` to `active` with a bounded deadline and report the tailnet URL
   `tailscale serve status` publishes.

Every remote call is an argument array, and each element must be a bare word from a
fixed safe set. A value carrying shell syntax is refused rather than escaped, so no
argument can become a second command, a pipeline, or an expansion. No step handles a
credential: the flake comes from the host's own network identity, and the authority
is the control plane's.

The readback (`internal/adapters/ssm/readback.go`) checks five facts and believes
none of the deploy's report:

| Fact | What proves it |
|---|---|
| `rex_resolves_to_nix_store` | `rex` resolves into `/nix/store`, and it is the binary the record for the requested revision names. A store path is a content hash, so the revision lives in the record beside it, not inside it |
| `rex_user_unit_active` | `systemctl --user is-active rex` reports `active` |
| `tailscale_serve_maps_443_to_127.0.0.1:7297` | `tailscale serve status` publishes an HTTPS address whose proxy target is `127.0.0.1:7297` |
| `rex_config_links_present` | the three profile links (`init.lua`, `missions.lua`, `notify-ntfy.lua`) exist under `~/.config/rex` |
| `linger_enabled` | `loginctl show-user <account> --property=Linger` reports `Linger=yes` |

A failed fact is a `domain.ProfileNotReadyError` naming it, and it is non-retryable:
the control plane reached the host and the host answered wrong.

Two operator prerequisites the deploy does not invent:

- the approved `flake_ref` must be **fully qualified** and **revision-pinned**. The
  shipped `rex` profile carries
  `git+https://github.com/aviralmansingka/dotfiles?rev=<40-character sha>#homeConfigurations.remote-mumbai.activationPackage`:
  a `git+https` URL because the repository is public and the branch name contains a
  slash, the full commit id because a branch name can move between the review and
  the deploy, and a fragment because the host has to know which attribute to
  activate. The catalog's old `.#...` form resolves against a checkout, and a
  provisioned host has none, so a deploy refuses it and names the fix; a branch
  name, a short rev, or a missing fragment is refused the same way. **The operator
  must push the branch that carries the pinned commit** before a live deploy:
  until then the revision is not on the remote, and the host cannot fetch it.
  A `git+https` revision that is not reachable fails on the host at the
  `nix flake metadata` step, before anything is activated;
- the worker's SSM command timeout for the deploy is
  `ssm.DeployCommandTimeoutSeconds` (2700 s), not the enrollment command's 180 s: the
  control plane cancels a command that outlives the `TimeoutSeconds` it was sent
  with. `cmd/provision/worker.go` builds the deploy's runner from the same client
  configuration for exactly this reason. The host also needs `home-manager`, which
  the first deploy fetches with `nix run`.

The host records the revision it activated in `/var/lib/fleet-profile/<rev>`: one
symlink per activated revision, named by the full commit id and pointing at the
`rex` binary that revision installed (step 5 above). The record is written by the
host, not reported by the caller, and the readback checks the binary it names, so
the revision in a job record is the revision that landed.

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

### 12.1 Teardown gates

Deleting a host is proven offline and unproven live, exactly like creation. The
offline suite runs the real `DeleteHostWorkflow` against in-process adapters and
proves the order, the retry, the reporting, and the isolation; it revokes no real
token, removes no real device, and destroys no real instance. These gates stay
**BLOCKED**, each for an owner-approved live run:

12. **The live host is gone from AWS**: `aws ec2 describe-instances` for the
    instance id the tombstone keeps returns an empty `Reservations` list, and
    `aws ec2 describe-instances --filters Name=instance-state-name,Values=pending,running,stopping,stopped`
    in the region lists no fleet instance with the retired host's tags.
13. **Its Tailscale device is absent**: `tailscale status` on the operator machine
    and the admin console's device list both show no node with that hostname, and
    `GET /api/v2/tailnet/-/devices` returns no device carrying the retired id.
14. **Its Bao accessors are revoked and old credentials fail**: the accessor list
    from §14.3 contains nothing carrying the retired host's policy, a session token
    captured before the teardown answers 403 to `bao token lookup`, and an AppRole
    login with a SecretID minted before the teardown fails. A token that still works
    is a failed gate, not a warning.
15. **Two consecutive delete runs leave no leftover**: run the teardown, then run it
    again for the same host. The second run starts no new operation, reports
    `deleted`, and §14's three checks pass after both runs. A second run that starts
    a job, or a leftover in any of the three systems, fails the gate.

## 13. The full create-to-delete exercise

This is the whole lifecycle on one host, in the order an operator runs it. Every
step is a command a human types; none of them prints a credential. The steps that
need a live cloud, tailnet, or Bao server are the gates in §12; the exercise is
written so the same commands are used for the offline rehearsal and the live run,
and the offline run stops before each gate.

Choose a name and keep it for the whole exercise: `canary-07` here.

```bash
# 0. The API listens on loopback and needs a bearer token. The token is read from
#    stdin, so it never becomes an argv word or a shell history entry.
export FLEET_API=https://127.0.0.1:8443
read -rs FLEET_TOKEN; export FLEET_TOKEN
```

```bash
# 1. Create. The Idempotency-Key makes a retried POST return the same host and job
#    instead of creating a second one.
curl -sS -X POST "$FLEET_API/v1/hosts" \
  -H "Authorization: Bearer $FLEET_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: exercise-2026-11-25-canary-07" \
  -d '{"name":"canary-07","profile":"rex","region":"ap-south-1","size":"standard",
       "secret_bundles":["canary"]}'
# → 202 {"host_id":"host-7f3c1d9a4b2e6f8c0d1a3b5e","job_id":"create-host-7f3c1d9a4b2e6f8c0d1a3b5e"}

export HOST_ID=host-7f3c1d9a4b2e6f8c0d1a3b5e
export CREATE_JOB=create-host-7f3c1d9a4b2e6f8c0d1a3b5e
```

```bash
# 2. Follow the job. The stage walks queued → creating → enrolling → deploying →
#    authorizing → ready. A failed stage is a terminal `failed` with a sanitized
#    message: nothing in it is a credential.
while sleep 10; do
  body=$(curl -sS "$FLEET_API/v1/jobs/$CREATE_JOB" -H "Authorization: Bearer $FLEET_TOKEN")
  echo "$body" | jq -r '.state + " " + .stage'
  echo "$body" | jq -e '.state == "ready" or .state == "failed"' >/dev/null && break
done
```

```bash
# 3. Confirm the identity the host actually got. The record names the resource and
#    the device; neither is a credential. §14 has the live checks.
curl -sS "$FLEET_API/v1/hosts/$HOST_ID" -H "Authorization: Bearer $FLEET_TOKEN" |
  jq '{host_id, state, resource_id, device_id, profile, region, size, ready}'
```

```bash
# 4. Delete. This starts one durable teardown. The same call twice answers with the
#    same job; it never starts a second teardown.
curl -sS -X DELETE "$FLEET_API/v1/hosts/$HOST_ID" \
  -H "Authorization: Bearer $FLEET_TOKEN"
# → 202 {"host_id":"host-7f3c1d9a4b2e6f8c0d1a3b5e","job_id":"delete-host-7f3c1d9a4b2e6f8c0d1a3b5e"}

export DELETE_JOB=delete-host-7f3c1d9a4b2e6f8c0d1a3b5e
```

```bash
# 5. Follow the teardown. The stage walks revoking_access → removing_device →
#    destroying → deleted. A failed teardown names its unfinished steps in
#    `incomplete_cleanup`.
while sleep 10; do
  body=$(curl -sS "$FLEET_API/v1/jobs/$DELETE_JOB" -H "Authorization: Bearer $FLEET_TOKEN")
  echo "$body" | jq -c '{state, stage, incomplete_cleanup}'
  echo "$body" | jq -e '.state == "deleted" or .state == "failed"' >/dev/null && break
done
```

A `failed` teardown is not a silent one. `error.message` names the steps that did
not finish, and the host record keeps the same list in `pending_cleanup`, so an
operator who never retries still has the answer:

```bash
curl -sS "$FLEET_API/v1/jobs/$DELETE_JOB" -H "Authorization: Bearer $FLEET_TOKEN" |
  jq '.error'
# → {"code":"teardown_incomplete","retryable":true,
#    "message":"teardown did not finish; incomplete cleanup: tailscale_device (...)"}
```

```bash
# 6. Retry the unfinished steps. Every cleanup step is idempotent, so the retry
#    finishes what is left and changes nothing that already succeeded. The retry
#    gets a job id of its own, because Temporal refuses to re-run a closed
#    execution under the same id.
curl -sS -X DELETE "$FLEET_API/v1/hosts/$HOST_ID" \
  -H "Authorization: Bearer $FLEET_TOKEN"
# → 202 {"host_id":"host-7f3c1d9a4b2e6f8c0d1a3b5e","job_id":"delete-host-7f3c1d9a4b2e6f8c0d1a3b5e-r2"}
```

```bash
# 7. The tombstone. The record keeps its identifiers and its approved shape, and
#    drops every field that described a machine which no longer exists: no private
#    address, no Rex URL, no flake revision, no tags.
curl -sS "$FLEET_API/v1/hosts/$HOST_ID" -H "Authorization: Bearer $FLEET_TOKEN" |
  jq '{state, tombstone, resource_id, device_id, private_address, rex_url, flake_revision, tags}'
# → {"state":"deleted",
#    "tombstone":{"deleted_at":"2026-11-25T15:04:05Z",
#                 "released":["openbao_tokens","openbao_credentials",
#                             "tailscale_device","terraform_resources"],
#                 "token_accessors_revoked":2,
#                 "policy":"identifiers, cleanup outcomes, and cost-relevant shape only; ..."},
#    "resource_id":"i-0123456789abcdef0","device_id":"n1234CNTRL",
#    "private_address":"","rex_url":"","flake_revision":""}
#    `tags` is absent, not empty: the map was cleared, so the field is omitted.
```

```bash
# 8. A repeat delete is a read. It answers with the job that did the work, starts
#    no operation, and changes no record.
curl -sS -X DELETE "$FLEET_API/v1/hosts/$HOST_ID" -H "Authorization: Bearer $FLEET_TOKEN"
# → 202 {"host_id":"host-7f3c1d9a4b2e6f8c0d1a3b5e","job_id":"delete-host-7f3c1d9a4b2e6f8c0d1a3b5e"}
```

Step 8 is also the leave-no-leftover sweep: after it, the three checks in §14 must
all pass. Running §14 twice, once after step 5 or 6 and once after step 8, is gate
15.

## 14. Operator verification after a teardown

The record is the service's claim. The three systems are the evidence. Each check
below is read-only and prints identifiers, never credentials.

### 14.1 The AWS instance is gone

```bash
# The instance id is kept on the record after the teardown, so this needs no other
# lookup.
INSTANCE=$(curl -sS "$FLEET_API/v1/hosts/$HOST_ID" -H "Authorization: Bearer $FLEET_TOKEN" |
  jq -r '.resource_id')

aws ec2 describe-instances --region ap-south-1 --instance-ids "$INSTANCE" \
  --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output table
# A destroyed instance answers: An error occurred (InvalidInstanceID.NotFound).
# That error is the pass condition; an instance in any state is a failed teardown.

# The sweep that catches an orphan created by a retry: no fleet machine should carry
# the retired name.
aws ec2 describe-instances --region ap-south-1 \
  --filters 'Name=tag:Name,Values=fleet-canary-07' \
  --query 'Reservations[].Instances[].InstanceId' --output text
# → empty
```

```bash
# This host's own state object must be empty or absent. It is one object per host,
# keyed by name (fleet-hosts/<name>/terraform.tfstate), and a destroy cannot reach a
# sibling's.
aws s3api head-object --bucket "$FLEET_STATE_BUCKET" \
  --key fleet-hosts/canary-07/terraform.tfstate 2>&1 | head -3
# → 404 Not Found, or: {"ContentLength": <small>, ...} with no instance_id output.
```

### 14.2 The Tailscale device is absent

```bash
DEVICE=$(curl -sS "$FLEET_API/v1/hosts/$HOST_ID" -H "Authorization: Bearer $FLEET_TOKEN" |
  jq -r '.device_id')

# Device ids are not secret. This call is the same one the adapter makes.
curl -sS -H "Authorization: Bearer $TS_API_TOKEN" \
  "https://api.tailscale.com/api/v2/device/$DEVICE" | jq '.'
# → 404 Not Found

# The operator's own view of the tailnet.
tailscale status | grep -i canary-07 || echo "no such node"

# And the sweep, which also catches a node that rejoined under a new id.
curl -sS -H "Authorization: Bearer $TS_API_TOKEN" \
  "https://api.tailscale.com/api/v2/tailnet/-/devices" |
  jq --arg name canary-07 '[.devices[] | select((.name|startswith($name)) or .hostname == $name)]'
# → []
```

A device that is still present is an incomplete teardown. The job reports it as
the `tailscale_device` cleanup step, and the two usual causes are an OAuth client
without device-write scope (403, not 404) and a host record with no recorded device
id (the `ambiguous ownership` refusal, which needs the admin console).

### 14.3 The Bao accessors are revoked

OpenBao has no endpoint that lists "the tokens of a role". Revocation enumerates
accessors and attributes each one by policy, so the check is the same enumeration:

```bash
# Requires `sudo` on auth/token/accessors: the management token the service reads
# already carries it, because revocation itself calls this endpoint.
bao list -format=json auth/token/accessors | jq -r '.[]' >/tmp/fleet-accessors

# Which of them carry the retired host's policy? Both names are derived from the
# host id, by the same rule: fleet-host-<hostID> and fleet-policy-<hostID>.
POLICY="fleet-policy-$HOST_ID"
while read -r accessor; do
  policies=$(bao write -format=json auth/token/lookup-accessor accessor="$accessor" |
    jq -r '.data.policies | join(" ")')
  case "$policies" in
    *"$POLICY"*) echo "STILL LIVE: $accessor carries $POLICY" ;;
  esac
done </tmp/fleet-accessors
rm -f /tmp/fleet-accessors
# → no output. Any "STILL LIVE" line is a failed teardown, and the accessor must be
#   revoked by hand: bao write auth/token/revoke-accessor accessor=<id>
```

The role and the policy must be gone as well:

```bash
bao read "auth/approle/role/fleet-host-$HOST_ID" 2>&1 | head -2
# → No value found at auth/approle/role/fleet-host-host-7f3c1d9a4b2e6f8c0d1a3b5e
bao policy read "fleet-policy-$HOST_ID" 2>&1 | head -2
# → No policy named fleet-policy-host-7f3c1d9a4b2e6f8c0d1a3b5e
```

And the two things a compromised host would try:

```bash
# An old session token must be dead. A captured token is a secret: read it from a
# file with mode 0600 and never put it on a command line.
bao token lookup -address="$BAO_ADDR" "$(cat ~/.fleet-old-token)"
# → Code: 403. Errors: permission denied

# An old SecretID must not log in.
bao write -format=json auth/approle/login \
  role_id="$OLD_ROLE_ID" secret_id="$(cat ~/.fleet-old-secret-id)" 2>&1 | jq -r '.errors[0]'
# → invalid role or secret id
```

## 15. Costs

The only recurring cost a host adds is the EC2 instance and its EBS volume. Both
come from the approved catalog, so the price of a profile is a property of the
catalog, not of a request: `config/profiles.yaml` pins `instance_type` and `disk_gb`
per size, and `internal/config` refuses a profiles file that disagrees with the
flake.

Order of magnitude for the one approved shape, `standard` = `t3.medium` with 40 GiB
gp3, in `ap-south-1` at the time of writing, on-demand and before tax:

| Item | Rate | Monthly (730 h) |
| --- | --- | --- |
| `t3.medium` on-demand compute | about $0.0456/hour | about $33 |
| 40 GiB gp3 storage | about $0.0912/GB-month | about $3.65 |
| Public IPv4 (default VPC assignment) | about $0.005/hour | about $3.65 |
| Data transfer out | first 100 GB/month free, then about $0.12/GB | variable |

Treat these as planning numbers, not a quote: the rates are regional, they change,
and a Savings Plan or a spot price would change them again. The point of writing them
down is the multiplier the service controls — an idle fleet of ten `standard` hosts
is roughly $400/month, and a teardown that half-finishes is money that keeps being
spent. That is why the destroy step runs even when an earlier cleanup step failed
(§13 step 5) and why gate 12 exists.

Costs the service does not add: Terraform state in S3 (kilobytes, in an existing
bucket), SSM `SendCommand` (free tier for the fleet's call volume), the Tailscale
plan already in use, and OpenBao on the homelab. The token table is small: every host
holds one session token and one rotating SecretID at a time.

```bash
# The only reliable cost check is the bill. Group by the tag the provider writes.
aws ce get-cost-and-usage --time-period Start=2026-11-01,End=2026-12-01 \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=TAG,Key=owner Type=DIMENSION,Key=INSTANCE_TYPE
```

A host whose tombstone says `released` includes `terraform_resources` should not
appear in a bill for the following month. If it does, the destroy ran against a
different account or region than the one the bill covers.

## 16. Credential rotation, and what revocation cannot do

Rotation is the routine case and teardown is the terminal one; they use different
calls and they answer different questions.

| Operation | Invalidates | Does not invalidate |
| --- | --- | --- |
| `RotateSecretID` (§6) | the previous SecretID, by accessor | the session token already issued, until it expires |
| `RevokeCredentials` | the AppRole, every SecretID, the ownership claim, and the policy | **every token already issued to that role** |
| `RevokeTokens` | every issued token whose policy is this host's | nothing else — the role can still log in until `RevokeCredentials` runs |
| Teardown (§13) | all of the above, in that order | a key that has already left the host |

**Revoking an AppRole does not invalidate a token it already issued.** OpenBao keeps
an issued token alive until its TTL expires; deleting the role it came from removes
the ability to log in again and leaves the existing session working. This is why the
teardown has two credential steps and why `RevokeTokens` runs first: it is the only
step that cuts off a session that already exists. The offline suite pins both halves
— `TestRevokeTokensInvalidatesAlreadyIssuedTokens` and
`TestRevokeCredentialsDoesNotInvalidateIssuedTokens`.

The routine rotation schedule is in §6: rotate every 6 hours, keep the previous
credential usable for a 30-minute grace window, and always rotate before the 12-hour
expiry.

Client tokens (`config` → token digests, mode 0600) are separate and are rotated by
hand: issue a new token, put its SHA-256 digest in the token file, restart the API,
then remove the old digest. `provision token-digest` reads a token from stdin and
prints the digest, so the plaintext token never becomes an argument.

### 16.1 What revocation cannot do

Revocation invalidates a credential **inside the systems that issued it**. It cannot
erase a copy of that credential that has already left the host.

If a host was compromised, assume every secret it could read was copied: the session
token, the SecretID it held, the flap bundle values behind its policy, the tailscale
node key, and anything else that passed through its memory or disk. Deleting the
AppRole and revoking the accessors makes the **copy** useless — a token that is
revoked cannot be renewed and a SecretID for a deleted role cannot log in — and it
does not retroactively protect a value the attacker has already used or will use for
a different system.

So the rule is: **revocation cannot erase a key that was already stolen from a
compromised host, and every key that host held must be rotated upstream.** "Upstream"
means the system that owns the value, not this service:

1. Rotate, do not just revoke: mint a new value at the source, install it, and only
   then invalidate the old one.
2. Rotate every credential the host could reach, not only the ones with the host's
   own policy name. A canary bundle shared with a profile is shared with every host
   in that profile.
3. Rotate outside the fleet too: a personal SSH key, a GitHub token, a cloud
   credential, a password manager entry. Anything the host could read is in scope.
4. Check the audit trail before trusting the rotation window: `bao audit list`, the
   SSM command history for that instance id, and the provider's CloudTrail events for
   the instance's role. A read of another host's canary is a policy bug worth finding.
5. Then run the teardown. Deleting the host is containment, not cleanup: it stops the
   bleeding and it does not undo a read.

The backup and restore procedure in §9 is the other half of this section: an
encrypted dump holds the inventory, the job records, and the token digests, so a
restore must land on a host whose own credentials were rotated first. A restored
token file that predates a rotation re-enables digests the operator thought were
retired.

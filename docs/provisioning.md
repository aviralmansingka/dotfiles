# Fleet provisioning: per-host OpenBao identity

This document describes how a provisioned fleet host gets a restricted OpenBao
identity. It covers the implemented code paths, the policy a host receives, the
token and SecretID lifetimes, the reboot and rotation procedures, and what an
operator still has to do by hand.

The implementation lives in `ops/provision`:

| Layer | File | Responsibility |
|---|---|---|
| domain | `internal/domain/identity.go` | host identity, role and policy names, policy document, token and login-credential lifetimes |
| domain | `internal/domain/bundles.go` | the per-host bundle mapping from `config/profiles.yaml` |
| application | `internal/application/identity.go` | the authorization use case: policy, role, wrapped SecretID, out-of-band delivery |
| application | `internal/application/session.go` | the host-side use case: unwrap once, log in, renew, rotate |
| adapter | `internal/adapters/openbao/identity.go` | OpenBao HTTP mechanics, response wrapping, login and renewal |
| adapter | `internal/adapters/openbao/bootstrap.go` | the mode-0600 bootstrap file |
| wiring | `cmd/provision/main.go` | `newAuthorizer` builds the adapter for the worker |

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

The exact host command is owner-gated (see §7); the file must be deleted after use.
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

## 7. What is still owner-gated and live-untested

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

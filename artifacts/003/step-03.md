# S03 — live validation of the fleet provisioner (step 3)

All times UTC, 2026-11-27 unless stated. No secret values appear here: token and
keys are never printed, only read on the host for the length of one call.

## Commits landed in this step

| commit | subject |
| --- | --- |
| `b005af9a` | fix(provision): accept a flake reference query in the ssm argv safe set |
| `4d6140e9` | fix(provision): trim the tailnet key and run the bootstrap under POSIX sh |
| `c3e88fc7` | fix(provision): restore the nix feature set after the installer rewrites it |
| `7418dbb3` | fix(provision): resolve the flake target without its attribute fragment |

## Defects found and closed, in the order the live runs exposed them

1. **`?` refused by the ssm argv safe set** (`b005af9a`). The comment allowed a
   query byte, the constant did not. `safeArgBytes` now ends `...#?`; `?rev=` and
   `#` are accepted, and `;`, `&&`, `` ` ``, `$(`, and newline are still refused.
2. **The Nix installer rewrites `/etc/nix/nix.conf`** (`c3e88fc7`). cloud-init
   wrote `experimental-features = nix-command flakes` with `write_files`, then
   `runcmd` ran the upstream installer, which rewrites the file with only
   `build-users-group`. Deploy failed with `experimental Nix feature
   'nix-command' is disabled`. Bootstrap now re-asserts the setting after the
   installer behind a `grep -q` guard and proves it with `nix eval --expr 1`
   (no network, no flake, no store).
3. **A `#fragment` handed to `nix flake metadata`** (`7418dbb3`). The deploy
   passed the whole catalog reference to the resolver; `nix flake metadata`
   resolves a flake and refuses a fragment: `unexpected fragment
   'homeConfigurations.remote-mumbai.activationPackage' in flake reference`. The
   resolver now receives `flakeTarget(ref)` (the reference before `#`) and the
   activation keeps the whole reference, because that is the command that runs
   the attribute. Regression test: the metadata argv carries no `#` and names
   the target; the activation argv still carries the attribute.

Each fix has a regression test proven to fail when the fix is reverted
(`git stash push -- <file>`, run the single test, restore).

## Offline proof

- `go test ./internal/adapters/ssm -count=1` → `ok`
- `go test ./... -count=1` → `ok` (16 packages)
- `go test -race ./... -count=1` → `ok` (16 packages)
- Regression proofs: the metadata-fragment test fails with the old resolver
  (`the metadata argv carries a fragment in "github:.../dotfiles/<rev>#homeConfigurations..."`),
  and the cloud-init feature test fails without the restore (`cloud-init is
  missing ">> /etc/nix/nix.conf"`).

## Deployment

- `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o /tmp/fleet-provision-linux ./cmd/provision` → exit 0
- installed to `homelab:~/.local/bin/fleet-provision`, `chmod 0755`,
  sha256 `e58b6fd380ef055824204c37c98d554f438c91cdf0463ce290d4cbdaaa458ace`
- `systemctl --user restart fleet-provision.service fleet-provision-worker.service`
  → both `active`, `NRestarts=0`
- `GET http://127.0.0.1:8080/healthz` → **200** `{"status":"ok"}`

## Live runs

| POST (UTC) | idempotency key | HTTP | host id | job id | result |
| --- | --- | --- | --- | --- | --- |
| 18:33:01 | `fleet-s03-fix3-20261126T183259Z` | 202 | `host-9cfc9271b1fb8fd87fda5f31` | `create-host-9cfc9271b1fb8fd87fda5f31` | failed at `DeployProfile`, nix feature disabled |
| 06:58:35 | `fleet-s03-fix3d-20261127T065833Z` | 202 | `host-25ece6795ab27261ff26b1d4` | `create-host-25ece6795ab27261ff26b1d4` | failed at `DeployProfile`, unexpected fragment |
| 07:01:06 | `fleet-s03-frag-20261127T070106Z` | 202 | `host-89e209ad5ac401a170adf89c` | `create-host-89e209ad5ac401a170adf89c` | failed at `DeployProfile`, flake rev not on the remote |

Last run's window: observed `Disconnected` at 07:00:39, POST 07:01:06, terminal
07:02:14, window ended 07:02:38. Workflow run `01a21bce-d19f-7ce8-adf1-ee8cf35e613e`.
Poll states: `07:01:14 in_progress/deploying`, `07:01:29 in_progress/deploying`,
`07:01:44 in_progress/deploying`, `07:01:59 in_progress/deploying`,
`07:02:14 failed`.

**Exact error of the last run** (`state=failed`, `stage=queued`, activity
`DeployProfile`, attempt 2):

```
resolve the flake revision did not succeed (status "Failed", exit 1):
fatal: remote error: upload-pack: not our ref [redacted]
error: … while fetching the input 'git+https://github.com/aviralmansing…
```

So the fragment fix did its job — the resolver ran, `nix flake metadata` accepted
the reference — and the failure moved to the fetch: the commit the catalog pins
is not available from the remote repository. That is a catalog truth, not a code
defect: the deploy records the revision it activates, so the pin must be a
published commit.

## Duty A — does `host-89e209ad5ac401a170adf89c` point at an instance?

- `GET /v1/hosts/host-89e209ad5ac401a170adf89c` → `resource_id=None`,
  `state=provisioning`, `name=fleet-s02-20261126t1015`
  (`resource_id= None state= provisioning name= fleet-s02-20261126t1015`).
- `head-object` on `aviral-dotfiles-terraform-state` key
  `fleet-hosts/fleet-s02-20261126t1015/terraform.tfstate` → `LastModified
  2026-11-26T10:15:53+00:00`, so the key exists.
- One instance carries that tag: `i-07d6ea915e97c4e7e` (`fleet-state` =
  `fleet-hosts/fleet-s02-20261126t1015/terraform.tfstate`).
- Answer: **the record names no resource**; the run failed before an instance
  existed. The state key it would have used is the one the earlier adopted host
  already owns, because the key is derived from the host *name*.

## State left behind

`host-89e209ad5ac401a170adf89c` is stuck at `state=provisioning` with no
resource. It is read-only evidence for the S04 teardown step, which must not
leave it pointing at nothing.

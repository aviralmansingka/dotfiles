---
name: mm
description: Machine-manager dev cycle: tests, generate, build (debug/release), OCI image build/load/push, deploy, migrations. Use when user types /mm or asks how to test/build/push/deploy machine-manager.
allowed-tools: Bash, Read
---

# Machine-Manager Dev Cycle

Reference for the `go/machine-manager` service. Two build systems coexist —
**Go toolchain** (fast iteration) and **Bazel** (CI, hermetic, OCI images).
All paths below are relative to the repo root unless noted.

## 0. One-time setup

| Action | Command |
|---|---|
| Start local Postgres | `inv services -d` |
| Apply River job migrations | `go install github.com/riverqueue/river/cmd/river@latest && river migrate-up --database-url "postgresql://postgres:f850b7013a703351b403b10beed24df2@localhost:5433/machinemanager?sslmode=disable"` |
| Generate embedded assets (audit binary, UI dist, sqlc) | `cd go/machine-manager && make generate` |

`make generate` runs three steps — invoke individually if only one changed:
`make generate-audit`, `make generate-ui`, `make generate-sqlc`.

## 1. Tests & lint

| Action | Command | Notes |
|---|---|---|
| Run all Go tests | `cd go/machine-manager && make test` | Uses `gotestsum`, `-count=1`, `-parallel=10`. |
| Run plain `go test` | `cd go/machine-manager && go test ./...` | |
| Update snapshot tests | `cd go/machine-manager && UPDATE_SNAPS=true go test ./...` | |
| Lint (Go, all of `go/`) | `cd go && make lint` | Pins golangci-lint v2.10.1. **Required before commit.** |
| Bazel test (targeted) | `bazel test --config=remote //go/machine-manager:machine-manager_test` | Use `--config=remote` first; fall back to local if cache miss. |
| Bazel test workspace-wide | `bazel test --config=remote //go/machine-manager/...` | |

After ANY Go change, also run `cd go && make lint` (per `go/AGENTS.md`).

## 2. Build (Go toolchain)

Build from repo root or `go/`. The `ui` build tag controls whether the
Svelte UI is embedded; without it `ui_embed_stub.go` is used.

| Variant | Command |
|---|---|
| Debug (default, full symbols, suitable for `dlv`) | `cd go && go build -gcflags="all=-N -l" -o ./bin/machine-manager ./machine-manager` |
| Standard | `cd go && go build -o ./bin/machine-manager ./machine-manager` |
| With UI embedded | `cd go && go build -tags ui -o ./bin/machine-manager ./machine-manager` |
| Release / stripped | `cd go && go build -tags ui -trimpath -ldflags="-s -w" -o ./bin/machine-manager ./machine-manager` |
| Build `mmctl` CLI | `cd go/machine-manager && make mmctl` (output: `bin/mmctl`) |

`-s -w` strip the symbol and DWARF tables (~30% size reduction). `-trimpath`
removes local filesystem paths from the binary for reproducibility.

## 3. Build (Bazel)

| Action | Command |
|---|---|
| Build server binary | `bazel build --config=remote //go/machine-manager:machine-manager` |
| Build server `go_library` only | `bazel build --config=remote //go/machine-manager:machine-manager_lib` |
| Build OCI image (no push) | `bazel build --config=remote //go/machine-manager:machine_manager_oci_image` |
| Load OCI image into local Docker | `bazel run //go/machine-manager:machine_manager_oci_tarball` |

Bazel always builds with `gotags = ["audit_binary", "ui"]` (see
`go/machine-manager/BUILD.bazel`), so the embedded UI and audit binary are
always included. Base image is `@distroless_static` (Go static binary, CA
certs only). For Bazel issues, see the `bazel-recovery` and
`bazel-keep-in-sync` skills.

## 4. OCI image: tag, push, deploy

The image is content-addressed; the tag is human-readable only.
Stamped builds use the short git SHA (`{{SHORT_SHA}}-bazel`); unstamped
builds tag `dev-bazel`.

| Action | Command |
|---|---|
| Push to **prod** ECR | `bazel run --config=ci --config=x86_64 --stamp //tools:bazel_push -- --targets machine_manager_oci` |
| Push to **dev** ECR | `bazel run --config=ci --config=x86_64 --stamp //tools:bazel_push -- --dev --targets machine_manager_oci` |
| Push **all** services in parallel (CI pattern) | `bazel run --config=ci --config=x86_64 --stamp //tools:bazel_push -- --parallel -o image-refs.values.yaml --json image-refs.json` |
| List discoverable push targets | `bazel run //tools:bazel_push -- --list` |
| Deploy machine-manager to dev cluster | `inv k-deploy --cluster dev-us-east-1 --chart machine-manager --build-images` |

`--build-images` rebuilds the image as part of deploy. Without it, deploy
uses the most recently pushed digest. **machine-manager is restricted to
the `dev-us-east-1` cluster** (see `go/machine-manager/README.md`).

The push target writes `repo@sha256:digest` references that the Helm chart
consumes — the digest, not the tag, is the deploy unit.

## 5. Database & migrations

| Action | Command |
|---|---|
| Open local psql shell | `cd go/machine-manager && ./scripts/psql` |
| Roll back last migration on dev cluster DB | `cd go/machine-manager && ./scripts/migrate --env dev down 1` |
| Migrate down (server-side) | `./go/bin/machine-manager migrate-down` (refuses in `prod`) |

Migrations apply automatically on server startup. Rolling back is for the
case where a feature branch with a migration was tested on dev but not
merged, leaving the dev DB ahead of `main`.

## 6. Pre-commit

After modifying any files, run pre-commit hooks:

```
uv run pre-commit run --files $(git diff --name-only origin/main...)
```

## Quick decision guide

- **Just want fast feedback while editing Go?** → `make test` + `make lint`.
- **Need to run the binary locally with the UI?** → `make generate-ui` then
  `go build -tags ui ...`.
- **CI failing on Bazel only?** → `bazel test --config=remote //go/machine-manager:machine-manager_test`.
- **Testing a UI/server change end-to-end on real hardware?** →
  `inv k-deploy --cluster dev-us-east-1 --chart machine-manager --build-images`.
- **Just want the image in local Docker to inspect it?** →
  `bazel run //go/machine-manager:machine_manager_oci_tarball`, then
  `docker run <repo>:latest`.

## Related skills

- `bazel-verify` — choosing remote vs. local execution and target scope.
- `bazel-recovery` — when Bazel hangs on a stale lock.
- `bazel-keep-in-sync` — after adding/moving Go files, run Gazelle.
- `modal-objlookup` — debugging Modal entities (`wo-`, `cu-`, etc.) that
  machine-manager produces.

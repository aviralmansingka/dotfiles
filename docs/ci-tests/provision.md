# provision — CI checks

## Purpose

The fleet provisioner uses Go. It configures fleet hosts through AWS SSM,
Tailscale, and OpenBao. This page documents the offline CI suite for the
provisioner. The suite shows that the Go code compiles, passes its tests, and
stays formatted. The suite uses no network and no cloud credentials.

## Overview

The suite is one entry: `scripts/test-provision.sh`. The CI changes job
discovers it through `git ls-files`. The script declares its paths in a
`# Paths:` header, so a change under `ops/provision/**`, to this page, or to
the script starts the `scripts-tests` job.

The script runs seven commands. It runs all of them from `ops/provision`.
Before the first command, two guards stop the script.

## What the suite covers

The suite runs these commands, in this sequence:

    go build ./...
    gofmt -l .
    go vet ./...
    go test -count=1 ./...
    go test -race -count=1 ./...
    go mod tidy -diff
    go build -tags=integration ./...

One line per command tells you the result. The line shows `PASS` or `FAIL`
and the command. When a command fails, the script writes the command output
below the line, writes a summary line, and stops. The exit code is then 1.
When all seven commands pass, the exit code is 0.

- `go build ./...` compiles every package.
- `gofmt -l .` lists unformatted files. The step fails when the list is not
  empty. To repair the tree, run `gofmt -w .`.
- `go vet ./...` runs the Go static checks.
- `go test -count=1 ./...` runs the unit tests. `-count=1` turns off the test
  result cache, so a second run gives the same work.
- `go test -race -count=1 ./...` runs the unit tests again with the race
  detector. This step needs a C compiler, because the race detector uses cgo.
- `go mod tidy -diff` shows module file drift. The step fails when
  `go.mod` or `go.sum` must change. To repair the tree, run `go mod tidy`.
- `go build -tags=integration ./...` compiles the live harness with the
  `integration` build tag. The step never runs that harness, so it makes no
  cloud call.

## The two guards

The script stops before the first command in two conditions:

| Guard | Condition | Result |
|---|---|---|
| `PROVISION_LIVE_AWS` | set and not empty | exit 1 |
| `AWS_PROFILE` | set and not empty | exit 1 |

`PROVISION_LIVE_AWS` turns on live AWS work. `AWS_PROFILE` selects an AWS
account. Automated CI must never create a cloud resource. The guard line
names the variable and tells you to unset it.

## What the suite excludes

The suite excludes these surfaces on purpose:

- Terraform. The Terraform files under `ops/provision/terraform` need
  providers and a plan. Their offline checks stay in
  `scripts/test-terraform.sh`.
- Docker. The suite builds no image.
- AWS SSM. The suite sends no command to a host.
- Tailscale. The suite mints no key and reads no device list.
- OpenBao. The suite writes no secret and no identity.
- Nix. The suite evaluates no flake.

The live harness is compiled, never run. Compilation catches a broken
signature in the harness. A run would need the live hosts.

## How to run

Run the script from the repository root:

    ./scripts/test-provision.sh

To see only the exit code:

    ./scripts/test-provision.sh > /dev/null; echo $?

Run one command by hand from `ops/provision`, for example:

    cd ops/provision && go test -count=1 ./...

A first run needs the module cache. Run `go mod download` in
`ops/provision` one time on a new machine. CI does this with the setup-go
cache.

CI runs the entry with `timeout 120`. Do not set `PROVISION_LIVE_AWS` or
`AWS_PROFILE` in the job environment.

## Runtime and SLA

Measured on an Apple Silicon macOS host, with a warm Go build cache:

    real 0m8.5s (first run), real 0m8.0s (second run)

The race step holds most of the time. The SLA for one entry is 30–60 s. The
script stays below 10 s warm. A cold module cache adds the time of
`go mod download`.

## Coverage result

The script covers the full Go module: `cmd/provision`, `internal/adapters`
(http, idgen, openbao, ssm, store, tailscale, temporal, terraform, tokenstore),
`internal/application`, `internal/config`, `internal/domain`,
`internal/hostsession`, `internal/ports`, `internal/provider`,
`internal/testsupport`, `internal/token`, and `internal/workflows`. `go build ./...` and `go vet ./...` read every package,
so a new package joins the suite with no edit to the script.

The suite gives no behavior coverage of its own. The unit tests in the module
own that; the suite runs them twice, once with the race detector.

## Known gaps

- The suite does not run the Terraform files. A change to
  `ops/provision/terraform` gets no check here.
- The suite does not evaluate the Nix code that the provisioner deploys. A
  Nix evaluation job would need the Nix store and the flake input downloads.
  That work is not offline, so this suite leaves it out.
- The suite does not prove that a deploy works. The live harness needs the
  fleet hosts, AWS, SSM, Tailscale, and OpenBao. Run it by hand on a test
  host.
- The script runs the seven steps in sequence, not in parallel. It stops at
  the first failure, so a later step can hide a second defect. Run the
  commands by hand to see all defects in one pass.
- The `scripts-tests` job must download the provisioner modules before the
  entry runs. `go build ./...` fails on a fresh runner when the module cache
  is empty. The owner of the workflow must add a download step for
  `ops/provision`, as the job already does for `go/mission` and
  `go/quicknote`. The toolchain is correct: `go/mission/go.mod` and
  `ops/provision/go.mod` both name Go 1.26.0.

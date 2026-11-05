# just-build — CI test suite

## Purpose

This suite keeps the root `justfile` honest. The justfile is the one-command
build for the two programs whose source lives in this repository: `mission`
(`go/mission`) and `rataflow-view` (the `rataflow` crate). The suite locks
that list, the source path each recipe names, and the rule that a build of
this repo never installs from a registry.

## Overview

`just build` compiles both binaries into their gitignored build directories
and moves them into `BIN_DIR` (default `~/.local/bin`). Mission `just-build`
added it because `mission` was built by `scripts/install-missions`, which no
installer calls, and `rataflow-view` could only be produced by
`cargo install` — which writes `~/.cargo/bin` and needs the network.
`install.sh` still owns the installer path; the justfile owns the builder
path.

## What the suite covers

- **Justfile parses.** Recipes, their dependencies, and their command lines
  are read the way `just` reads the file: an unindented `name: deps` header,
  indented body, `x := y` assignments, `#` comments.
- **Inventory matches the tree.** The suite re-derives the in-repo binaries
  from source facts — `go/*/cmd/*/main.go` and any `*/Cargo.toml` with
  `src/main.rs` — and compares them with the S01 inventory (`mission`,
  `rataflow-view`). A new in-repo binary, or a moved source tree, fails here
  instead of silently escaping the justfile.
- **Every in-repo binary has a build recipe.** Some recipe's command lines
  must name the source path: `go/mission` **and** `./cmd/mission` for
  `mission`, `rataflow/Cargo.toml` for `rataflow-view`. Naming the binary is
  not enough.
- **Recipe dependencies resolve.** Every dependency names a recipe in the
  same justfile, so a renamed recipe with a stale `build:` dependency fails
  with the names in the message.
- **`build` reaches every binary recipe.** `build` exists, is not empty, and
  its dependency closure covers the recipe that builds each binary — so
  `just build` really builds both.
- **No registry install command.** No recipe body runs `cargo install`,
  `go install`, `go get`, `npm install`, `brew install|bundle`,
  `pip install`, `gem install`, `git clone`, or `curl | sh`. Only executed
  lines are scanned, so the justfile's own header comment ("no `cargo
  install`") is prose, not a violation.
- **`just` layer (optional).** When `just` is on PATH: `just --summary`
  lists `build` and both binary recipes, and `just --dry-run build` exits 0
  and echoes a line naming each source path. Without `just` these two SKIP
  with a message; the parse above already asserts the same contract.

## How to run

    python3 scripts/test-just-build.py

Against a copy of the justfile (a mutation, a rehearsal, an experiment):

    python3 scripts/test-just-build.py /tmp/copy/justfile

The mutation proof is built in. It deletes a recipe, renames a recipe,
deletes `build`, and adds a `cargo install` line, then asserts the hard gate
catches each one:

    python3 scripts/test-just-build.py --selftest

## Runtime and SLA

Under 0.05 s with `just` on PATH (two subprocesses), under 0.02 s without.
No network, no writes, no `$HOME` mutation, no sleeps. Budget is 5 s.

## Coverage result

8/8 checks pass on the shipped justfile (macOS python 3.9, just 1.59.0).
`--selftest` catches 4/4 mutations. With `just` off PATH, 6 checks pass and
2 SKIP: exit 0.

## Known gaps

- The `just` layer SKIPs even under `STRICT=1`, unlike the repo's dual-mode
  rule. CI runners do not install `just`, and the parser asserts the same
  recipe set, so a hard failure would cost setup time for no coverage. If
  `just` ever lands in the runner image, promote the two checks.
- The suite does not execute a build. `just build`'s Rust half needs a real
  toolchain (`cargo` on a default PATH here is a rustup shim with no
  toolchain installed), and invoking Go or cargo would be slow and
  environment-dependent. `scripts/test-missions.sh` covers the Go build;
  `RATAFLOW_BUILD=1 scripts/test-rataflow.py` covers the crate.
- The registry scan reads commands, not effects. A shell script that a
  recipe calls could still install something; no recipe calls one today.
- `BIN_DIR` is not asserted. The recipe honors it, but the destination is a
  machine preference, not a repo invariant.

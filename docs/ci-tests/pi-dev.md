# pi-dev tests

Run `bash scripts/test-pi-dev.sh` from the repository root.

## Purpose

Check `scripts/pi-dev`, the runner that starts Pi on one worktree's config
directory. The suite proves the prepare steps and the command it builds. It
never starts a real Pi session.

## Overview

The suite uses a temporary directory. It sets a private `HOME` with an auth
file, puts a fake `pi` binary first on `PATH`, and builds two Git trees: a
repository with `pi/.pi/agent` and a linked worktree of it.

## What the suite covers

- `--print` output: the `env PI_CODING_AGENT_DIR=<root>/pi/.pi/agent pi` line,
  quoted Pi arguments, and the current-directory Git root.
- The auth link: created, correct target, idempotent, and an existing auth file
  is never replaced.
- The `info/exclude` entry: written once, stays single, and `git status` stays
  clean in the primary checkout and in a linked worktree.
- The exec path: the fake `pi` shows the environment variable and the arguments.
  `--` stops option parsing.
- Error lines: no `pi/.pi/agent` directory, and a path outside Git.

## How to run

```sh
bash scripts/test-pi-dev.sh
```

## Runtime and SLA

About 1 s on a warm host. The CI entry limit is 120 s.

## Coverage result

19 checks pass.

## Known gaps

The suite cannot prove that Pi loads the worktree extensions: that needs a real
Pi session, which repository rules keep out of tests. Probe it by hand with
`scripts/pi-dev <worktree> -p "<prompt>"`.

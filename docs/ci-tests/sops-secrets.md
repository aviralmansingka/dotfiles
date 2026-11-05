# sops-secrets — CI test suite

## Purpose

This suite guards the fleet's encrypted secrets. It answers one question
offline, with no key: does every Nix module read a key name that the secrets
file it points at really holds, and is every file under `secrets/` encrypted?

## Overview

Fleet secrets live in `secrets/*.yaml` as sops ciphertext, tracked. Their
recipients live in `.sops.yaml`. Hosts decrypt at activation through
sops-nix, and three units on the homelab read the decrypted copies.

Two failures were possible and neither had a check on this side of the deploy:

- a plaintext file landing under `secrets/` (an `.env`, a backup, a
  hand-decrypted copy);
- a `sops.secrets.<name>` declared in a Nix module with no matching key in
  the secrets file that module references.

The second one only shows up in `sops-install-secrets -check-mode=sopsfile`,
which runs on a Linux host, so a Mac-only edit looked fine until a deploy
failed. The suite added by S04 runs on the CI runner, in under a second, with
no sops, no age key and no Nix.

## What the suite covers

- **`secrets/` holds only encrypted YAML.** Any file under `secrets/` that is
  not `*.yaml`/`*.yml` fails. The two names the root `.gitignore` reserves for
  local scratch (`keys.txt`, `*.dec.*`) are out of scope: they cannot be
  committed.
- **Every secrets YAML has a `sops:` block.** A YAML file that parses but
  carries no `sops:` mapping (or no `sops.version`) is plaintext that got
  tracked.
- **The guard is green.** `scripts/sops-check.py` — the script behind
  `just secrets-check` — must exit 0. That covers one creation rule per file,
  every rule's recipients wrapped in the file, the admin recipient on every
  rule, and no plaintext leaf outside the `sops` block. The suite calls it as a
  subprocess, so the two checks cannot drift apart.
- **Declared names exist.** Every `sops.secrets."<name>"` in `nix/**` must be a
  top-level key in the secrets file that module references through
  `sops.defaultSopsFile` — its own, or one reachable through `imports`. A
  missing `sops.defaultSopsFile`, a path that does not exist, and a declared
  name with no key each fail with the module path and the file.
- **Self-test.** `--selftest` copies `.sops.yaml`, `secrets/`, `nix/` and the
  two scripts into a temporary tree and proves four cases: the clean copy
  passes, a YAML file with no `sops:` block is rejected, a plaintext `.env`
  under `secrets/` is rejected, and a declared name with no key is rejected.

## How to run

    python3 scripts/test-sops-secrets.py

Against the seeded failures, in a throwaway copy:

    python3 scripts/test-sops-secrets.py --selftest

## Runtime and SLA

About 0.07 s on the real tree with PyYAML (0.5 s through the `ruby -ryaml`
fallback: four processes instead of one library call). The self-test copies a
small tree four times and runs the suite four times: about 0.6 s. No network,
no writes outside a temporary directory, no `$HOME` mutation, no sleeps.
Budget is 5 s.

## Coverage result

4/4 checks pass on the shipped tree: `secrets/` holds two YAML files, both
carry a `sops:` block, three declared names (`pi-stt-worker.env`,
`pi-telegram.env`, `pi-whatsapp.env`) resolve to keys in
`secrets/homelab.yaml`, and the guard exits 0. `--selftest` matches all four
cases.

## Known gaps

- **YAML parser.** PyYAML is used when it imports; otherwise `ruby -ryaml`
  (the fallback `scripts/sops-check.py` uses). With neither, all three
  parse-dependent checks SKIP locally and FAIL under `STRICT=1`, including the
  guard check, because the guard needs a parser too.
- **Per-secret `sopsFile`.** A `sops.secrets` block that sets its own
  `sopsFile` is refused rather than followed: this guard reads
  `sops.defaultSopsFile` only. No module does that today, and the failure is
  loud.
- **Computed secret sets.** `sops.secrets` built by a function (no literal
  quoted attribute names) is not enumerated. No module does that.
- **Values are not read.** A key could hold a stale or wrong value; that is
  `sops rotate`, a deploy and a consumer restart — not a static check.
- **The consumers are not checked.** Whether a unit's `EnvironmentFile` names
  the secret it needs is `scripts/test-service-units.py` territory, not this
  suite's.
- **Unmigrated plaintext files.** Files such as `~/.config/pi-slack-mcp.env`
  live outside the repo; no static check can see them. See the open items in
  `docs/secrets.md`.

---
name: hostbench
description: Use when the user types /hostbench or asks to run, kick off, or invoke a command from ops/modal_host_bench/main.py (bench, compare, compare-files, evaluate, evaluate-files, inspect). Scans the current conversation for hints (subcommand verbs, instance types, IPs/worker IDs, cloud/region, dates, file paths) and pre-fills AskUserQuestion options so the user mostly just confirms, then runs `uv run main.py ...` from the modal_host_bench directory.
allowed-tools: Bash, Read, AskUserQuestion
---

# hostbench

Driver for `ops/modal_host_bench/main.py`. Prompts the user for the subcommand
and its required arguments via `AskUserQuestion`, builds the final command, and
runs it from the `modal_host_bench` directory.

The `main.py` script is run with `uv run main.py ...` (PEP-723 inline
dependencies). The `bench` subcommand additionally needs AWS creds, so it must
be wrapped in `uv run inv cloud prod -- uv run main.py ...`.

## Workflow

**Before asking anything, scan the conversation for context.** The skill's job
is to make the prompts feel pre-filled, not to interrogate the user. Re-read
the user's recent turns and pull out:

- Subcommand hints — verbs like "compare", "evaluate", "inspect", "kick off a
  bench"; nouns like "pass rates" → `evaluate`, "percentiles" → `compare`,
  "two JSON files" → `compare-files`, "one run" → `inspect`, "raw JSON" →
  `inspect`, "thresholds" → `evaluate-files`.
- `--instance-type` — strings matching `g5.2xlarge`, `bm.gpu.h100.8`,
  `sfc.h100v`, `c5.4xlarge`, etc.
- `--ip-addresses` / `--worker-ips` — IPv4 like `10.0.0.1`, hostnames like
  `peyton-sfc-test`, worker IDs like `wo-HpLLUytryeKAqOmAygSwIu`, or a path
  ending in `.txt` / referenced as a "worker IPs file".
- `--cloud` / `--region` — `aws`, `oci`, `sfc`; `us-east-1`, `us-west-2`,
  region names mentioned earlier.
- `--username` — `ubuntu` (default), `root` (sfc), `modal` (oci prod workers).
- `--ssh-key` — paths under `~/.ssh/`, e.g. `~/.ssh/global_worker`.
- `--since` / `--until` — any `YYYY-MM-DD` dates in the conversation.
- `files` (for `evaluate-files`) — paths under `bench_results/`.
- Local-vs-S3 intent — "local only", "ad-hoc", "don't upload" → `--local-only`;
  otherwise default to S3 upload (which forces `--cloud`/`--region`).

1. **Pick the subcommand.** Ask via `AskUserQuestion` (single-select,
   `header: "Subcommand"`). **Order the options so the inferred best guess is
   first**, and label it `<name> (Recommended)`. Always include all 6 so the
   user can override.
   - `bench` — Run benchmarks on a host (SSH-driven)
   - `compare` — Compare percentile distributions across (cloud, instance_type, region) triples
   - `compare-files` — Interactively compare two benchmark JSON files under `bench_results/`
   - `evaluate` — Aggregate evaluate pass-rates across triples
   - `evaluate-files` — Evaluate local benchmark JSON files against hostbench thresholds
   - `inspect` — Pretty-print raw benchmark JSON for one S3 run

   If exactly one subcommand is unambiguously implied (the user literally
   said "/modal-host-bench evaluate" or "compare runs"), skip this prompt
   and announce the choice instead.

2. **Collect required args** for the chosen subcommand (see table below).
   For each `AskUserQuestion`:
   - Put the value extracted from conversation context as the **first option**
     and append `(Recommended)` to its label.
   - Add 2–3 other plausible options drawn from the README examples (e.g. for
     `--instance-type`: `g5.2xlarge`, `bm.gpu.h100.8`, `sfc.h100v`).
   - The "Other" escape hatch is added automatically — rely on it for fully
     free-form input rather than guessing.
   - If a value is already pinned in the conversation (e.g. user said "use
     instance type g5.2xlarge"), do NOT re-ask — just use it and tell the
     user what you inferred.
   - Convert relative dates ("last week", "since Tuesday") to absolute
     `YYYY-MM-DD` before pre-filling.

3. **Confirm and run.** Print the assembled command verbatim (with all
   inferred values inlined), then execute it via `Bash` from
   `/Users/aviral/modal/ops/modal_host_bench/`. Stream output to the user.
   Mention which values came from context vs. which the user picked, so they
   can catch a wrong inference before secrets are sent over SSH.

## Required arguments per subcommand

| Subcommand | Must ask the user for | Optional but commonly asked |
|---|---|---|
| `bench` | `--instance-type` (free-form), one of `--ip-addresses` (comma-separated) or `--worker-ips` (path), and whether this is a `--local-only` run or an S3-uploading run (then `--cloud` and `--region` are also required) | `--ssh-key`, `--username` (default `ubuntu`), `--port`, `--parallel`, `--only`, `--run-blobnet`, `--run-full-ping-test`, `--s3-only`, `--require-s3-upload`, `--dry-run-s3` |
| `compare` | nothing required | `--since YYYY-MM-DD`, `--until YYYY-MM-DD` |
| `compare-files` | nothing (fully interactive) | — |
| `evaluate` | nothing required | `--since YYYY-MM-DD`, `--until YYYY-MM-DD` |
| `evaluate-files` | `files` (one or more paths under `bench_results/`) | `--thresholds` (currently unused) |
| `inspect` | nothing required | `--since YYYY-MM-DD`, `--until YYYY-MM-DD` |

For `bench`, also ask whether to wrap in `uv run inv cloud prod --` (default
**yes** unless `--local-only` is set and the user has no AWS use). The wrap is
required whenever the run uploads to S3 or signs R2 URLs.

## Command shapes

Local-only `bench`:

```bash
uv run inv cloud prod -- uv run main.py bench \
  --local-only \
  --instance-type <type> \
  --ssh-key <path> \
  --ip-addresses <ip[,ip...]>
```

S3-uploading `bench`:

```bash
uv run inv cloud prod -- uv run main.py bench \
  --cloud <aws|oci|sfc|...> --region <region> \
  --instance-type <type> \
  --ssh-key <path> \
  --ip-addresses <ip[,ip...]>
```

Read-only commands (no AWS wrap needed for `compare-files`/`evaluate-files`;
`compare`/`evaluate`/`inspect` read S3 indices, so wrap them):

```bash
uv run inv cloud prod -- uv run main.py compare  [--since DATE] [--until DATE]
uv run inv cloud prod -- uv run main.py evaluate [--since DATE] [--until DATE]
uv run inv cloud prod --no-log -- uv run main.py inspect [--since DATE] [--until DATE]
uv run main.py compare-files
uv run main.py evaluate-files <file> [<file> ...]
```

## Validation rules (enforced by main.py)

- `--s3-only` is incompatible with `--local-only`.
- When the run uploads to S3 (i.e. not `--local-only` and not `--only`),
  `--cloud` and `--region` are mandatory.
- `--parallel` must be a positive integer.

If the user picks a combination that violates these, surface the conflict
before invoking — don't let argparse fail after `inv cloud prod` has already
authenticated.

## Running it

Always `cd` to (or run from) `/Users/aviral/modal/ops/modal_host_bench/`.
Echo the assembled command back to the user before executing so they can
sanity-check secrets/paths.

## When NOT to use this skill

- The user already wrote a complete `uv run main.py ...` invocation — just run
  it; don't re-prompt for arguments they already supplied.
- The user is asking *about* main.py (how it works, what it does) rather than
  asking to *run* it. Use `Read` instead.

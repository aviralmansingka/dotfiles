# Coding eval set

A curated, reproducible set of 23 coding tasks (10 dotfiles, 11 rack-bench, 2 kimi-endpoint) taken from the
captain's own agent sessions, built so that two models can be compared fairly: **same repo, same base commit, same prompt, same
verification command**.

Every task has a known-good final commit (the one the original session landed), a base commit equal to that
commit's parent, the original prompt, and a `verify.sh` that runs offline.

```
evals/coding/
  README.md            this file: rubric, how to run, how to score, known limits
  REPORT.md            how the set was built, per-task validation results, rejected candidates
  manifest.jsonl       one JSON object per task (14 fields, see below)
  run-task.sh          harness helper: worktree at base/final + run verify
  tasks/<id>/prompt.md verbatim task prompt (paths rewritten, see Prompt edits)
  tasks/<id>/verify.sh the exact verification the task is graded on
```

## Selection rubric

A session became a task only if **all** of these hold:

1. **One repo, one commit.** The work landed as a merged commit in `/Users/aviral/dotfiles` or
   `/Users/aviral/rack-bench`. `base_commit` is that commit's first parent, `final_commit` is the merged commit,
   so the diff is exactly the task.
2. **Self-contained prompt.** The first user message of the session is a complete brief: files, behaviour,
   constraints, and how to know it is done. Briefs that lean on "the conversation above", on a `/tmp` handoff
   file, on vault content, or on the captain's prior context were rejected.
3. **Deterministic, offline verification.** Either an existing test in the repo covers the change, or the check
   is authored for this eval (`verify_kind` records which). Both run with no network, no credentials, no GPU, no
   TUI, no live pi session, no nvim/tmux/herdr, and no vault access. Runtime is capped at ~120 s (every task
   here finishes in under 8 s).
4. **Known-good final state.** The final commit is green under the same command.
5. **No secrets, no live hosts.** Prompts that carried passwords, R2/AWS credentials, or required SSH to a lab
   host were either trimmed (documented per task) or rejected.
6. **Human effort roughly 20–120 minutes.** Diff size is recorded for every task; the target spread was
   ~4 small (≤150 changed lines), ~6 medium (150–450), ~4 large (450+), with at least 4 bug fixes.

The realised spread is **6 small / 10 medium / 7 large** (fourteen features, three refactors, three bugfixes, one
removal). The bugfix count is still below the target of four: of the bugfix-shaped sessions, two have landed
commits and are in the set (`dotfiles-mermaid-minimal-trim`, `dotfiles-thinking-hidden-row`), while the rest
are one-line complaints, need a live PTY, or never landed a commit. See REPORT.md for the full reject list.

## Tasks

| id | repo | size | kind | why it is a good eval |
| --- | --- | --- | --- | --- |
| `dotfiles-fast-mode-openai` | dotfiles | 142 / small | feature | New extension from a spec that names every branch and the exact test matrix; base has no such file, so attribution is clean. |
| `dotfiles-fast-command` | dotfiles | 307 / medium | feature | Must extend the previous task's 39-line module: two-provider behaviour, sibling-id mapping, model swap via a stub registry. |
| `dotfiles-quiz-thinking` | dotfiles | 438 / medium | feature | Two features over an existing TUI state machine plus a journal formatter and a prompt builder; UI strings are asserted. |
| `dotfiles-revise-practice` | dotfiles | 1674 / large | feature | Two new tools with session-keyed state, attempt accounting, error strings, journal integration and an agent profile — a full contract. |
| `dotfiles-remove-fix-code-remote` | dotfiles | 636 / large | removal | Deletion with a hard boundary: remove the extension and every reference, keep unrelated "remote" uses and keep the JSON valid. |
| `dotfiles-mermaid-minimal-trim` | dotfiles | 378 / medium | bugfix | One-sentence defect report (art too wide, trim to the minimal box); the agent must find the cause and the second (renderer-resolution) half. |
| `rack-bench-part-size` | rack-bench | 128 / small | feature | Four-layer plumbing (CLI → reports → transfer window) plus S3 part-count rules; a half-plumbed flag is visible. |
| `rack-bench-datapath-cache` | rack-bench | 256 / medium | refactor | Perf work with a stated diagnosis and a required memory bound; every safety invariant is already covered by the suite. |
| `rack-bench-process-pool` | rack-bench | 589 / large | refactor | Threads → processes under a fake-clock test seam, with the ss pid filter, picklability, cross-process stop and fork safety. |
| `rack-bench-multi-bucket` | rack-bench | 471 / large | feature | CLI grammar, round-robin assignment, per-object bucket records, download routing, cleanup, strict backward compatibility. |
| `rack-bench-gcs-provider` | rack-bench | 423 / medium | feature | Third provider via the S3-interop endpoint: credentials, SKIP-with-reason, signing scope, per-provider bounds, RTT band. |
| `rack-bench-blob-profiling` | rack-bench | 597 / large | feature | Percentile/steadiness math, defensive `ss` parsing across kernel formats, and a pure verdict function — all additive. |
| `rack-bench-putobject-upload` | rack-bench | 324 / medium | refactor | Protocol-shape change with a size-boundary rule and deadline semantics; loopback asserts the request count. |
| `dotfiles-thinking-hidden-row` | dotfiles | 415 / medium | bugfix | Full diagnostic brief for a UI defect: symptom, suspected paths, renderer contract, and a required regression test. Spans fix + tests + version pin. |
| `dotfiles-hunk-gruvbox-theme` | dotfiles | 68 / small | feature | One-line brief, authored property check: a complete, valid hunk theme on the stow path, dark background, light text, 25 roles + 10 syntax scopes, any gruvbox-consistent palette. |
| `dotfiles-ghdash-hunk-shortcut` | dotfiles | 32 / small | feature | Two-sentence wiring brief (a `ghd` entry point plus an `H` binding that pipes the PR diff into hunk); the repo's own config-guard script is the gold test. |
| `dotfiles-opengateway-provider` | dotfiles | 158 / medium | feature | Register a third-party provider: one extension that owns endpoint/model facts plus the `settings.json` wiring; gold test pins the facts. |
| `rack-bench-checksum-signing` | rack-bench | 29 / small | bugfix | Two signing bugs that only show against S3/R2: two checksums on one PUT, and a signed `content-length` that breaks zero-length reads. Graded by inspecting what the client puts on the wire. |
| `rack-bench-keepalive-pooling` | rack-bench | 454 / large | feature | Per-thread keep-alive pooling with three traps: stale-socket reconnect, "zero bytes is setup, never a retry", and fresh connections for latency probes. Graded by counting TCP accepts. |
| `rack-bench-quick-object-size` | rack-bench | 35 / small | feature | Profile workload shape: quick uploads 32 MiB objects so download windows can verify them, plus an `--object-size` override. Graded on the CLI surface with base tests restored. |
| `rack-bench-cloud-lab-runbook` | rack-bench | 409 / medium | feature | Docs deliverable with a stated shape: practice runbook (matrix, loop, read-and-fix table, five experiments, SKIP triage, limits) plus the `--config` schema draft. Graded structurally. |
| `kimi-bench-agentic-harness` | kimi-endpoint | 745 / large | feature | Largest single-file task: five agentic traffic patterns, dry-run payload generation and bench_serving-style metrics. Graded on `--list-patterns`, per-pattern `--dry-run`, and the documented knobs, with no server. |
| `kimi-trace-profiler` | kimi-endpoint | 516 / large | feature | Debug-and-extend a buggy draft analyzer so it reads three trace formats into workload parameters. Graded hermetically: a private HOME with one synthetic trace and known token totals. |

`size` in the table is changed lines (added + removed); `manifest.jsonl` also carries `files_changed`,
`lines_added` and `lines_removed`.

## manifest.jsonl

One JSON object per line:

| field | meaning |
| --- | --- |
| `id` | task id, also the `tasks/<id>/` directory name |
| `repo` | absolute path of the source repository |
| `base_commit`, `final_commit` | full SHAs; `final_commit` is the merged task commit |
| `prompt_file` | path to the prompt, relative to `evals/coding/` |
| `prompt_source` | `session-first-user-message` (verbatim brief) or `authored-from-commit` (no session existed; written from the landed commit message and diff) |
| `verify` | the exact shell commands, in order; the first entry (when present) checks gold test files out of `final_commit` |
| `verify_kind` | `gold-tests` (reference tests), `authored-check` (greps/structural), `behaviour-check` (drives the public surface), or a combination |
| `difficulty` | `small` (≤150 changed lines), `medium` (151–450), `large` (>450) |
| `kind` | `feature`, `bugfix`, `refactor`, `removal` |
| `files_changed`, `lines_added`, `lines_removed` | `git diff --shortstat base final` |
| `source_session` | absolute path of the source `.jsonl` session |
| `notes` | why this task is worth running, plus every caveat and prompt edit |

## How to run

Prepare a worktree at the base commit and print the prompt:

```sh
git -C /Users/aviral/dotfiles worktree add --detach /tmp/eval-<id> <base_commit>
cat evals/coding/tasks/<id>/prompt.md      # hand this to the model, cwd = /tmp/eval-<id>
```

Grade whatever the model produced (from inside the worktree, any path for the script):

```sh
cd /tmp/eval-<id> && bash /path/to/evals/coding/tasks/<id>/verify.sh
```

Or let the helper do both, for the sanity check that the task still discriminates:

```sh
bash evals/coding/run-task.sh <id>           # worktree at base_commit -> expect RED (exit 1)
bash evals/coding/run-task.sh <id> --final   # worktree at final_commit -> expect GREEN (exit 0)
bash evals/coding/run-task.sh --list         # all ids
```

### The gold-test convention

Feature tasks in this corpus ship their tests *with* the change, so at `base_commit` the tests that describe
the new behaviour do not exist yet. To make verification meaningful, `verify.sh` first checks the task's test
files out of `final_commit` (`git checkout <final> -- <test paths>`) and then runs them. Those gold tests are
the graded contract:

- at `base_commit` they fail because the behaviour (or the module) is absent — the "red before" state;
- at `final_commit` they pass — the "green after" state;
- a solution is accepted when `verify.sh` exits 0.

### Behaviour-only grading

Six tasks were re-graded after a model comparison showed the reference tests rejecting work that behaved
correctly but named its helpers differently (`fastIdFor`, `trimArt`, `part_size_mib`, a literal `H` command).
Those tasks now grade on behaviour, driven through the public surface the brief names — registered tool,
command, hook, CLI flag, config file — and never import a helper from the reference implementation:

| task | behaviour check |
| --- | --- |
| `dotfiles-fast-mode-openai` | load the extension, find the `before_provider_request` hook, feed payloads: gpt on openai/openai-codex → `priority`, copy not mutate, explicit tier wins, `PI_FAST_MODE=off` disables (fresh process) |
| `dotfiles-fast-command` | drive the registered `/fast` command: state report, on/off/toggle, sibling swap through a stub registry, no-sibling report, unknown-argument usage, env-off override |
| `dotfiles-ghdash-hunk-shortcut` | read the `H` binding from the gh-dash config, substitute the placeholders, run it with stub `gh`/`hunk` on PATH, require the PR diff to reach hunk; `ghd` must exist |
| `dotfiles-opengateway-provider` | accept either an extension that registers a gateway provider on load or a JSON model-config fragment with a gateway block (https base URL, ≥1 model) |
| `rack-bench-part-size` | public CLI: `--part-size` listed, 0/4/513/-1 rejected with a message that names the flag, 64 accepted, base test files restored from `HEAD` and the suite green |
| `rack-bench-checksum-signing` | drive the client against a loopback S3 server: CRC32-only uploads, `content-length` sent but never in `SignedHeaders` |
| `rack-bench-keepalive-pooling` | loopback server counts TCP accepts: 1 for 3 sequential requests, 1 per thread, a fresh one after `close()` |
| `rack-bench-quick-object-size` | `--object-size` in the CLI, 32 MiB quick default stated in `--help`, input validation, base tests restored |
| `rack-bench-cloud-lab-runbook` | both docs exist, ≥5 of the 6 named sections, `--config` covered, runnable commands quoted, no credential-shaped strings |
| `rack-bench-multi-bucket` | kept gold-graded: a parse-level probe cannot separate real sharding from the base parser's silent last-wins, so the CLI-grammar pin stays |

`verify-strict.sh` is kept next to each relaxed task: it is the old gold-test grader, useful for spotting a
solution that passes behaviour but breaks a pinned contract. `lib/pi-harness.mjs` provides the recording
`ExtensionAPI` stub that makes the extension checks short.

Some tasks have no test to borrow. There the check is **authored for this eval** and lives next to the task
(`check.py`, `check.mjs`, `check.sh`, or inline gates in `verify.sh`). Authored checks assert the properties the brief states, and prefer
properties over reference values: `dotfiles-hunk-gruvbox-theme` parses the theme with `tomllib` and requires
dark/light luminance bounds, 25 colour roles, 10 syntax scopes and 12 distinct colours — it accepts any
gruvbox-consistent palette and rejects a stub. `dotfiles-remove-fix-code-remote` uses the brief's own
grep/JSON/loader gates. `manifest.jsonl` records which kind each task uses.

## How to score

1. For every task, `cd <worktree> && bash <verify.sh>`; record the exit status. Cap the run at ~120 s.
2. A task scores **1** if `verify.sh` exits 0, else **0**. (The rack-bench tasks run their suite twice inside
   `verify.sh` because the suite carries one known pre-existing flake — see below.)
3. Report per-task results and the total out of 13, plus the per-`kind` and per-`difficulty` tallies, so a
   model that only does small features cannot look equal to one that does large refactors.
4. Optional but recommended: read the diff. Several tasks leave a design choice open (CLI grammar for
   multiple buckets, cache bounds, process-pool scoping). The gold tests pin the reference choice, so a
   different-but-reasonable design can score 0. Score the tests for comparability, and note the qualitative
   differences separately.

## Known limits

- **Reference-contract grading.** Gold tests come from the reference implementation. Where the brief leaves a
  choice open (`rack-bench-multi-bucket` CLI syntax, `rack-bench-gcs-provider` env-var names,
  `rack-bench-process-pool` scoping) the tests encode the choice the original session made.
- **Internal-API pins.** Some rack-bench gold tests import helper names that the brief never mentions
  (`stats.steadiness`, `targets.run_seed`, `cli.part_size_mib`, `s3client._LRUCache`,
  `s3client.set_chunk_cache_limit`, `transfer._POOL_STATE`). A correct implementation with different helper
  names fails. Prefer these tasks for regression-style comparisons, or review diffs alongside scores.
- **Known pre-existing flake.** `test_concurrent_loaded_gets_are_inside_upload_window`
  (`tests/test_bench_internet_transfer.py`) fails roughly 1 run in 6 at *every* rack-bench commit
  (an `at_seconds` vs `elapsed_seconds` race). `verify.sh` retries the suite once before calling it red.
- **Text deliverables are not graded.** Skill files, agent profiles, README tables and `docs/` prose that the
  briefs require are not test-verifiable; only code behaviour (or an authored structural check) scores.
- **Authored checks encode a contract too.** Property-based checks are deliberately loose (palette, structure,
  luminance), but they still define what "done" means; read the task's `notes` before scoring a diff that fails.
- **Two repo tests are excluded on purpose.** `scripts/test-pi-hidden-thinking.mjs` asserts against the live
  `~/.pi/agent` settings file, which no worktree controls, and its pyte sibling needs a PTY fixture; the
  thinking-row task therefore grades on the extension unit suite only. The same rule removed
  `scripts/nm-test.sh` from dotfiles grading (pre-existing reds plus a ~4-minute runtime).
- **Network and PR steps are not graded.** Some briefs end with "open a PR with `gh`" (rack-bench) or ask the
  agent to verify facts on the web (`rack-bench-gcs-provider`). Run the tasks offline; those steps are out of
  scope and do not affect the score.
- **`dotfiles-remove-fix-code-remote` greps the tree.** Run it from the task worktree, not from a checkout that
  contains this `evals/` directory (the prompts mention `fix-code`), or add `--exclude-dir=evals`.
- **No repo tests added.** This is data plus docs, so no `scripts/test-*` entry was added and `nm-test.sh` picks
  up nothing new.

### Prompt edits

Prompts are verbatim first user messages with three mechanical changes:

1. the harness boilerplate line `Complete your task autonomously…` and the trailing
   `Your FINAL assistant message should summarize what you accomplished.` are stripped (they carry no
   constraint);
2. absolute worktree paths (`/Users/aviral/.herdr/worktrees/...`, `/Users/aviral/rack-bench`) are replaced with
   `<repo>`;
3. for three rack-bench tasks (`part-size`, `datapath-cache`, `process-pool`) the lab-host A/B appendix was
   removed: it contained a plaintext host password and required SSH plus R2 credentials. Nothing else was
   removed. Per-task `notes` record every edit, including the branch-base sentences that were rewritten so the
   base commit is self-contained.

## Provenance

Sessions live at `~/.pi/agent/sessions/--Users-aviral-<cwd>--/<timestamp>_<uuid>.jsonl`; the exact file for each
task is in `manifest.jsonl` under `source_session`. Nested `<run-0>/session.jsonl` headless runs were skipped.

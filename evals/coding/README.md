# Coding eval set

A curated, reproducible set of 13 coding tasks taken from the captain's own agent sessions, built so that two
models can be compared fairly: **same repo, same base commit, same prompt, same verification command**.

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
3. **Deterministic, offline verification.** An existing test command in the repo covers the change and runs with
   no network, no credentials, no GPU, no TUI, no live pi session, no nvim/tmux/herdr, and no vault access.
   Runtime is capped at ~120 s (every task here finishes in under 7 s).
4. **Known-good final state.** The final commit is green under the same command.
5. **No secrets, no live hosts.** Prompts that carried passwords, R2/AWS credentials, or required SSH to a lab
   host were either trimmed (documented per task) or rejected.
6. **Human effort roughly 20–120 minutes.** Diff size is recorded for every task; the target spread was
   ~4 small (≤150 changed lines), ~6 medium (150–450), ~4 large (450+), with at least 4 bug fixes.

The realised spread is **2 small / 6 medium / 5 large** (one bugfix, one removal, three refactors, eight
features). The two source repos only contain one bugfix session with a landed commit and a self-contained
brief (`dotfiles-mermaid-minimal-trim`); the other bugfix sessions are one-line complaints or depend on state
that was never committed. This gap is a property of the data, not of the filter — see REPORT.md.

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
| `verify` | the exact shell commands, in order; the first entry (when present) checks gold test files out of `final_commit` |
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

For the removal task there are no gold tests; verification is the brief's own grep/JSON/loader gates, which is
how the original run proved the wiring was gone.

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
  briefs require are not test-verifiable; only code behaviour scores.
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

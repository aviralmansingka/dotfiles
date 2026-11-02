# Report — building the coding eval set

## What was done

1. Swept every top-level session file under `~/.pi/agent/sessions` (1294 files across 192 cwd directories; nested
   `<run-0>/session.jsonl` headless runs were skipped). For each one I read the `session` record (`cwd`), the
   `model_change` records, and the first user message.
2. Mapped candidate sessions to landed work: every session was matched to a merged commit in
   `/Users/aviral/dotfiles` or `/Users/aviral/rack-bench`, and `base_commit` was taken as that commit's first
   parent.
3. Applied the rubric in `README.md` (one repo, self-contained brief, deterministic offline verification,
   known-good final commit, no secrets/hosts, 20–120 min of human effort).
4. Rewrote only absolute worktree paths (and, in three cases, stripped a credential-bearing appendix), copied
   the prompts verbatim, and wrote a `verify.sh` per task that checks the task's gold tests out of
   `final_commit` before running them.
5. Validated all 13 tasks in throwaway worktrees at `base_commit` (must be red, for a substantive reason) and at
   `final_commit` (must be green). Every run finished well under the 120 s cap.

## Selected tasks

| id | repo | changed lines | kind | why |
| --- | --- | --- | --- | --- |
| `dotfiles-fast-mode-openai` | dotfiles | +142/−0 | feature | Cleanest spec in the pool: the brief fixes the hook, the payload rule, the kill switch and the exact seven test cases; two new files, nothing else touched. |
| `dotfiles-fast-command` | dotfiles | +272/−35 | feature | Reads and extends the previous task's module: per-session state, two provider behaviours, a documented sibling-id mapping table, model swap through a stubbed registry. |
| `dotfiles-quiz-thinking` | dotfiles | +397/−41 | feature | Two features over an existing TUI state machine (`select → thinking → feedback`) plus a journal formatter and a prompt builder; UI hint strings are asserted. |
| `dotfiles-revise-practice` | dotfiles | +1668/−6 | feature | Largest task: two new tools with session-keyed state, attempt accounting, exact error strings, journal routing and an agent profile. Tests the ability to hold a long contract. |
| `dotfiles-remove-fix-code-remote` | dotfiles | +10/−626 | removal | Deletion with a boundary: remove one extension, its wiring, docs and two skill sections while keeping every unrelated "remote" use and valid JSON. Graded by the brief's own grep/JSON/loader gates. |
| `dotfiles-mermaid-minimal-trim` | dotfiles | +304/−74 | bugfix | The only bugfix with a landed commit in this pool: a one-sentence defect report, so the agent must reproduce, diagnose and split art to its minimal box. |
| `rack-bench-part-size` | rack-bench | +115/−13 | feature | Four-layer plumbing (CLI flag → reports → `transfer_window`) plus S3 part-count rules; partial plumbing is visible. |
| `rack-bench-datapath-cache` | rack-bench | +237/−19 | refactor | Perf refactor with a measured diagnosis (16k Python chunk generations per GiB, double body walk for digests) and a required, declared memory bound. |
| `rack-bench-process-pool` | rack-bench | +490/−99 | refactor | Threads → processes while the fake-clock/mock-client seam keeps working; the brief names the eight traps (picklability, cross-process stop, contextvars, fork safety) so failures are graded. |
| `rack-bench-multi-bucket` | rack-bench | +376/−95 | feature | CLI grammar, round-robin worker assignment, per-object bucket records, download routing, cross-bucket cleanup, and single-bucket behaviour unchanged. |
| `rack-bench-gcs-provider` | rack-bench | +358/−65 | feature | Third provider over the S3-interop endpoint: credentials env vars, SKIP-with-reason, signing scope, per-provider part bounds, RTT band. |
| `rack-bench-blob-profiling` | rack-bench | +572/−25 | feature | Percentile/steadiness math, per-request post-TTFB streaming rate, defensive `ss` flag parsing across kernel formats, and a pure verdict function, all additive. |
| `rack-bench-putobject-upload` | rack-bench | +290/−34 | refactor | Request-shape change with a size-boundary rule, preserved deadline semantics and record compatibility; the loopback server asserts the request count. |

Sort order in `manifest.jsonl` matches this table. Sizes are `git diff --shortstat <base> <final>`.

## Rejected candidates

| session / commit | reason |
| --- | --- |
| `dotfiles-feat-off-by-one` (round 06, dot-origin bugfix) | Step 0 restores the baseline from out-of-repo `/tmp/visualize-eval/round-05/renderer-source`; main's `rataflow/` is an older engine, so no base commit reproduces the pre-state. |
| `dotfiles-feat-struct-merge` (round 08, 3 sessions) | Same `/tmp` baseline problem, plus the work spans three sessions (implement, restart, one-red-test fixup) with no single self-contained brief. |
| `dotfiles/fix-visualize-skill` (all rounds, 113 sessions) | The visualize/rataflow work never merged to `main`; there is no known-good final commit, and the briefs depend on round snapshots and judge roles. |
| `dotfiles/fix/thinking-extra-row` | Explicitly out of scope: the branch has no commits, so the work is still in progress. |
| `rack-bench/perf-internet` (`tcp-wmem-runbook`, ssh/`ab_quick` sessions) | Docs-only or requires SSH to `server1`/`server2`; no offline verification. |
| `rack-bench/docs-network-diagram`, `feat-network-diagram`, Bidadi SVG/ReactFlow sessions | Artifact/HTML deliverables graded by human judgement (and image reading); no deterministic command. |
| `rack-bench` main-checkout sessions (R2 credentials hunt, dependency install, WhatsApp/host setup) | Contain secrets, require SSH to homelab hosts, or are pure infra setup. |
| `dotfiles-feat-modal-devbox` (6 sessions) | Serverless/VM provisioning: needs Modal tokens and network; several sessions are no-mistakes orchestration. |
| `dotfiles-feat-remote-subagent`, `feat-remote-subagent`, `fix-hunk-extension-close` | Pure orchestration briefs ("Orchestrate one no-mistakes validation run", "map the Go source"). |
| `task-*` vault-hunter sessions, `vault-hunter-crew-pipeline`, `*-atlas-*`, `scout-*` | Depend on `~/vault` tickets, `/tmp` handoff files, or "the conversation above"; forbidden by the rubric. |
| `dotfiles-feat-learning-skills` | "Run exactly one professor eval" — needs live pi sessions and human judgement. |
| `dotfiles-fix-mermaid-stuck` (stdin-reattach) | A live-tty defect (Herdr pane tty sever); cannot be reproduced offline in a unit test. |
| `dotfiles-fix-nm`, `fix-pending-notification`, `fix-run-command-paste`, `fix-send-context` | First user message is an artifact/`<file>` reference or a one-line complaint; no self-contained brief. |
| `dotfiles-fix-telegram-bot` | "Implement the user's Telegram rendering request" — the request itself is not in the prompt. |
| `dotfiles-fix-visualize`, `feat-add-opengateway`, `fix-lavish-open-session`, `fix-cost-calculator`, `feat-hunk-dash-ext`, `feat-hunk-custom-gruvbox`, `feat-dash-worktree-shortcut`, `fix-ask-question-nav`, `fix-subagent-new-tab`, `fix-agent-pane-size`, `fix-interactive-subagent-tab-launch`, `fix-tuicr-review`, `feat-worktree`, `feat-autonomous-worktrees`, `feat-update-dotfiles`, `feat-gruvbox-dash`, `feat-rataflow`, `feat-local-provider` | Conversational one-to-three-line briefs with no acceptance criteria; verification would have to be invented. |
| `dotfiles` `.treehouse/*` crewmate launch briefs (10 sessions) | Rich specs, but they are firstmate orchestration briefs for a different worktree layout, and their commits are not all in `main`. |

## Verification results

All runs: worktree at the listed commit, `verify.sh` from this directory, `timeout 120`. `base_rc` is the exit
status at `base_commit` with the gold tests checked out; `final_rc` at `final_commit`.

| task | base_rc | red because | final_rc | runtime (final) |
| --- | --- | --- | --- | --- |
| `dotfiles-fast-mode-openai` | 1 | `Cannot find module './fast-mode.ts'` (module absent) | 0 | 0.7 s |
| `dotfiles-fast-command` | 1 | gold assertion `state off leaves the payload alone` (no session state / `/fast`) | 0 | 2.0 s |
| `dotfiles-quiz-thinking` | 1 | gold assertions in `md-log.test.mjs` and `quiz-result.test.mjs` (no `thinking` field/entry) | 0 | 0.9 s |
| `dotfiles-revise-practice` | 1 | `formatProblemEntry is not a function`; `Cannot find module './practice.ts'` | 0 | 2.2 s |
| `dotfiles-remove-fix-code-remote` | 1 | `fix-code` and `remote.ts` references still present | 0 | 2.1 s |
| `dotfiles-mermaid-minimal-trim` | 1 | `TypeError: trimArt is not a function` | 0 | 2.6 s |
| `rack-bench-part-size` | 1 | `unrecognized arguments: --part-size 16`; `cannot import name 'part_size_mib'` | 0 | 1.9 s |
| `rack-bench-datapath-cache` | 1 | `no attribute 'run_seed'`; `unexpected keyword argument 'seed'`; `no attribute '_LRUCache'` | 0 | 2.4 s |
| `rack-bench-process-pool` | 1 | `no attribute '_POOL_STATE'`; `no attribute 'set_chunk_cache_limit'` | 0 | 3.5 s |
| `rack-bench-multi-bucket` | 1 | `argparse: duplicate bucket for s3` (old parser rejects multiple buckets) | 0 | 3.5 s |
| `rack-bench-gcs-provider` | 1 | `ValueError: GCS interoperability not implemented`; `unexpected keyword argument 'provider'` | 0 | 5.1 s |
| `rack-bench-blob-profiling` | 1 | `cannot import name 'steadiness'`; `KeyError: 'limits'`; `no attribute 'limit_ticks'` | 0 | 5.6 s |
| `rack-bench-putobject-upload` | 1 | `unrecognized arguments: --upload-mode multipart`; `KeyError: 'upload_mode'` | 0 | 6.7 s |

13/13 discriminate: red at base for a substantive reason, green at final. Reproduce any row with:

```sh
bash evals/coding/run-task.sh <id>            # expect "VERIFY PASS" absent, exit 1
bash evals/coding/run-task.sh <id> --final    # expect "VERIFY PASS", exit 0
```

Timings above include creating the throwaway worktree and tearing it down.

Full-suite baselines were measured separately and deliberately are **not** what `verify.sh` grades:

- dotfiles: `bash scripts/nm-test.sh` takes ≈3 m 50 s and exits non-zero at `00113c9b` (the base of the removal
  task) for suites unrelated to any task here: `interactive-subagents.test.mjs`, `tuicr.test.mjs`,
  `scripts/test-ghostty.sh`, `scripts/test-herdr-clean-handoff.sh`, `scripts/test-nm-install.sh`,
  `scripts/test-nvim-headless.sh`, `scripts/test-nvim-octo.sh`, `scripts/test-nvim-picker.sh` and the repo-parity
  docs check. That is over the 120 s cap *and* would blame the model for pre-existing reds, so no task grades on
  it. The prompts keep their wording about `nm-test.sh`; the graded commands are the targeted suites plus
  `scripts/test-extension-loader.mjs` where the extension list changes.
- rack-bench: the full suite (263–290 tests, ~3.5 s) *is* graded. It carries one known pre-existing flake,
  `test_concurrent_loaded_gets_are_inside_upload_window`, observed in 5 of 20 full-suite runs spread over four
  different commits, so `verify.sh` runs the suite twice before calling it red.

## Repository gates

This change adds data and documentation only (`evals/coding/`): no `scripts/test-*` entry, no extension, no code.
Both gate runners were executed on the branch anyway:

- `bash scripts/nm-lint.sh` → `nm-lint: passed (shell, python, lua syntax)`, exit 0.
- `bash scripts/nm-test.sh` → exit 1: 253 PASS, 27 FAIL. Every failure is pre-existing and unrelated to this
  change — the identical set fails on the task base commit `00113c9b` before any eval file existed:
  `pi/.pi/agent/extensions/interactive-subagents.test.mjs`, `pi/.pi/agent/extensions/tuicr.test.mjs`,
  `terminfo-compile`, `terminfo-key-caps`, `scripts/test-ghostty.sh`, `scripts/test-nm-install.sh`,
  `scripts/test-nvim-headless.sh`, `scripts/test-nvim-octo.sh`, `scripts/test-nvim-picker.sh`,
  `scripts/test-repo-parity.py` (stow table + broken `docs/rex-herdr-coupling-audit.md` references).
  No new suite joined the run and no `evals/` path appears in any failure.

## Reproducing the validation

```sh
bash evals/coding/run-task.sh --list
for id in $(bash evals/coding/run-task.sh --list | cut -f1); do
  bash evals/coding/run-task.sh "$id";         echo "base   -> $?"   # expect 1
  bash evals/coding/run-task.sh "$id" --final; echo "final  -> $?"   # expect 0
done
```

Total runtime for the whole matrix is under two minutes; each worktree is created and removed by the helper.

## Residual risks

1. **Gold tests pin the reference contract.** Where a brief leaves an interface choice open, a different but
   reasonable choice scores 0 (`multi-bucket` CLI grammar, `gcs` env-var names, `process-pool` scoping). Read
   diffs as well as scores for those three.
2. **Internal-helper names.** Several rack-bench tests import helpers the brief does not name
   (`stats.steadiness`, `targets.run_seed`, `cli.part_size_mib`, `s3client._LRUCache`,
   `s3client.set_chunk_cache_limit`, `transfer._POOL_STATE`). An implementation with other names fails even if
   the behaviour is right.
3. **Two prompts were substantively trimmed** (`part-size`, `datapath-cache`) and one reworded at the top
   (`process-pool`) to remove a lab-host password and branch choreography. The trimmed work (live A/B on a
   remote host) is exactly the part an offline eval cannot grade, but it means those prompts are not quite
   verbatim.
4. **`gcs-provider` expects world knowledge.** The brief asks the agent to confirm GCS interop facts on the web;
   offline, the model must already know the endpoint/scope conventions that the gold tests assert.
5. **The bugfix gap is real.** Only one bugfix survived the filter. The requirement of "at least 4 bug fixes" is
   not met by this corpus; bugfix-shaped sessions either have one-line briefs or never landed a commit.
6. **Skill/doc prose is ungraded.** Four tasks ask for SKILL.md, agent-profile, README-table or `docs/` edits
   that no test covers, so a model can score 1 while leaving the prose wrong.
7. **Environment coupling.** dotfiles tests resolve `jiti` from the pi managed install and rack-bench needs a
   CPython ≥3.14 interpreter (`/opt/homebrew/bin/python3.14` here, reached through
   `uv run --offline --python 3.14`). Both are present here; a different host may need `JITI_PATH`/`NODE_PATH`
   or a newer interpreter.

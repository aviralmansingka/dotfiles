# Commands (exact, chronological)

Case: `modal-runtime`, round `01`. Working dir for every command:

```
/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill/docs/visualize-eval/rounds/01/modal-runtime
```

Binary used everywhere: `/tmp/visualize-eval/round-01/bin/rataflow-view`
(sha256 `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8`).
Candidate skill read fresh: `rounds/01/SKILL.md`
(sha256 `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92`).

## Environment / identity probe

```
env | grep -i '^PI_' | sort          # PI_MODEL, PI_PROVIDER, PI_REASONING_LEVEL, session ids
herdr pane layout --pane w7E:p2V     # my own pane: tab w7E:tP, area 159x49
```

## Per-view capture (helper, evidence/capture.sh <view> <spec>)

The helper performs exactly these steps for one view:

```
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus
herdr pane run <pane> "stty size | tee evidence/<view>.tty-size.txt"
herdr pane run <pane> "/tmp/visualize-eval/round-01/bin/rataflow-view '$PWD/<spec>'; herdr pane close <pane>"
herdr pane read <pane> --source visible                       > captures/<view>.text.none.txt
herdr pane read <pane> --source visible --format ansi         > captures/<view>.ansi.none.txt
herdr pane send-keys <pane> Tab
herdr pane read <pane> --source visible                       > captures/<view>.text.sel-tab.txt
herdr pane read <pane> --source visible --format ansi         > captures/<view>.ansi.sel-tab.txt
herdr pane send-keys <pane> Right
herdr pane read <pane> --source visible                       > captures/<view>.text.sel-right.txt
herdr pane read <pane> --source visible --format ansi         > captures/<view>.ansi.sel-right.txt
herdr pane send-keys <pane> q                                 # app exits, pane self-closes
herdr pane get <pane>                                         # expect pane_not_found
```

`herdr pane read` output is normalised: lines end in CRLF and text captures are
re-wrapped. `stty size` inside every viewer pane returned `47 77` (rows first).

## Check runs

```
/tmp/visualize-eval/round-01/bin/rataflow-view --check attempts/overview.v1.json > checks/overview.v1.out 2> checks/overview.v1.err
/tmp/visualize-eval/round-01/bin/rataflow-view --check attempts/overview.v2.json > checks/overview.v2.out 2> checks/overview.v2.err
/tmp/visualize-eval/round-01/bin/rataflow-view --check attempts/seams.v1.json     > checks/seams.v1.out     2> checks/seams.v1.err
/tmp/visualize-eval/round-01/bin/rataflow-view --check attempts/seams.v2.json     > checks/seams.v2.out     2> checks/seams.v2.err
/tmp/visualize-eval/round-01/bin/rataflow-view --check attempts/seams.v3.json     > checks/seams.v3.out     2> checks/seams.v3.err
/tmp/visualize-eval/round-01/bin/rataflow-view --check attempts/execution.v1.json > checks/execution.v1.out 2> checks/execution.v1.err
/tmp/visualize-eval/round-01/bin/rataflow-view --check attempts/execution.v2.json > checks/execution.v2.out 2> checks/execution.v2.err
/tmp/visualize-eval/round-01/bin/rataflow-view --check spec/overview.json         > checks/final-overview.out  2> checks/final-overview.err; echo "exit=$?" > checks/final-overview.code
/tmp/visualize-eval/round-01/bin/rataflow-view --check spec/seams.json            > checks/final-seams.out     2> checks/final-seams.err;    echo "exit=$?" > checks/final-seams.code
/tmp/visualize-eval/round-01/bin/rataflow-view --check spec/execution.json        > checks/final-execution.out 2> checks/final-execution.err;echo "exit=$?" > checks/final-execution.code
```

Every check printed only `ok: …`, `layers=…` and `extent=…`; stderr was empty
(sha256 of each `*.err` is the empty-string hash), exit code `0` for all runs
that produced output.

## Analysis (local, read-only, no renderer changes)

```
uv run --no-project python evidence/analyze_ansi.py captures/overview.ansi.none.txt         > evidence/overview.ansi-analysis.txt
uv run --no-project python evidence/analyze_ansi.py captures/seams.ansi.none.txt            > evidence/seams.ansi-analysis.txt
uv run --no-project python evidence/analyze_ansi.py captures/execution.ansi.none.txt        > evidence/execution.ansi-analysis.txt
uv run --no-project python evidence/trace_ansi.py captures/overview.text.none.txt           > evidence/overview.trace.txt
uv run --no-project python evidence/trace_ansi.py captures/seams.text.none.txt              > evidence/seams.trace.txt
uv run --no-project python evidence/trace_ansi.py captures/execution.text.none.txt          > evidence/execution.trace.txt
shasum -a 256 spec/*.json attempts/*.json > evidence/spec-hashes.txt
```

## Sequence notes a judge needs

1. `08:24:52` overview v1 pane `w7E:p2Z` split and measured by hand (no helper
   yet); viewer launched `08:25:29`; captures `08:25:30`–`08:25:38`; `q` at
   `08:25:45`, pane self-closed. This pane has no per-step log line, only the
   file mtimes in `evidence/manifest.tsv` and the three bare timestamps in
   `evidence/overview.timeline.txt`.
2. `08:26:21` the seams pane `w7E:p3F` ran `spec/seams.json` **while that file
   still held the v1 content** (`attempts/seams.v1.json`, sha256
   `e64e676f…`). Its captures were then renamed to `captures/seams-v1.*`, which
   is why their header line reads `seams.json`, not `seams.v1.json`.
3. `08:26:40` seams v3 rendered from `attempts/seams.v3.json` (pane `w7E:p3K`).
   v3 was promoted to `spec/seams.json` and re-captured at `08:26:55` in pane
   `w7E:p3N`; that capture set is the final one.
4. `08:27:03` execution v1 (final spec) in pane `w7E:p3S`; `08:27:18`
   execution v2 alternative in pane `w7E:p3W` (not promoted).
5. Every viewer pane self-closed on `q`. Final state: tab `w7E:tP` holds only my
   own pane `w7E:p2V`.

# modal-runtime — fresh DeepSeek generation, round 05

Renderer: `/tmp/visualize-eval/round-05/bin/rataflow-view`
sha256 `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404`
Candidate skill: `docs/visualize-eval/rounds/05/SKILL.md`
sha256 `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949`
Generator: fresh worker subagent (`viz-ds05-7`), model `accounts/fireworks/routers/deepseek-flash-latest`.
No judge and no reviewer subagent was started.

## Views (3)

| view | spec | direction | nodes / edges | extent | check | validator |
|---|---|---|---|---|---|---|
| v1 seam 1: modal-worker → modal-runtime | `specs/v1-a5.json` | lr | 2 / 1 | 49x8 | `labels: 1/1 placed, 0 skipped, 0 ambiguous owners` | pass |
| v2 seams 2–3: runtime → worker, runtime → daemon | `specs/v2-a4.json` | lr | 3 / 2 | 49x19 | `labels: 2/2 placed, 0 skipped, 0 ambiguous owners` | pass |
| v3 runtime internals: dispatch, compute, storage | `specs/v3-a1.json` | tb | 6 / 5 | 64x32 | `labels: 5/5 placed, 0 skipped, 0 ambiguous owners` | pass |

Full `--check` output per view: `evidence/<view>/check.txt` (recorded verbatim in `generation.json`).
All three views: `crossings: 0 bridges, 0 touching bends`, `0 warnings`.
The binary emits no `routes:` line; that is expected in round 05 and is not a defect.

## Coverage

* e1 worker→runtime `task+ctrl RPC` — v1
* e2 runtime→worker `events+mg RPC` — v2
* e3 runtime→engine `task dispatch` — v3
* e4 engine→backend `starts+manages` — v3
* e5 backend→container `user proc` — v3
* e6 engine→filesystem `mount+snapshot` — v3
* e7 filesystem→blobnet `image+vol data` — v3
* e8 runtime→daemon `HTTP over UDS` — v2

All 8 components and all 8 directed relations are drawn; every edge carries exactly one label.
HTTP over UDS never shares a label or a view-node set with the worker RPC seams.

## Static by design

The source never animated, so no edge has dots or flow. Each view ships 5 timestamped frames
(0/100/200/300/400 ms) whose bodies are byte-identical — `evidence/*/[v]-frames.txt`, plus pinned
`COLUMNS=77 LINES=47` dumps in `evidence/*/[v]-frames-77x47.txt` (copies in `pinned-77x47/`).

## Known defects (honest, unresolved)

1. **Worker seam split across two views.** One view cannot hold both anti-parallel labels: they share
   one corridor and one label is skipped (`attempts/v1-a2/check.txt`), and the lr variant reports an
   ambiguous owner (`attempts/v1-a3/check.txt`).
2. **`user proc` instead of `runs user process`.** A 14-cell label places its centre 9 cells from its own
   route while the sibling branch corridor is 7 cells away → `1 ambiguous owners`
   (`attempts/v2-a1`, `v2-a2`, `v2-a3`). The 9-cell label clears it.
3. **No group block is drawn.** `--check` reports `groups: orchestration(2) compute(2) storage(2)` but no
   enclosing border or group title appears (`evidence/v3/v3-text.txt` rows 12–39); the skill's bordered-block
   promise is unmet by this build. Groups are only visible as border hues.
4. **Group hues are not distinct enough.** In `evidence/v3/v3-ansi.ansi`, storage reuses the orchestration pair
   (125,160,184) and (151,184,206); compute uses (211,134,155) and (226,156,175).
5. **v1 is thin (2 nodes / 1 edge)** because a tb chain cannot place a 13-cell label at all
   (`attempts/v1-a4/check.txt`: `labels: 0/2 placed`).

## Blocker (resolved per the corrected protocol)

Evidence panes measure **83x51**, not 77x47: the worker tab is 170x53 and `viz-evidence.sh` splits it 50/50.
Pane size is not worker-controlled, so each view ships a pinned `COLUMNS=77 LINES=47` dump printing
`viewport: 77x47 zoom: 1.00 natural` with the complete graph and no overflow banner. The measured size is
still recorded as 83x51 — never relabelled.

## Attempts

10 `--check` runs, all raw output preserved under `attempts/<spec-id>/`:

* final views: one run each (v1 `v1-a5`, v2 `v2-a4`, v3 `v3-a1`)
* superseded compositions: `v1-a1` (extent 78x16 overflows the target), `v1-a2` (1 skipped label),
  `v1-a3` (1 ambiguous owner), `v1-a4` (2 skipped labels), `v2-a1`/`v2-a2`/`v2-a3` (1 ambiguous owner each)

`attempts.json` lists the three final views (one attempt each, within the 3-per-view budget) and lists the
seven superseded runs under `rejected_attempts` with their check paths. Nothing was hidden to make a line green.

## Cleanup

Panes `w7E:pGX` (v1), `w7E:pGY` (v2), `w7E:pGW` (v3): each `confirmed_closed` in its manifest and re-probed
gone afterwards. No capture pane survives in the worker tab.

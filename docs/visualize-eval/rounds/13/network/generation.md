# network — round 13 generation (viz-ds13-2)

Frozen inputs: skill `docs/visualize-eval/rounds/13/SKILL.md` (proposal 12, sha256 `65d826f0…`),
renderer `/tmp/visualize-eval/round-13/bin/rataflow-view` (sha256 `1f28d87d…`), rubric revision 11.
No judges, no subagents, no commits, no renderer/skill/case edits.

## Triage (brief: "network diagram, wan down to the db")

Annex `TRIAGE-network`. Seven questions provoked; five answered by the annex verbatim
(scope, reader's job, one pane, motion-is-not-a-measurement), one settled by `source.md`
(Redis's two relations — the Fixed constraints say keep both), one answered by own judgment
(dots on the four speed-labelled transport hops only; the application triangle stays static),
one settled by the brief's "must not change" list (speeds stay verbatim).
Converged after the fourth answer: every node, relation, surface and motion rule was fixed.
Shape decision: **one view** (ladder rung 1) — 6 nodes / 7 relations are one connected concept.
Rungs 2 and 3 rejected with reasons in `generation.json`.

## Family

**service-meshes** — `core` is a two-edge fan (core->web 10 GbE, core->cache 25 GbE) and the same
targets carry two different relations (core->cache 25 GbE vs web->cache session; fw->core and
core->web are both 10 GbE). Secondary recipe borrowed: flow-chains, for the wan->fw->core spine.

## Drawing

`tb`, gruvbox, 6 nodes, 7 edges, 7 labels, 2 groups (`fabric` = fw, core; `tiers` = web, cache, db;
wan ungrouped), a `layers` pin `[[wan],[fw],[core],[web,cache],[db]]`, `label_slot` on e0/e1/e4/e5/e6
and deliberately *not* on e2/e3. No trunks, no `minlen`, no dashed styles, no canvas.
Check: `extent=34x41`, `crossings: 0 bridges, 0 touching bends`, `near-misses: 0`,
`labels: 7/7 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners`.

Motion: four single-dot routes (e0-e3) at the default constant 0.5 c/step; e4-e6 static by triage
answer (labels are the measurement, motion never is). `dot hues: 0 by source, 4 by destination,
0 shared-hue pair(s)` — each dot carries its destination node's hue; the source end would make the
two core-out dots share Core switch's hue. Frame audit on 30 frames: **PASS** (4/4 steady,
0.500..0.500 cells/frame, equal distance over 19 windows).

## Attempts (all recorded in `attempts-log.jsonl`)

| attempt | extent | near-miss | ambiguous labels | verdict |
|---|---|---|---|---|
| a1-tb-four-dots | 29x67 | 0 | 0 | orientation probe — too tall (label gaps = label width + 3 rows) |
| a2-tb-gutters | 27x45 | 5 (e3 hugging `web`) | 1 (`session`) | rejected |
| a3-tb-pinned-tiers | 34x36 | 2 (same pair) | 1 (`session`) | rejected |
| a4-tb-open-fan = `spec.json` | 34x41 | **0** | **0** | shipped |

Routing relief: removing `label_slot` from e2/e3 opens the 9-row core fan band, so the 25 GbE jog
leaves Core switch well above Web tier instead of inside its 2-cell margin (5 -> 2 -> 0).
Budget: the three-candidate cap is exceeded by one (four distinct specs checked); recorded openly in
`attempts.json` and `generation.json`. `attempts.json` lists the three drafts that competed for
shipping and puts a1 under `abandoned_shapes`.

## Evidence

`evidence/v1/` — check, pane text/ANSI (68x44 @100%), `--select-all` ANSI (all six borders accent
216;166;87), 30 timestamped pane frames, pinned `77x47 @1.00 natural` frames (no `canvas` badge =
fits), frame audit. Pane `w7E:pZY` closed, `cleanup: confirmed_closed`.

`validation.txt` — 36 checks, **all passed** (including `routes_near_unrelated_nodes`,
`labels_ownership_clear`, `viewport_matches_target` via the pinned dump, `probe_inputs_present`,
`frame_audit_passes`).

## Defects / notes

- The lateral `web -> cache` arrow is 3 cells and static; it carries no motion (deliberate).
- Engine observation: in a3 the label-ownership repair ended with 1 ambiguous owner instead of a
  leader tick (`labels_leadered: 0`); a4 removed the cause rather than accept either.
- No blockers.

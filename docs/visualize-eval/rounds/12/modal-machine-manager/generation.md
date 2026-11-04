# modal-machine-manager — round 12 generation (viz-ds12-6)

Frozen inputs: skill `docs/visualize-eval/rounds/12/SKILL.md` (sha256 `44935981…`, proposal 11),
binary `/tmp/visualize-eval/round-10/bin/rataflow-view` (sha256 `db70722b…`).
Generator: viz-ds12-6, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.

## Step 0 — family

```
family: lifecycle-machines
evidence: one machine node and one work queue each fan to 5 phase transitions, and the
          source marks every transition live ("add slow dots flowing through it"), so one
          dot per line.
```

Tie-breakers considered: `E=23 > N=17` pulls toward a mesh/fabric, but the human asked for slow
dots and then "keep on dot alive per line", so it is not a dot-free fabric; the source narrates a
phase order (request → enqueue → registry → providers → machines → boot → heartbeat) in one
direction, which is the lifecycle signature, and the skill's own family table names this case a
lifecycle machine. Secondary habits borrowed: the service-mesh anti-parallel rule (the iPXE
request and the boot.ipxe response stay in one view, two labels, two ports) and the
identity-probe habit of making every verb and payload a ledger row first.

## Views (2)

| view | carries | nodes | edges | extent | labels | ambiguous | crossings | fit |
|---|---|---|---|---|---|---|---|---|
| v1 | control plane + humans → private gRPC → River queue → registry → providers; the four Postgres writers; S3 diagnostics uploads; reconcile gcore sync | 11 | 12 | 68×41 | 12/12 | 0 | 6 bridges / 4 touching | fits 77×47, no banner |
| v2 | machines: provider allocate, iPXE request ↔ boot.ipxe response, boot-image pull, machine-agent heartbeat, SSH/BMC audit, janitor → webapi → Slack | 11 | 11 | 65×41 | 11/11 | 0 | 2 bridges / 2 touching | fits 77×47, no banner |

Coverage: 17 components and 23 directed relations, each relation in exactly one view (v1: e1–e6,
e12–e14, e18, e22, e23; v2: e7–e11, e15–e17, e19–e21). Nothing dropped, no direction reversed.

Density against the round-12 hint (~12 nodes / ~16 edges split): the shipped pair carries 22 node
placements and 23 relations over two views, i.e. 1.8× the hint's node density per view at the
5-rank depth a 47-row tb canvas supports. A single view was measured and is impossible: 17n/23e is
101×136 cells (record `probe-whole-graph-tb`).

## Structural levers

- `group` tags: control / humans / ops / fleet / state — the source's own planes. No box or title is
  drawn; the engine derives hue families and one stable sibling order.
- `label_slot: true` on all 23 edges: every hop has a 12–20 character verb phrase, which would cost a
  14–23 row rank gap as an in-gap label. With gutters all labels place (0 on route cells).
- `minlen: 2` on `mch → boot`: the request/response round trip gets a two-rank corridor. This is the
  measured fix for the pair's ambiguous labels (see the yield below).
- `dots: 1` + `flow: true` everywhere: one slow live dot per line at the constant default 0.5 c/step.

## Recipe yield (measured)

- whole graph in one view: 101×136 cells, 35 bridges, 6 ambiguous labels → split.
- 6-rank cuts: 52×48 / 62×48 — one row over the 47-row canvas, 1–2 skipped labels.
- 5-rank 11-node machine view: 76–81 columns wide, 2 skipped + 2–3 ambiguous labels.
- the anti-parallel pair in adjacent lanes is ambiguous even with 1-character labels: the engine's
  neighbour test, not the wording, decides. Two fixes were measured: a third (sparse, 4-edge) view,
  rejected as the over-split round 11 was faulted for, or the 2-rank corridor, shipped.

## Abbreviations (all documented in the ledger)

`create/term/repair`, `diag uploads`, `allocate inst`, `boot.ipxe+S3 args`, `reg + heartbeat`,
`proposals` (= proposed actions). A 22-character gutter band has no clear home beside a shared
rank-0 route at 77 columns; 16-character labels place, 18+ are skipped (measured).

## Evidence

- `evidence/v1/`, `evidence/v2/`: `--check`, plain text, ANSI, `--select-all` ANSI, 120-frame capture,
  pane manifest with `cleanup: confirmed_closed`.
- Pinned target-size dumps of the final specs: `evidence/vN/vN-77x47-frames.txt` (fit proof: the
  `viewport: 77x47 zoom: 1.00 natural` line, no overflow banner), `vN-77x47-lap.txt` (120 frames,
  full lap), `vN-77x47-select-all.txt` (all nodes selected at target size).
- Pane header measured 83×51 in this tab; the pinned dumps are the accepted fit proof.
- Motion: 12/12 and 11/11 dots live and moving between frames 0 and 10, arrival reached at the
  arrowhead within the 120-frame lap; `--check` reports one constant rate for every route.
- `attempts.json` (2 views, ≤3 attempts each), `attempts-log.jsonl` (every probe, rejected draft and
  final check, with command, exit status and raw stdout/stderr hashes).

## Validator

```
scripts/viz-validate.py …/evidence/v1 --require-select --require-frames --require-records --attempts …/attempts.json
all checks passed
scripts/viz-validate.py …/evidence/v2 --require-select --require-frames --require-records --attempts …/attempts.json
all checks passed
```

## Known defects

- v1 keeps 6 bridges / 4 touching bends among the four Postgres writers; v2 keeps 2 bridges at the
  machine fan. Removing them by re-splitting measured worse label placement (skips), so they stay.
- In v2 the 2-rank corridor lifts `boot server` to rank 0: the iPXE request runs upward along the
  left edge, the boot.ipxe response runs downward in the middle. Both are separate, labelled and
  unambiguous; adjacent lanes measured 2 ambiguous owners and cannot be read.
- The pair's labels are the two abbreviated ones (`boot.ipxe+S3 args`, `reg + heartbeat`): the
  corridor fixed the ambiguity, the width still forced the wording.
- `pub` appears in both views so that no Postgres writer is dropped from v1.

No blockers. No pane leaked; no judge, subagent, renderer, skill, rubric or commit touched.

# pipeline — round 09 generation

Generator `viz-ds09-1`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Candidate skill `docs/visualize-eval/rounds/09/SKILL.md` sha256 `ba2878c5…431381`.
Frozen renderer `/tmp/visualize-eval/round-09/bin/rataflow-view` sha256 `405a61a6…6db495b`.
No judge, no subagent, no renderer/skill/rubric edit, no commit, no install, no cargo.

## Step 0 — family

```
family: flow-chains
evidence: six stages and exactly six relations (E = N = 6, shallow one-hop hops) plus the
          brief's "slow, sparse motion for traffic", which is the animated chain signature.
```

Tie-breakers: density is E − N = 0, so it is a chain even though the API gateway fans to two
and Postgres converges from two; no bus between disconnected worlds, so not placement-planes
and no trunk is declared; no addresses, ports or qualifiers, so not identity-probe-maps;
motion is present but the fan is 2 wide, not the 5+ of a lifecycle machine. No secondary
recipe; the two 2-wide fans were drawn in source order with distinct labels (chain doing mesh
hygiene). Family was never reclassified.

## Views

One view. Six nodes, six edges, extent 31×46 cells — the whole chain reads at 77×47, and the
chains recipe forbids inventing branches or splitting hops across views.

| view | spec | carries |
|---|---|---|
| v1 | `specs/pipeline-v1-a1.json` (sha256 `2623986f…bb9357`) | all 6 nodes, e1–e6, the 4 action labels, group membership, all 6 traffic dots |

Evidence bundle `evidence/v1/`: `v1-text.txt`, `v1-ansi.ansi`, `v1-selected.ansi`,
`v1-frames.txt` (19 frames), `v1-77x47-pinned-frames.txt` (21 frames at the target),
`check.txt`, `bin.sha256`, `manifest.json`, `validator.txt`.

## Checks (check.txt, shipped spec)

```
extent=31x46 cells
crossings: 0 bridges, 0 touching bends
labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: ingress(2) control(2) compute(1) storage(1)
trunks:
dots: 6 single-dot routes, 0 periodic routes, 0 violations, 6 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 6/6 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

Validator: **all 33 checks pass** (`validator-v1.txt`).

## Levers used (and the source fact behind each)

| lever | value | source fact |
|---|---|---|
| group tags | ingress {CLI, API gateway}, control {Auth, Job queue}, compute {Worker pool}, storage {Postgres} | "semantic tiers, related color shades"; nothing is drawn around members (correct) |
| direction | `tb` | the brief narrates one pipeline direction, so the stage order reads top-to-bottom |
| rank pins / `minlen` / trunks | none | no source-stated tiers outranking depth, no corridor needing extra length, no shared bus |
| `label_slot` | not shipped (measured in v1-a3) | the four action labels are 4–7 characters and fit their rank gaps |
| dots / flow | `dots: 1`, `flow: true`, constant default | "slow, sparse motion for traffic": one dot per route, no rate invented |

## Group colour (v1-ansi.ansi, 82×51 pane)

- ingress: CLI `231;138;78` (row 3, cols 39–43), API gateway `241;164;108` (row 11, cols 35–47)
- control: Auth `211;134;155` (row 25, cols 31–36), Job queue `226;156;175` (row 25, cols 40–50)
- compute: Worker pool `211;134;155` (row 33, cols 38–50)
- storage: Postgres `125;160;184` (row 45, cols 36–45)
- routes `124;111;100`, node ink `235;219;178`, background `40;40;40`, palette corner `168;153;104`

## Structure claims, each with its capture and coordinates

Coordinates are 0-based `(row, col)`; pinned-frame coordinates are relative to a frame body
whose header line is row 0.

- **Separate auth/queue paths** — `v1-text.txt` row 19: `verify` cols 29–34 on corridor col 36,
  `enqueue` cols 40–46 on corridor col 38; corners row 23, arrowheads (24,32) and (24,41).
- **The auth read is not the worker write** — `v1-text.txt`: two arrowheads on Postgres' top
  border at (44,37) *read* and (44,39) *write*, from two distinct source ports (Auth bottom
  (28,32), Worker bottom (36,39)); labels at row 36 cols 27–30 and row 40 cols 41–45.
- **Unlabeled historical hops stay unlabeled** — `v1-text.txt` rows 7–10 (cli→api) and rows
  29–32 (queue→worker) carry no label; no protocol was invented.
- **Dots start at their own origins** — `v1-77x47-pinned-frames.txt` frame 0: (5,37), (13,33),
  (13,35), (27,29), (27,38), (35,36), each the first drawn cell after its own port.
- **Constant speed** — frame 0 → frame 2: every one of the six dots advances exactly one cell
  (0.5 cells per 100 ms step); the two routes that round a corner inside one interval show a
  two-cell step there; each dot loops its own route (cli dot back at (5,37) on frame 10).
- **No dot on a corner, junction or label** — all 21 pinned frames scanned: 0 hits; check
  agrees with `0 violations`.
- **Fit** — pane header token `82x51 @100%` (`v1-text.txt` row 0) is larger than the target, so
  the accepted proof is the pinned dump of this final spec: `viewport: 77x47 zoom: 1.00
  natural` with all six boxes inside the 47-line frame body and no `overflows` banner.
- **Palette corner intact** — pinned frame 0 rows 40–45, cols 1–9.

## Attempts (cap 3 per view, 1 view)

| label | spec | result |
|---|---|---|
| v1-a1 | `specs/pipeline-v1-a1.json` | **shipped**: extent 31x46, crossings 0, labels 4/4, 0 ambiguous, origins 6/6 |
| v1-a2 | `specs/pipeline-v1-a2.json` | rejected by the renderer: `label_slot` on all four labelled edges → exit 1, "no obstacle-safe route for api -> auth, api -> queue" |
| v1-a3 | `specs/pipeline-v1-a3.json` | `label_slot` on read+write: extent 31x42, crossings 0, labels 4/4 — not shipped, the `read` label lands in a side gutter between the Auth dot and the queue dot |

Every `--check` ran through `scripts/viz-evidence.sh record`; raw stdout/stderr are in
`attempts-log.jsonl` + `recorded/`, and the validator's `attempts_records_complete` passes.

### Recipe yields

1. `label_slot` on the two parallel fan edges — **yielded**, measured (v1-a2, exit 1 above).
2. `lr` orientation for a 5-rank chain — **unmeasured** (evidence gap). The derived bound is
   node boxes 5+13+13+13+10 = 54 columns plus four engine-reserved label slots (verify 6,
   enqueue 7, read 4, write 5) and at least one arrow cell each ≈ 88 columns against 77. The
   three-candidate cap for v1 was already spent, so no `lr --check` could be run.
3. Label ownership won over height: a1 is 4 rows taller than a3 but keeps `read`/`write` in
   rank gaps next to their own corridors instead of beside another route's dot.

## Defects and blockers

- **d1 group hue collision.** `control` (Auth) and `compute` (Worker pool) both resolve to
  `211;134;155`, so two tiers read as one hue family. Field lever: the hue derives from the
  group name, and renaming a group is a fourth spec candidate — over the cap.
- **d2 thin vertical margin.** 31×46 in a 47-row viewport: fits exactly at the target (proven
  by the pinned dump) and would overflow in a shorter pane. The 31×42 alternative (v1-a3) buys
  margin at the cost of label ownership.
- **Blockers.** (a) one lr orientation measurement; (b) four separated hue families from the
  frozen renderer. Both need either one extra candidate allowance or a renderer palette fix.

## Cleanup

Pane `w7E:pNH` opened by `viz-evidence.sh`, close `confirmed_closed` in
`evidence/v1/manifest.json`. The captain's tab and raw tmux were never used. No cleanup
failure to report.

## Not done (out of contract)

No independent review — round 09 forbids the skill's Step 9 reviewer; a separate terra judge
runs after this report. This sample is not self-marked green.

# server-nic-layout — round 05 generation (fresh DeepSeek)

Generator: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`, worker label `viz-ds05-4`.
No judge, no reviewer, no renderer edit, no rebuild.

Frozen inputs (verified with `shasum -a 256`):

- skill `docs/visualize-eval/rounds/05/SKILL.md` = `ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949`
- binary `/tmp/visualize-eval/round-05/bin/rataflow-view` = `b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404`

Motion scope: the source never animated anything, so **every view is static** — every edge
carries `dots: 0`, no edge sets `flow`, and each view's five timestamped frames are
byte-identical over the app's 51-row window.

## Views

| view | direction | spec | extent | crossings | labels | capture |
|---|---|---|---|---|---|---|
| v1 ports + uplink | tb | `specs/v1-a3.json` | 34x32 | 0 bridges, 0 touching bends | 3/3, 0 on route, 0 skipped, **0 ambiguous** | `evidence/v1/` |
| v2 the /29 pool | lr | `specs/v2-a2.json` | 62x39 | 0 bridges, 0 touching bends | 3/3, 0 on route, 0 skipped, **0 ambiguous** | `evidence/v2/` |
| v3 upstream + caveat | tb | `specs/v3-a3.json` | 64x32 | 0 bridges, 0 touching bends | 4/4, 0 on route, 0 skipped, **0 ambiguous** | `evidence/v3/` |

Measured pane size, all three views: **83x51 @100%** (app header token). Target 77x47 was not
reachable — see blockers. `pinned77/<view>-frames-77x47.txt` are supplementary
`COLUMNS=77 LINES=47 --frames 5` dumps: they report `viewport: 77x47 zoom: 1.00 natural` and
contain no `graph overflows` notice, and every extent fits inside 77x47.

## Meaning ledger

| fact | kind | fate |
|---|---|---|
| server1 = 103.19.91.58, Dell R7725 | address+id | drawn (v1 `.58`, keyed by the full `.57` on the same view) |
| server1 bare metal | residency | dropped — provisioning, no topology |
| server2 = 103.19.91.59, R7725 | address+id | drawn (v2) |
| NxtGen Cloud AS132717, Bengaluru | identifier | AS132717 drawn on v1's gateway; Bengaluru dropped (location) |
| 8 physical NICs, one active `eno16595np0` 25 GbE | id+role | drawn (v1 `7 of 8 dark` + `eno16595np0 25 GbE`) |
| seven ports dark | state | drawn (v1, dashed `no cable?`) |
| /29: gw .57, s1 .58, s2 .59, .60-.62 free | address pool | drawn (v1 full address, v2 pool) |
| no NAT, public L3 straight to host | limitation | abbreviated to v2 `no NAT, no v6` |
| no IPv6 | limitation | drawn (v2) |
| gateway answers at 0.1 ms | measurement | drawn (v1 `def gw 0.1 ms`) |
| MAC OUI = Arista | identifier | vendor only; the ToR/leaf **role** is deliberately not drawn (OUI does not prove it) |
| Airtel 14.143.x 1.8 ms | hop+measurement | drawn (v3) |
| Airtel backbone 14.141.x 7.1 ms | hop+measurement | drawn (v3) |
| Cloudflare 1.1.1.1 AS13335 at 8.6 / 8.3 ms | hop+qualifier | drawn as `8.3-8.6 ms` — the range keeps the two source values instead of picking one |
| hops 3,6 silent; hop 5 lost 80% | uncertainty | `L2? hops 3,6 nil`; the 80% drop is dropped for label budget |
| one uplink, one visible ISP, no ECMP | topology+limit | `1.8 ms, 1 ISP` on the gateway→ISP hop + the single-chain shape |
| fabric above the ToR invisible; L2 unproven | uncertainty | drawn on a dashed annotation spur labelled `unproven`; no switch invented |
| fresh handoff: no GPUs, no rack-bench, up 1.5 d | state | `fresh 1.5d, no GPUs`; rack-bench dropped for label budget |
| border-leaf pattern analogy | interpretation | dropped — analogy, not a fact about this box |

## Relationship audit

| id | from → to | verb / tech | label owner | view |
|---|---|---|---|---|
| e1 | dark → s1 | inactive ports, no cable | `no cable?` (dashed) | v1 |
| e2 | s1 → nic | the one uplink out of the host | `only uplink` | v1 |
| e3 | nic → gw | default gateway, 0.1 ms | `def gw 0.1 ms` | v1 |
| e4 | nic → gw | routed /29 attachment, no NAT, no v6 | `no NAT, no v6` | v2 |
| e5 | s2 → gw | same /29 segment | `same /29` | v2 |
| e6 | spare → gw | free addresses in the /29 | `free? in /29` | v2 |
| e7 | gw → airtel | transit, 1.8 ms, one visible ISP | `1.8 ms, 1 ISP` | v3 |
| e8 | airtel → airtelbb | Airtel backbone, 7.1 ms | `7.1 ms` | v3 |
| e9 | airtelbb → cf | Cloudflare, 8.3-8.6 ms | `8.3-8.6 ms` | v3 |
| a1 | gw ⇢ l2q | **annotation, not a link**: the trace's silence leaves the fabric's layering unproven | `unproven` (dashed) | v3 |

Each label belongs to exactly one edge; no label string is shared. e3 and e4 are the same node
pair in two different views, so no single frame carries two same-pair routes.

## Trunk decision (round-05 rule)

No trunk is used. The only real shared bus is the routed /29. The renderer expresses a trunk as
one corridor `from → to` plus one spur from that corridor out to each branch, i.e. a hub can only
be written as `from: <one member>, to: gateway, branches: [the rest]`. The source states every
member's direction as member → gateway (`nic -> gw`, `s2 -> gw`, `spare -> gw`); that trunk form
would make one member the corridor source and point the other two spurs away from the gateway,
reversing two stated edges. So plain edges carry the /29 and the contradiction is recorded here.
No trunk candidate was checked, so no attempt budget was spent on it.

## Split coverage map

| view | carries |
|---|---|
| v1 | e1–e3; the port card, the one uplink, gateway address + AS132717, fresh-handoff state |
| v2 | e4–e6; the /29 pool with server2 and the free range |
| v3 | e7–e9 + a1; observed upstream hops, single ISP, silent-hop / L2 caveat |

## Commands

```sh
BIN=/tmp/visualize-eval/round-05/bin/rataflow-view
D=docs/visualize-eval/rounds/05/server-nic-layout
for v in v1; do "$BIN" --check $D/specs/v1-a3.json; done          # every candidate kept in attempts/
scripts/viz-evidence.sh --spec $D/specs/v1-a3.json --bin "$BIN" --out $D/evidence/v1 --label v1 --frames 5
scripts/viz-evidence.sh --spec $D/specs/v2-a2.json --bin "$BIN" --out $D/evidence/v2 --label v2 --frames 5
scripts/viz-evidence.sh --spec $D/specs/v3-a3.json --bin "$BIN" --out $D/evidence/v3 --label v3 --frames 5
scripts/viz-validate.py $D/evidence/v1 --require-select --require-frames --attempts $D/attempts.json
# supplementary pinned-size proof
COLUMNS=77 LINES=47 "$BIN" --frames 5 $D/specs/v2-a2.json > $D/pinned77/v2-frames-77x47.txt
```

## Exact `--check` lines (final views)

v1 (`evidence/v1/check.txt`):

```
ok: nodes=5 edges=3 flows=0 direction=tb theme=gruvbox
extent=34x32 cells
crossings: 0 bridges, 0 touching bends
labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: server1(4) nxtgen /29(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

v2 (`evidence/v2/check.txt`):

```
ok: nodes=4 edges=3 flows=0 direction=lr theme=gruvbox
extent=62x39 cells
crossings: 0 bridges, 0 touching bends
labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: nxtgen /29(3) server1(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

v3 (`evidence/v3/check.txt`):

```
ok: nodes=5 edges=4 flows=0 direction=tb theme=gruvbox
extent=64x32 cells
crossings: 0 bridges, 0 touching bends
labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: nxtgen /29(1) isp transit(2) cloudflare(1) trace caveats(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

## Validator

Each view: **31 PASS, 2 FAIL** (full output in `validators/`).

```
FAIL routes_economy_reported — no 'routes: N/M near-minimal, K detours' line; route economy cannot be checked
FAIL viewport_matches_target — measured 83x51, target is 77x47
```

## Blockers

1. **No `routes:` line exists in the frozen binary.** `strings` finds zero hits for
   `near-minimal`/`detour`, and none of the 9 raw check outputs contains the line, so route
   economy cannot be shown for any view. Not fixable without changing the binary (forbidden).
2. **Viewport is 83x51, not 77x47.** `scripts/viz-evidence.sh` splits the caller pane at a fixed
   ratio 0.5; this tab is 168x53, so the half pane is 83 wide and no harness path yields 47 rows.
   Recorded as measured. Mitigation: pinned `COLUMNS=77 LINES=47` dumps plus extents all inside
   77x47.
3. **`herdr pane layout` returned no rect** for the capture panes (`pane_rect`/`pane_cols` null),
   so the width proof rests on the app's header token alone.

## Honest defects

- Isolated nodes are not reliably drawn: **v3-a1 declared 6 nodes, the frame drew 5** while
  `--check` still said `nodes=6` and `labels: 3/3 placed` — the undrawn `L2? unproven` box was a
  node label, which the labels line does not count. Worked around in v3-a3 (caveat node on a
  dashed annotation spur); `--check` cannot detect this class of defect at all.
- v2 does not restate server1's `.58`; the pool view shows only the port. The address pair is
  complete across v1+v2, not inside v2.
- v2's star is tall (39 rows at 83 columns): readable, unclipped, 0 crossings, but taller than
  necessary. Kept over the tb candidate (95x16, overflow + 1 ambiguous owner).
- Group hues are stable by name (gateway border `38;2;169;182;101` in both v1 and v2) but the
  hash collides across views: server1 blue `38;2;125;160;184` equals Cloudflare blue in v3. Never
  visible in the same frame; recorded, not hidden.
- AS132717 appears once (v1); v2 could not take it (85x39 overflow in v2-a3).

## Attempt budget

3 views, 3 candidates each, 9 `--check` runs, all raw outputs in `attempts/` and indexed in
`attempts.json`. Final: `v1-a3`, `v2-a2`, `v3-a3`; rejected attempts kept with their reasons.

## Cleanup

v1 pane `w7E:pGB`, v2 pane `w7E:pGE`, v3 pane `w7E:pGG` — all `confirmed_closed` by the harness.
No cleanup failures.

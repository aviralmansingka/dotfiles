# server-nic-layout — round 04 generation

Generator: pi worker subagent, fresh DeepSeek generator
(`fireworks/accounts/fireworks/routers/deepseek-flash-latest`), no judges spawned.

| Frozen input | SHA-256 |
|---|---|
| candidate skill `docs/visualize-eval/rounds/04/SKILL.md` | `ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c` |
| executable `/tmp/visualize-eval/round-04/bin/rataflow-view` | `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc` |

Both hashes were re-checked with `shasum -a 256` in this worktree before any spec was
authored. The binary was invoked by absolute path only, never rebuilt or substituted.

## What was drawn

Three focused views instead of one wide graph. The split exists because the member →
gateway fan and the host chain fight for the same label slots: the first three-edge
attempt produced a label with no unambiguous owner.

| View | Direction | Extent | Nodes / edges | Content |
|---|---|---|---|---|
| v1-host | tb | 48×21 | 4 / 2 | seven dark ports → server1 (R7725, 103.19.91.58) → the single active `eno16595np0 25 GbE` uplink |
| v2-subnet | lr | 69×18 | 5 / 3 | the routed /29: NIC `.58`, server2 R7725 `.59`, pool `.60-.62` (free?) → Arista gateway `103.19.91.57` at 0.1 ms; key note `/29 · no NAT · no v6` |
| v3-upstream | tb | 68×29 | 6 / 3 | Arista AS132717 → Airtel 14.143.x (1.8 ms, dashed, `L2?`) → Airtel backbone 14.141.x (7.1 ms) → Cloudflare 1.1.1.1 AS13335 (8.3-8.6 ms); notes for the invisible fabric and for "one uplink, no ECMP" |

Measured size for all three: the live app's own header token `77x47 @100%` (line 1 of each
`*-text.txt`). No panning, no zooming out; no view reports `graph overflows`.

Motion: static by the round-04 case note — every edge declares `dots: 0`, so nothing about
dots or arrivals is claimed and no frame dumps were captured.

## Full `--check` output (final specs)

v1-host (`evidence/v1/check.txt`)

```
viewport: unknown zoom: 1.00 natural
ok: nodes=4 edges=2 flows=0 direction=tb theme=gruvbox
layers=3 (explicit placement, sugiyama skipped)
extent=48x21 cells
crossings: 0 bridges, 0 touching bends
labels: 2/2 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: plant(2) facts(1) host(1)
trunks:
routes: 2/2 near-minimal, 0 detours, 0 shortened
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

v2-subnet (`evidence/v2/check.txt`)

```
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=3 flows=0 direction=lr theme=gruvbox
layers=2 (explicit placement, sugiyama skipped)
extent=69x18 cells
crossings: 0 bridges, 0 touching bends
labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: plant(1) host(1) pool(1) access(1) facts(1)
trunks:
routes: 3/3 near-minimal, 0 detours, 0 shortened
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

v3-upstream (`evidence/v3/check.txt`)

```
viewport: unknown zoom: 1.00 natural
ok: nodes=6 edges=3 flows=0 direction=tb theme=gruvbox
layers=4 (explicit placement, sugiyama skipped)
extent=68x29 cells
crossings: 0 bridges, 0 touching bends
labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: access(1) transit(2) internet(1) facts(2)
trunks:
routes: 3/3 near-minimal, 0 detours, 0 shortened
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

`routes: … 0 detours` and `0 ambiguous owners` hold in every view. `origins:`/`arrivals:`
read `0/0` because no route is animated — the case note forbids dots here, so there is no
motion to prove and none is claimed.

## Attempts (budget: 3 spec candidates per view)

The first design was a single access view carrying all five access relations. It spent its
budget on layout, so both its probes are recorded as an **abandoned view** (`v0`) rather than
folded into v1: 7 nodes, 5 edges, 2 bridges and a 64-cell wrap-around route in probe 1;
0 crossings but still 1 ambiguous label in probe 2. That is when I split the material into
v1/v2/v3.

Disclosure: the two v0 probes first reused the filenames `attempts/v1-attempt{1,2}.check.txt`,
which the split later overwrote. Their check files in this bundle are deterministic re-runs of
the same spec bytes (`spec_sha256` unchanged and listed in `attempts.json`); no output was
edited or reconstructed by hand.

| View | Attempt | Verdict | Why |
|---|---|---|---|
| v0 | 1 | abandoned | all five access relations in one tb graph: 2 bridges, 1 touching bend, the s2→gw route wrapped 64 cells around the gateway, 1 ambiguous label |
| v0 | 2 | abandoned | /29 members flattened into one layer: crossings 0, but the short nic→gw stub still had no unambiguous label slot |
| v1 | 1 | rejected | server1 carried the bare octet `.58` — an abbreviation with no `/29` key on that view |
| v1 | 2 | rejected | full address fixed the key, but `no cable?` anchored one cell right of its own vertical, printing flush against the arrowhead (`▼no cable?`) |
| v1 | 3 | **final** | host note moved left of the dark-port node, so the dark→server1 route owns a long run and its label rides above it |
| v2 | 1 | rejected | tb with all sources in one row: the router wrapped the s2 route around the nic box (1 bridge, 1 touching bend, 61-cell forced route) and `0.1 ms` had no unambiguous slot (1 ambiguous owner) |
| v2 | 2 | **final** | same seed graph drawn lr: each member owns a long horizontal run, so every label sits closer to its own edge |
| v3 | 1 | rejected | 5 layers with a top note band put the Cloudflare box at rows 39-42, under the floating control palette, which overwrote its border |
| v3 | 2 | rejected | one long fabric note widened the graph to 81×29 — wider than 77, so the pane said `graph overflows · drag to pan` |
| v3 | 3 | **final** | AS132717 on the gateway, the fabric note beside Airtel, "1 uplink · no ECMP" beside the backbone |

Every attempt's raw `--check` output is preserved in `attempts/<name>.check.txt`; the specs
themselves are in `attempts/` and the three finals are also in `specs/`. Counts used:
v0 = 2, v1 = 3, v2 = 2, v3 = 3 (10 checked specs, per-view budget respected).

## Validator

`scripts/viz-validate.py evidence/<v> --require-select --attempts attempts.json` returns
`all checks passed` for v1, v2 and v3 (full transcripts in `evidence/<v>/validate.txt`).
Notably green: `check_warnings_absent`, `labels_ownership_clear`, `routes_no_detours`,
`viewport_proven`, `viewport_matches_target`, `cleanup_confirmed`, `select_all_artifact`,
`attempts_spec_budget`.

## Trunk direction — why no trunk

Every relation terminates at the gateway (`nic→gw`, `s2→gw`, `spare→gw`). A trunk with
`from: gw` and the members as branches would state gateway→member and reverse the direction
the source gives. A trunk rooted at one member cannot fan out to sibling members without
inventing relations. So the views use plain edges and each check prints an empty `trunks:`
line.

## Meaning kept (qualifiers that had to survive)

- full address `103.19.91.57` printed in v2 (line 19, col 47) and v3 (line 12, col 6)
- `free?` on the pool — v2 edge label `free? in /29` (line 29, col 22)
- `L2?` on the first transit — v3 edge label `1.8 ms · L2?` (line 16, col 7)
- `8.3-8.6 ms` — the prose/fact disagreement kept as a range (v3 line 32, col 13)
- `ToR?` — MAC OUI does not prove a ToR role (v2 line 19)
- `no cable?` — dark ports do not prove an absent cable (v1 line 20)
- R7725 with **both** boxes (v1 line 24, v2 line 25)

## Known defects

1. v2's three member routes enter the Arista box as short risers beside its left edge
   (`evidence/v2/v2-text.txt` lines 16-31). Each arrowhead is separate and no routes share a
   corridor, but the eye must follow a riser upward instead of reading one straight line.
2. v1 is deliberately small (2 edges, 4 nodes); the richer host+gateway shape failed label
   ownership in the first attempt.
3. Isolated note nodes (v1, v2, v3) carry facts with no edge of their own.

## Blockers

None on capability — `group`, `style: "dashed"`, `dots: 0` and explicit `layers` covered every
shape these views needed. Measurement caveat (not a blocker): `--check` runs outside a pane
and prints `viewport: unknown`, so the size proof is the app's header token `77x47 @100%`;
`viz-evidence.sh` recorded `pane_rect: null` but `pane_rows: 47`.

## Cleanup

All three panes were opened by `viz-evidence.sh` in this session's own tab and closed by it:
`w7E:pDZ` (v1), `w7E:pDV` (v2), `w7E:pDW` (v3), each `cleanup: confirmed_closed` in its
`manifest.json`. No cleanup failures. The captain's tab and raw tmux were never touched.

## Approval

Not claimed. No independent review was run; the captain starts a separate Sol judge.

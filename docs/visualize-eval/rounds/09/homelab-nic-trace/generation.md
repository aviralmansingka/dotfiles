# homelab-nic-trace — round 09 generation (viz-ds09-3)

Generator: fresh DeepSeek generator, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Candidate skill `docs/visualize-eval/rounds/09/SKILL.md` (sha256 `ba2878c5…6d431381`) governs.
Renderer `/tmp/visualize-eval/round-09/bin/rataflow-view` (sha256 `405a61a6…6b495b`), used by absolute
path in every command. Target 77×47 @100% natural zoom.

Read scope: `docs/visualize-eval/cases/homelab-nic-trace/source.md` only. `expected.json` and
`historical-variants.json` were not opened; no other case output was read.

## Step 0 — family

```
family: identity-probe-maps
evidence: 13 of 14 nodes are addresses, device names or AS numbers
(bond0 192.168.1.197, 100.113.153.49, 172.18.2.1, 169.254.3.1, AS701,
100.41.x) and the brief marks two device roles claimed/historical, so
omission — not geometry — is what loses meaning.
```

Tie-breakers considered in the skill's order:

1. Density `E ≈ N` (14 edges / 13 nodes) — chain-like, not mesh or fabric. No
   anti-parallel pair, no redundant lane the source calls redundant.
2. No bus between disconnected worlds — everything reaches `box` through the
   uplink, so `placement-planes` does not apply.
3. Identifier/qualifier content outranks shape → `identity-probe-maps`.
4. Motion is not a signature: the source reports a topology statically, so the
   diagram is static and carries no dots.

Secondary recipe: none. The `rtr` fan (2 in, 1 out) was tested mentally against
`service-meshes` and rejected — the source states no anti-parallel pair, so no fan
port order and no paired edge is owed.

## Coverage map and family recipe per view

| view | carries | recipe | capture |
|---|---|---|---|
| v1 host-local | vm, virbr, ctr, dkbr, ts, box — e1–e5 | every identifier/qualifier is a coverage row before the spec; ranks follow the fact cluster (segments → bridges → host) | `pinned/v1-77x47.stdout` L5–L48 |
| v2 uplink ports | ts, box, bond0, wlp — e6–e8 | the two port identifiers and the metric-600 qualifier drawn on separate ports so the uplinks never merge | `pinned/v2-77x47.stdout` L17–L37 |
| v3 egress | bond0, wlp, rtr, ont, vzagg, vzbb, cf — e9–e14 | every address, AS number and qualifier as its own row; ranks follow the chain outward | `pinned/v3-77x47.stdout` L6–L46 |

Join nodes: `bond0` (v1, v2, v3), `box` (v1, v2), `wlp` (v2, v3), `ts` (v1, v2).
Each view shows the relations that start or end at them; no relation is
duplicated and none crosses a boundary untraceably. All 14 relations and all 25
ledger rows name a view (see `generation.json` → `relationship_mapping`,
`meaning_ledger`; full reasoning in `ledger.md`).

## Structural levers

- **Groups** (`group`, logical tags only — nothing is drawn around members):
  `virtual` {vm, virbr, ctr, dkbr}, `overlay` {ts}, `physical` {box, bond0, wlp},
  `egress` {rtr, ont, vzagg, vzbb, cf}. These are the four tiers the task names
  ("physical, virtual, overlay, and egress relations"). Measured hues in
  `evidence/*/*-ansi.ansi`: virtual pink (226,156,175 / 211,134,155 / 238,180,196
  / 187,108,131), physical teal (125,174,163 / 147,194,183 / 99,151,141), overlay
  olive (169,182,101 in both v1 and v2), egress gold (216,166,87 … 177,136,71).
  Sibling order is stable: virtual `container veth` before `VM vnet0`,
  `dkbr` before `virbr0` before `ts0`, physical `bond0` before `wlp8s0`.
- **`label_slot: true`** on all six v3 edges, and nowhere else. Justification: a
  rank gap is as tall as the widest label crossing it, which is exactly why the
  first host draft measured 62 rows. With gutters, v3's six labelled ranks cost
  54×44. Every label there is ≤ 11 characters (`gw 0.5 ms`, `metric 600`,
  `NAT out`, `4.5 ms`, `6.6 ms`, `6-9 ms`) — no word was shortened for it.
- **Rank pins (`layers`), `minlen`, `trunks`**: not used. The source names no
  tiers to pin beyond the groups above, no corridor gap, and no shared bus (the
  `rtr` fan is three separate labelled relations, and a trunk would merge them).
- **Direction** `tb` in every view (see the yield). No coordinates are written
  anywhere; placement is engine-owned.

## Family recipe yield (measured)

| demand | spec | measurement | outcome |
|---|---|---|---|
| deep `lr` chain for the 6-rank egress chain | `specs/v2-egress-lr.json` | `extent=189x9` | 189 columns vs a 77-column target: impossible once every rank carries an address label |
| one 8-node host view (e1–e8) | `specs/v1-host-tb.json` | `extent=66x62` | 62 rows vs 47: four ranks, each gap as tall as its widest label |
| same view, `label_slot` on all 8 edges | `specs/v1-host-tb2.json` | exit 1, `no obstacle-safe route for vm -> virbr, …` | gutters on every edge of a converged 4-rank view leave no corridor |

So the identity-map recipe's "deep lr chain" yields to `tb` in the egress view and
the host cluster yields from one view to two. v3 still keeps the whole outward
chain in one picture reading top-to-bottom (44 of 47 rows); the host side pays
with two three-rank views, which is the price of 19-character addresses.

## Checks

Every view: `crossings: 0 bridges, 0 touching bends`; labels fully placed with
`0 on route cells, 0 skipped, 0 ambiguous owners`; `dots: 0 … 0 violations`;
`origins: 0/0`, `arrivals: 0/0` (no animated route exists); no `warning:` line.

| view | extent | labels | groups |
|---|---|---|---|
| v1 | 55×44 | 5/5 | virtual(4) overlay(1) physical(1) |
| v2 | 54×22 | 3/3 | overlay(1) physical(3) |
| v3 | 54×44 | 6/6 | physical(2) egress(5) |

Motion: none, and the source never shows motion. Three timestamped frames per
view (0/100/200 ms) contain identical drawn art — `evidence/*/*-frames.txt`
(45, 26 and 45 glyph lines respectively, identical frame to frame).

Fit: the live pane measured **82×51** (`header token`, all three manifests), larger
than the target. Fit at the target is proven by a pinned direct dump of each view's
FINAL spec at exactly `COLUMNS=77 LINES=47`: `pinned/v1-77x47.stdout`,
`pinned/v2-77x47.stdout`, `pinned/v3-77x47.stdout`, each starting
`viewport: 77x47 zoom: 1.00 natural` with no `overflows` banner.

Validator (`scripts/viz-validate.py <bundle> --require-select --require-frames
--require-records --attempts attempts.json`): **all checks passed** for v1, v2 and
v3 (full output in `evidence/<view>/validator.txt`).

## Attempts

6 `--check` runs on distinct specs, all recorded through
`scripts/viz-evidence.sh record` in `attempts-log.jsonl` (plus the three pinned
dumps, recorded the same way). Budget: 3 views of 4, and 3/1/2 attempts against
the cap of 3 per view. Detail in `attempts.json`.

## Known defects

1. Pane measured 82×51, not 77×47; fit rests on the pinned 77×47 dumps under the
   round-09 pinned ruling, not on the pane.
2. v3's spine is a staircase (drifts right as it descends, `pinned/v3-77x47.stdout`
   L5–L46). No crossing or label defect results; straightening would need
   coordinates a spec may not carry.
3. v2 is sparse (54×22) because it carries only the two uplink ports. It exists to
   keep wired primary and Wi-Fi backup separate without pushing the host view past
   47 rows.
4. `box` and `ts` appear in two views; a reader must follow two views to see all of
   `box`'s relations. Declared in the coverage map, not hidden.
5. The first v1 capture read the pane before the app had drawn (a 182-byte file
   holding only the echoed command line). It was re-captured; the bundle now holds
   a real frame. Recorded rather than hidden.

## Deliberate drops

- **D1** shared Fios pool IP 71.251.12.240 — a home-shared egress address, not a
  relation of this host; `NAT out` already carries translation.
- **D2** datacenter-model comparison (collapsed fabric, MMR analog, 4-ISP/2-MMR) —
  commentary onto a different diagram; states no relation of this host.
- **D3** "no committed rate" — a measurement property of a test result, not a link.

## Cleanup

Three panes, each split with `--no-focus` inside this worker's own tab and closed by
the harness; every manifest reads `cleanup: confirmed_closed` and `herdr pane get`
fails afterwards. No captain pane touched, no pane art pasted into chat.

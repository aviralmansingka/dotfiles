# C4 probe — modal-machine-manager through the C4 lens (round 13 appendix)

Owner-requested capability probe: **can the current `visualize` skill + the frozen round-13 engine
carry a C4 ask, or does C4 need its own skill?** Output: one canvas, one described diagram per C4
level the source supports.

Frozen inputs: binary `/tmp/visualize-eval/round-13/bin/rataflow-view` (sha `1f28d87d…`), skill
`rounds/13/SKILL.md` (proposal 12, sha `65d826f0…`), rubric rev 11. Facts only from
`docs/visualize-eval/cases/modal-machine-manager/source.md`.

## Verdict in one line

**Partial.** L1 context and L2 containers are expressible and clean; L2 needs **two** diagrams
(the engine refuses one 17-node/23-edge section), the C4 boundary is only expressible as node
label + hue family (no painted boundary), L3 is unsupported by the source, and the owner's canvas
chrome (top divider, uniform divider width) is **blocked** — the engine has no field for it.

## Triage (skill Step 0)

Annex `TRIAGE-modal-machine-manager`. Provoked: scope (all 23 relations?), shape (one canvas or
panes?), motion (one dot per live transition?), C4 levels (which does the source support?), the
component level (does the source state webapi internals?), may one level own two diagrams?, is the
machine-agent inside the boundary?, do "historical claims" need dashed edges?, does a context edge
expand or repeat? Answered by the annex: scope (all), shape (one canvas, described diagrams),
motion (slow sparse dots, one per transition, none on a border). Own judgment: L3 omitted (no
source internals), L2 takes two diagrams (engine budget, measured), agent inside the boundary, no
dashed edges, context edges expand (recorded in the coverage map).

Shape: **canvas, 3 described diagrams**. Family: **lifecycle-machines** (wide fan out of the queue
and machine spine, one live dot per line). Borrowed: the anti-parallel boot pair stays in one
diagram (service-mesh habit) and the manager sits between its caller and its externals
(placement-plane habit at context zoom).

## What shipped

| diagram | C4 level | title | extent | nodes/edges | direction |
|---|---|---|---|---|---|
| l1 | L1 context | L1 · System context — the machine manager | 57x37 at 0,3 | 6 / 7 | tb |
| l2a | L2 containers | L2 · Containers — request, provisioning and boot | 228x16 at 0,45 | 12 / 14 | lr |
| l2b | L2 containers | L2 · Containers — heartbeat, audits and diagnostics | 175x13 at 0,66 | 10 / 9 | lr |

Whole canvas **228x79**, 28 node instances, 30 edges, 12 animated routes. L3 component: **omitted**
(source states no container internals — drawing auth/intake/jobs/persistence would invent them).
L4 code: out of scope.

Every one of the 23 source relations is drawn verbatim exactly once, at the container level (where
both endpoints live); the context edges are aggregates and their expansions are recorded
(`generation.json → coverage_map.expansions`), e.g. `mm → machines "boot+audit"` expands to
`boot → mch boot.ipxe + S3 args` and `ssh → mch run machine-audit`.

## Evidence

- `specs/c4-canvas.json` — final spec (sha `1d7672ea…`); attempts 1–2 kept in `attempts/` +
  `specs/c4-canvas-attempt{2,3,4,5,6}.json`, probes in `probes/`.
- `evidence/canvas/` — one bundle: `check.txt`, pane text/ANSI/`--select-all`, 48 frames
  (pane-sized), the **whole-canvas** 228x80 dump, `manifest.json` (cleanup `confirmed_closed`),
  `validator.txt`, `frame-audit.txt`.
- Measured: pane token `68x44 @100%`; pinned whole-canvas `viewport: 228x80 zoom: 1.00 natural`,
  no overflow banner (extent 228x79 fits).
- Check: **0 near-miss cells**, 30/30 labels placed, 0 ambiguous owners, 0 labels on routes, 12/12
  dot origins, 0 dot violations, 0 pin conflicts, 1 bridge crossing.
- Frame audit: **PASS** — 12/12 routes steady, equal distance, 0.500 cells/frame; longest route 23
  cells → 46 frames required, 48 captured.

## C4 capability findings (the point of the probe)

1. **A C4 level can exceed one diagram.** All 17 containers + 23 relations as one section: `lr`
   exits 1 (`no obstacle-safe route for wapi -> q`), `tb` renders at 105x171 with the engine's own
   `warning: … 17 nodes / 23 edges, above the readable budget (12/16)`, 23 crossings, 73 near-miss
   cells and 1 skipped label. So a real container level must be split — and the canvas form has no
   way to say "these two diagrams are one C4 level".
2. **Owner canvas chrome is unreachable.** No rule above the first diagram (row 0 is the title),
   and the two rules differ: 228 cells (above l2a) vs 181 cells (above l2b). No spec field exists,
   so this is recorded, not imitated.
3. **C4 boundaries** have no rendering: `group` is hue only. A system/container boundary is a node
   label plus a family, never a drawn box.
4. **L3/L4** are not expressible here because the source has no internals, not because the engine
   lacks a feature — untested either way.

A dedicated `c4` skill would earn its place by specifying level-owned bands (a level heading over
several diagrams), boundary rendering, and the divider contract.

## Defects / blockers

- Labels shortened from source wording (`audit` for `audit / verify reimage`, `create/term/repair`,
  `reinstall/reprov`, `register+beat`), keyed in the diagram descriptions and the ledger; `BM`
  (bare metal) is keyed only in this record.
- The pane slice cannot show l2a/l2b headings; the whole-canvas 228x80 dump is the heading proof.
- Budget: 6 canvas candidates + 2 single-diagram probes (all recorded; listed in `attempts.json`,
  experiments under `abandoned_shapes`).
- Blockers: top divider, uniform divider width, L3 (source).

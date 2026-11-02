# datacenter-redundancy — round 04 fresh generation

Generator: fresh round-04 diagram generator (isolated pi worker subagent), model
`fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Candidate skill: `docs/visualize-eval/rounds/04/SKILL.md`, sha256 `ac431c6d3035e466e29136f36d9579c551c2e070a354dc5df72999b1bb1beb3c`.
Renderer: `/tmp/visualize-eval/round-04/bin/rataflow-view`, sha256 `0da16d8d8ed46e2a25eb773fc71ecad4de9e310cd33e303a4c7fe77231ad95bc`
(absolute path only, never rebuilt, never substituted).

Four views cover the 28 historical relationships exactly once each. No edge is
animated: the source forbids flowing dots (chat line 134), so all 28 edges carry
`"dots": 0` and no `flow` field, and no capture shows a dot.

## Arrow convention

An arrow runs from the endpoint named first in the historical facts to the one
named second. These are physical connectivity links, not proof of one-way
traffic: an arrow means "this port/cable reaches that device in the recorded
direction", never "traffic flows only this way". No endpoint was reversed to
make a layout easier.

## Views

| view | role | spec | check | size | crossings | labels | routes |
|---|---|---|---|---|---|---|---|
| v1 | ISP carriers → MUX appliances → core routers | `specs/v1.json` | `evidence/v1/check.txt` | 64×22 | 3 bridges, 3 touching bends | 4/4, 0 on route, 0 skipped, **0 ambiguous** | 8/8 near-minimal, 0 detours |
| v2 | cores → active/passive firewall pair → border leaves | `specs/v2.json` | `evidence/v2/check.txt` | 64×12 | 2 bridges, 2 touching bends | 8/8, 0 on route, 0 skipped, **0 ambiguous** | 8/8, 0 detours |
| v3 | fabric: both spines above the one border-leaf/rack-leaf row, racks below | `specs/v3.json` | `evidence/v3/check.txt` | 65×35 | 4 bridges, 2 touching bends | 8/8, 0 on route, 0 skipped, **0 ambiguous** | 8/8, 0 detours |
| v4 | spine → rack-leaf ECMP detail fan | `specs/v4.json` | `evidence/v4/check.txt` | 43×12 | 1 bridge, 1 touching bend | 4/4, 0 on route, 0 skipped, **0 ambiguous** | 4/4, 0 detours |

Measured viewport, all four: the running app's own header token `77x47 @100%`
(`evidence/<v>/<v>-text.txt` line 1), natural zoom, no pan. `--check` printed no
warning line for any view.

Full `--check` lines (identical shape in all four, values per view in
`generation.json`):

```
extent=64x22 cells
crossings: 3 bridges, 3 touching bends
labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
routes: 8/8 near-minimal, 0 detours, 0 shortened
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

## Coverage map (28 relationships, each drawn once)

- **v1** — `ispA→mux1`, `ispB→mux1`, `ispC→mux2`, `ispD→mux2` (unlabelled: the
  source gives no verb, so none was invented); `mux1→core1`, `mux1→core2`,
  `mux2→core1`, `mux2→core2` labelled `x-connect` on every link.
- **v2** — `core1→fw1`, `core2→fw1` `active`; `core1→fw2`, `core2→fw2`
  `standby` (dashed); `fw1→bl1`, `fw1→bl2` `active`; `fw2→bl1`, `fw2→bl2`
  `standby` (dashed).
- **v3** — `bl1→sp1`, `bl1→sp2`, `bl2→sp1`, `bl2→sp2` `ECMP`;
  `leaf1→rack1`, `leaf2→rack1`, `leaf1→rack2`, `leaf2→rack2` `dual`.
- **v4** — `sp1→leaf1`, `sp1→leaf2`, `sp2→leaf1`, `sp2→leaf2` `ECMP`.

No trunks anywhere: every redundant link keeps its own port and corridor, as
line 270 demands.

## Captures that back the claims

- **No dots.** `evidence/v1/v1-text.txt` … `evidence/v4/v4-text.txt` contain no
  `●` glyph (grep count 0 in all four), and the ANSI frames
  `evidence/<v>/<v>-ansi.ansi` carry only route, border and label cells.
- **Fit.** The header token `77x47 @100%` on line 1 of every text capture, plus
  no `graph overflows · drag to pan` line in any capture (the overflow banner
  does appear in the rejected probe `probes/v2-a1-frames.txt`, which shows what
  a real overflow looks like).
- **Fabric heights (line 248).** `evidence/v3/v3-text.txt`: spines at rows 8–11
  (cols 8–16 and 25–33), one row (rows 28–31) holding `BL 1` (cols 10–15),
  `BL 2` (cols 27–32), `Leaf 1` (cols 46–53) and `Leaf 2` (cols 62–69); racks at
  rows 38–41 (cols 46–53 and 62–69), i.e. below the rack leaves. Border leaves
  and rack leaves share one row and both spines sit above it.
- **Independent links (line 270).** `evidence/v1/v1-text.txt`: `MUX 1` (box cols
  21–27, rows 14–18) sends two separate arrows out of its right border at rows 15
  and 17 — one into `Core 1` (cols 63–70) and one into `Core 2`; `MUX 2` (rows
  20–24) does the same at rows 21 and 23. No shared bus, no trunk junction.
- **Standby path.** `evidence/v2/v2-text.txt` rows 22, 26, 28: every `standby`
  route is drawn with `╌` dashes through its bends, every `active` route solid;
  the word itself rides along the route.
- **Group colors.** Read back cell by cell out of `evidence/<v>/<v>-ansi.ansi`
  (SGR state at each node's top-left corner). Every node in a group gets a shade
  of one hue family: v1 `carrier` yellows 216,166,87 / 228,184,111 / 200,147,68 /
  239,202,138, `agg` aquas 125,174,163 / 147,194,183, `core` pinks 211,134,155 /
  226,156,175; v2 `core` yellows, `firewall` aquas, `edge` pinks; v3 `spine`
  yellows, `edge` aquas, `leaf` pinks, `racks` greens 169,182,101 / 189,201,124;
  v4 `spine` yellows, `leaf` aquas. Families stay distinct inside a view (see
  defect 6 for what does not hold across views).
- **Every node selected.** `evidence/<v>/<v>-selected.ansi` (captured with
  `--select-all`): 56 bold `rgb(216,166,87)` border segments in v1, i.e. the
  per-node selected border, distinct from the plain frame's per-group hues.

## Relationship audit

The full 28-row table (id, from → to, verb, label owner, view, drawn label) is
`generation.json → relationship_audit`. Each row's label owner is its own edge
id; no two edges share an ambiguous label.

## Meaning ledger

`generation.json → meaning_ledger`. Highlights:

- FW residency («FW1 active / FW2 standby») is **abbreviated**: node labels read
  `FW1` / `FW2`, and the `active` / `standby` words sit on all four links of each
  appliance in v2. Reason: the longer node labels pushed the lr view past the
  77-column pane (extent 79, `attempts/v2-a2-check.txt`).
- `ISP A…D` keep their own node identities rather than being collapsed into MUX
  labels; the four feeds are separately traceable in v1.
- `x-connect`, `active`, `standby`, `ECMP`, `dual` are the source's own words,
  kept verbatim.
- The historical compactness wishes (lines 150–166) are **dropped with reason**:
  they corrected a different, denser rendering; here the size target is the
  77×47 pane and all four views fit at natural zoom.

## Honest defects

1. **v1 has 3 bridges.** The MUX cross-connect forces one crossing; the two ISP
   pairs feeding the two MUXes add two more where the feeds weave. Fixing this
   needs a different split, and v1's three candidate checks were spent.
2. **v2 has 2 bridges**, one per cross-connected tier. A complete 2×2 fan has a
   crossing number of 1, so this is structural.
3. **v3 has 4 bridges.** The border-leaf → spine fan enters the spine boxes
   through side ports, so routes cross near each spine.
4. **v3 alone does not show the spine → rack-leaf ECMP fan** (it lives in v4).
   Someone opening only v3 sees spines wired to border leaves only. v3 is the
   view that satisfies the human's height rule, so the split runs along
   border-leaf/rack-leaf, and the coverage map names v4 for the rest.
5. **v1, v2 and v4 are `lr`, not `tb`.** Their tb renderings each left one label
   with no unambiguous owner at the canvas edge (`attempts/v1-a1-check.txt`,
   `attempts/v1-a2-check.txt`, `attempts/v4-a3-check.txt`); lr gives every route
   its own run row, which is what reached `0 ambiguous owners`. v3 stays `tb`
   because the spine-above-leaf rule is vertical.
6. **Group hues are not stable across views.** `core` is pink in v1 and yellow
   in v2; `edge` is pink in v2 and aqua in v3; `leaf` is pink in v3 and aqua in
   v4. The spec format has no color field (only a `group` name), so the renderer
   assigns families per view and cross-view color identity is not expressible.
   Inside every view the families are distinct, so within-view reading is safe.

## Blockers and environment notes

- No renderer capability was missing: `layers`, `style: "dashed"`, `dots: 0`,
  `group` and label placement all did what the views needed. Nothing was
  invented, nothing substituted, the renderer was not rebuilt or edited.
- Reserved spacer layers (`[""…]` between two node layers) are accepted by the
  frozen binary and are what bought the label room in v1/v3/v4. They are part of
  the spec, not a hidden renderer change.
- `herdr pane layout` returned no rect for the split panes, so `pane_rect` /
  `pane_cols` are null in every manifest; size and zoom are proven by the app's
  own `77x47 @100%` token, which the validator accepts
  (`viewport_proven`, `viewport_matches_target`).
- Attempt accounting: **v1 3, v2 2, v3 3, v4 3** `--check` runs on distinct
  specs. Two extra candidates were screened with `--frames` only and never
  checked (`probes/v2-a1-frames.txt`, `probes/v3-a1-frames.txt`); both are listed
  in `attempts.json` so no candidate is hidden. Five 4-node/8-node capability
  probes ran `--check` before any case view existed (`preflight/`, logs kept);
  they answer the skill's step-4 preflight — `layers`, `dots: 0`, dashed styles,
  and how a 2×2 fan's labels behave in `tb` versus `lr`. They are not candidates
  for any case view and are disclosed in `attempts.json → preflight_probes`.
- `specs/v1-a1.json` is a preserved copy: attempt 1 was first written straight to
  `specs/v1.json` and its bytes were lost when the chosen spec took that name.
  Re-running `--check` on the copy reproduces `attempts/v1-a1-check.txt` byte for
  byte.

## Cleanup

Four panes split (`--no-focus`), each closed by `scripts/viz-evidence.sh`; every
manifest records `cleanup: confirmed_closed` with its pane id. No pane was left
open, no pane outside this tab was touched.

## Verdict ownership

`scripts/viz-validate.py … --require-select --attempts attempts.json` reports
"all checks passed" for all four bundles (`evidence/<v>/validator.txt`). That is
the harness verdict, not an approval: no reviewer or judge was run, and this
sample is not marked green.

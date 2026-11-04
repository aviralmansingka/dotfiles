# C4 zoom-in retry — v3 (last pass)

Build `9b3baf04…`, skill `72ea7197…`. v1 and v2 archived unchanged under `v1/` and `v2/`.

## What changed versus v2

| v2 defect | v3 fix |
|---|---|
| boot server (a manager service) outside the L2a boundary | `enclosures: [[cp,wapi,pgrpc,q,rec,reg,db],[boot]]` — two dotted boxes; boot has its own (`15x7 at 237,36`). Every manager service is inside some box |
| three boundary-crossing routes static | all 12 live routes carry one dot, crossing routes included; frame audit tracks **12/12** with 12 dots in every frame (v2: 9/9) |
| enclosure dots overwriting two label characters | paint order fixed in the build; verified from the capture: **25/25** distinct relation labels render verbatim in frame 0 and all 12 dots are visible |
| coverage map swapped the two L1 machine expansions | corrected: `l1:e4 "boot, audit"` → boot→mch + ssh→mch; `l1:e5 "iPXE, heartbeat"` → mch→boot + agent→pub |

## Structure (253×74, one `lr` direction, focus on `mm`)

| diagram | level | boxes / membership | extent | nodes/edges/dots |
|---|---|---|---|---|
| l1 | L1 context | — (double border on `mm`) | 112x21 @0,5 | 6/7/4 |
| l2a | L2 request·provisioning·boot | box 1 `131x16 @23,31` = `cp wapi pgrpc q rec reg db`; box 2 `15x7 @237,36` = `boot`. Outside: `web prov mch s3` | 253x20 @0,31 | 12/14/6 |
| l2b | L2 heartbeat·audits·diagnostics | box `140x14 @22,56` = `pub wapi q ssh agent db jan`. Outside: `mch s3 slack` | 189x18 @0,56 | 10/9/2 |

Chrome: top rule row 8, three uniform rules of 257 cells (rows 8/34/59), dotted boxes at rows 31–46,
36–42, 56–69, legend at row 84 (below the drawing).

## Check summary

`enclosure-entrances: 7` · `enclosure-crossings:` absent ⇒ **0** (metric live: a v2 probe printed
`enclosure-crossings: 1 cell(s)`) · extent 253x74 · 4 bridges / 0 touching bends · **0 near-miss** ·
**30/30 labels, 0 ambiguous owners, 0 on route** · **12 single-dot routes, 0 violations, 12/12
origins** · 28 pins / 0 conflicts · double border `l1:mm` · three dotted boxes.

Frame audit **PASS** — 12/12 routes, 12 dots per frame, one rate 0.500 cells/frame, equal distance;
longest route 28 cells → 56 frames required, 60 captured.
Validator (select + frames + records + frame-audit): **all checks passed**.

## Whole-canvas ANSI: not possible in this harness

Tried three ways:
1. `python3 scripts/viz-pinned-dump.py --bin … --spec specs/c4-canvas.json --cols 260 --rows 90 --frames 1`
   → **0** ANSI sequences; the script strips escapes (`data.replace("\x1b","")`).
2. `scripts/viz-evidence.sh … --out evidence/canvas` → ANSI comes from `herdr pane read` on the split
   pane; the manifest records `68x44 @100%`, i.e. a half pane.
3. `herdr pane layout` → tab area **140x46**, smaller than the 253x74 canvas; no pane can show it whole
   at 100%, and zooming out is forbidden.

So `conceptual_grouping_color` and `animation` still cannot be closed by whole-canvas color evidence:
the pane ANSI proves the L1 hues only. This is a harness limit, not a drawing defect.

## Coverage

All 23 relations verbatim once at L2, all 17 components, 7 context aggregates with expansions
(ids corrected), 0 drops; all qualifiers on canvas (`audit/verify reimage`, `boot.ipxe + S3 args`,
`create/terminate/repair`, `reinstall/reprovision`, `gcore sync, 1 min`, `run machine-audit`,
`register + heartbeat`, `diagnostic events`, `proposed actions`, `confirm + alerts`,
`diagnose uploads`, `pull boot image`, `allocate instance`, the three state writes, `runs on host`).

## Defects / blockers

- L1 `diagnose` is short for `diagnose uploads` (full phrase on l2b:e8); `BM` is keyed on canvas.
- The boot box is small and at the far right of l2a; the reader must see it as the same boundary.
- No whole-canvas ANSI/selected capture exists (harness), so colour continuity and per-route dot hue
  stay unproven to a judge.
- OS-level SIGKILL of freshly replaced binaries at the frozen path (both this build and v2's);
  re-materialising byte-identical content at the same path fixed it, sha unchanged.
- One-diagram L2 still impossible at `lr`; L3 unsupported by the source.

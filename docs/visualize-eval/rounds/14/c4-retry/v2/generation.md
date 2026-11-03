# C4 zoom-in retry — v2 (member-based enclosure)

Regenerated on build `b0282d3b…` after the v1 verdict (FAIL-partial). v1 is archived unchanged
under `v1/`.

## What changed versus v1

| v1 (failed) | v2 (this run) |
|---|---|
| `enclosed: true` put actors/externals **inside** the dotted box | `enclosure: [...]` lists only the manager's cells; every actor/external sits **outside** the boundary |
| `queue → SSH` label `verify reimage` (lost `audit`) | label `audit/verify reimage` — both source actions |
| L1 folded the machine→manager directions into one outward arrow | two L1 arrows: `mm → mch "boot, audit"` and `mch → mm "iPXE, heartbeat"` |
| L2 descriptions called the dotted area "contents" while externals sat inside | descriptions say the box is the manager's containers and name what is outside |
| `BM` unkeyed | "BM = bare metal" keyed in all three on-canvas descriptions |
| pinned dump clipped the far-right enclosure edge | pinned 260×90 for a 253×74 canvas: 3 cols + 16 rows of margin, legend below the drawing |

## Structure

| diagram | level | feature | extent | nodes/edges/dots |
|---|---|---|---|---|
| l1 | L1 context | `focus: true` on `mm` → double border | 112x21 @0,5 | 6/7/4 |
| l2a | L2 containers (request·provisioning·boot) | enclosure: `cp wapi pgrpc q rec reg db` — outside: `web prov mch s3 boot` | 253x20 @0,31; box 131x16 @23,31 | 12/14/5 |
| l2b | L2 containers (heartbeat·audits·diagnostics) | enclosure: `pub wapi q ssh agent db jan` — outside: `mch s3 slack` | 189x18 @0,56; box 140x14 @22,56 | 10/9/0 |

Canvas 253×74, one `lr` direction declared at canvas scope, uniform rules (257 cells, rows 8/34/59)
with the top rule above L1.

## Enclosure metrics

`enclosure-entrances: 5` (relations joining an outside element to a nested cell — normal).
`enclosure-crossings:` absent ⇒ 0; the metric is live — a rejected probe reported
`enclosure-crossings: 1 cell(s) of a route RUNNING ALONG a dotted boundary`.

## Check summary

extent 253x74 · 4 bridges / 0 touching bends · **0 near-miss cells** · **30/30 labels, 0 ambiguous
owners** · 9 single-dot routes, **0 violations, 9/9 origins** · 28 pins / 0 conflicts · double border
on `l1:mm` · two member-based dotted boxes. Frame audit **PASS** (9/9 steady, equal distance,
0.500 cells/frame; longest route 28 cells → 56 frames needed, 60 captured).
Validator (select + frames + records + frame-audit): **all checks passed**.

## Coverage

All 23 relations verbatim once at L2, all 17 components, 7 context aggregates with recorded
expansions, no drops. Qualifiers on canvas: `audit/verify reimage`, `boot.ipxe + S3 args`,
`create/terminate/repair`, `reinstall/reprovision`, `gcore sync, 1 min`, `run machine-audit`,
`register + heartbeat`, `diagnostic events`, `proposed actions`, `confirm + alerts`,
`diagnose uploads`, `pull boot image`, `allocate instance`, the three state writes, `runs on host`.

## Defects / blockers

- **Renderer**: the dotted boundary is painted after the flow, so a dot crossing it is occluded for
  a frame and the frame audit splits that route (12/12 dots visible under `enclosed:true`, 11/12
  under member enclosures). The three boundary-crossing routes (`web→wapi`, `reg→prov`,
  `wapi→slack`) therefore ship static; the other nine keep one dot each.
- **Membership compromise**: the boot server is a manager service but sits outside the L2a box —
  the source chain `reg→prov→mch→boot` interleaves two externals between members, and every
  rectangle that keeps boot inside also engulfs prov/mch (measured probes; 30+ near-miss cells).
- L1's `diagnose` is shortened from `diagnose uploads` (full phrase on l2b:e8).
- Whole-canvas ANSI/selected-state is still not capturable by the harness (ANSI is pane-only), so
  the v1 judge's color/animation "blocked" finding remains an evidence gap.
- The frozen binary was SIGKILLed at its path by the OS signature cache; identical bytes were
  re-materialised at the same path (sha unchanged) and every later run succeeded.
- Process: 9 layout probes + 6 frame-audit variants ran outside the record wrapper (specs bundled,
  listed in `attempts.json`); only the attempts and evidence runs are recorded.

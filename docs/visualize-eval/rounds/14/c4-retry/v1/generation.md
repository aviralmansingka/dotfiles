# C4 zoom-in retry — modal-machine-manager (round 14)

Retry of the round-13 C4 probe on the new frozen build, using the three features that were
missing: `focus` (double border on the zoom parent), `enclosed` (dotted box around the expanded
contents), and uniform dividers with a top rule above the first section.

Frozen: binary `/tmp/visualize-eval/round-14/bin/rataflow-view` (sha `2b1dd353…`), skill
`proposals/13/SKILL.md` (sha `86b72df4…`, section "Zoom-in views (C4-style)"). Facts only from
`cases/modal-machine-manager/source.md`.

## What shipped

One canvas, **direction `lr` everywhere** (declared once at canvas level, no override), three
described diagrams:

| diagram | C4 level | new feature | extent | nodes/edges | dots |
|---|---|---|---|---|---|
| l1 | L1 context | `focus: true` on `mm` → double border (`╔══╗`) | 98x16 at 0,5 | 6 / 6 | 3 |
| l2a | L2 containers (request·provisioning·boot) | `enclosed: true` → dotted box 244x18 at 0,25 | 244x18 at 0,26 | 12 / 14 | 6 |
| l2b | L2 containers (heartbeat·audits·diagnostics) | `enclosed: true` → dotted box 214x13 at 0,48 | 214x13 at 0,49 | 10 / 9 | 2 |

Whole canvas **244x62**; 28 node instances, 29 routes, 11 animated. L3 omitted (the source states
no container internals), L4 out of scope.

## Owner directives, checked

- **One direction:** `direction: "lr"` on the canvas; `--check` reports `direction=lr` once, no
  diagram carries a direction.
- **Qualifiers on the canvas:** `verify reimage` (l2b:e0) and `boot.ipxe + S3 args` (l2a:e8) are now
  labels, plus `create/terminate/repair`, `reinstall/reprovision`, `gcore sync, 1 min`,
  `run machine-audit`, `register + heartbeat`, `diagnostic events`, `proposed actions`,
  `confirm + alerts`, `diagnose uploads`, `pull boot image`, `allocate instance`. Nothing the
  round-13 judge missed lives only in a ledger now.
- **Uniform dividers + top rule:** rows 7, 28 and 51 of the capture, each 250 cells (the widest
  band); the top rule above L1 exists.
- **Dots through the dotted line:** no route crosses either enclosure. The build prints the
  `enclosed:` lines but no `enclosure-crossings:` line (the brief allows 0 or absent), so I also
  scanned every dotted row in all 56 frames — no route or border glyph on any of them.

## Why L2 is still two diagrams (measured, not chosen)

The dotted box does not make a 17-container section routable on this build:

- `lr` (the mandated direction): exit 1 — `no obstacle-safe route for wapi -> q; increase
  node/layer spacing` (`probes/l2-one-diagram-lr.json`).
- `tb`: renders, but the build itself refuses the section — `17 nodes / 23 edges, above the
  readable budget (12/16)` — at 105x171 with 23 crossings, 73 near-miss cells, 1 skipped label
  (`probes/l2-one-diagram-tb.json`).

So both halves ship `enclosed`, and the union covers all 23 relations exactly once.

## Check summary

`--check` on the final spec: extent 244x62, 1 bridge / 1 touching bend, **0 near-miss cells**,
**29/29 labels placed, 0 ambiguous owners**, 11 single-dot routes with **0 violations**, **11/11
origins**, 28 pins / **0 conflicts**, `double border: 1 zoom parent(s) - l1:mm`, two `enclosed:`
boxes. Frame audit: **PASS** — 11/11 routes steady, equal distance, 0.500 cells/frame, longest
route 26 cells → 52 frames needed, 56 captured. Validator (`--require-select --require-frames
--require-records --frame-audit`): **all checks passed**.

## Defects / notes

- L1's `boot + audit + heartbeat` aggregate folds the machine→manager directions; both boot
  directions and the heartbeat are drawn verbatim at L2 (l2a:e7/e8, l2b:e3) and the expansion is
  recorded in `generation.json`.
- `l1:e1` reads `prov API` (full `provider API` on l2a:e5); `BM` = bare metal is keyed only in the
  record.
- Two dotted boxes, not one nested box: the engine has a single enclosure level, so level 2 reads
  as two enclosed halves.
- The controls legend sits at the viewport's bottom-left; pinned at exactly the canvas extent it
  covered the second enclosure's border, so the whole-canvas dump is pinned 250x76 (drawing ends
  row 66, legend row 70). Viewer chrome, not a spec error.

## Evidence layout

`specs/c4-canvas.json` (final) + attempts 1–5, `probes/` (the two one-diagram measurements),
`evidence/canvas/` (check, pane text/ANSI/selected, 56 frames, whole-canvas 250x76 dump, frame
audit, validator, manifest with `confirmed_closed`), `attempts.json`, `attempts-log.jsonl`
(8 records), `generation.json`.

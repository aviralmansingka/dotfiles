# datacenter-redundancy — round 08 generation record

Case: `docs/visualize-eval/cases/datacenter-redundancy/source.md`
Candidate skill: `docs/visualize-eval/rounds/08/SKILL.md` — sha256 `b1bdb4d3d38336cb7783db34da7f9f19edf80704a890de32285d9e582b4221eb`
Executable: `/tmp/visualize-eval/round-08/bin/rataflow-view` — sha256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`
Both hashes re-verified with `shasum -a 256` before the first spec was written. Nothing was installed, built, committed or edited outside this directory.

## Step 0 — family

```
family: redundant-fabrics
evidence: 18 nodes / 28 links, every tier cross-connected 4-way so each target takes two
          independent arrowheads, and the source forbids motion ("remove the dots flowing
          for now"), which is this family's static signature.
```

Recipe applied to every view: rank pins for the source's tiers, independent parallel lanes at
separate ports, **never a trunk**, **no dots** (zero `●` glyphs in all captures).

## Views (4, full coverage of 18 nodes and 28 links)

| view | carries | spec | pane size | extent | labels | crossings | validator |
|---|---|---|---|---|---|---|---|
| v1 uplink | e1–e8 (ispA–D, mux1/2, core1/2) | `specs/v1-uplink.json` | 83x51 (harness pane), fits 77x47 | 45x31 | 4/4, **2 ambiguous** | 1 bridge, 1 touching bend | 2 FAIL (ambiguity) |
| v2 security | e9–e16 (core1/2, fw1/2, bl1/2) | `specs/v2-security.json` | 83x51, fits 77x47 | 36x36 | 8/8, **2 ambiguous** | 2 bridges, 1 touching bend | 2 FAIL (ambiguity) |
| v3 fabric | e17–e24 (sp1/2, bl1/2, leaf1/2) | `specs/v3-fabric.json` | 83x51, fits 77x47 | 53x25 | 8/8, **2 ambiguous** | 14 bridges, 5 touching bends | 2 FAIL (ambiguity) |
| v4 access | e25–e28 (leaf1/2, rack1/2) | `specs/v4-access.json` | 83x51, fits 77x47 | 45x16 | 4/4, **0 ambiguous** | 1 bridge, 1 touching bend | all checks passed |

Every view: `--check` exit 0, 0 skipped labels, 0 labels on route cells, 0 dot violations,
`dots: 0 single-dot routes, 0 periodic routes, 0 violations`, `origins: 0/0`, `arrivals: 0/0`,
`trunks:` empty. Only v4 is warning-free.

Full `--check` lines per view are in `generation.json` and in `evidence/<view>/check.txt`.

## Structural levers and the source fact behind each

- **`layers` rank pins.** v1 pins the three WAN/core tiers (source line 126: four ISPs feed two MUXes, each MUX to 2 cores). v2 pins core → firewall pair → border leaf. v3 pins `sp1,sp2` above the one leaf rank that holds `bl1,bl2,leaf1,leaf2` — the round-05 blocker, closed honestly: source line 248 demands "border leaf and leaf at the same height" and "the spine above the leaf", and the capture shows Spine 1/Spine 2 on rows 18–21 of `evidence/v3/v3-text.txt` while Leaf 1, Leaf 2, BL 1 and BL 2 all sit on row 32. v4 pins leaf → rack. All four report `pins: N pinned, 0 conflict(s)`.
- **Two declared-empty ranks (v2, v4) + `minlen: 2`.** Each labelled transition asks for its own rank gap so the eight independent standby/active lanes are not squeezed into one channel (source line 270: never merge or overlap the redundancy links). Honored (0 conflicts) but it buys corridor room only — see defect D2.
- **`group` regions by concept.** `wan / mux / core` (v1), `core / firewall / border-leaf` (v2), `spine / border-leaf / rack-leaf` (v3), `rack-leaf / rack` (v4). Hues are name-stable across views (`core` = rgb(110,118,66) in v1 and v2; `border-leaf` = rgb(140,108,57) in v2 and v3).
- **No trunks anywhere.** The human explicitly rejected merged arrows; the fabric's density is the meaning, so 28 independent links are drawn as 28 independent routes. `--check` prints an empty `trunks:` line in every view.
- **`style: dashed` + uncertainty in the text.** The four standby links carry `standby?` and `╌` glyphs (`evidence/v2/v2-text.txt`: `standby?` on rows 22 and 24, dashed `╌` runs on rows 24–25, 28–30 and 34); the active links stay solid.
- **No dots anywhere.** `dots: 0` on all 28 edges, no `flow`; zero `●` characters in every text and frame capture.

## Coverage map

| view | nodes | edges |
|---|---|---|
| v1 | ispA, ispB, ispC, ispD, mux1, mux2, core1, core2 | e1–e8 |
| v2 | core1, core2, fw1, fw2, bl1, bl2 | e9–e16 |
| v3 | sp1, sp2, bl1, bl2, leaf1, leaf2 | e17–e24 |
| v4 | leaf1, leaf2, rack1, rack2 | e25–e28 |

28/28 links and 18/18 nodes drawn exactly once as edges; boundary nodes (core, bl, leaf) reappear
so each hop is visible in context. Nothing merged, reversed or dropped. The meaning ledger,
relationship audit and arrow convention are in `generation.json`.

## Defects and blockers (recorded, not invented)

- **D1 — group regions collapse (round-08 headline capability).** With 2+ declared groups only one
  region box wraps its members; the rest render as a 3-column sliver at the graph's right edge in the
  group's hue with no title. v1: `wan` correct (title row 11 col 26, borders rows 11–15, cols 23–61, hue rgb(137,87,101)) but
  `mux` draws only cols 65–67 rows 20–25 while MUX 1/MUX 2 sit at cols 34–41 and 44–51; `core` draws
  only cols 62–64 rows 36–41 while Core 1/Core 2 sit at cols 33–41 and 44–52 (all 1-based, from
  `evidence/v1/v1-text.txt` and `v1-selected.ansi`). v2: `core`
  correct (title row 9 col 31, borders rows 9–14, cols 31–51) while `firewall` draws only cols 55–57
  rows 24–29 and `border-leaf` only cols 51–53 rows 39–44. v3: no region wraps its members (the spine
  box appears only at rows 16 and 23, cols 44–53, though Spine 1/Spine 2 span cols 30–52). v4: `rack`
  correct (title row 20 col 49, borders rows 20–31, cols 48–57) while `rack-leaf` draws an empty 10x3
  sliver at rows 33–35, cols 25–34, below the leaves it should enclose. "Members stay inside their region's box" is therefore
  violated in every view; membership is still legible by hue and by the `groups:` line.
- **D2 — repeated labels cannot reach 0 ambiguous owners (v1 2/4, v2 2/8, v3 2/8).** Mechanism:
  ports on one box side are always 2 cells apart (`port_cell`: `along = 1 + 2*slot`) while a
  vertical-run label sits `len/2 + 1 + gap` cells to the side, so the sibling lane is closer to the
  text than its own lane. The engine's structural fix — a reserved label slot for a labelled edge
  spanning two ranks — never reaches the router in this build (`router::EdgeSpec.label_slot` is built
  as `None`; `with_label_slot`/`reserve_label_slot` have no caller), so the `minlen` label ranks in v2
  and v4 provably do not remove ambiguity (measured in `raw/check-v2-a2-labelrank.txt`). `lr` does
  remove it (v4: 0/4; v2 attempt a3: 0/8) because the label then sits beside a horizontal run at
  distance 1 — but a3's extent (80x19) overflows 77 columns, and the clean lr rebuild would have been
  a fourth candidate on that view, over the three-per-view budget. v1 also measured 2 ambiguous in
  `lr` (`raw/check-v1-a2-lr.txt`), so the crossing pair is label-hostile in both orientations.
- **D3 — fabric view is busy.** 14 bridges / 5 touching bends, and one `ECMP` label overwrote the
  leaf-row region title (row 30 of `evidence/v3/v3-text.txt` reads `──▼r▼cECMPaf`, cols 23–42). Cause: the recorded
  relationship list says `bl1 → sp1` (leaf → spine) while the source pins the spines **above** the leaf
  row, so those four routes must re-enter the spine tops from below and loop above the spine boxes
  (`evidence/v3/v3-text.txt` rows 13–24). Flipping the arrowheads would change endpoint semantics,
  which the fixed constraints forbid; un-pinning the tiers would lose "spines above the leaf row".
- **D4 — capture viewport is 83x51, not 77x47.** The harness pane in this tab is wider than the
  protocol target, so each bundle's measured token is `83x51 @100%`. Fit at the target is proven by a
  pinned `COLUMNS=77 LINES=47` dump of each FINAL spec with no overflow banner:
  `evidence/<view>/<view>-pinned-77x47-frames.txt` (the validator accepts this path and passes
  `viewport_matches_target`).
- **D5 — `manifest.json.pane_rect` is null** for all four bundles: `scripts/viz-evidence.sh` asks
  `herdr pane layout` for the rect without a tab argument and gets the globally focused tab. Pane ids,
  `pane_rows`, the app's header token and `cleanup: confirmed_closed` are recorded.
- **D6 — frame 4 differs from frames 0–3 only by the shell prompt** appended by
  `pane read --source recent` after the app exited. Frames 0–3 are byte-identical, i.e. the graph is
  static as demanded. This is a capture artifact, not motion.
- Minor observation: two different group names can share one hue (`wan` and `rack` = rgb(137,87,101);
  `spine` and `firewall` = rgb(81,113,106)). Hues are stable per name across views, but not unique.

## Honest state

Not green. v4 passes the validator; v1, v2 and v3 fail exactly two checks each
(`check_warnings_absent`, `labels_ownership_clear`) for the single reason recorded in D2. The
region collapse (D1) is a capability blocker for this round and is visible in every view. No judge or
reviewer was run from this session, and no approval is claimed.

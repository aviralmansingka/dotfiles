# server-nic-layout — round 08 generation

Frozen inputs: candidate skill `docs/visualize-eval/rounds/08/SKILL.md`
(sha256 `b1bdb4d3d38336cb7783db34da7f9f19edf80704a890de32285d9e582b4221eb`),
renderer `/tmp/visualize-eval/round-08/bin/rataflow-view`
(sha256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`).
Both hashes verified with `shasum -a 256`; the binary hash is re-recorded in every
`evidence/<view>/bin.sha256`.

Generator: pi worker subagent, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
No judge was spawned.

## Step 0 — family

**family: identity-probe-maps**
**evidence:** the source's structure is one deep egress chain whose content is identifiers and
qualifiers — `103.19.91.57/.58/.59/.60-.62`, `14.143.x`, `14.141.x`, `1.1.1.1`, `AS132717`,
`AS13335`, `eno16595np0`, `R7725`, plus `free?`, `L2?`, `no cable`. Density is low (9 relations over
9 named elements) and depth is 4 observed hops, so shape cannot decide; per tie-breaker 3
(identifier/qualifier content outranks shape) this is an identity-probe-map. Recipe applied: every
identifier and qualifier became a ledger row and was assigned a view before any spec existed; the
layout is a deep `tb` chain, split along the source's own fact clusters (host NICs, the /29, the DC
boundary, the external hops).

Why `tb` and not `lr`: `lr` spends width. Measured — a 4-rank labelled chain at `tb` already costs
`label_width + 3` rows per gap, and the same chain in `lr` sums to 119+ columns, so `tb` is the only
direction that keeps 100% zoom at 77x47. Every view has ≤4 ranks, which is the skill's `tb` range.

## Views (4 of 4 allowed)

| view | title | nodes/edges | extent | theme |
|---|---|---|---|---|
| v1 | server1's box: one live NIC among eight | 3 / 2 | 39x40 | region `srv1` |
| v2 | the /29: gateway, server1, server2, free pool | 4 / 3 | 64x25 | regions `srv1`, `srv2`, `address pool` |
| v3 | DC edge: gateway → first Airtel hop, plus the unproven interior | 2 / 2 | 46x19 | region `DC edge` |
| v4 | external hops: the observed path beyond the /29 | 3 / 2 | 41x36 | region `external hops` |

Checks (verbatim, no warnings in any view):

```
v1: extent=39x40 cells | crossings: 0 bridges, 0 touching bends
    labels: 2/2 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
    groups: srv1(3) | trunks: | dots: 0 single-dot routes, 0 periodic routes, 0 violations,
    0 constant at 0.5c/step, 0 same-arrival at 2000ms | origins: 0/0 | arrivals: 0/0
v2: extent=64x25 cells | crossings: 0 bridges, 0 touching bends
    labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
    groups: srv1(1) srv2(1) address pool(1) | trunks: | dots: ... 0 violations | origins: 0/0
v3: extent=46x19 cells | crossings: 0 bridges, 0 touching bends
    labels: 2/2 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
    groups: DC edge(2) | trunks: | dots: ... 0 violations | origins: 0/0
v4: extent=41x36 cells | crossings: 0 bridges, 0 touching bends
    labels: 2/2 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
    groups: external hops(3) | trunks: | dots: ... 0 violations | origins: 0/0
```

Static: the source never animates, so no edge sets `flow`; each view's frames capture holds five
timestamped frames whose graph bodies are byte-identical.

## Structural levers and the source fact behind each

- **Regions.** v1 `srv1` (server1's 8 physical NICs are one host's plant), v2 `srv1` / `srv2` /
  `address pool` (two distinct hosts and the `0.60-.62 free` tail are three distinct things to tell
  apart), v3 `DC edge` ("between .57 and Airtel the fabric either bridges, tunnels, or stays
  silent" — the boundary is one concept), v4 `external hops` (the observed hops outside the /29).
- **`layers` rank pins: none anywhere.** The source states no row or plane geometry for this graph.
  The only ordering it states is member → gateway, which edge direction already carries; the engine
  puts the gateway one rank below its members (v2-text rows 34-37), so nothing needed pinning.
- **`minlen`: one use, v3 e7 = 2.** Source: "hops 3 and 6 answered nothing" — the interior between
  `.57` and Airtel is a stage the trace cannot name, so the unproven relation reserves a rank
  instead of squeezing its label between neighbours. The confirmed relation keeps its label in the
  first gap (`1.8 ms`, v3-text row 29) and the dashed one in the reserved rank (`L2? no hop`,
  row 25).
- **Trunks: none.** A trunk is one bus that splits from a single source into branches; the source's
  /29 relations all run member → gateway (many → one), so a trunk would have to reverse the source.
  Plain edges were used, and the gateway shows three separate arrowheads (v2-text row 33, `▼ ▼ ▼`).

## Region hues (measured, not assumed)

Read from each view's ANSI capture (`38;2;r;g;b` on the region border cells):

| name | hue | views |
|---|---|---|
| `srv1` | rgb(140,108,57) | v1, v2 — identical in both (name-stable) |
| `srv2` | rgb(150,90,51) | v2 |
| `address pool` | rgb(110,118,66) | v2 |
| `DC edge` | rgb(81,113,106) | v3 |
| `external hops` | rgb(81,104,120) | v4 |

v2 is the multi-region view: three distinct hues on one title row, so the round-07 collision does
not recur. v4's region was renamed from `upstream hops` because that name rendered the *same* aqua
as v3's `DC edge`; the mapping was measured on the frozen binary with `evidence/hue-probe2`, not
guessed from source code (the frozen binary's name→hue mapping does not match the current tree's
hash).

## Meaning ledger, audit, coverage

The full ledger (29 rows, each drawn / abbreviated / dropped-with-reason), the 9-edge relationship
audit with label owners, and the per-view coverage map are in `generation.json`
(`meaning_ledger`, `relationship_audit`, `coverage_map`, `relationship_to_view`).
All nine source relations are drawn, none reversed or merged; each label belongs to exactly one
edge (0 ambiguous owners in every check).

Deliberate drops: the fresh-handoff state (GPUs / rack-bench / uptime), the historical
`/tmp/*.json` spec paths, and the role word "ToR" — the source says the MAC OUI does not prove a
ToR role, so only "Arista" is asserted.

## Attempts and budget

| view | attempts | outcome |
|---|---|---|
| v1 | 1 | accepted as written |
| v2 | 3 | #1 three sibling regions → gateway outside its region box (containment) → #2 single-rank regions, clean → #3 added `no v6` to the gateway label |
| v3 | 3 | #1 whole egress chain, extent 44×49 clipped the top region → #2 shorter labels, 44×47 still 1 row over → #3 split at the DC boundary |
| v4 | 2 | #1 region `upstream hops` → same aqua as `DC edge` → #2 renamed `external hops` (blue) |

Raw `--check` output for every attempt is in `attempts/`; rejected specs are preserved as
`specs/attempts-*.json` (each verified to reproduce its original `--check` output byte-for-byte,
except v3 attempt 2, whose raw file was overwritten during iteration and was re-run from the
identical preserved bytes — same extent, recorded in `attempts.json`).

## Honest defects

1. **Region corners render as `─`, not `╭╮╰╯`** (v1-text row 6, v2 row 13, v3 row 16, v4 row 8).
   Frozen-binary behaviour: the border run is painted first and corner glyphs are then refused.
   Cosmetic; node boxes in the same captures keep their corners.
2. **Long titles eat the top border** (v2 row 13, `address pool`).
3. **Multi-rank regions lose containment in a multi-region view** — measured twice
   (`attempts/v2-attempt1-77x47.txt`; `evidence/hue-probe/hueprobe-text.txt` rows 19-40, where each
   chained single-node region collapses into a 3-wide sliver to the right of its member). All final
   views avoid it.
4. **v2's three region boxes share one bottom row** (row 32) instead of hugging their single-rank
   members; engine region-extent behaviour, cosmetic, members stay inside.
5. **The /29's gateway is ungrouped in v2** (no region of its own) — forced by defect 3; its /29
   membership still reads from the label and from e3/e4/e5, and it is grouped as `DC edge` in v3.

Not blockers: this binary prints no `routes:` line (expected in round 08); no missing capability
was needed — every required qualifier (`free?`, `L2?`, `8.3-8.6 ms`, `103.19.91.57`, `R7725` with
server2) is visible as text in its view.

## Evidence, size, cleanup

Each `evidence/<view>/` bundle holds `check.txt`, `<view>-text.txt`, `<view>-ansi.ansi`,
`<view>-selected.ansi`, `<view>-frames.txt` (5 timestamped frames), `manifest.json`, `bin.sha256`,
`validator.txt`. The live half pane in this worker tab measures **83x51** (the app's own header
token `83x51 @100%`) — larger than the 77x47 target — so each view also has a pinned direct dump
`<view>-pinned-77x47-frames.txt` reporting `viewport: 77x47 zoom: 1.00 natural` with no overflow
banner; that is the fit proof the validator accepts. No pane geometry was invented: 83x51 is
measured, 77x47 is pinned.

Validator (`uv run scripts/viz-validate.py evidence/<view> --require-select --require-frames
--attempts attempts.json`): **all checks passed** for v1, v2, v3 and v4 (full output in each
bundle's `validator.txt`). Every capture pane was closed and re-probed by
`scripts/viz-evidence.sh`; all six manifests report `cleanup: confirmed_closed`.

I am not claiming a visual pass or independent approval — the captain runs the separate Sol judge.

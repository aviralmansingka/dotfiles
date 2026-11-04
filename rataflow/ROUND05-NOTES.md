# Round 05 — layout engine checkpoints

Assessment of the interrupted session first: the round-03 baseline plus every carried item was
already in place (`edges[].timing` constant/same-arrival, `duration_ms` gating, `flow: true` =
0.5 c/100 ms, frame-0 dot on the first drawn cell, single-split trunk, the `--check` lines).
Nothing there was rebuilt. Two things were broken and are fixed:

- **Suite hang (21 min).** `Engine::balance` computed its upper rank bound as
  `unwrap_or(usize::MAX)` for a sink (a node with no successors), then scanned
  `low..=high` — roughly 2^64 candidates per sweep. A sink is now bounded by its own rank
  (`unwrap_or(low)`), so every layout test finishes in milliseconds.
- **`cargo clippy -D warnings` (10 warnings).** Dead `Slot::edge`, dead `Engine::axis` (and its
  now-unused `new` parameter), loop-variable index lints (`down`, `gaps`, `trunks`), a
  `seen` counter turned into `enumerate`, two needless `row as i32` casts, `is_some_and(.. != ..)`
  → `is_none_or(.. == ..)`, and `Unit::Group(usize)` now carries a real tie-break through
  `unit_key` instead of an unread field.

Checkpoints, one line each, in build order.

1. **Rank balancing** — `Engine::balance` (layout.rs): each node moves to the feasible rank
   `low..=high` (between its parents and successors) minimizing Σ|rank − neighbour rank| over
   both sides, charged `GROUP_SPAN_CHARGE = 12` per extra rank its group's box would span; 8
   alternating declaration / reverse-declaration sweeps, stopping at the first sweep with no
   move. Ties keep the lower rank, so a grouping never drifts down for free.
2. **Barycenter ordering** — `reorder` per rank: neighbour-average blocks (a group is one unit,
   a lone slot is another), down then up sweeps, crossing count from the accumulator tree
   (`accumulator_crossings`, one Fenwick tree per sweep), best order kept, stop after 4 sweeps
   without improvement. Braided fan fixture (`barycenter_orders_a_braided_fan_better_than_declaration_order`):
   **crossings 3 → 0**; the one-rank fan stays 0 → 0.
3. **Label slots** — a labelled edge spanning ≥2 ranks gets a `SlotKind::Label` dummy on its
   middle rank (`across` = label width in `tb`, `along_pad` in `lr`), ordered like a node and
   folded back to an overlay label through `label_anchor`; `Placement` still exposes the rank
   so the label rides the rank it reserved. `a_labelled_long_edge_owns_a_slot_and_reports_none_ambiguous`
   reports **0 ambiguous owners**, and a 6-node/6-edge sugiyama spec (no explicit `layers`)
   checks `labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners`.
4. **Subgraph blocks + hues** — members of a group are one atomic unit per rank, so a group
   reads as a rectangle in a stable sibling order (blocks keep the order they appear in, and
   `unit_key` breaks a barycenter tie). A group's hue now comes from a **stable hash of its
   NAME**: `group_family` runs FNV-1a over the bytes and finalizes with SplitMix64, mod the six
   gruvbox families; `group_color(name, member)` shades within the family. Declaration order no
   longer touches color, so the same name keeps its hue across specs (test
   `a_group_keeps_its_hue_across_specs` paints `management`/`tenants` from two specs that
   declare them in opposite orders and requires identical border colors), while `management`
   and `tenants` still land in different families (hue gap > 30°).
5. **Straight long edges** — one dummy slot per crossed rank, so the route is a straight run
   and the ordering sees the edge as unit-length segments; `bend_cost` charges
   0, 0, 5, 12, 30, then doubling, which `bend_penalties_cost_more_than_crossings` pins above
   the crossing price.
6. **Routing** — `router.rs` keeps A* for the crossings ordering cannot remove, one port per
   fan-out edge merging into one stem that splits in the gap, one track per turn, and pair-wise
   turn-crossing avoidance; a trunk with ≤2 branches gets one hub junction (single split), more
   branches keep one tap each and report honestly — `examples/trunk.json` with 3 branches
   checks `trunks: oob from oob-switch to nvos, 3 branches, 3 junctions`.
7. **Palette corner** — the layout reserves the bottom-left `PALETTE_W × PALETTE_H` rectangle
   and shifts the whole graph right by the palette width when a box would touch it, so no node
   border is ever overwritten (`the_palette_corner_stays_free_of_node_boxes`).

Round-03 guarantees keep their tests: ports/stems, no shared corridor runs, bridges only when
forced, and dots never on corners, bridges, junctions, or arrowheads except the origin cell.

Gates (all under a 150 s watchdog, one cargo command at a time): `cargo test` **83 passed**
(43 lib, 5 cli, 35 render), `cargo clippy --offline --all-targets -- -D warnings` clean,
`cargo fmt --check` clean, `cargo build --offline --locked --release` ok.

Still unsatisfied: a label on a spec that pins its own `layers` (no sugiyama output) is placed by
the overlay anchor search, not by a layout slot, and `examples/trunk.json` reports
`1 ambiguous owner` — two parallel corridors in one gap, so the text is as close to the neighbour
route as to its own. Widening the overlay's gap search from `[1, 2]` to `[1, 2, 3]` did not clear
it; `--check` reports it instead of hiding it.

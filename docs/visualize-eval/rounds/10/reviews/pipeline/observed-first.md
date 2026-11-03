# Pipeline — blind observation, stage A

This record is based on the case's spec, captures, recorded check outputs, and generation/attempt metadata, not on expectations or rubric. Shipped spec `specs/v1.json` SHA-256 verified with `shasum -a 256`: `3e812eaacb7daa6f6b4e10b50cd6dadad35775face9d30dd1bcdad23d34a25f6`, matching generation and manifest. Nine filenames under `specs/` contain eight distinct hashes: `v1-enqfirst-probe.json` duplicates the shipped `v1.json` byte for byte.

## Visible text and geometry

Coordinates are 1-based `[column,row,width,height]` in the 82×51 pane `v1-text.txt`; label widths count character cells. Graph text, all visible:

- `CLI` [41,10,3,1]; `API gateway` [37,18,11,1]; `Auth` [33,26,4,1]; `Job queue` [42,26,9,1]; `Worker pool` [39,34,11,1]; `Postgres` [38,42,8,1].
- `verify` [34,21,6,1]; `enqueue` [44,21,7,1]; `read` [37,29,4,1]; `write` [46,37,5,1]. Their owners are discernible by adjoining route geometry; no owner is visually uncertain, although `enqueue` begins immediately to the right of its route's dot. Check reports 4/4 placed and zero ambiguous.
- UI header `rataflow-view · 82x51 @100% · v1.json · 6 nodes · 6 edges · q quit` [2,1,66,1]. UI controls `+ [+]` [4,46,5,1], `− [-]` [4,47,5,1], `⊡ [f]` [4,48,5,1], `□ [i]` [4,49,5,1]. They are not graph labels.

Six directed routes, all with visible downward arrowheads and traceable throughout without guessing:

1. CLI → API gateway: straight down; head [42,16], unlabeled.
2. API gateway → Auth: left fan from [41,21], bends [41,23] and [34,23], head [34,24], `verify`.
3. API gateway → Job queue: right fan from [43,21], bends [43,23] and [46,23], head [46,24], `enqueue`.
4. Job queue → Worker pool: bends [46,31], [44,31], head [44,32], unlabeled.
5. Worker pool → Postgres: bends [44,39], [42,39], head [42,40], `write`.
6. Auth → Postgres: long left route, bends [34,39], [40,39], head [40,40], `read`.

The two incoming Postgres paths use distinct, correctly ordered ports [40,40] and [42,40]; their approaches remain separate. The API fan is an apparent conceptual fork, not a shared drawn junction: its two distinct bottom-side ports sit symmetrically around column 42. No crossing, touching bend, bridge glyph, or shared route junction appears. Check independently reports `crossings: 0 bridges, 0 touching bends`. The lone CLI→API endpoints are at the horizontal middle of each box; other single endpoints are also mid-side to the extent permitted by even-width boxes; multi-port endpoints spread across the side.

## Groups, borders, selection, ranks

The five declared groups are logical tags. No group box, border, or group title is drawn, as required by this round's contract. Unselected ANSI shows:

| Group | Member(s), visible order | Border foreground RGB | Family |
|---|---|---|---|
| client | CLI | 115,161,206 | blue |
| gateway | API gateway | 138,115,206 | violet |
| auth | Auth | 206,115,138 | pink/red |
| jobs | Job queue above Worker pool | 183,206,115; 203,219,153 | yellow-green, two shades |
| data | Postgres | 206,115,206 | magenta |

Five hue families; only jobs has multiple members. Its order is stable across the one shipped view and captured frames; singleton sibling order is not testable. No separately drawn tier label line or hue band: tier tagging is conveyed by member border hues. Each of the six node borders has all four sides and four corners, color-continuous in its group hue; the ANSI capture supports this, rather than plain text alone. Uniform background is RGB 40,40,40. The separate select-all ANSI shows each of the six node occurrences with complete accent-colored borders, RGB 216,166,87: selected coverage 6/6. This is simultaneous select-all evidence, not six separately captured single selections.

No rank pins (`layers`) are declared in shipped `v1.json` or reported as shipped in generation metadata: pinned-rank count 0. Actual ranks by top-to-bottom box position are CLI; API gateway; Auth and Job queue; Worker pool; Postgres. An abandoned probe's pins are not shipped pins.

## Structural observations

One connected six-node, six-edge directed view. Widest outgoing fan is two, from API gateway. Zero pairs have edges in both directions. One node, Postgres, receives arrowheads from two separate routes. There are no disjoint worlds and no joining bus. Labels are short component names plus four short verbs, with no addresses or numeric identifiers; `gateway`, `Job`, and `pool` qualify component names. The top-to-bottom order looks like successive processing stages, with a middle fork and final merge. The longest visible directed path contains five boxes.

Generator's exact classification, from `generation.md`, section `Step 0 — family first`:

```text
family: flow-chains
evidence: six nodes and six relations (E = N) form one shallow pipeline — CLI ->
          API gateway -> {Auth, Job queue -> Worker pool} -> Postgres — and the
          task asks for "slow, sparse motion for traffic", the chain family's
          animated signature.
```

That is a quoted generator claim, not a blind family verdict. The same section notes a secondary mesh habit of separately target-aligned converging Postgres ports. In `generation.md` section `Family recipe, and its measured yield`, the generator reports LR 89×9 without label slots and 79×10 with slots; the corresponding recorded check captures show exactly those extents. These exceed the 77-column target by 12 and 2 columns respectively.

## Declaration-order disclosure

`attempts.json` identifies rejected `v1-draft1-tb-rejected.json` and shipped `v1.json`; their byte diff changes only the order of the two API edges, `verify` first versus `enqueue` first. Recorded `v1-attempt3-tb-final.stdout` reports 1 ambiguous owner for the former; `v1-enqueue-first-probe.stdout` and final `check.txt` report 0 for the latter. Captured results and preserved spec bytes support the disclosed sensitivity and actual ordering; no new viewer session was run. This establishes reproducibility from the recorded artifacts, not an independently rerun binary check.

## Motion

Pinned dump `v1-pinned-77x47-frames.txt` contains frames 0–43, 100 ms apart; each has exactly six visible dots, one on each independent route, no periodic dot train. Frame 0 dots are on the first drawn route cell immediately outside each source border, including the fan sources; in pinned coordinates excluding the `frame` heading these are CLI→API [39,11], API→Auth [38,19], API→queue [40,19], queue→worker [43,27], worker→Postgres [41,35], Auth→Postgres [31,27]. First cells are straight vertical glyphs, not corner cells. Check says `origins: 6/6`.

Independent comparison of dot coordinates in all 44 frames against their underlying glyphs in other frames finds dots only on straight `│` or `─` glyphs, never on corner, bridge, arrowhead, or label. At corners the dot moves diagonally past the elbow rather than resting on it. Every route advances one eligible dot position per two 100 ms frames, in its arrow direction, and wraps independently; thus the stated 0.5 position/step holds for the rendered dot sequence, but it is not literal geometric grid-cell travel at the corner skips. The `analysis/lockstep-check.txt` reports 148 single-cell transitions, 46 diagonal corner skips, 44 wraps and 14 initially unexplained transitions; its note identifies those 14 as the 3-position CLI route wraps, consistent with the observed sequence. No motion anomaly remains under that convention. Reported check dot violations: 0.

Route-by-route eligible-position counts and observed wrap: CLI→API 3 (returns frame 6); API→Auth 8 (returns frame 16); API→queue 4 (returns frame 8); queue→worker 3 (returns frame 6); worker→Postgres 3 (returns frame 6); Auth→Postgres 15 (returns frame 30). In particular frame 0 read [31,27], frame 20 [32,37], frame 28 [36,37], frame 30 [31,27] establish a complete lap. The generator's claim that verify has a 7-cell lap is inconsistent with the pinned frames: frame 0 [38,19], frame 2 [38,20], frame 4 [37,21], frames 6–14 traverse [36,21] through [32,21], and frame 16 returns to [38,19], i.e. eight eligible positions. This does not disprove equal advance; it corrects the claimed lap length. Arrowhead glyphs are never occupied by a dot, so the dots do not all reach their arrowheads in the same frame; the check reports zero same-arrival routes, not a same-arrival guarantee.

## Fit and evidence limits

Final `check.txt`: `viewport: unknown zoom: 1.00 natural`, extent 31×36, no warnings. Actual pane header: 82×51 @100%. The independently pinned final-spec dump states `viewport: 77x47 zoom: 1.00 natural`; graph labels, complete borders and routes fit without an overflow banner, clipping, pan or zoom. UI controls sit at the lower left and do not cover the graph. Pane frame capture contains 19 of 44 requested frames; the separate pinned dump contains the full 44. No `routes:` line is expected. Evidence formats were readable; no required capture was unreadable.

## Blind scorecard

```json
{"visible_nodes":6,"visible_edges":6,"graph_labels":10,"node_labels":6,"edge_labels":4,"ui_text_lines":5,"group_hue_families":5,"declared_rank_pins":0,"visible_bridges":0,"visible_touching_bends":0,"visible_crossings":0,"uncertain_label_owners":0,"clipped_graph_items":0,"selected_occurrences":6,"total_node_occurrences":6,"dot_violations_reported":0,"animated_routes":6,"observed_dots_per_frame":6,"frame_0_origins_verified":6,"pinned_frames":44,"pane_frames":19}
```

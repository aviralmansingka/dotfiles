# network — round 04 generation report

Case: `network` (WAN → firewall → core, with web, Redis and DB behind it).
One view, one accepted spec, two `--check` runs out of a budget of three.

## Frozen inputs

| input | path | sha256 (verified with `shasum -a 256`) |
|---|---|---|
| candidate skill | `docs/visualize-eval/rounds/04/SKILL.md` | `ac431c6d3035e466…` |
| renderer | `/tmp/visualize-eval/round-04/bin/rataflow-view` | `0da16d8d8ed46e2a…` |

Every check, dump and capture used that absolute binary. Nothing was rebuilt,
installed, or substituted. I wrote only inside `docs/visualize-eval/rounds/04/network/`.

## Method

1. Meaning ledger (21 rows) and relationship audit (7 edges, one label owner each)
   before any spec — `generation.json` carries both.
2. Capability preflight: explicit `layers`, `dots: 1`, constant `flow` are available
   and used; `trunks` and `style: dashed` are available but not honest here (the
   source has seven separate point-to-point relations and no uncertain fact).
3. Layout search, in the order the skill asks for: port/placement first, spacing
   second, split never needed. Twelve geometry probes were rendered at
   `COLUMNS=77 LINES=47` (plus one two-node synthetic diagnostic used to learn how
   label placement behaves); only two of them were checked.
4. `scripts/viz-evidence.sh` for the capture, `scripts/viz-validate.py` for the
   verdict. Two verification scripts of my own read the captures back for the
   claims below (motion, layout, colour).

## Accepted view: v1

`specs/v1-a3.json` — `direction: tb`, `theme: gruvbox`, 6 nodes, 7 edges,
`layers` explicit (chain in the second slot, Redis at the fourth tier to the
left, DB two columns right), `flow: true` + `dots: 1` on every edge.

Exact `--check` output (`evidence/v1/check.txt`):

```
viewport: unknown zoom: 1.00 natural
ok: nodes=6 edges=7 flows=7 direction=tb theme=gruvbox
layers=6 (explicit placement, sugiyama skipped)
extent=42x46 cells
crossings: 0 bridges, 0 touching bends
labels: 7/7 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: wan(1) edge(1) core(1) compute(1) data(2)
trunks:
routes: 7/7 near-minimal, 0 detours, 1 shortened
dots: 7 single-dot routes, 0 periodic routes, 0 violations, 7 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 7/7 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

No warnings. Measured size: the pane's own header token `77x47 @100%`
(`evidence/v1/v1-text.txt`, line 0). `--check` cannot print the applied
viewport line outside a terminal — it reads `unknown` — so the header token is
the measurement. Extent 42×46 against a 77×46 drawing area: 35 columns of
horizontal slack, **zero** vertical slack.

### Validator verdict

`evidence/v1` with `--require-select --require-frames`:
**all checks passed, 34 PASS, 0 FAIL** (`validator-v1.txt`).

### Motion (constant, round-04 default)

`flow: true`, `dots: 1` everywhere: 0.5 cells per 100 ms step, no per-route
rate. Same-arrival is not requested by this source, so it is not used and
`arrivals: 0/0` stays honest.

`evidence/v1/v1-frames-77x47.txt` — `COLUMNS=77 LINES=47 --frames 21 --step-ms 100`,
frames 0 … 20 (21 frames, whole 2000 ms cycle). `evidence/v1/v1-motion-verify.txt`:

- 7 dots in every frame, one per route.
- Frame 0: all 7 dots sit exactly one cell below their source port, i.e. on the
  first drawn cell of their own arrow (e.g. WAN port (34,4) → dot (34,5), which
  is a corner glyph; core ports (30,20)/(32,20) → dots (30,21)/(32,21)).
- Every dot advances 10 cells over the 20 steps, **on the same frames** — no
  route reads faster or slower. That is 0.5 cells/step, the constant default.

The harness copy (`evidence/v1/v1-frames.txt`) holds 20 timestamped frames;
its first block was scrolled out of the pane buffer, which is why the pinned
dump exists alongside it.

### Labels

All seven sit beside their own route and nowhere else: `1 GbE` (36,5),
`10 GbE` (34,13) and (34,21), `25 GbE` (22,21), `session` (24,30),
`queries` (40,37), `fill` (33,40) — coordinates as (col, graph row) in
`evidence/v1/v1-text.txt`, graph row 0 = its line 1. The round-03 failure was
`session`; it now sits on its own row-31 run, one cell below it, with the
nearest other route two rows away, and `--check` reads `0 ambiguous owners`.

### Crossings

`crossings: 0 bridges, 0 touching bends`, and no bridge glyph (U+232C) anywhere
in `evidence/v1/v1-text.txt`. Check and picture agree.

The rejected geometry (`specs/v1-a2.json`) had a 0-bridge layout too but two
ambiguous owners; the earlier probe family with Redis in a right-hand column
carried one real bridge (see `dumps/v1-a1-frame0.txt`, frame rows 27–28). That
bridge is what forced the change of layout: no port reassignment removes it,
because the two routes have to cross in the tier band.

### Colour and selection

`evidence/v1/v1-color-verify.txt`: group borders are `wan #d8a657`,
`edge #7daea3`, `core #d3869b`, `compute #a9b665`, `data #7da0b8` / `#97b8ce`
(Redis and DB share the blue family); routes are muted `#7c6f64`, labels
`#ebdbb2`, dots accent `#d8a657`, and every cell carries the same background
`#282828`. Under `--select-all` the five non-WAN borders switch to the accent;
WAN's does not change, because its group colour already **is** the accent.

## Defects I am not hiding

1. **Selection accent collides with the `wan` group colour** — WAN looks the same
   selected or not (`v1-color-verify.txt`). Fixing it means changing an honest
   group to dodge a palette value; not worth the last attempt.
2. **Zero vertical slack** — extent 42×46 in a 77×46 drawing area. The label fix
   could not come from spacing, because there is no vertical room; it came from
   moving the graph's own bounding box (the renderer only places labels inside
   its extent, so a route at the left edge has no label slot on its outside).
3. **`10 GbE` appears twice** — the source states it on two hops (`fw→core`,
   `core→web`). Ownership is unambiguous per edge, but the string repeats.
4. **`25 GbE` goes round the web tier band** — 0 detours by the check, yet the
   left-hand descent reads less direct than a diagonal the web box blocks.
5. **No same-arrival evidence, by design** — not requested; `arrivals: 0/0`.
6. **`1 shortened`** — the renderer's economy pass shortened one route while
   planning; the check counts 0 detours, so this is reported, not repaired.

No blockers: no required capability was missing.

## Cleanup

One pane opened (`w7E:pDR`), `cleanup: "confirmed_closed"` in
`evidence/v1/manifest.json`. No probe ever ran in a pane; the layout probes were
`--frames` dumps. The captain's pane was not touched.

## Files

```
rounds/04/network/
  generation.json  generation.md  attempts.json  validator-v1.txt
  specs/v1-a1.json v1-a2.json v1-a3.json
  checks/v1-a2.check.txt v1-a3.check.txt
  dumps/            (frame-0 dumps and probe specs: what was rejected and why)
  evidence/v1/      check.txt v1-text.txt v1-ansi.ansi v1-selected.ansi
                    v1-frames.txt v1-frames-77x47.txt manifest.json
                    v1-motion-verify.txt v1-layout-verify.txt v1-color-verify.txt
```

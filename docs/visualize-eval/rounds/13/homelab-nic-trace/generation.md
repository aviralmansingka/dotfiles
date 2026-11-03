# homelab-nic-trace — round 13 generation (viz-ds13-4)

Framing: troubleshooting. The reader follows the wired egress path hop by hop and
stops at each hop to check a latency claim.

- Generator: `viz-ds13-4`, model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
- Candidate skill: `docs/visualize-eval/rounds/13/SKILL.md` (proposal 12), sha256 `65d826f0…`
- Rubric: revision 11, sha256 `6bfd3733…`
- Renderer: `/tmp/visualize-eval/round-13/bin/rataflow-view`, sha256 `1f28d87d…`
- Source: `docs/visualize-eval/cases/homelab-nic-trace/source.md`, sha256 `abe8b376…`

## Triage (annex `TRIAGE-homelab-nic-trace`)

Asked (scripted answers used verbatim): which path matters (the wired one, end to
end), the role of Wi-Fi and overlay (secondary, do not tangle them into the main
line), panes or one pane (the annex leaves it to the generator), dots (only if
they help follow a hop). Answered from the brief framing: the libvirt/Docker
bridges are local and get their own surface; the historical/claimed qualifiers
stay drawn; each hop latency is the label of its own route. One own-judgment
call: **no dots** — the source never animates traffic and the annex's conditional
is not a request.

Converged when the source, the reader's job (7-hop trace with one latency claim
per hop) and the shape were all settled by measurement and the qualifier text had
a place to live.

## Classification

```
family: identity-probe-maps
evidence: every node is an interface, address or AS role (bond0 192.168.1.197,
          ONT 169.254.3.1, VZ backbone AS701); the chain is 7 hops deep and the
          source marks the hops and device identities as historical.
```

Tie-breakers: density also fits flow-chains (borrowed for the egress diagram);
placement-planes nearly fits but the source names no shared bus, so no trunk.
Secondary recipe: flow-chains + placement-planes' separation habit. No
reclassification.

## Shape: one canvas, three described diagrams

Rung 1 measured first: the all-in-one graph (13 nodes, 14 relations) drew
`extent=293x15` — 3.8× the 77-column pane — and the check itself warned that
13/14 is above the readable budget. Rung 2: one canvas, sections stacked
vertically by the engine.

| diagram | title | carries |
|---|---|---|
| `egress` | Wired egress, hop by hop | 7 nodes, 6 routes: box → bond0 → rtr → ont → vzagg → vzbb → cf, plus the collapsed-fabric role, the historical marker and ULA-only v6 |
| `local` | Local virtual nets | 5 nodes, 4 routes: vm → virbr → box, ctr → dkbr → box |
| `secondary` | Wi-Fi backup and Tailscale overlay | 5 nodes, 4 routes: ts → box, ts → bond0, box → wlp, wlp → rtr |

Every one of the 14 source relations appears exactly once (17 node instances, 13
distinct nodes; `box`, `bond0` and `rtr` recur as anchors and keep one group tag).

## Check summary (shipped spec)

```
canvas: 3 diagrams on one canvas, drawn whole at 100%
diagram egress     at 0,3:  extent=210x5  nodes=7 edges=6 routes=6
diagram local      at 0,13: extent=88x10  nodes=5 edges=4 routes=4
diagram secondary  at 0,28: extent=151x10 nodes=5 edges=4 routes=4
extent=210x38 cells (whole canvas)
crossings: 0 bridges, 0 touching bends
near-misses: 0 cell(s) inside the 2-cell margin of a node the route does not serve
passes-near-unrelated-node: 0
labels: 14/14 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners
groups: host(3) uplink(2) gateway(2) demarc(1) isp(2) internet(1) libvirt(2) docker(2) overlay(1) wifi(1)
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
```

No warnings. Static: 12 timestamped frames at 77x47 are byte-identical, and the
215x45 natural-zoom dump draws the whole 210x38 canvas with no overflow token.

## Attempts (3 candidates per rendered diagram)

| label | what | result | verdict |
|---|---|---|---|
| `probe-1-single-view` | one graph, 13/14, lr | `293x15`, 0 near-miss, budget warning | rung 1 rejected by measurement |
| `canvas-a` | 3 diagrams, all lr | `210x38`, 0 near-miss, 0 warnings | **shipped** (byte-identical to `spec.json`) |
| `canvas-b` | 3 diagrams, all tb | `71x212` (egress alone `37x93`) | rejected: tb spends a rank gap as tall as the label is wide |
| `canvas-c` | tb + `label_slot` everywhere | `71x116`, **4 near-misses** on `secondary:e0` at ring 2 of `bond0` | rejected: a pass that reads as a false connection |

Near-miss proof for the shipped geometry: in
`evidence/canvas-sections/whole-canvas-215x45-frames.txt` the `ts → bond0` route
turns at (50,37) and enters bond0 at (52,35), while `homelab host` occupies rows
39–42, columns 56–69 — five columns and two rows clear; the sibling `ts → box`
route corners at (49,39) and enters at (56,40), seven columns clear of bond0.

## Validation

`scripts/viz-validate.py evidence/canvas --require-select --require-frames
--require-records --attempts attempts.json` → **all checks passed** (40 PASS, 0
FAIL; `note layout_fit_canvas_form — 3 diagram(s) on a 210x38 canvas`). Full
output in `validator-canvas.txt`.

## Defects and blockers

1. Descriptions run 84–91 characters, so their tail is offscreen at 68/77 columns
   until the reader pans right (full text in `check.txt`).
2. The historical qualifier sits on the egress description, not on each node, so
   the claimed ONT/router identity is marked at diagram level only.
3. Not drawn, deliberately: the router's DHCP and Fios pool IP `71.251.12.240`,
   Cloudflare `AS13335`, and the ONT-as-MMR interpretation (reasons in
   `generation.json.deliberate_drops`).
4. Case-wide hue consistency is capture-verified only inside the 68-column pane;
   the five offscreen groups rest on the `groups:` line.
5. Blocker: the harness pane measured **68x44 @100%**, not 77x47. Recorded as
   measured; the canvas form's fit proof is the per-diagram extents plus the
   215x45 natural-zoom dump. The canvas is 210x38, so no 77x47 fit is claimed.

## Commands

```sh
BIN=/tmp/visualize-eval/round-13/bin/rataflow-view
CASE=docs/visualize-eval/rounds/13/homelab-nic-trace

# every probe and rejected draft
scripts/viz-evidence.sh record --to "$CASE/attempts-log.jsonl" --label <label> -- \
    "$BIN" --check "$CASE/attempts/<spec>.json"

# the shipped surface (pane text + ANSI + select-all + 3 frames + pinned 77x47 dump)
scripts/viz-evidence.sh --spec "$CASE/spec.json" --bin "$BIN" \
    --out "$CASE/evidence/canvas" --label canvas --frames 3

# whole canvas at natural zoom, no overflow token
COLUMNS=215 LINES=45 "$BIN" --frames 3 "$CASE/spec.json" \
    > "$CASE/evidence/canvas-sections/whole-canvas-215x45-frames.txt"

scripts/viz-validate.py "$CASE/evidence/canvas" --require-select --require-frames \
    --require-records --attempts "$CASE/attempts.json"
```

## Files

- `spec.json` — shipped canvas spec (3 diagrams)
- `attempts/` — probe-1, canvas-a/b/c
- `attempts.json`, `attempts-log.jsonl`, `recorded/` — budget and raw records
- `evidence/canvas/` — pane text/ANSI, select-all ANSI, 3 frames, pinned 77x47 dump, `check.txt`, `manifest.json`
- `evidence/canvas-sections/` — whole-canvas 215x45 natural dump + one crop per diagram (title, description, drawing)
- `generation.json` — full record (ledger, audit, mapping, levers, routing, hues, defects, blockers)

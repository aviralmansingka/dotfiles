# homelab-nic-trace — round 08 generation record

Generator: pi coding agent, worker subagent `viz-ds08-3`, model
`fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
Candidate skill `docs/visualize-eval/rounds/08/SKILL.md`
(sha256 `b1bdb4d3d38336cb7783db34da7f9f19edf80704a890de32285d9e582b4221eb`).
Renderer `/tmp/visualize-eval/round-08/bin/rataflow-view`
(sha256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`, absolute path only, never rebuilt).

## Step 0 — family (same for the case and for every view)

```
family: identity-probe-maps
evidence: 13 nodes carry addresses, AS numbers, device names, subnets and
          metrics (bond0 eno1 192.168.1.197/24, 100.113.153.49, AS701,
          AS13335, metric 600); 14 edges is close to N, but density does not
          win here — every row is identifier- or qualifier-bearing, so
          Step 0 tie-breaker 3 applies: coverage outranks shape.
```

Recipe applied: every identifier and qualifier became a ledger row with a
named view **before** any spec existed; layout is a plain `tb` chain, and all
four views are fully static (the source never animates, so no dots anywhere).
Second-order levers: `group` regions for the source's own clusters, `layers`
rank pins in v2 only, where the source states the uplink tier order.

## Views

| view | carries | extent (`--check`) | pane | pinned 77x47 dump |
|---|---|---|---|---|
| v1 host + local virtual nets | vm/ctr/workloads, virbr0, docker0, host identity | 67x40 | 83x51 @100% | `pinned/v1-77x47.txt` |
| v2 uplinks + first hop | bond0/eno1, wlp8s0, gateway, metric failover | 66x36 | 83x51 @100% | `pinned/v2-77x47.txt` |
| v3 egress + WAN path | rtr, ont, vzagg, vzbb, cf + negative facts | 52x44 | 83x51 @100% | `pinned/v3-77x47.txt` |
| v4 overlay + bench answers | tailscale0, encapsulation, bench internet answers | 59x34 | 83x51 @100% | `pinned/v4-77x47.txt` |

All four pinned dumps open with `viewport: 77x47 zoom: 1.00 natural` and carry no
overflow banner, so the graphs fit the 77x47 target at natural zoom even though
the live pane in this tab measured 83x51.

## `--check`, full lines (final specs)

v1 — `evidence/v1/check.txt`

```
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=4 flows=0 direction=tb theme=gruvbox
extent=67x40 cells
crossings: 0 bridges, 0 touching bends
labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: workloads(2) virtual nets(2) homelab host(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

v2 — `evidence/v2/check.txt`

```
viewport: unknown zoom: 1.00 natural
ok: nodes=4 edges=4 flows=0 direction=tb theme=gruvbox
layers=3 (4 pinned, within-rank order automatic)
pins: 4 pinned, 0 conflict(s)
extent=66x36 cells
crossings: 0 bridges, 0 touching bends
labels: 4/4 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: uplinks: wired + wifi(2)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

v3 — `evidence/v3/check.txt`

```
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=4 flows=0 direction=tb theme=gruvbox
extent=52x44 cells
crossings: 0 bridges, 0 touching bends
labels: 1/1 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: egress: one ISP one path, no v6 (ULA)(5)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

v4 — `evidence/v4/check.txt`

```
viewport: unknown zoom: 1.00 natural
ok: nodes=4 edges=3 flows=0 direction=tb theme=gruvbox
extent=59x34 cells
crossings: 0 bridges, 0 touching bends
labels: 3/3 placed, 0 on route cells, 0 skipped, 0 ambiguous owners
groups: overlay: UDP on wired path(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms
origins: 0/0 routes start at their arrow origin
arrivals: 0/0 same-arrival routes show their dot at the arrowhead on the final step
```

No warnings in any final check; every view ends with `0 ambiguous owners`
and `0 bridges, 0 touching bends`.

## Structural levers and the source fact behind each

- **v2 `layers` pins** `[[box],[bond0,wlp],[rtr]]` — the source states the tier:
  the host's wired primary and its Wi-Fi backup both reach the gateway
  192.168.1.1. `--check` reports `layers=3 (4 pinned, …)` and `pins: 4 pinned,
  0 conflict(s)`; the capture shows the pinned ranks in place (box rows 8-11,
  bond0/wlp rows 22-25, rtr rows 39-42 in `evidence/v2/v2-text.txt`).
- **`group` regions** — v1 `workloads` / `virtual nets` / `homelab host`
  (guest vs bridge vs host), v2 `uplinks: wired + wifi` (both interfaces sit on
  the same LAN, one primary and one metric-600 backup), v3
  `egress: one ISP one path, no v6 (ULA)` (collapsed fabric + no global v6),
  v4 `overlay: UDP on wired path` (Tailscale is its own plane).
- **`style: "dashed"`** on the three traceroute hops in v3, with `hist` in
  every hop label — the source says the hops and MAC-vendor roles are
  historical interpretations, not verified topology.
- **`minlen` and `trunks`: not used.** No source statement declares a
  multi-rank corridor inside these views that the label slots do not already
  reserve, and the two candidate "bus" shapes (wired + Wi-Fi; libvirt + docker)
  are independent paths the source explicitly keeps separate (metric failover,
  not ECMP; two different bridges).

## Coverage (summary; the full ledger is `generation.json`)

- All 13 source nodes appear, all 14 source relationships appear
  (`original_relationship_mapping`), none reversed.
- Addresses and identifiers drawn: 192.168.122.x, 172.18.2.x, 172.18.2.1,
  192.168.1.197/24, 192.168.1.213, 192.168.1.1, 0.5 ms, 100.113.153.49,
  71.251.12.240, 169.254.3.1, 100.41.x, AS701, AS13335, 1.1.1.1,
  4.5 / 6.6 / 6-9 ms.
- Qualifiers drawn: `Fios?` (WNC OUI, unverified), `hist` on all WAN hops,
  `not ECMP`, `no v6 (ULA)`, `bench internet: NAT, no committed rate, no v6`.
- Deliberate drop: the contrast with the 4-ISP/2-MMR reference design (DL1 in
  `generation.json`) — the drawn side of that sentence is the v3 region title.

## Honest defects

1. **D1 (renderer, v1).** Two of v1's three declared regions render as
   3-column slivers at the right edge, outside their members:
   `evidence/v1/v1-text.txt` rows 20-25 (borders at cols 69 and 71) and rows
   40-45 (cols 66-68), while the member boxes sit at rows 21-24 cols 22-62 and
   rows 41-44 cols 19-61. Cause read from `rataflow/src/lib.rs::region_boxes`:
   the sibling band pass gives every region its own column band in block order
   without regard to the rank axis, so the 2nd/3rd regions start past their own
   right face and collapse to `max(start + 3)`. One region per `tb` view is the
   most this build can render correctly. Renderer not edited (frozen binary).
2. **D2 (renderer, all views).** Region corners never render: the corner pass
   asks for a blank cell after the border pass already wrote `─`/`│` there.
   e.g. `evidence/v2/v2-text.txt` rows 21/26 have no corners at cols 8/72.
3. **D3 (cosmetic, v2).** A route crossing the region border keeps its
   arrowhead on the title row: `──▼uplinks: wired + wifi ────────▼────`.
4. **D4.** v1's 'virtual nets' and 'homelab host' titles are invisible because
   those regions collapsed (D1). v1's three-candidate budget was spent on two
   earlier probes (height arithmetic, then a skipped-label warning), so it
   shipped as measured rather than silently relabelled.
5. **D5.** Pane measured 83x51, not 77x47; fit proven only by the pinned dumps.
6. **D6.** Hop latencies sit on the hop node labels instead of edge labels
   (four labelled rank gaps would exceed 47 rows); the source prose puts the
   value on the hop cell, the historical edge table puts it on the following
   edge — recorded, not silently resolved.
7. **D7.** v4's bench-answers box is an annotation node with no relations.

## Verification

`uv run scripts/viz-validate.py evidence/<view> --require-select
--require-frames --attempts attempts.json` — all checks pass for v1-v4
(`validator/vN.txt`, summary line `all checks passed`). The validator's
`viewport_matches_target` passes via the pinned 77x47 dumps of each final spec.

Statically verified from the captures: frames 0-3 are byte-identical in every
view (frame 4 differs only by the shell prompt that follows exit), so nothing
moves; `dots: … 0 violations` matches.

## Cleanup

Four evidence captures, each manifest `cleanup: confirmed_closed`
(panes `w7E:pK9`, `w7E:pKA`, `w7E:pKB`, `w7E:pKJ`). One superseded v4 capture
(`evidence/attempt-v4-a2-superseded`, pane `w7E:pKD`, also closed) is kept as
the raw record of that candidate. No cleanup failures.

## Files

- `specs/v1.spec.json` … `specs/v4.spec.json` — final specs.
- `specs/attempts/` — every candidate (a1 files for v2/v3/v4 are faithful
  reconstructions; their original paths were reused by the final spec).
- `checks/` — raw `--check` output for all 12 candidates.
- `evidence/vN/` — manifest, check, text, ANSI, `--select-all` ANSI, frames
  (txt + ansi) per view.
- `pinned/vN-77x47.txt` — pinned-size dumps of the final specs (fit proof).
- `attempts.json`, `generation.json`, `validator/vN.txt`.

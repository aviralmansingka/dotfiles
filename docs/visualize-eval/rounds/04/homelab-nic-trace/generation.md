# homelab-nic-trace — fresh generation, round 04

Case: `homelab-nic-trace`. Candidate skill `docs/visualize-eval/rounds/04/SKILL.md`
(sha256 `ac431c6d3035e466…`). Frozen renderer `/tmp/visualize-eval/round-04/bin/rataflow-view`
(sha256 `0da16d8d8ed46e2a…`), absolute path, never rebuilt. Generator: this pi worker,
model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. No judge and no reviewer
were spawned (the round-04 brief forbids it).

## Views

| view | what it holds | spec | extent (check) | header token | labels | crossings | routes | motion |
|---|---|---|---|---|---|---|---|---|
| `v1` | inside the host: libvirt NAT net + docker bridge | `specs/v1.json` | 67x24 | `77x47 @100%` | 4/4 placed, 0 ambiguous | 0 bridges, 0 bends | 4/4 minimal, 0 detours | static |
| `v2-lan` | host uplinks, gateway, egress answers | `specs/v2-lan.json` | 74x32 | `77x47 @100%` | 5/5 placed, **1 ambiguous** | 0 bridges, 0 bends | 5/5 minimal, 0 detours | 5 single-dot routes, constant 0.5c/step, origins 5/5 |
| `v3-overlay` | tailscale encap over the wired path | `specs/v3-overlay.json` | 63x11 | `77x47 @100%` | 2/2 placed, 0 ambiguous | 0 bridges, 0 bends | 2/2 minimal, 0 detours | 2 single-dot routes, 2 constant at 0.5c/step, origins 2/2 |
| `v4-wan` | ISP hops with claimed identities | `specs/v4-wan.json` | 67x40 | `77x47 @100%` | 5/5 placed, 0 ambiguous | 0 bridges, 0 bends | 5/5 minimal, 0 detours | 4 single-dot routes, 4 constant at 0.5c/step, origins 4/4 |

Full `--check` lines per view are in `evidence/<view>/check.txt` and are repeated verbatim in
`generation.json → views.<view>.check_lines`.

## Why four views

One host graph (virtual nets + overlay + both uplinks + WAN) rendered `extent=139x32`: the host
hub then has four in-edges and two out-edges, the router moves routes onto the hub's side ports and
the canvas explodes to 139 columns. The six-node uplink view stayed 76–82 columns with 2 ambiguous
owners. Both were recorded as probes and the graph was re-split along four honest seams instead —
inside the host, LAN/gateway/answers, overlay encapsulation, ISP hops. `attempts.json` lists every
candidate with its raw `--check` file, including the three superseded combined-view probes.

## Motion

Dots are kept on the three directed-flow views at the round-04 default: `flow: true`, `dots: 1`,
constant speed 0.5 cells / 100 ms step. No same-arrival timing — nothing in the source asks for
synchronised arrival. `v1` has no dots: it is an attachment view where four routes converge on one
host hub, and dots would queue on its two ports without adding direction the arrowheads do not
already give.

Equal-speed proof: `evidence/v2-lan/v2-lan-frames-pinned.txt`, frame 2 → frame 10 gives
`(27,16)→(23,16)`, `(5,24)→(9,24)`, `(51,24)→(47,24)` — 4 cells in 8 steps on all three long
routes. `evidence/v3-overlay/v3-overlay-frames-pinned.txt`: `(36,20)→(40,20)` and
`(36,22)→(40,22)`.

Dot origin: the check's own `origins:` line is full on every animated view (5/5, 2/2, 4/4). In the
captures the phase-0 dot sits on the first cell the router cleared for dots, which is one cell
beyond the port stem cell — e.g. v2-lan frame 0 dot at `(28,15)` below the host port stem at
`(28,14)`; v4-wan frame 0 dot at `(8,19)` below the ONT port stem at `(8,18)`. Stated plainly
because a reader sees it, not because the renderer disagrees with itself.

`UDP encap` ownership (the round-03 failure mode): in `v3-overlay` the label sits at row 23,
columns 35–43, one row below its own encap run at row 22 (dot at `(38,22)`, corner at `(42,22)`) and
three rows below the overlay run at row 20; the check reads `0 ambiguous owners`.

## Honest result

- Validator: `v1`, `v3-overlay`, `v4-wan` — **all checks passed**. `v2-lan` — **2 failed**
  (`check_warnings_absent`, `labels_ownership_clear`) on 1 ambiguous label owner.
- The ambiguous label is `no committed rate` (row 31, columns 30–46, centre `(38,31)`): its own
  rtr→fios route is the vertical stem at column 28, 10 cells away, while the competing wlp→rtr run
  on row 24 passes through column 38, 7 cells away. The view was at its three-candidate budget;
  the two attempts that tried to move that text onto the path node both blew the width to
  `extent=90x32` (overflow), so the honest best candidate is kept and the defect recorded.
- `v4-wan` composition defect: the control palette (columns 1–9, rows 40–45) covers the bottom
  node's lower-left border (columns 7–9, rows 40–41 of `evidence/v4-wan/v4-wan-text.txt`). The
  validator does not test this; a reader sees it. The alternative candidate cleared the palette but
  reintroduced an ambiguous label owner, so the palette overlap was preferred.
- No blockers: no required capability was missing (labels, dashed uncertainty, groups, one dot per
  route, explicit layers all exist).

## What is carried, what is not

Every address, interface name and qualifier from the source is in the coverage map
(`generation.json → meaning_ledger`), including `claimed` on both the ONT and the Fios router, the
`metric 600 / not ECMP` failover qualifier, `no committed rate`, `ULA only`, and the shared pool IP.
Recorded coverage gaps: the WNC OUI, the words "bare metal", and the datacenter-model analogies
(ToR/spine/border/firewall, MMR, 4-ISP contrast) — those are interpretation, not relations on this
host, and drawing them would need invented nodes.

## Files

- `specs/` final specs · `attempts/specs/` every candidate · `attempts/*-check.txt` raw check output
- `evidence/<view>/` check, text, ANSI, `--select-all` ANSI, in-pane frames, pinned 77x47 frames,
  manifest (pane id, cleanup), validator output
- `attempts.json`, `generation.json`, `generation.md`

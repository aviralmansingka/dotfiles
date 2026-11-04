# homelab-nic-trace — round 03 generation report

Case: rack-bench homelab host. Static case (no animation requested), three views,
no renderer or skill edits, no judge spawned.

- Candidate skill: `docs/visualize-eval/rounds/03/SKILL.md`
  sha256 `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c`
- Executable: `/tmp/visualize-eval/round-03/bin/rataflow-view`
  sha256 `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7`
- Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
- Measured viewport for every view: `77x47 @100%` at natural zoom (target 77x47).
- Every view: `crossings: 0`, `labels: N/N placed, 0 on route cells, 0 skipped`,
  no warnings, `--check` exit 0.

## Views

| view | spec | extent | crossings (attempts) | relations | nodes |
|---|---|---|---:|---|---:|
| v1-virtual-nets | `specs/v1-virtual-nets.json` | 44x21 | 1 → **0** (2 attempts) | e1–e4 | 5 |
| v2-overlay-uplinks | `specs/v2-overlay-uplinks.json` | 54x37 | 0 → 1 → **0** (3 attempts) | e5–e10 | 6 (one caption) |
| v3-wan-egress | `specs/v3-wan-egress.json` | 31x37 | 0 → **0** (2 attempts) | e11–e14 | 5 |

Coverage: all 14 audited source relations appear in exactly one view; every node of the
source relationship list appears (box, bond0, wlp, ts, virbr, vm, dkbr, ctr, rtr, ont,
vzagg, vzbb, cf). The gateway box is deliberately shared by v2 and v3 so the local
uplinks and the ISP chain each read on their own.

Group hue families: `virtual`, `host`, `overlay`, `wire`, `edge`, `isp`, `wan`, `limit`
— declared by concept, never by row or column; geometry never creates a group.

## `--check` lines (chosen specs)

```
# v1-virtual-nets
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=4 flows=0 direction=tb theme=gruvbox
layers=3 (explicit placement, sugiyama skipped)
extent=44x21 cells
crossings: 0
labels: 4/4 placed, 0 on route cells, 0 skipped
groups: virtual(4) host(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
origins: 0/0 routes start at their arrow origin

# v2-overlay-uplinks
viewport: unknown zoom: 1.00 natural
ok: nodes=6 edges=6 flows=0 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=54x37 cells
crossings: 0
labels: 6/6 placed, 0 on route cells, 0 skipped
groups: overlay(1) host(1) wire(2) edge(1) limit(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
origins: 0/0 routes start at their arrow origin

# v3-wan-egress
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=4 flows=0 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=31x37 cells
crossings: 0
labels: 4/4 placed, 0 on route cells, 0 skipped
groups: edge(2) isp(2) wan(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
origins: 0/0 routes start at their arrow origin
```

## Relationship audit (source → visible)

| id | from → to | verb / tech | label owner | view | style |
|---|---|---|---|---|---|
| e1 | vm → virbr | libvirt guest port, 192.168.122.x | e1 | v1 | solid |
| e2 | virbr → box | NAT bridge | e2 | v1 | solid |
| e3 | ctr → dkbr | veth, 172.18.2.x | e3 | v1 | solid |
| e4 | dkbr → box | docker bridge | e4 | v1 | solid |
| e5 | ts → box | Tailscale overlay | e5 | v2 | solid |
| e6 | ts → bond0 | UDP encapsulation | e6 | v2 | solid |
| e7 | box → bond0 | eno1 2.5 GbE wired | e7 | v2 | solid |
| e8 | box → wlp | Wi-Fi backup path | e8 | v2 | solid |
| e9 | bond0 → rtr | default gateway, 0.5 ms | e9 | v2 | solid |
| e10 | wlp → rtr | metric 600 failover | e10 | v2 | solid |
| e11 | rtr → ont | NAT out, pool 71.251.12.240, DHCP | e11 | v3 | dashed (claimed ONT) |
| e12 | ont → vzagg | 4.5 ms traceroute hop | e12 | v3 | dashed (historical) |
| e13 | vzagg → vzbb | 6.6 ms traceroute hop | e13 | v3 | dashed (historical) |
| e14 | vzbb → cf | 6–9 ms traceroute hop | e14 | v3 | dashed (historical) |

Every label belongs to exactly one edge. No relation is merged, reversed, or dropped;
no group is reordered to reduce a crossing.

## Layout decisions

- The first attempt put the whole host in one view (7 nodes, edges e1–e7). It measured
  139x32 — 62 columns past the target — with 1 crossing. That is a split, not a label
  diet: v1 keeps the virtual networks, v2 keeps overlay + uplinks, and no relation moved
  out of the audit.
- v2's third attempt is the one that reaches 0 crossings: adding the `claimed` router
  qualifier widened the router box, shifted the ports, and made the long
  `tailscale0 → bond0` corridor cross a route (1 crossing). The qualifier moved to v3,
  which is the view that draws the interpreted traceroute chain; v2 keeps the plain
  router label. Nothing was dropped to buy the crossing back.
- v3 uses explicit one-node layers so the chain reads top-to-bottom in 37 rows instead
  of the 40 the automatic layering spent.

## Honest defects / unresolved

1. **IPv6 limitation drawn as a caption box.** `rataflow-view` has no footnote or
   annotation field, so "no global v6 (ULA only)" can only be drawn as an edge-less box
   in v2's last layer (group `limit`). It is labelled as a limitation, but a reader can
   mistake it for a device.
2. **`no committed rate` not drawn.** It is a Part B answer in the source and names no
   node or link. The caption slot went to the IPv6 reachability fact and v2's three
   attempts were spent; recorded here rather than hidden.
3. **Router qualifier is per-view.** v3 says `claimed Fios rtr 192.168.1.1`; v2 says
   `Fios rtr 192.168.1.1`. Carrying the qualifier in v2 costs 1 crossing.
4. **`tailscale0 → bond0` skips the host band.** The renderer routes it in an outer
   corridor, so it can read as bypassing the host; the host is the sender in both e5
   and e6, and the encap label says so.
5. **`Linux 7.0`, the WNC OUI string, and the "collapsed fabric / ONT = MMR" analogy are
   not drawn** (reasons in `generation.json`): versions and analogies are not relations,
   and the OUI would read as verified hardware rather than a MAC-vendor guess.
6. **Static case.** No dot is animated, so `dots: ... 0 synchronized`, `origins: 0/0`,
   and a 5-frame static capture are the full motion evidence. No motion claim is made.
   The round-03 `--frames 21` rule applies to animated views; nothing here animates.

No blockers: every required fact that has a node or a link can be drawn with this
renderer, and every drawn view fits 77x47 at 100% zoom.

## Validator

`scripts/viz-validate.py <evidence/view> --require-select --require-frames --attempts
attempts.json` → **all checks passed** for all three bundles (28/28 PASS each);
outputs saved as `evidence/<view>/validator.txt`. No failing check.

## Cleanup

Each capture split a no-focus half pane in this worker's own tab (`w7E:t3S`) and closed
it: panes `w7E:pBW`, `w7E:pB0`, `w7E:pC2`, all `confirmed_closed` in their manifests.
The captain's tab was never used; no raw tmux.

## Files

```
docs/visualize-eval/rounds/03/homelab-nic-trace/
├── generation.json, generation.md, attempts.json
├── specs/v1-virtual-nets.json, v2-overlay-uplinks.json, v3-wan-egress.json
├── attempts/v1-attempt1-combined-7nodes.json
├── attempts/v2-attempt1-no-caption.json
├── attempts/v2-attempt2-claimed-rtr-crossing.json
├── attempts/v3-attempt1-plain.json
└── evidence/{v1-virtual-nets,v2-overlay-uplinks,v3-wan-egress}/
    ├── check.txt, bin.sha256, manifest.json, validator.txt
    ├── <view>-text.txt, <view>-ansi.ansi, <view>-selected.ansi
    └── <view>-frames.txt, <view>-frames.ansi
```

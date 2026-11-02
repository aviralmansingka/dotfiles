# homelab-nic-trace — round 02 generation

**Case** `homelab-nic-trace` · **worker_id** `viz-ds02-homelab-nic-trace` · **round** 02
**Generator** pi worker subagent, `fireworks` / `accounts/fireworks/routers/deepseek-flash-latest`
**Frozen renderer** `/tmp/visualize-eval/round-02/bin/rataflow-view`, sha256 `ee085c0f…40e8ea`
**Candidate skill** `docs/visualize-eval/rounds/02/SKILL.md`, sha256 `7d1ff098…b75d70`
**Target** 77 × 47 @ natural 100 % — measured `77x47 @100%` in every view's app header

No reviewer was spawned (the captain runs the Sol judges). Nothing outside this directory was
touched; no commit, no install, no renderer edit.

## Views

| view | carries | extent | labels | groups | dots | dashed | pane |
|---|---|---|---|---|---|---|---|
| v1 | host stack: guests → virtual bridges → host → overlay + NIC fan-out | 74×30 | 8/8, 0 on route, 0 skipped | guest 2, virt 2, host 1, overlay 1, nic 2 | 8 single-dot, 0 violations | — | `w7E:p7G` closed |
| v2 | home side: default vs metric-600 failover → Fios gateway NAT/DHCP → historic demarc | 45×21 | 3/3, 0 on route, 0 skipped | nic 2, nat 1, demarc 1 | 3 single-dot, 0 violations | e11 | `w7E:p7Y` closed |
| v3 | ISP side: ONT → Verizon edge → AS701 → Cloudflare | 19×29 | 3/3, 0 on route, 0 skipped | demarc 1, isp 2, internet 1 | 3 single-dot, 0 violations | e12 | `w7E:p7N` closed |

Coverage is a partition, not a repeat: v1 owns e1–e8, v2 owns e9–e11, v3 owns e12–e14, and all
14 audited relationships are drawn exactly once. The split is at the demarc — below it is the
home, above it is the ISP.

## Validator

`scripts/viz-validate.py <bundle> --require-select --require-frames --attempts attempts.json`:
**24 PASS / 0 FAIL** for each of the three bundles; no failing check anywhere. Full output in
`validator/v1.txt`, `validator/v2.txt`, `validator/v3.txt`, combined in `validator/all-views.txt`.

## What the source forced

- **Separation** (fixed constraint): wired primary, Wi-Fi backup, Tailscale encapsulation, Docker
  bridge and libvirt NAT are five different colour families in v1, and the two LAN links are two
  different routes in v2 — metric failover, never ECMP.
- **Qualification** (fixed constraint): the router and the ONT are drawn as `Fios rtr?` and `ONT?`,
  and the two hops that depend on those identities (e11 `NAT 71.251.12.240`, e12 `4.5 ms`) are
  `style: "dashed"`. Everything measured but not identity-dependent stays solid.
- **One dot per route**: `dots: 1` on all 14 edges. Each of the five frames per view carries exactly
  one dot per route (8/8/3 glyphs), so motion is provable, not aliased.

## Blockers (capability gaps, reported not faked)

1. **No blocked-path style.** `style` is `solid|dashed` and dashed means *unconfirmed*. The source's
   `no global IPv6 → v6 internet unreachable` is a negative claim, so it cannot be an edge. It lives
   on the host node as `v6 ULA`.
2. **No property channel.** The `bench internet` answers (NAT on egress, no committed rate, no v6)
   are attributes of one measured path; nodes and edges only carry labels. Only NAT and no-v6 could be
   drawn.
3. **Trunks exist but are lossy here.** A trunk is one corridor out of `from` plus *unlabelled* spurs.
   The only real shared bus in this source is the home LAN, whose links emit from the NICs toward the
   router — every trunk form reversed e9/e10 or invented a wlp↔bond0 link, and the spur label field
   does not exist, so `default 0.5 ms` and `metric 600` would vanish. Probes and the two routing
   findings (`no obstacle-safe route` without a spacer layer; a trunk-only spec is rejected) are in
   `probe/`.

## Known defects

1. **Overlay address missing (v1).** `100.113.153.49` is not drawn. Putting it in the node label makes
   the final layout 80 columns wide (3 over the 77 target); the auto-layout attempt was 139 wide.
   v1's three attempts were spent, so this is reported rather than re-rolled.
2. **Adjacent parallel runs (v1).** `backup path` and `eno1 2.5 GbE` leave the host two rows apart;
   label-to-route association rests on the renderer's label-above-route convention. Arrowheads land
   on distinct nodes.
3. **Cross-view hues.** Group colours key off declaration order per view, so `nic` is blue in v1 and
   amber in v2, and the ONT is pink in v2 and amber in v3. Within a view each group keeps one family
   with member shading (verified in the ANSI captures).
4. **`pane_cols: null`.** The harness's `herdr pane layout` rect lookup returned no rect for freshly
   split panes on this Herdr build; `pane_rows` came through as 47. Size and zoom rest on the app's
   own `77x47 @100%` header token. Manifests were left exactly as produced.

## Files

```
attempts.json                     9 recorded attempts, ≤3 per view, written before capture
attempts/v1-a1..a3.json           v1: 113x32 → 139x32 → 74x30 (explicit layers)
attempts/v2-a1..a3.json           v2: 52x24 → 33x21 → 45x21 (gateway address added)
attempts/v3-a1..a2.json           v3: 22x32 → 19x29
v1.json v2.json v3.json           final specs
evidence/v1|v2|v3/                check.txt, text, ansi, selected ansi, 5 frames, manifest, bin.sha256
probe/                            offline trunk capability probes (no pane opened)
validator/v1.txt v2.txt v3.txt    full validator output
generation.json                   ledger, audit, coverage map, defects, blockers, cleanup
```

Every pane opened (two geometry preflights, three captures, one superseded capture) is
`confirmed_closed`, and the tab now holds only the generator's own pane.

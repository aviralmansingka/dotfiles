# Blind observation — homelab-nic-trace, round 11, stage A

Coordinates below are **1-based [column,row,width,height]**, relative to the drawn frame, not the file line number; the two preamble lines in each pinned file are excluded. Node and edge labels are transcribed from the pinned 77×47 frame 0. The 82×51 captures have different centering. Facts about what the source requires remain unverified until stage B; the generator's own ledger is not independent source evidence.

## Spec identities

`shasum -a 256`, compared with `generation.json`:
- `specs/v1-lan.json`: `9735dde6a5340d0a96915c4d2006ba79f7b5fccac33064f45f9b3c7d6b34fe61` — matches.
- `specs/v2-wan.json`: `2916c9258c0196839fcfc110e5e1a2315aa6ca4f954290c9603498ee48744a3d` — matches.
- `specs/v3-virt-overlay.json`: `6385f6cd683c6104e9397bdbdbfc93cec4ccb6c4c31e10ded56d86659edb6d68` — matches.

## Generator's classification and disclosed choices

`generation.md`, section “Step 0 — shape notice”, verbatim:

```text
family: identity-probe-maps
evidence: thirteen host/device nodes carry fourteen relations whose whole content is
          addresses and qualifiers (bond0 192.168.1.197 on 192.168.1.0/24, tailscale0
          100.113.153.49, ONT 169.254.3.1 as a historical reading, AS701/AS13335,
          ULA-only v6) — E ≈ N, the trace tail is deep, and coverage of the
          identifiers is the hard part, not geometry.
```

The classification is a hint, not a requirement to match a family exactly. Generator discloses top-to-bottom rather than left-to-right because measured LR widths were 372 and 233 cells; three views rather than one page because the merged attempts measured 372×9 LR and 78×97 TB; and a differing repeated gateway label because of width. In v3, a length-3 route reserves the UDP corridor. These are claims about the attempts, not independently recreated measurements.

## Visible labels

Node label positions:

| View | Label | Rectangle |
|---|---|---|
| v1 | `homelab host: ASUS, Linux 7.0, ~/rack-bench, v6 ULA-only` | [11,16,56,1] |
| v1 | `bond0 192.168.1.197` | [17,24,19,1] |
| v1 | `wlp8s0 192.168.1.213` | [41,24,20,1] |
| v1 | `Fios router 192.168.1.1 (hist.): ToR+spine+border+FW, NAT+DHCP` | [8,32,62,1] |
| v2 | `Fios router 192.168.1.1 (hist., WNC OUI): ToR/spine/border/FW` | [9,8,61,1] |
| v2 | `ONT 169.254.3.1 (hist.) = MMR analog, 1 ISP vs 4-ISP/2-MMR` | [11,16,58,1] |
| v2 | `Verizon aggregation 100.41.x` | [26,24,28,1] |
| v2 | `Verizon backbone AS701` | [29,32,22,1] |
| v2 | `Cloudflare 1.1.1.1 AS13335` | [27,40,26,1] |
| v3 | `tailscale0 100.113.153.49` | [10,10,25,1] |
| v3 | `container veth` | [40,10,14,1] |
| v3 | `VM vnet0` | [59,10,8,1] |
| v3 | `docker0 172.18.2.1` | [22,20,18,1] |
| v3 | `virbr0 libvirt NAT` | [45,20,18,1] |
| v3 | `homelab host: ASUS, Linux 7.0, ~/rack-bench, v6 ULA-only` | [12,30,56,1] |
| v3 | `bond0 192.168.1.197` | [29,38,19,1] |

Edge labels:

| View | Label | Rectangle |
|---|---|---|
| v1 | `eno1 2.5 GbE` | [41,19,12,1] |
| v1 | `backup path` | [39,22,11,1] |
| v1 | `LAN /24, def gw 0.5 ms` | [15,30,22,1] |
| v1 | `metric failover, not ECMP` | [52,28,25,1] |
| v2 | `NAT out, pool 71.251.12.240` | [41,11,27,1] |
| v2 | `4.5 ms, no CIR` | [42,19,14,1] |
| v2 | `6.6 ms` | [42,27,6,1] |
| v2 | `6-9 ms` | [42,35,6,1] |
| v3 | `UDP encap` | [12,13,9,1] |
| v3 | `overlay` | [24,13,7,1] |
| v3 | `172.18.2.x` | [49,13,10,1] |
| v3 | `192.168.122.x` | [65,13,13,1] |
| v3 | `docker bridge` | [33,23,13,1] |
| v3 | `NAT bridge` | [56,23,10,1] |

The UI also displays the application title, size, filename, counts and quit hint on row 1, plus a separate bottom-left palette with `+ [+]`, `− [-]`, `⊡ [f]`, `□ [i]`; these are UI, not graph labels. In pinned v3 row 1 the end of the quit hint is clipped to `q q`. The graph labels themselves are all visible. The pinned v1 rightmost edge label ends at column 76; the pinned v3 rightmost edge label ends at column 77.

The exact `192.168.1.0/24` does **not** appear; the graph says `LAN /24` next to the two 192.168.1.x interface addresses and router 192.168.1.1. The generator explicitly calls this an abbreviation. `metric 600` does **not** appear in the final spec or capture: `metric failover, not ECMP` omits the number, contrary to the generator's assertion that both halves are visible. `v6 ULA-only`, NAT+DHCP, pool, no CIR, ONT historical qualifier, MMR comparison, the AS identifiers, Tailscale address, UDP encap and hop latencies are visible as transcribed. The no-v6-internet bench answer is suggested by ULA-only and an all-v4 WAN trace, not explicitly stated as an internet reachability result. No separate Oct 11 date is visible. The claims of complete source coverage cannot be established blind.

## Arrow observations

All routes terminate in visible downward `▼` arrowheads. The following is what can be traced in the final captures, using the text labels to identify endpoints; no route is dashed. At each common target the arrowheads are separate, not a drawn merge.

- v1 host → bond0 (`eno1 2.5 GbE`); host → wifi (`backup path`); bond0 → router (`LAN /24, def gw 0.5 ms`); wifi → router (`metric failover, not ECMP`). All four routes traceable. Two adjacent originating ports from the host and two adjacent incoming router heads are distinct. The `backup path` and `LAN /24` text abuts an arrowhead, but remains readable; its owner is apparent from its placement beside that route.
- v2 router → ONT (`NAT out, pool 71.251.12.240`); ONT → Verizon aggregation (`4.5 ms, no CIR`); aggregation → Verizon backbone (`6.6 ms`); backbone → Cloudflare (`6-9 ms`). Four straight vertical routes, traceable.
- v3 VM → virbr0 (`192.168.122.x`); container → docker0 (`172.18.2.x`); virbr0 → host (`NAT bridge`); docker0 → host (`docker bridge`); tailscale0 → host (`overlay`); tailscale0 → bond0 (`UDP encap`). Six traceable routes. The tailscale0 left port takes a long left-side corridor to bond0 and its right port runs to the host; three distinct arrowheads enter the host. The label `overlay` is immediately against its port, yet distinguishable.

No visible crossing, bridge glyph, touching bend, T-junction or shared route occurs in the graph areas. The apparent branching is via separate ports at the same boxes, not an unmarked wire split. `--check` independently reports 0 bridges and 0 touching bends in each view; 0 ambiguous label owners, 0 on-route label cells and all 4/4, 4/4 and 6/6 labels placed. My count of uncertain owners is 0, although tightly adjacent text and heads merit attention.

## Groups, colors, borders and ranks

Normal ANSI was parsed per cell. All 16 node occurrences have complete four-sided rounded borders with all four corners, and **every border cell** has the same foreground color per node. Selected ANSI shows all 16 occurrences with complete borders in RGB(216,166,87), simultaneously: v1 4/4, v2 5/5, v3 7/7. This is a select-all capture, not evidence of 16 separate single-selection interactions.

Declared group tags are logical only: no group border, box, header or label is painted. Six distinct families appear:
- `host`: teal RGB(115,206,183), v1 and v3, identical.
- `nics`: yellow-green bond0 RGB(183,206,115) in v1 and v3, wifi RGB(203,219,153) in v1; same family, lighter wifi.
- `gateway`: purple RGB(138,115,206), v1 and v2, identical.
- `wanpath`: orange family: ONT (206,161,115), aggregation (219,186,153), backbone (193,135,78), Cloudflare (231,209,187), in top-down order.
- `virtnets`: blue family: VM (115,161,206), container (153,186,219), virbr0 (78,135,193), docker0 (187,209,231); top rank left-to-right container then VM, next rank docker0 then virbr0.
- `tailnet`: green RGB(115,206,115), tailscale0.

Repeated host, bond0 and gateway have no hue drift. No view repeats a multi-member sibling set in another view, so cross-view sibling order stability cannot be tested. Within v3 container/docker precedes VM/virbr left-to-right at both paired ranks. No explicit named tier label or painted tier band is visible; hues mark the groups. No rank pins are declared in the final specs or stated as pins in `generation.json` (0); actual top-down ranks are v1 host / bond0+wifi / router, v2 router / ONT / aggregation / backbone / Cloudflare, v3 tailscale0+container+VM / docker0+virbr0 / host / bond0. The v3 `minlen: 3` is a routing constraint, not a rank pin.

## Motion and fit

All final edges are static: no animated route is declared; every check reports 0 single-dot, 0 periodic routes and 0 violations, with origins and arrivals 0/0. Each pinned file has five timestamped frame bodies, all byte-identical within that view. No flow dots are visible; spacing, travel direction, corners/bridges/heads, frame-zero origin and simultaneous arrival are not applicable, not independently tested dynamic behavior.

The pinned evidence starts `viewport: 77x47 zoom: 1.00 natural` in all views, with no overflow banner. All 16 graph boxes, 14 graph edge labels and their routes are in frame, with no need to pan or zoom in these captures. The v3 status/quit header is clipped at the right edge, unlike graph content. The separate evidence captures' app headers report 82×51 @100%; `manifest.pane_rect` and pane columns are missing per generator, so the independent pane geometry is not proven by those manifest fields. `--check` reports viewport unknown and extents 83×20, 63×36, 72×32 respectively. The v1 extent exceeds 77 despite a fully drawn pinned graph; the generator attributes the discrepancy to reserved palette/label space versus drawn span, but the capture establishes visible fit, not that implementation explanation. The clipped UI header is an additional limitation. The absent `routes:` output is expected.

## Neutral structural summary and blind scorecard

- Views: v1 4 boxes/4 arrows, v2 5/4, v3 7/6. Occurrences total 16 boxes, 14 arrows and 30 graph labels (16 node, 14 edge); 13 distinct node IDs across specs due to 3 repeated occurrences: host, bond0, router. The claimed 13/13 source nodes and 14/14 source relationships cannot be confirmed without the withheld source.
- Maximum fan-out is 2, at v1 host and v3 tailscale0; 0 bidirectional box pairs / 0 antiparallel arrows. Router receives 2 separate arrowheads in v1; host receives 3 in v3. Each view is connected; across views they join conceptually through repeated router and host/bond0 labels, not drawn inter-view connectors. There is a downward sequential hop chain in v2, but no explicit phase labels. Addresses and qualifiers dominate labels.
- Group hue families 6; declared rank pins 0; visible bridges 0, touching bends 0, drawn wire junctions 0; uncertain edge-label owners 0; graph items clipped 0, UI header clipped 1 at pinned v3; selected-state border coverage 16/16 simultaneously (individual interactions not separately captured); animated routes 0, dot violations 0 reported and none visually observed (dynamic behavior not exercised).
- Input evidence was readable; independent source, rubric and expected data deliberately not read. Pane-rectangle metadata missing; no separate per-node single-select capture; no animated-route evidence.

# Blind observation — homelab-nic-trace, round 08, stage A

Reviewer: openai/gpt-6.1-terra:high. Observations below are made before seeing expectations. Only final specs, their capture bundles and pinned captures were inspected; no new viewer was run. Coordinates are 1-based [column,row,width,height], in the 83×51 pane text/ANSI capture, not the pinned 77×47 dump. The pane text file has 50 stored lines with trailing blanks omitted; ANSI lines contain the full 83-column grid. Labels listed are diagram labels, not UI chrome. Identical views are separate node occurrences.

## Hashes and capture provenance

`shasum -a 256` of the four final specs, each matching its manifest `spec_sha256`:
- v1 `2c62b75ef750df747df7dcb969044d365850d5f86b17c7dc7c478cf1d6fee5b2`
- v2 `762f484b003e8ff2419dfb2292c31ab7b8a92d18f12a1c3d3ed9f70bc3906ea8`
- v3 `a45b241565a2b753bf7e8488fdd4653817061294da7c273707ab6b1d18b421e4`
- v4 `4bd1c2251c999ed239b0ab34a8f6d4e875002b90272ff6e9c1302315948efbc9`

All manifests name binary SHA-256 `ea24593b0f80c1617573eef4766f2bacaaf4315a8133a65d5331e9daec1c1f30`, five frames at 100 ms steps, select-all capture, and confirmed pane close. Captured frames record `viewport: 83x51 zoom: 1.00 natural`; check files instead say `viewport: unknown zoom: 1.00 natural`. Pinned dumps record `viewport: 77x47 zoom: 1.00 natural` and show the same diagram content at shifted coordinates. Pane manifest `viewport_line` and `pane_cols` are null; viewport dimensions are evidenced by the frame line and pane header. Check extents v1–v4 respectively 67×40, 66×36, 52×44, 59×34. At both captured sizes all node and edge text is visible without pan or zoom, but v1 loses two group titles and their region outlines do not enclose the members; count those two group titles as clipped/missing rather than claiming the entire content fits.

## Labels and geometry

Every list entry is verbatim followed by its text rectangle. Node border rectangles are given separately below. The family evidence available in the check captures, recorded verbatim without a verdict:

```
groups: workloads(2) virtual nets(2) homelab host(1)
groups: uplinks: wired + wifi(2)
groups: egress: one ISP one path, no v6 (ULA)(5)
groups: overlay: UDP on wired path(1)
```

No capture or final spec contains a separate line explicitly named `family`; the above are the literal group-membership lines, not an invented family measurement.

### v1

Nodes:
- `ctr veth 172.18.2.x` [19,9,19,1]; border [18,8,21,4].
- `VM vnet0 192.168.122.x` [43,9,22,1]; border [42,8,24,4].
- `docker0 172.18.2.1` [24,23,18,1]; border [23,22,20,4].
- `virbr0 libvirt` [47,23,14,1]; border [46,22,16,4].
- `homelab ASUS Linux 7.0, ~/rack-bench Oct 11` [21,43,43,1]; border [20,42,45,4].

Edge labels: `docker` [21,16,6,1], `libvirt` [45,16,7,1], `docker bridge` [11,32,13,1], `NAT bridge` [30,39,10,1]. Group title `workloads` [20,7,9,1]. `virtual nets` and `homelab host` titles are absent. The addresses, device names, and date/path text above are legible.

Arrows: ctr → docker0, head ▼ [24,21]; VM → virbr0, ▼ [47,21]; docker0 → host, ▼ [21,41]; virbr0 → host, ▼ [23,41]. All downwards, heads present, routes traceable; the two host-bound arrows end adjacent but are distinct. Docker bridge runs a long vertical then bends left to the host; NAT bridge is a long vertical then bends left. The NAT bridge label is well to the left of its own right-hand vertical run at row 39 and just above another parallel horizontal route at row 40: its ownership is visually less immediate, but tracing the two separated routes resolves it. The other edge labels sit next to their respective routes.

The workloads outline spans columns 17–66, rows 7–12, with two nodes inside. It uses horizontal and vertical strokes, not corner glyphs, and outgoing edges overwrite its bottom boundary at [19,12] and [43,12]. The two later outlines are three-column slivers: virtual nets at columns 70–72, rows 21–26, while its member borders occupy columns 23–42 and 46–61, rows 22–25; homelab host at columns 67–69, rows 41–46, while its member border occupies columns 20–64, rows 42–45. Their top/bottom strokes are `───`, sides `│ │`, no corner glyphs, no visible titles; they are entirely outside their members. ANSI establishes these are styled drawing cells rather than plain text artifacts. This invalidates spatial enclosure and makes the declared region order only a vertical sliver order, not sibling boxes enclosing their members.

### v2

Nodes: `homelab host` [36,10,12,1], border [35,9,14,4]; `bond0 eno1 192.168.1.197/24` [11,24,27,1], border [10,23,29,4]; `wlp8s0 192.168.1.213, not ECMP` [43,24,30,1], border [42,23,32,4]; `rtr 192.168.1.1 Fios? NAT+DHCP` [27,41,30,1], border [26,40,32,4]. Edge labels `2.5 GbE` [21,20,7,1], `backup` [40,17,6,1], `0.5 ms` [16,37,6,1], `metric 600` [31,37,10,1]; region title `uplinks: wired + wifi` [12,22,21,1]. The address, `not ECMP`, and `Fios?` qualifiers are visible.

Arrows: host → bond0 ▼ [11,22]; host → wlp ▼ [43,22]; bond0 → rtr ▼ [27,39]; wlp → rtr ▼ [29,39]. All head down and their routes are traceable. Both incoming uplink arrowheads sit on the REGION title/top-border row; the left ▼ is immediately adjacent to the title at its first character, and the right ▼ replaces a border stroke. The two outgoing uplink routes overwrite the region bottom at columns 11 and 43. `2.5 GbE` lies between its left route's bend and vertical stem, and `backup` beside the other stem. `0.5 ms` and `metric 600` are above their respective lower bends; association is traceable, though labels are offset.

One region spans columns 9–74, rows 22–27, enclosing the two uplink boxes, but top/bottom have no corner glyphs and are interrupted by routes. Four boxes visibly occupy three distinct ranks: host row 9, both uplinks row 23, router row 40. The `layers` spec assigns exactly those three ranks; check says `layers=3 (4 pinned, within-rank order automatic)` and `pins: 4 pinned, 0 conflict(s)`. Capture agrees with rank placement; pin/conflict status itself is from check, not visually inferable. No minlen is declared.

### v3

Nodes: `rtr = ToR+spine+FW, NAT+DHCP, pool 71.251.12.240` [18,7,48,1], border [17,6,50,4]; `ont 169.254.3.1 = demarc/MMR, 4.5 ms hist` [22,21,41,1], border [21,20,43,4]; `vzagg 100.41.x, 6.6 ms hist` [29,29,27,1], border [28,28,29,4]; `vzbb AS701, 6-9 ms hist` [31,37,23,1], border [30,36,25,4]; `cf AS13335 1.1.1.1 hist` [31,45,23,1], border [30,44,25,4]. Edge label `NAT out` [20,14,7,1]; region title `egress: one ISP one path, no v6 (ULA)` [19,5,37,1]. Pool/IP addresses, AS701, AS13335, all four `hist` qualifiers, and `no v6 (ULA)` are visible.

Arrows: rtr → ont, solid, ▼ [22,19]; ont → vzagg, dashed ╎/╌, ▼ [29,27]; vzagg → vzbb, dashed, ▼ [31,35]; vzbb → cf, dashed ╎, ▼ [31,43]. All head down, heads intact, routes traceable. Solid bends on dashed paths do not erase their visible dash distinction. NAT out is adjacent to its route. One region spans columns 16–67, rows 5–48 and contains all five nodes. Its continuous side strokes and horizontal top/bottom have no corner glyphs; no crossing of its boundary is required. No minlen declared.

### v4

Nodes: `tailscale0 100.113.153.49 UDP` [28,11,29,1], border [27,10,31,4]; `bond0 eno1` [29,27,10,1], border [28,26,12,4]; `homelab host` [44,27,12,1], border [43,26,14,4]; `bench internet: NAT, no committed rate, no v6` [20,40,45,1], border [19,39,47,4]. Edge labels `UDP encap` [19,19,9,1], `overlay` [34,22,7,1], `0.5 ms` [22,36,6,1]; region title `overlay: UDP on wired path` [29,9,26,1]. Address, device names, UDP, no committed rate and no v6 are visible.

Arrows: tailscale → bond0 ▼ [29,25], tailscale → host ▼ [44,25], bond0 → bench internet ▼ [20,38]. All downwards, heads present and traceable. `UDP encap` sits by the left stem, `overlay` by the right branch, and `0.5 ms` at the bond-to-bench stem. Two outgoing tailscale routes run closely in parallel and peel apart but remain distinct, not a junction. Region columns 26–58 rows 9–14 encloses tailscale alone; top/bottom lack corners and outgoing routes replace two bottom cells. No minlen declared.

## Borders, crossings, selections and motion

All 18 node boxes have complete four sides and all four rounded corners `╭╮╰╯`; every cell of each individual node border uses one continuous foreground color in the corresponding ANSI capture, despite colors differing among nodes. The select-all ANSI independently shows all 18 borders in bold RGB 216;166;87, including their corners: coverage 18/18 node occurrences, not merely one border reused as evidence. The region outlines, unlike node boxes, have no rendered corner glyphs. v1 two group outlines are displaced slivers; v1/v2/v4 outline strokes are interrupted by routes where described.

Each check reports `crossings: 0 bridges, 0 touching bends`. No bridge glyph, route-route crossing, touching bend, or genuine route junction was seen in the captures. The apparent branch at v4's tailscale is two individual exit stems, and the adjacent v1/v2 target heads are distinct. Region boundary/arrow overlaps noted above are visible border interruptions, not counted here as route-route crossings. No route is untraceable; no label ownership remains uncertain after route tracing, though v1 `NAT bridge` and v2 offset labels are less immediate. Check reports zero ambiguous owners, consistent with this trace-based count.

All four specs contain zero flows; each check reports `dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 constant at 0.5c/step, 0 same-arrival at 2000ms`. Five captured frames per view, at 0, 100, 200, 300, 400 ms, show no flow dot glyphs (also checked `●`, `•`, `⦿`, `◉` in frame text and ANSI). Frame diagrams are static. Dot count is 0 in each frame for each view; spacing, direction, corners, bridges, origin and arrival timing are not applicable, not proven dynamic behavior. UI header middle dots are punctuation, not route dots.

## Blind scorecard

| view | visible nodes | visible edges | visible diagram labels (node / edge / region) | route crossings / touching bends | uncertain edge-label owners after tracing | missing/clipped labels | selected occurrences | dot violations |
|---|---:|---:|---|---|---:|---:|---|---:|
| v1 | 5 | 4 | 5 / 4 / 1 | 0 / 0 | 0 | 2 region titles | 5/5 | 0 |
| v2 | 4 | 4 | 4 / 4 / 1 | 0 / 0 | 0 | 0 | 4/4 | 0 |
| v3 | 5 | 4 | 5 / 1 / 1 | 0 / 0 | 0 | 0 | 5/5 | 0 |
| v4 | 4 | 3 | 4 / 3 / 1 | 0 / 0 | 0 | 0 | 4/4 | 0 |
| total | 18 | 15 | 18 / 12 / 4 = 34 | 0 / 0 | 0 | 2 | 18/18 | 0 |

Evidence not readable: none among final specs, pane text/ANSI, check, selected ANSI, five-frame captures, manifests and pinned text. Separate individual-selection captures were not supplied; select-all provides per-occurrence selected-border evidence simultaneously. The explicit named family-evidence line is absent in the permitted files; the actual group lines are quoted above. Pinned files contain three frames each, whereas full evidence has five.

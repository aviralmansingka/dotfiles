# Blind observation — homelab-nic-trace, round 10, stage A

Scope: final specs, generator's disclosed classification/metadata, and provided captures only. No source, expected data, rubric, earlier rounds, new viewer session, or subagents. Coordinates below are 1-based [column,row,width,height] in the 82×51 `evidence/vN/vN-text.txt` captures, not the differently centered pinned dumps. Widths are terminal cells; all listed labels are one row. Node and edge labels are listed separately. UI header and controls are not graph labels.

## Spec hashes

Computed with `shasum -a 256`; each matches the corresponding `spec_sha256` in `generation.json` and capture manifest:
- v1 `a15623e23256044f1dd266bd08b9e79e1ef99bb870c04cf6b73a46c41248b40b`
- v2 `ac511f635f630100aeb7daeca28627f0c4cbda91ce3a9ec24f72f3a43693dc4d`
- v3 `1439e2d086e7eb027b964a426a8fff27fdd05a9236ba8af1c4cf2735b902e90e`
- v4 `e8907659668ae98fdd4a173d869b3bdb4c92cdcdd68da5a13618a8aa9e62f0db`

## Visible labels

### v1: five node labels, four edge labels
- Node `ctr veth` [31,18,8,1]; `VM vnet0` [44,18,8,1]; `docker0 172.18.2.1` [27,26,18,1]; `virbr0` [50,26,6,1]; `homelab rack-bench · no global v6` [25,34,33,1].
- Edge `172.18.2.x` [23,22,10,1]; `192.168.122.x` [50,21,13,1]; `docker bridge` [22,30,13,1]; `libvirt NAT` [43,32,11,1].

### v2: four node labels, four edge labels
- Node `tailscale0` [39,17,10,1]; `homelab ASUS Linux 7.0 · no committed rate` [21,25,42,1]; `wlp8s0 .213` [25,34,11,1]; `bond0 192.168.1.197/24` [41,34,22,1].
- Edge `100.113.153.49` [46,20,14,1]; `UDP encap` [50,21,9,1]; `Wi-Fi backup` [28,30,12,1]; `eno1 2.5 GbE` [38,32,12,1].
- The first two edge labels are visually close to the same right-hand route, even though the spec assigns `100.113.153.49` to the left-hand route to homelab and `UDP encap` to the right-hand route to bond0. In particular the address begins at col 46, two cells to the right of the col 44 route and four cells right of the col 42 route. The address's ownership is uncertain/misleading by inspection; this disagrees with the check's 0 ambiguous owners. The `UDP encap` association is supported by proximity to the right route but this crowded pair makes reading the two together less immediate. `eno1 2.5 GbE` ends immediately before its arrowhead at col 50, next to another arrow at col 52; trace the routes to disambiguate it.

### v3: three node labels, two edge labels
- Node `bond0` [34,22,5,1]; `wlp8s0` [44,22,6,1]; `Fios rtr 192.168.1.1 · NAT+DHCP · WNC (hist.)` [19,30,45,1].
- Edge `default gw 0.5 ms` [19,26,17,1]; `metric 600 · failover, no ECMP` [49,26,30,1].

### v4: five node labels, four edge labels
- Node `Fios rtr = ToR+spine+border+FW` [27,10,30,1]; `ONT 169.254.3.1 (hist.) = MMR analog` [24,18,36,1]; `vzagg 100.41.x` [35,26,14,1]; `vzbb AS701 (1 ISP, 1 path)` [29,34,26,1]; `cf 1.1.1.1 AS13335` [33,42,18,1].
- Edge `NAT → 71.251.12.240 (whole home)` [44,13,32,1]; `4.5 ms (hist.)` [44,21,14,1]; `6.6 ms (hist.)` [44,29,14,1]; `6-9 ms (hist.)` [44,37,14,1]. The arrow embedded in the NAT text is part of a label, not an additional graph route.

## Routes, ports and topology

All 14 visible graph routes have one downward ▼ arrowhead at the target and can be traced end-to-end; no bidirectional pair. Their visible endpoints and direction agree with the final spec; agreement with the withheld source cannot be independently established in stage A. Edges attach to box top/bottom sides, away from corners; where a node has multiple edges they use distinct near-center ports rather than one shared mid-side port. The dashed v4 routes are still traceable. Identifiers/qualifiers remain in the graph labels above, with the owner caveat noted for v2.

- v1: `ctr veth → docker0` (row 23 bend cols 34–35; head [35,24]); `VM vnet0 → virbr0` (row 23 cols 47–52; head [52,24]); `docker0 → homelab` (row 31 cols 35–40; head [40,32]); `virbr0 → homelab` (row 31 cols 42–52; head [42,32]). Separate arrows land on homelab.
- v2: `tailscale0 → homelab` (col 42, bend to 41 at row 22; head [41,23]); `tailscale0 → bond0` (col 44, row 22 to col 65, around the right of homelab, row 31 to col 52; head [52,32]); `homelab → wlp8s0` (col 40, row 31 to col 30; head [30,32]); `homelab → bond0` (col 42, row 31 to col 50; head [50,32]). The side-by-side starts at cols 42/44 and heads 50/52 are separate, not branches or joins.
- v3: `bond0 → Fios rtr` (col 36 to 40 at row 27; head [40,28]); `wlp8s0 → Fios rtr` (col 46 to 42 at row 27; head [42,28]). The paths remain distinct into separate ports.
- v4: `Fios rtr → ONT` solid, head [41,16]; `ONT → vzagg` dashed, head [41,24]; `vzagg → vzbb` dashed, head [41,32]; `vzbb → cf` dashed, head [41,40]. All four follow column 41.

Independent coordinate inspection: 0 bridge glyphs, 0 route crossings, 0 touching bends, 0 junction glyphs and 0 actual route branches across these captures. Bends are the listed ╭╮╰╯ route turns; nearby node corners are not route junctions. A node may have separate outgoing ports (v2 tailscale and homelab), not an edge splitting. This agrees with all four check outputs `crossings: 0 bridges, 0 touching bends`. All 14 edge labels are present and none lies on a route cell; 0 visibly skipped. Check claims 0 ambiguous owners per view, but independently I count 1 uncertain/misleading label owner in v2 as above.

Visible occurrence counts are 5+4+3+5=17 boxes and 4+4+2+4=14 routes; mapping repeated named entities gives 13 spec node identities overall. Widest out-degree is two (tailscale0 and homelab in v2); homelab v1, bond0 v2, and router v3 each receive two separate arrowheads. No opposite-direction pair. Each separate view is internally connected; the four separate panels connect conceptually by recurring homelab, bond0/wlp8s0, and Fios rtr names, not by a drawn inter-panel bus. The visual is identifier- and qualifier-dense. V4 has an ordered top-to-bottom hop sequence, not explicit phase markings. No source-named tier label or hue band is visible.

V3 and v4 both say `Fios rtr`: v3 supplies its address, NAT+DHCP and historical WNC; v4 instead supplies ToR/spine/border/FW role. The common name supports a complementary split, but the labels differ and no cross-view connector or explicit key identifies them as the same box. The reader must compare panels; the historical qualifier is not repeated beside the v4 router label. `vzagg`/`vzbb`/`cf`, `WNC`, `hist.` and abbreviations appear without expansions in the graph itself. No claim about absent source facts is possible blind.

## Groups, rank and borders

Groups are logical hue tags only: no enclosing group box, border or title is drawn, which is correct for this round. Each individual node border has all four sides and corners ╭╮╰╯ intact and a single continuous foreground color around its full perimeter, independently checked on `vN-ansi.ansi`; every selected border is also continuous.

RGB (normal border), in spec sibling order:
- v1 `libvirt`: VM (206,115,138), virbr0 (219,153,170), pink/red; `docker`: ctr (206,115,206), docker0 (219,153,219), magenta; `host`: homelab (115,206,183), teal.
- v2 `overlay`: tailscale (206,161,115), orange; `host`: homelab (115,206,183), teal; `wired`: bond0 (115,161,206), blue; `wifi`: wlp8s0 (206,115,206), magenta.
- v3 `wired`: bond0 (115,161,206), blue; `wifi`: wlp8s0 (206,161,115), orange; `egress`: Fios rtr (206,115,206), magenta.
- v4 `egress`: Fios rtr (206,115,206), ONT (219,153,219), vzagg (193,78,193), vzbb (231,187,231), cf (197,89,197), magenta variants, in that sibling order top-to-bottom.

The disclosed wifi drift is confirmed quantitatively: (206,115,206) in v2 versus (206,161,115) in v3. In v1 libvirt and docker both go from the first/darker member in the upper rank to the second/lighter member below; their sibling order matches spec. V4 siblings follow spec top-to-bottom; within other groups there is only one member. Cross-view hues are not universal identity keys: v2 wifi magenta is v3 egress, v2 overlay orange is v3 wifi. Selected-state evidence is one simultaneous `--select-all` capture per view, not 17 individually isolated selection screenshots. It shows all 17/17 node occurrences with their own intact selected gold (216,166,87) border.

No explicit `layers`/rank pins appear in the four specs; `generation.json` says none declared, though it describes an implicit v3 ordering. Actual ranks: v1 ctr/VM, then docker0/virbr0, then homelab; v2 tailscale, then homelab, then wlp8s0/bond0; v3 bond0/wlp8s0 then router; v4 router, ONT, vzagg, vzbb, cf. Thus explicit pins observed: 0 declared, 0 assessed; implicit v3 ordering appears as described.

## Fit, checks and time

`check.txt` reports `viewport: unknown zoom: 1.00 natural` in each case, extents v1 54×20, v2 57×21, v3 73×12, v4 65×36, and labels 4/4, 4/4, 2/2, 4/4 respectively, with no skipped labels or route-cell labels. The actual captured pane header says `82x51 @100%`. Each pinned 77×47 dump says `viewport: 77x47 zoom: 1.00 natural`; graph contents fit, no graph label, box or route is clipped or requires pan/zoom, and no overflow banner appears. The long UI header itself is truncated at the right edge in the v2 pane (`q qui`) and pinned headers can truncate; this is UI chrome, not a graph item. The dump/headers establish the evidence at those sizes, not behavior in unrecorded sizes. There is no `routes:` line, as expected.

For every view, frame 0/1/2 at 0/100/200 ms have byte-identical drawing bodies (the surrounding shell transcript is excluded); 0 animated routes and 0 visible moving dots. Dot spacing, direction, corner/bridge/arrowhead occupancy, origin and simultaneous-arrival comparisons are not applicable, not demonstrated movement. `--check` reports 0 dot violations and 0/0 origin/arrival routes. The static appearance is consistent with the static specs; whether the unseen source calls for motion is not independently verifiable. Generator discloses v1 was re-captured after an initial startup race yielded no app header/frames; final bundle is the successful capture. No inference of tampering.

## Generator's classification, verbatim

`generation.md`, section `Step 0 — family`, states:

```text
family: identity-probe-maps
evidence: every relation in the source rides on an address, a name, or a qualifier
          (bond0 192.168.1.197, tailscale0 100.113.153.49, dkbr 172.18.2.1,
          ONT 169.254.3.1, vzbb AS701, cf AS13335, "metric 600", "WNC OUI", "(hist.)")
          and the egress path is a deep chain of probe hops.
```

The same section states 14 relations over 13 nodes, and secondary service-mesh fan and flow-chain corridor rules. This is the generator's classification, not a blind family verdict. `generation.json` `step0_classification` provides a differently worded evidence sentence and says no reclassification.

## Blind scorecard

| Metric | v1 | v2 | v3 | v4 | Total |
|---|---:|---:|---:|---:|---:|
| Visible node occurrences | 5 | 4 | 3 | 5 | 17 (13 distinct spec identities) |
| Visible directed edges | 4 | 4 | 2 | 4 | 14 |
| Visible node + edge labels | 9 | 8 | 5 | 9 | 31 (17 + 14) |
| Group hue families in view | 3 | 4 | 3 | 1 | 7 declared group names across views; hues drift |
| Explicit rank pins | 0 | 0 | 0 | 0 | 0 |
| Crossings / touching bends | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Uncertain or misleading label owners, independent | 0 | 1 | 0 | 0 | 1 |
| Clipped graph items | 0 | 0 | 0 | 0 | 0 |
| Selected border occurrences in select-all | 5/5 | 4/4 | 3/3 | 5/5 | 17/17 |
| Animated routes / observed dot violations | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0; motion-specific criteria N/A |

Evidence unavailable: original source and expectations intentionally withheld; no individually isolated selections or animated routes exist in the provided evidence. All evidence formats used above were readable. No overall grade is assigned before expectations.

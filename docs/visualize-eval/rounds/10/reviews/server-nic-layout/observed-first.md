# Blind observation — server-nic-layout, round 10, stage A

Evidence limited to the supplied specs and captures. Coordinates below are 1-based `[column,row,width,height]` in the 82×51 text capture, not the 77×47 pinned dump. Labels are literal; UI title/control text is not counted as diagram labels.

## Specification identity

- v1: `1b8c431c260e32e40e76396c0ccf9c31a4a47803be85b426553631325a1ad1fa`
- v2: `194c1baf3c3ca9b4ace3752d8007505e70d81675887b5a17a680951c608094be`
- v3: `cc12a2aed5f4936e1e05ed14251c16985ecc13ca14e51e85dec0e15a53b30916`

These `shasum -a 256` hashes match their evidence manifests.

## All diagram labels

| View | Label, verbatim | Rectangle | Owner |
|---|---|---|---|
| v1 | `7 NICs dark` | [37,18,11,1] | node dark |
| v1 | `server1 R7725 103.19.91.58` | [29,26,26,1] | node s1 |
| v1 | `eno16595np0 25G` | [35,34,15,1] | node nic |
| v1 | `no cable seen` | [44,21,13,1] | dark → s1 |
| v1 | `only uplink` | [44,29,11,1] | s1 → nic |
| v2 | `eno16595np0 25G` | [14,21,15,1] | node nic |
| v2 | `server2 R7725 .59` | [34,21,17,1] | node s2 |
| v2 | `spare .60-.62` | [56,21,13,1] | node spare |
| v2 | `gw .57 Arista? 0.1ms` | [32,30,20,1] | node gw |
| v2 | `no NAT no v6` | [23,24,12,1] | nic → gw |
| v2 | `same /29` | [44,24,8,1] | s2 → gw |
| v2 | `free? unprobed` | [64,24,14,1] | spare → gw |
| v3 | `gw .57 Arista? 0.1ms` | [32,10,20,1] | node gw |
| v3 | `3,6 silent, 5 lossy` | [33,18,19,1] | node silent |
| v3 | `Airtel 14.143.x` | [35,26,15,1] | node airtel |
| v3 | `AirtelBB 14.141` | [35,34,15,1] | node airtelbb |
| v3 | `CF 1.1.1.1 AS13335` | [33,42,18,1] | node cf |
| v3 | `NxtGen AS132717 BLR` | [44,13,19,1] | gw → silent |
| v3 | `1.8 ms, no L2 proof` | [44,21,19,1] | silent → airtel |
| v3 | `7.1 ms` | [44,29,6,1] | airtel → airtelbb |
| v3 | `8.3-8.6 ms` | [44,37,10,1] | airtelbb → cf |

All nine edge labels are visually associated with their routes; no uncertain owner. The gateway is densely packed but the text remains legible. The two machine labels say R7725 but do not literally say Dell. `25G` is visible, not the full wording `25 GbE`; `/29` is visible, but the complete /29 network address is not written. `Arista?` conveys uncertainty, but the OUI-only basis is not stated in any visible label. These omissions are not clipping. The `.59`, `.57`, `.60-.62` addresses are abbreviated. The caveat and silent hops are explicit.

## Routes, geometry, ports

All edges travel downwards with a visible `▼` at the target; all routes can be followed without guessing. Source/target columns below are the cells immediately outside their box borders. Port midpoint assessments compare against border ranges and allow half-cell rounding.

- v1 dark → s1: dashed, source (42,21), bend cells (42,23) and (41,23), arrow (41,24). Bottom/top sides both at midpoint (dark center 42; s1 center 41.5).
- v1 s1 → nic: solid, source (41,29), bends (41,31),(42,31), arrow (42,32). Both mid-side (41.5 and 42).
- v2 nic → gw: solid, source (21,24), horizontal run row 27 columns 21–39, arrow (39,28); source midpoint 21. Gateway target is one of three deliberately spaced ports, not a lone port.
- v2 s2 → gw: solid, source (42,24), bends (42,27),(41,27), arrow (41,28); source midpoint 42.
- v2 spare → gw: dashed, source (62,24), dashed horizontal run row 27 columns 43–62, arrow (43,28); source midpoint 62. Gateway top border spans columns 31–52; target ports 39,41,43 straddle its 41.5 midpoint. At row 27 (42,27) and (43,27) the two bend glyphs are adjacent, but their strokes face away from one another and do not join; this is not an apparent branch or crossing.
- v3 gw → silent: dashed, source (41,13), bends (41,15),(42,15), arrow (42,16). Both midpoint within half-cell (41.5 and 42).
- v3 silent → airtel: dashed, source (42,21), arrow (42,24), straight. Both mid-side (42 and 42).
- v3 airtel → airtelbb: solid, source (42,29), arrow (42,32), straight. Both mid-side (42 and 42).
- v3 airtelbb → cf: solid, source (42,37), bends (42,39),(41,39), arrow (41,40). Both mid-side (42 and 41.5).

Independent reading of coordinates: no crossing, bridge glyph, touching connected bend, junction or apparent branch. Separate routes in v2 converge on the same box, not on one another. Each check reports `crossings: 0 bridges, 0 touching bends`, 0 ambiguous owners, no label on a route, and 0 dot violations, consistent with the captures.

## Borders, hue, groups and selection

Every node has a complete four-sided rounded border, all four corners, and one continuous border RGB throughout, including adjacent port cells. The selected ANSI changes every perimeter cell to (216,166,87), so all 12 of 12 node occurrences are captured selected. That capture is simultaneous select-all, not 12 individually selected screenshots.

Normal perimeter colors (RGB):
- v1 ports: dark (115,206,115), nic (153,219,153), two related greens; hosts: s1 (206,115,138), pink.
- v2 ports: nic (115,206,115), green; hosts: s2 (206,115,138), pink; pool: spare (206,115,206), purple; plant: gw (115,206,183), aqua.
- v3 plant: gw (206,115,138), pink; transit: airtel (206,161,115), airtelbb (219,186,153), related tans; internet: cf (138,115,206), purple; ungrouped silent: (125,174,163), muted teal.

Six declared tag names occur globally. The same tag does not guarantee a consistent hue across views: plant changes from aqua to pink, while pink also represents hosts elsewhere. Within each view the two-member groups share a hue family; their visible order is dark before nic and airtel before airtelbb. Other groups are singletons, so sibling order cannot be evaluated. The ungrouped silent marker gets its own muted color rather than falsely asserting an operator identity; that is a reasonable visual distinction, though the color itself does not explain why it is ungrouped. No group enclosure, border, or title is painted, correctly for this contract. There are no explicit tier bands or source-named tier labels.

## Shape and rank

v1 has 3 nodes and 2 edges in a thin vertical chain; v2 has 4 nodes and 3 edges, three top peers feeding one bottom gateway; v3 has 5 nodes and 4 edges in a vertical chain. Across views there are 12 node occurrences, 9 edges, 21 diagram labels. Widest outgoing fan is 1 per node; v2 gateway receives three separate arrowheads. No pair has opposite-direction edges. Each view is internally connected; the three separate views visually repeat the NIC or gateway as recognizable continuity, not an actual drawn inter-view edge. v3's ordering reads like successive hops. Labels are information-dense and abbreviated, especially the gateway; v1 is sparse, but its few labels and link qualifiers are easily read. The full identifier and qualification limitations are listed above.

No rank pins are present in the supplied final JSON specs. The observed geometric ranks are v1 dark / s1 / nic; v2 nic+s2+spare / gw; v3 gw / silent / airtel / airtelbb / cf. `generation.json` was not among the stage-A captures or specs permitted by the explicit instruction, so any additional declared pins there cannot be verified.

## Frames and fit

Evidence text captures show 82×51 @100%; evidence manifests record `viewport_token: 82x51 @100%` but `viewport_line: null`, and check output says `viewport: unknown zoom: 1.00 natural`. Checks report extents v1 41×20, v2 66×13, v3 44×36. Pinned dumps each say `viewport: 77x47 zoom: 1.00 natural`; their graph labels, arrowheads, and complete boxes fit at 100%, including v3's lower box adjacent to but not overlapping the control widget. No content appears clipped, hidden, or dependent on panning/zoom. The three plain-text frames in each pinned capture are visually identical at 0, 100 and 200 ms. No dots are visible and no routes are animated; dot origin, spacing, corner/bridge/arrowhead occupancy, direction of motion and simultaneous arrival are not applicable rather than measured successes. Checks report 0 flows and 0 dot violations.

## Disclosures and evidence limits

The task-provided disclosure states that the generator recovered from two transient validator failures: a missing `generation.json` lookup and a deleted raw dump restored byte-identically. Recorded neutrally, not independently verified within the allowed capture/spec scope.

The exact generator classification line and its location cannot be quoted verbatim from the permitted captures or specs: the task paraphrases `family: identity-probe-maps`, identifier-inventory evidence and flow-chain outranked by tie-breaker 3, but does not provide the full literal evidence line or location. No unsupported format was encountered. The excluded `generation.json` is not read, so exact classification and any pins it might declare remain unverified.

## Blind scorecard

| Metric | v1 | v2 | v3 | Total |
|---|---:|---:|---:|---:|
| Visible node occurrences | 3 | 4 | 5 | 12 |
| Visible edges | 2 | 3 | 4 | 9 |
| Diagram labels, node + edge | 5 | 7 | 9 | 21 |
| Declared group families in view | 2 | 4 | 3 | 6 distinct global tags |
| Spec rank pins | 0 | 0 | 0 | 0 (generation record not examined) |
| Visible crossings / bridges / connected touching bends | 0 | 0 | 0 | 0 |
| Uncertain label owners | 0 | 0 | 0 | 0 |
| Clipped diagram items | 0 | 0 | 0 | 0 |
| Selected border occurrences | 3/3 | 4/4 | 5/5 | 12/12 |
| Dot violations | 0 | 0 | 0 | 0 (no dots) |

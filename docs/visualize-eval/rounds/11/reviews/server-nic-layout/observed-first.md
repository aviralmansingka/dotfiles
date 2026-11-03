# Blind observation — server-nic-layout, round 11

Coordinates below are 1-based `[column,row,width,height]` in frame 0 of each **pinned 77×47 viewport**, counting its `rataflow-view` header as row 1, not the preceding `viewport:` or `frame` metadata. Width is terminal cells (all listed diagram label characters occupy one cell). Node and edge labels are listed verbatim; the common UI header and zoom-control legend are not diagram labels. The three views are separate captures; occurrence counts are not deduplicated identities.

## Labels and arrows

### v1 — 4 boxes, 3 arrows

- Node `7 of 8 NICs dark` [32,12,16,1]; `server1 103.19.91.58 R7725 bare metal · 1.5d up, no GPU/bench` [9,20,61,1]; `eno16595np0 25GbE .58/29` [28,28,24,1]; `.57 Arista ToR (MAC OUI, role unproven)` [20,36,39,1].
- `no cable seen · unproven` [42,15,24,1]: dark → server1, downward dashed, ▼ at [39,18]; traceable.
- `only uplink · no ECMP, 1 ISP` [41,23,28,1]: server1 → NIC, downward solid, ▼ [39,26]; traceable.
- `default gw 0.1 ms` [42,31,17,1]: NIC → gateway, downward solid, ▼ [39,34]; traceable.
- All three labels sit beside their respective single route; no uncertain ownership. No bends, crossings, touching bends, bridge glyphs, junctions or apparent branches.

### v2 — 4 boxes, 3 arrows

- Node `eno16595np0 .58/29` [8,19,18,1]; `server2 .59 R7725` [9,24,17,1]; `.60-.62 free` [11,29,12,1]; `.57 Arista ToR · MAC OUI` [46,25,24,1].
- `routed /29 · no NAT/proxy/v6` [14,22,28,1]: NIC → gateway, right then down then right, solid ▶ [44,23]; bends [43,19] and [43,23]; traceable.
- `same /29` [30,23,8,1]: server2 → gateway, right then down then right, solid ▶ [44,25]; bends [42,24], [42,25]; traceable.
- `free · unprobed` [26,28,15,1]: free pool → gateway, right then up then right, dashed run with corner glyphs ▶ [44,27]; bends [43,29], [43,27]; traceable.
- Labels sit adjacent to their routes; the top label is between the top and middle routes but follows the top route, while `same /29` is immediately above the middle route. No uncertain owner observed. The three routes reach distinct gateway ports and do not merge. No route crossings, touching bends, bridge glyphs, junctions or apparent branches. The bend at [42,25] and the other route at column 43 are close but occupy different cells/rows and do not touch as connected paths.

### v3 — 4 boxes, 3 arrows

- Node `.57 Arista L3 leaf · NxtGen AS132717 Bengaluru` [16,12,46,1]; `Airtel 14.143.x` [32,20,15,1]; `Airtel backbone 14.141.x` [27,28,24,1]; `Cloudflare 1.1.1.1 AS13335` [26,36,26,1].
- `1.8 ms · bridge|tunnel|silent` [41,15,29,1]: gateway → Airtel, downward dashed with a one-cell jog at [38,17]–[39,17], ▼ [39,18]; traceable.
- `7.1 ms · h3 mute ≠ L2` [41,23,21,1]: Airtel → backbone, downward solid with a one-cell jog at [39,25]–[38,25], ▼ [38,26]; traceable.
- `8.3-8.6 ms · h5 -80% h6 mute` [41,31,28,1]: backbone → Cloudflare, downward solid ▼ [38,34]; traceable.
- No uncertain label owners, crossings, touching bends, bridge glyphs, junctions or apparent branches. The two jogs are ordinary bends of different, vertically separated routes.

## Structure, group, rank, borders

- v1 and v3 each show a four-box, three-edge vertical chain, one outgoing edge at most per node; ordering follows the page top to bottom, visually sequence-like. v2 shows three left-side members each pointing to one right-side sink: widest outgoing fan is 1 and gateway receives three separate arrowheads. The other views have no node receiving two arrowheads. No bidirectional box pair or opposite-direction edge pair in any view. Each individual view is connected. Across views they are separate canvases, related by repeated `.57 Arista` and NIC identifiers, not by an inter-view drawn line. Identifiers and qualifying phrases are dense. No explicit source-named tier label line or band is drawn.
- Group membership is declared in the specs; normal ANSI border colors establish families: v1 `nics` dark RGB(183,206,115), NIC RGB(203,219,153), green siblings in top-to-bottom order dark then NIC; `servers` orange RGB(206,161,115); `access` pink RGB(206,115,138). v2 `nics` green (183,206,115), `servers` orange (206,161,115), `pool` mauve (206,115,206), `access` pink (206,115,138), each singleton. v3 `access` pink (206,115,138), `isp` Airtel RGB(115,206,183), backbone RGB(153,219,203), aqua siblings top to bottom, and `target` green (183,206,115). There are six declared group names but five visually distinct hue families: `nics` and `target` share green. Only v1 nics and v3 isp have siblings; each has one stable top-to-bottom occurrence order; there is no repeated sibling pair across views with which to establish a comparative ordering. No group box, border or group title is painted; node boxes are separate.
- Explicit rank pins: none in any final spec; `generation.json` says no layers/minlen/rank pins. Observed ranks are the four sequential boxes in v1/v3 and three left members versus one right sink in v2. No pinned rank is verifiable because none is declared.
- All 12 node occurrences have all four border sides and all four rounded corners. Normal ANSI indicates each node border is continuous in its own foreground color; the separately captured selected ANSI gives all 12 borders continuous amber RGB(216,166,87). The selections are simultaneous `--select-all`, not 12 separate interactive selection captures; selected border coverage is 12/12 occurrences in that sense. Node borders are not group outlines.

## Motion and fit

- No animated routes are declared or visible; 0 dots in each complete pinned frame, so spacing, direction, origin, corner/bridge/arrowhead occupancy and simultaneous arrival are not applicable; 0 observed and 0 check-reported dot violations. Pinned frames 0, 1, 2 are identical per view after frame headers. Live v2/v3 frame art is also complete and identical. The live v1 frame-2 text capture is truncated mid-server border (24 of 51 rows); frames 0/1 and all three pinned v1 frames are complete. Thus the generator's blanket live three-frame byte-identical claim is not supported by the live v1 text capture; pinned evidence does show all three complete.
- `check.txt`: v1 extent 63×28, v2 75×14, v3 56×28; each reports `crossings: 0 bridges, 0 touching bends`, 3/3 edge labels, 0 on routes, 0 skipped, 0 ambiguous; independent coordinates above agree. `viewport: unknown zoom: 1.00 natural` is the check's line. Pinned captures say `viewport: 77x47 zoom: 1.00 natural`, display all listed labels and arrows at 100%, no overflow banner, and show no clipping or need to pan/zoom. v2 has thin layout-extent margin (75 of 77 columns) even though its visible glyphs are more inset. Live evidence header says `82x51 @100%`; manifests have null pane rectangle and columns, but row count 51 and that header token. Generator says the pane layout query resolved the focused pane instead of the split, and used the app header plus separate pinned dumps without editing the script. This is reported measurement provenance, not an independently measured pane rectangle.
- Final spec hashes independently computed with `shasum -a 256` and match the three manifest hashes: v1 `467e2e905830dc6730bafbe07bc2baf568a50c489ff527ecd1258bfa53d39797`; v2 `f9a161e554c6c7f9707661d99b3d30da2a4bd16db4a46a95094ac01cd55daf97`; v3 `3ed2a72689920d7c89b2abf05198d5465e84e19569118944040242edae39e7d8`.

## Generator statement and disclosed limitations

`generation.md`, section “Step 0 — the family hint, and where the source led”, states verbatim:

```text
family: identity-probe-maps
evidence: the source is address- and qualifier-dense (103.19.91.58/29, eno16595np0 25 GbE,
          AS132717, AS13335, 14.143.x, 14.141.x, 1.1.1.1) and every claim arrives with a caveat
          ("no cable seen", "MAC OUI = Arista" but "MAC OUI does not prove a ToR role",
          "hop 5 lost 80%", "invisible from the host"), while the shape is only E≈N
          (8 relations over 9 nodes).
```

This is the generator's orientation, not a shape constraint or independent fact check. Its `generation.md` “Deviations” records three small views rather than one deep chain, the LR star and no trunk, gateway wording varied across views, shortened fabric wording, inferred hop anchoring, AS132717 on the access node rather than on the two servers as the generator says the source states, and the range `8.3-8.6 ms` for inconsistent stated values. `generation.json` known defects additionally discloses v2's thin margin and the larger live pane. The source was not read in this blind stage; these source comparisons are disclosures, not independently established facts.

## Blind machine-readable scorecard

```json
{
  "views": {
    "v1": {"nodes": 4, "edges": 3, "node_labels": 4, "edge_labels": 3, "group_names": 3, "hue_families": 3, "pinned_ranks": 0, "crossings": 0, "touching_bends": 0, "uncertain_label_owners": 0, "clipped_items_pinned": 0, "selected_occurrences": 4, "node_occurrences": 4, "animated_routes": 0, "dot_violations": 0},
    "v2": {"nodes": 4, "edges": 3, "node_labels": 4, "edge_labels": 3, "group_names": 4, "hue_families": 4, "pinned_ranks": 0, "crossings": 0, "touching_bends": 0, "uncertain_label_owners": 0, "clipped_items_pinned": 0, "selected_occurrences": 4, "node_occurrences": 4, "animated_routes": 0, "dot_violations": 0},
    "v3": {"nodes": 4, "edges": 3, "node_labels": 4, "edge_labels": 3, "group_names": 3, "hue_families": 3, "pinned_ranks": 0, "crossings": 0, "touching_bends": 0, "uncertain_label_owners": 0, "clipped_items_pinned": 0, "selected_occurrences": 4, "node_occurrences": 4, "animated_routes": 0, "dot_violations": 0}
  },
  "total_occurrences": {"nodes": 12, "edges": 9, "node_labels": 12, "edge_labels": 9, "distinct_group_names": 6, "distinct_hue_families": 5, "pinned_ranks": 0, "crossings": 0, "touching_bends": 0, "uncertain_label_owners": 0, "clipped_items_pinned": 0, "selected_occurrences": 12, "animated_routes": 0, "dot_violations": 0},
  "missing_evidence": ["live v1 frame 2 is truncated", "manifest pane rectangle and columns are null"]
}
```

All formats examined were readable. Truncated live v1 frame 2 is the only incomplete diagram frame found; its corresponding complete pinned frame is available.

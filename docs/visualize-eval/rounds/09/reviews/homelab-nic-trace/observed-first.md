# Blind observations — round 09, homelab-nic-trace

Stage A only. Coordinates below are 1-based `[column,row,width,height]` in the 82×51 live plain-text captures, including the header as row 1. Widths are literal character widths; every graph label is one row high. I did not inspect source, expectations, rubric, or other cases. Findings distinguish visible marks from generator assertions.

## Frozen specs

Independent `shasum -a 256` values match `generation.json`:

- `specs/v1-host-local.json`: `7399db149bfc1042b25e586c5c8c2fdae5dbde9e652bb592cfccb9c5c2034357`
- `specs/v2-uplink.json`: `a1c68a7fa19bc3018cc9a44d90b02eadcc22bb926dcd8576069067b1efc7b568`
- `specs/v3-egress.json`: `b0abc2f24a8667015326ca0b3a9db34d8354d348ce2d8c707cd21a9095c44637`

## Visible graph labels

v1 nodes, 6:
- `VM vnet0` [47,6,8,1]; `container veth` [28,6,14,1].
- `ts0 100.113.153.49` [50,26,18,1]; `virbr0 NAT` [35,26,10,1]; `dkbr 172.18.2.1` [15,26,15,1].
- `homelab rack-bench` [33,46,18,1].

v1 edge labels, 5:
- `192.168.122.x` [49,16,13,1]; `172.18.2.x` [17,16,10,1].
- `NAT bridge` [24,36,10,1]; `docker bridge` [18,42,13,1]; `overlay` [52,36,7,1].

v2 nodes, 4:
- `ts0 100.113.153.49` [44,17,18,1]; `homelab rack-bench` [21,17,18,1].
- `bond0 192.168.1.197` [40,35,19,1]; `wlp8s0 .213` [24,35,11,1].

v2 edge labels, 3:
- `UDP encap` [46,26,9,1]; `eno1 2.5GbE` [26,29,11,1]; `backup path` [10,26,11,1].

v3 nodes, 7:
- `bond0 192.168.1.197` [24,6,19,1]; `wlp8s0 .213` [48,6,11,1].
- `rtr 192.168.1.1 claimed, no v6` [27,14,30,1]; `ONT 169.254.3.1 claimed` [30,22,23,1].
- `VZ agg 100.41.x` [34,30,15,1]; `VZ bb AS701` [36,38,11,1]; `cf 1.1.1.1 AS13335` [33,46,18,1].

v3 edge labels, 6:
- `gw 0.5 ms` [35,9,9,1]; `metric 600` [55,9,10,1]; `NAT out` [44,17,7,1].
- `4.5 ms` [43,25,6,1]; `6.6 ms` [43,33,6,1]; `6-9 ms` [43,41,6,1].

The visible qualifiers are exactly `claimed`, `no v6`, `NAT`, `backup path`, `metric 600`, `UDP encap`, and the shown timings and identifiers. `claimed` is visible on the two nodes; the word `historical` is not drawn. `.213` is abbreviated on the picture, and no full address for it is shown. The captures do not themselves explain abbreviations or include group names. Generator materials describe the interpretation; I did not verify it against source.

## Routes and ownership

All 14 are solid orthogonal routes, each ending in a visible downward `▼`. Whole routes can be followed in the text without a hidden segment. The last coordinate is the live arrowhead. e-numbers are generator audit identifiers, not labels printed in the pane.

- v1 e1 VM vnet0 → virbr0 NAT [35,24]; e2 virbr0 NAT → homelab rack-bench [35,44]; e3 container veth → dkbr 172.18.2.1 [15,24]; e4 dkbr → homelab [33,44]; e5 ts0 → homelab [37,44].
- v2 e6 ts0 → bond0 [42,33]; e7 homelab → bond0 [40,33]; e8 homelab → wlp8s0 [24,33]. Distinct source ports for e7/e8 are adjacent vertical stems, not one merged junction. There are two distinct arrowheads into bond0.
- v3 e9 bond0 → rtr [27,12]; e10 wlp8s0 → rtr [29,12]; e11 rtr → ONT [30,20]; e12 ONT → VZ agg [34,28]; e13 VZ agg → VZ bb [36,36]; e14 VZ bb → cf [33,44]. The two inbound router routes end at separate arrowheads.

No crossing, bridge glyph, touching bend, shared route, or actual junction is visible; the close parallel stems and close arrowheads remain separate. No visible apparent branch: the pair leaving homelab in v2 uses separate ports. Each check reports `crossings: 0 bridges, 0 touching bends` and zero ambiguous owners. Most owners are clear by proximity or the sole route in a rank gap. In v3, `gw 0.5 ms` is in the gap between the two stems, closer horizontally to the Wi-Fi stem than to the bond0 stem, with no leader; its assignment to bond0 is recoverable from left-to-right label order and the generator/spec, but is visually less direct and could be misread. I count this as **one potentially uncertain owner**, not a confirmed wrong owner; this is a stricter visual observation than the machine's 0. The remaining 13 label owners are clear to me. The six v3 labels are in gutters, not on route cells. The chain-gap labels have only one route in their respective gap.

## Groups, colors, borders, ranks

ANSI evidence, not plain text, supports the following normal-border colors (RGB):
- virtual: v1 container (226,156,175), VM (211,134,155), dkbr (238,180,196), virbr (187,108,131): pink family.
- overlay: ts (169,182,101) in v1 and v2: olive.
- physical: box (125,174,163) v1/v2; v2 bond0 (147,194,183), wlp (99,151,141); v3 bond0 (125,174,163), wlp (147,194,183): teal family. Exact per-node shades can change across views.
- egress: v3 rtr (216,166,87), ONT (228,184,111), VZ agg (200,147,68), VZ bb (239,202,138), cf (177,136,71): gold family.

There are no group boxes, borders, group titles, or tier text markings. Hue is the only visible group indicator; individual node boxes are not group boundaries. Virtual peers are container left of VM and dkbr left of virbr in v1. Physical peers reverse page order across views: wlp left of bond0 in v2, bond0 left of wlp in v3. Thus a common sibling order across these views is not stable. Overlay has one member per view, and egress members occupy successive ranks rather than side-by-side positions; no cross-view egress ordering test exists.

For all 17 node occurrences, I checked all four sides and corners against both the ordinary and selected ANSI captures: complete, with one continuous foreground color per perimeter. Selected captures cover **17/17 occurrences**, each in accent RGB (216,166,87), including corners; that accent equals the normal rtr hue, so selected evidence must be interpreted alongside the `select_all` capture rather than by color difference alone. This is simultaneous select-all evidence, not separate individual-selection frames.

`generation.json` declares `rank_pins: []` in all three views; none are pinned. Observed ranks top to bottom: v1 `{container, VM}`, `{dkbr, virbr, ts}`, `{box}`; v2 `{box, ts}`, `{wlp, bond0}`; v3 `{bond0, wlp}`, `{rtr}`, `{ONT}`, `{VZ agg}`, `{VZ bb}`, `{cf}`. No pinned-versus-observed rank discrepancy can be assessed.

## Shape, joins, and density

Counts by view: 6 nodes/5 edges, 4/3, 7/6; 17 node occurrences but 13 distinct labels/identities across views and 14 distinct edges. A node's greatest outgoing fan is 2 (homelab in v2); no pair is connected in both directions. Multiple separate arrowheads enter homelab (3), bond0 (2), and rtr (2). The v1 components and v2/v3 connect conceptually by repeated labels, not by an on-screen inter-view wire: `box` and `ts` join v1↔v2, `bond0` and `wlp` join v2↔v3. `generation.json` also claims bond0 and wlp occur in v1; the actual final v1 capture/spec does not contain them. Taken across these joins the graph has one weakly connected world; a reader seeing a single view does not get the entire graph. There is no explicitly drawn inter-view connector or legend.

v2 is notably sparse: a compact two-rank island amid blank vertical space, with wired and backup routes distinct. v3 is a top-down staircase, drifting right through VZ bb then back left to cf, not a straight spine. The spatial progression outward could read as ordered hops rather than explicit phases; there are no phase labels. Identifier and qualifier content is dense: nearly all box labels carry device/address/AS strings, while edges carry network segments, interface, protocol, metrics, or role. `generation.json` claims 13 of 14 nodes are identifiers, but the final repeated-label union visibly has 13 distinct nodes, and its own tie-breaker says 14 edges / 13 nodes; do not silently reconcile that 13/14 claim.

## Generator-stated classification and recorded yields

`ledger.md`, section `Step 0 — family`, states verbatim:

```text
family: identity-probe-maps
evidence: 13 of 14 nodes are addresses, device names or AS numbers
(bond0 192.168.1.197, 100.113.153.49, 172.18.2.1, 169.254.3.1, AS701,
100.41.x) and the brief marks two device roles "claimed"/historical, so
omission — not geometry — is what loses meaning.
```

The same section cites E ≈ N (14 edges / 13 nodes), one weakly connected world, and static topology with no dots as tie-breakers. Its phrase `No double-arrowhead target` conflicts with the visibly separate multiple incoming arrowheads described above; it may intend an anti-parallel pair, but that is not what its literal words say. The ledger is a pre-spec plan: its older v1/v2 view allocations and `label_slot` statement do not match the final three specs.

`generation.json` `recipe_yield.measured_attempts` records, neutrally: egress LR draft extent 189×9; 8-node host TB draft 66×62; the 8-edge `label_slot:true` host draft exited 1, reporting `no obstacle-safe route for vm -> virbr, virbr -> box, ts -> box, ts -> bond0, box -> wlp, box -> bond0; increase node/layer spacing`. These are recorded yields, not independently rerun. Final v3 declares `label_slot:true` on all six edges.

## Motion and fit

Each text frame dump has three 51-line frames at 0, 100 and 200 ms, and I compared each set: the recorded text frames are identical within each view. No dot glyph is visible. Each `check.txt` reports 0 single-dot routes, 0 periodic routes and 0 violations. Dot spacing, direction, corner/bridge/head position, true-origin position, and synchronized arrival are not applicable: no animated route exists. Identical text alone does not prove pixel identity or rule out color-only changes; ANSI frames were supplied, but no pixel capture is available. The user/generator's pixel-identical assertion is therefore not independently proven by text comparison.

Live headers say 82×51 at 100%; frame dumps report `viewport: 82x51 zoom: 1.00 natural`. `check.txt` itself reports `viewport: unknown zoom: 1.00 natural`. The pinned final dumps each report `viewport: 77x47 zoom: 1.00 natural`; extents are v1 55×44, v2 54×22, v3 54×44. All final node and route content appears inside both the live and pinned captures, without overflow banner, clipping, hidden labels, or need to pan/zoom. Machine checks report 0 bridges/touching bends, 14/14 edge labels placed, 0 on route cells, 0 skipped. Absence of a `routes:` line is expected.

## Blind scorecard

- Visible nodes: 6 / 4 / 7 = 17 occurrences, 13 distinct identities.
- Visible edges and edge labels: 5 / 3 / 6 = 14 each; graph label occurrences including node text: 11 / 7 / 13 = 31.
- Group hue families: 4; no rendered group boundary/title.
- Rank pins: 0 declared; observed ranks 3 / 2 / 6.
- Crossings/bridges/touching bends: 0 / 0 / 0 observed; 0 / 0 reported per check.
- Uncertain owners: 1 potentially uncertain (`gw 0.5 ms`), versus 0 machine-reported; no confirmed wrong assignment.
- Clipped/hidden graph items: 0 observed in the live and pinned captures.
- Selected-state coverage: 17/17 node occurrences in select-all ANSI frames.
- Dots and dot violations: 0 dots / 0 observed violations, 0 reported; motion-specific conditions not applicable.
- Unreadable evidence: none of the required text/spec/ANSI evidence was unsupported. No pixel-level evidence was provided. Binary hash and validator records are claims in supplied evidence, not a fresh viewer run.

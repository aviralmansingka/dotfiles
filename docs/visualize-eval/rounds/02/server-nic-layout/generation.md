# server-nic-layout — round 02 generation

Worker `viz-ds02-server-nic-layout` (dispatch bug note: the captain's task message
carried a literal `undefined` case id and this tab is labelled
`viz-ds02-undefined-4`; the captain confirmed `server-nic-layout` and this output
directory before any capture).

| Input | Value |
|---|---|
| Generator | worker (pi subagent), `fireworks/accounts/fireworks/routers/deepseek-flash-latest` |
| Candidate skill | `docs/visualize-eval/rounds/02/SKILL.md` `7d1ff098…b75d70` |
| Renderer | `/tmp/visualize-eval/round-02/bin/rataflow-view` `ee085c0f…40e8ea` (absolute path in every command) |
| Source | `docs/visualize-eval/cases/server-nic-layout/source.md` `235d296f…0308b` |
| Target | 77 × 47 at natural 100 % zoom |

Two views, nothing captured outside the harness, both bundles validate clean.

## Views

| view | carries | extent | labels | dots | evidence |
|---|---|---|---|---|---|
| v1 | server1 chassis, active NIC, seven dark ports, routed /29 segment (.57 gateway, .59 neighbour, .60-.62 free) | 58×29 | 5/5 placed, 0 on route, 0 skipped | 2 single-dot, 0 violations | `evidence/v1` |
| v2 | observed egress path NIC → gateway → Airtel → Airtel backbone → Cloudflare, with AS numbers and RTTs | 25×40 | 4/4 placed, 0 on route, 0 skipped | 4 single-dot, 0 violations | `evidence/v2` |

Measured size for both: `77x47 @100%` — the app's own header token in the
captured pane text, since the alternate screen erases the `viewport:` startup
line in a live pane. Validator: 24/24 PASS for each bundle
(`evidence/<view>/validate.txt`).

## Coverage map

| view | nodes | audited edges |
|---|---|---|
| v1 | dark, s1, nic, s2, gw, spare | e1, e2, e3 (RTT), e4, e5 |
| v2 | nic, gw, airtel, airtelbb, cf | e3 (addressing mode), e6, e7, e8 |

Every audited edge names a view. `nic` and `gw` are deliberate anchors in both
views; `e3` is the only edge drawn twice, carrying one true label per view
(0.1 ms in v1, `no NAT, no v6` in v2).

## What the source needed and how it was drawn

- **One active uplink, seven dark** — v1 draws `7 of 8 ports dark → server1 →
  eno16595np0 25GbE`; `dots: 1` runs only on the active route, `dots: 0` on the
  dark ports, on server2 and on the free pool, so "one uplink" is visible as
  motion and not only as text.
- **Neighbour and pool** — server2 and `.60-.62` sit on the gateway's rank as
  peer members of the /29, each with its own arrow.
- **Uncertainty** — two facts the source explicitly will not promote stay
  dashed with question marks: `dark → s1 "no link seen"` (inactive interfaces
  do not prove no cable) and `spare → gw "free?"` (unresponsive addresses do
  not prove free).
- **Qualified identifications** — the gateway is labelled `Arista .57 L3`, not
  "ToR": the MAC OUI supports the vendor, and only the fact that `.57` routes
  the /29 supports the Layer 3 role.
- **Invisible fabric** — the transit hop keeps its measurement and its
  qualification in one label, `1.8 ms unseen`; no spine or leaf node was
  invented, per the fixed constraints.
- **One ISP, no ECMP** — drawn structurally: a single unbranched path with one
  dot per route.

No trunks: the renderer refused the only candidate bus in both placements
(`no obstacle-safe route for nic -> s2, nic -> spare`), and, more decisively,
the /29 is a routed prefix whose members hold independent links — two of them
carrying qualifiers that a trunk spur cannot express, since `SpecTrunk`
branches take no label and no style. Details in `attempts.json`
(`capability_preflight`) and `generation.json` (`blockers.unmet_needs`).

## Attempts

| view | # | spec | outcome |
|---|---|---|---|
| v1 | 1 | `attempts/a1-v1-merged-9node.json` | rejected — one 9-node overview, extent 95×56, overflows both axes |
| v1 | 2 | `attempts/a2-v1-segment-flat.json` | superseded — flat layer slots drew a stair-step; cramped `noNAT/v6` label |
| v1 | 3 | `v1.json` | captured |
| v2 | 1 | `attempts/a3-v2-path-5node.json` | superseded — repeated v1's RTT label, left no home for the no-NAT fact |
| v2 | 2 | `attempts/a4-v2-before-colorfix.json` | captured, then superseded by the colour audit (bundle kept in `attempts/superseded-capture/v2-pre-colorfix`) |
| v2 | 3 | `v2.json` | captured |

Four views allowed, two used; three attempts per view allowed, three and three
used. The split is forced by the renderer: the same 9-node graph with explicit
7-layer placement measures 59×53, over the 47-row budget.

## Known defects

1. v1: the `free?` label sits flush against both neighbouring box borders.
   Off the route, 0 skipped; shortening it would drop the word carrying the
   uncertainty.
2. v1: one-cell jogs where the stacked boxes differ in width.
3. v2: uses 25 of 77 columns — five single-node layers; an `lr` version of the
   same chain needs ~110 columns and would have to drop identifiers.
4. Both views: group hues are positional (family index = order of first
   appearance). Declaration order was chosen so the two nodes present in both
   views (NIC gold, gateway pink) match; the residual reuse of the fourth and
   second hues by v1's pool/hosts and v2's internet/transit is recorded, not
   faked.

## Blockers

No view is blocked. Two unmet renderer needs are recorded: per-branch label and
style on trunk spurs, and a per-group colour override.

Harness quirks, recorded not worked around: `viz-evidence.sh` writes
`pane_cols: null` and `pane_rect: null` for this tab (its layout rect lookup
misses), so size comes from `pane_rows` plus the app's `77x47 @100%` header
token; and the `--frames` capture also carries the command echo and shell
prompt around its five complete frames.

## Cleanup

Three panes, all opened by the harness as no-focus half splits in my own tab
`w7E:t1Q`, all closed and confirmed: `w7E:p7E` (v1), `w7E:p7F` (v2 attempt 2),
`w7E:p7T` (v2). `herdr pane list` shows only my own pane afterwards. No foreign
tab, no raw tmux, no credential or remote access.

## Not claimed

No review was run by this generator (the captain runs the independent Sol
judges). Nothing is marked green; `generation.json` lists the same defects.

# homelab-nic-trace — round 01 generation report

Live evaluation sample. **This report does not claim a pass.** No independent readability
review was run by this generator; the visual verdict is captain-owned and uses a separate
Astra judge. `generation.json` is the machine-readable manifest for the same run.

## Identity and frozen inputs

| Item | Value |
|---|---|
| Case | `homelab-nic-trace` |
| Round | `01` |
| Generator | fresh pi worker session `01a19b5b-df9f-71fc-8aa3-540bc3465404` (`viz-ds01-homelab-nic-trace`) |
| Exact model | `fireworks/accounts/fireworks/routers/deepseek-flash-latest` (provider `fireworks`, reasoning level `high`) |
| Candidate skill | `docs/visualize-eval/rounds/01/SKILL.md`, sha256 `9c5cea27…308d92` |
| Renderer | `/tmp/visualize-eval/round-01/bin/rataflow-view`, sha256 `4a883e73…a3a1d8` |
| Source brief | `docs/visualize-eval/cases/homelab-nic-trace/source.md`, sha256 `abe8b376…21b4c4` |

Every `--check` and every viewer launch used that frozen binary. Nothing was built,
installed, committed, or edited outside this case directory. No earlier round, other
case output, expected data, or critique was read.

## Measured viewport

Target: **77 columns × 47 rows** at natural 100% zoom.

Each view was opened in its own fresh pane:

```sh
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus
herdr pane run <pane> "stty size"          # measured BEFORE the viewer started
herdr pane run <pane> "/tmp/visualize-eval/round-01/bin/rataflow-view <spec>; herdr pane close <pane>"
```

`stty size` returned `47 77` in all three viewer panes (pane rect 79×49; the rest is Herdr
chrome). So the measured content viewport **matches the 77×47 target exactly** — no
relabelling, no pan, no zoom, and `f` was never pressed. Per-view pty logs:
`captures/vN-size.txt`, `captures/vN-commands.txt`.

## Views

Three focused views. 13 nodes / 14 edges do not fit one 77×47 pane at 100% zoom without
crowding, so the graph is split by plane; `homelab host` repeats in v1/v2 and `bond0`/`wlp8s0`
repeat in v2/v3 as bridge nodes.

| View | Spec | Direction | Extent | Pane | Content |
|---|---|---|---|---|---|
| v1 | `specs/v1-local-nets.json` | tb | 35×21 | 77×47 | libvirt NAT bridge, Docker bridge, and their VM/container upstreams into the host |
| v2 | `specs/v2-host-nics.json` | lr | 76×12 | 77×47 | Tailscale overlay, its UDP encapsulation over the wired path, and the two host NIC attachments |
| v3 | `specs/v3-lan-wan.json` | tb | 43×45 | 77×47 | LAN default gateway, WAN transit hops, egress to Cloudflare |

`--check` on all three final specs: `extent` as above, **no warnings, exit 0**
(`checks/vN-check.txt`). Node boxes: four complete sides, one uniform border colour per box,
no arrow or flow dot on any border cell (`checks/vN-borders.json`, ANSI-derived).
Selected-node states are captured separately so the judge can inspect border handles:
Tab selected `homelab host` in v1, `bond0` in v2, `bond0` in v3 — the whole border of the
selected box turns bold accent (`captures/vN-selected.ansi`, diffs in
`checks/vN-selection-diff.json`). Frames `frames/vN-frame01..03.*` are timestamped one second
apart and differ (flow dots move; routing is static — re-rendering the same spec reproduced
the same layout byte-for-byte apart from dot phase and the header filename).

To re-open a view:

```sh
/tmp/visualize-eval/round-01/bin/rataflow-view specs/v3-lan-wan.json
```

## Relationship coverage (all 14 source edges, no additions, no reversals)

| # | Source relationship | Source label | View | Visible as |
|---|---|---|---|---|
| 1 | `vm → virbr` | 192.168.122.x | v1 | VM vnet0 → virbr0 NAT, label row 20, arrow (22,24) |
| 2 | `virbr → box` | NAT bridge | v1 | virbr0 NAT → homelab host, label row 28, arrow (30,23) |
| 3 | `ctr → dkbr` | 172.18.2.x | v1 | Container veth → docker0, label row 20, arrow (22,41) |
| 4 | `dkbr → box` | Docker bridge | v1 | docker0 → homelab host, label row 30, arrow (30,25) |
| 5 | `ts → box` | overlay | v2 | tailscale0 → homelab host, label row 22, arrow (21,30) |
| 6 | `ts → bond0` | encap over UDP | v2 | tailscale0 → bond0, drawn over the host, label `UDP encap` row 20, arrow (21,62) |
| 7 | `box → bond0` | eno1 2.5 GbE | v2 | homelab host → bond0, label row 22, arrow (23,62) |
| 8 | `box → wlp` | backup path | v2 | homelab host → wlp8s0, label `backup` row 24, arrow (27,62) |
| 9 | `bond0 → rtr` | default gw 0.5 ms | v3 | bond0 → Fios router?, label row 7, arrow (10,22) |
| 10 | `wlp → rtr` | metric 600 | v3 | wlp8s0 → Fios router?, label row 8, arrow (10,24) |
| 11 | `rtr → ont` | NAT out | v3 | Fios router? → ONT?, label row 15, arrow (18,23) |
| 12 | `ont → vzagg` | 4.5 ms | v3 | ONT? → VZ agg (hop), label row 24, arrow (26,20) |
| 13 | `vzagg → vzbb` | 6.6 ms | v3 | VZ agg (hop) → VZ backbone AS701 (hop), label row 32, arrow (34,19) |
| 14 | `vzbb → cf` | 6-9 ms | v3 | VZ backbone AS701 (hop) → Cloudflare, label row 39, arrow (42,22) |

Node coverage: `box x2` (v1 bridge, v2 bridge), `bond0 x2` (v2, v3 bridge), `wlp x2` (v2, v3
bridge) — an intentional abstraction, declared here. Every source node appears; every source
edge appears exactly once, in its original direction, with its original meaning.

Two edge labels were shortened to fit free slots, with meaning preserved and no fact dropped:

- `encap over UDP` → `UDP encap` (v2; the tb variant dropped a label outright, see attempts)
- `backup path` → `backup` (v2)

## Qualified historical evidence

The brief requires qualifying the claimed device identities:

- `Fios router? .1.1` and `ONT? 169.254.3.1` carry `?`: router role comes from MAC OUI plus the
  historical chat, and the ONT/demarc is an interpretation of a link-local first hop. Neither is
  verified physical topology.
- `VZ agg 100.41.x (hop)` and `VZ backbone AS701 (hop)` carry `(hop)`: traceroute hops, not
  verified devices.
- The Fios box's collapsed-fabric role (ToR + spine + border + firewall) and the shared pool IP
  `71.251.12.240` are prose facts from the source, not edges in the relationship list, so they
  are not drawn as nodes; the egress consequence is the `NAT out` edge plus `default gw 0.5 ms`.
- IPv6: ULA only, no reachable global v6. The relationship list has no v6 edge, so none was
  invented. Recorded, not drawn.
- Metric failover, not ECMP: the Wi-Fi rung carries `metric 600` and has no flow dots, while the
  wired rung flows. Nothing claims load sharing.

## Abbreviations

| Rendered | Meaning |
|---|---|
| `bond0 .1.197` | bond0, 192.168.1.197 (LAN 192.168.1.0/24) |
| `wlp8s0 .213` | wlp8s0, 192.168.1.213 |
| `tailscale0 .49` | tailscale0, 100.113.153.49 (100.64/10 overlay prefix implied) |
| `Fios router? .1.1` | 192.168.1.1, role expected/claimed |
| `ONT? 169.254.3.1` | link-local first hop treated as the ONT/demarc |
| `VZ` | Verizon |
| `(hop)` | traceroute hop, unverified device |
| `UDP encap` | the source phrase "encap over UDP" |
| `backup` | the source phrase "backup path" |

## Known defects (visible, not hidden)

**v1**

1. `vm → virbr` and `virbr → box` each jog left by one cell just above their arrowhead
   (rows 21 and 29). Continuous, but a step rather than a straight drop.
2. The `virbr → box` turn at (29,24) and the `dkbr → box` turn at (29,25) are vertically
   adjacent, corner to corner. Separate cells, separate labels, but a glance can read the pair
   as one junction.
3. `Docker bridge` sits one row below its run and one row above the host's top border, because
   that is the only free slot left.

**v2**

1. At row 21, cols 28–31 the `UDP encap` route turns up at (21,28) immediately beside the
   `overlay` arrival corner and arrowhead at (21,29)–(21,30): `──╯╭▶`. Two separate routes with
   two separate source ports (rows 21 and 23), no shared cell — but the collinear one-cell stub
   can be misread as a branch into the host. This is the weakest point of the sample.
2. At row 23, cols 59–62 the `backup` turn at (23,59) is adjacent to the `eno1` arrival corner
   at (23,60): `╮╰─▶`. Same adjacency class.
3. Extent 76 cells in a 77-column pane: one spare column, no width budget for a longer label.
4. Direction is `lr` while v1/v3 are `tb` — forced by the tb dropped-label warning; the views do
   not share an orientation.
5. Flow dots overwrite the corner glyph of the cell they occupy, so an individual frame can show
   a bare dot where a turn was.

**v3**

1. Each WAN rung steps one or two cells sideways before its arrowhead (e.g. `NAT out` jog at
   (17,22)→(18,23); `4.5 ms` step at (25,20)→(25,21); `6-9 ms` step at (41,22)→(41,23)). Every
   last segment is vertical and every arrowhead is visible, but the ladder is not one straight
   column.
2. The graph reaches row 46, the last row of the pane: no bottom margin under the Cloudflare box.
   The bottom-left control palette (cols 2–10, rows 41–46) stays clear of nodes and routes.
3. `metric 600` sits one row above the route it names (row 8 vs row 9), stacked under
   `default gw 0.5 ms`, instead of beside its source stem.
4. The header line is clipped by the 77-column pane (`… · drag`). Renderer chrome, not graph
   content.

## Spec attempts (limit: three per view)

| View | Attempt | Spec | Result |
|---|---|---|---|
| v1 | 1 | `specs/v1-local-nets.json` (tb) | accepted — clean at 35×21 |
| v1 | 2 | `attempts/v1-a2-lr.json` | rejected — 81×11, exceeds the 77-column pane |
| v2 | 1 | `attempts/v2-a1-tb-reconstructed.json` | rejected — `1 edge label(s) had no free slot` at 34×22. The draft file was overwritten when the winner was promoted; this copy is a faithful reconstruction (same nodes, layers, direction, source labels) and reproduces the same warning. Marked reconstructed, not a captured original. |
| v2 | 2 | `attempts/v2-a2-lr.json` | accepted — clean at 76×12, promoted byte-identically to `specs/v2-host-nics.json` |
| v2 | 3 | `attempts/v2-a3-tb.json` | rejected — tb with the short labels still reports `1 edge label(s) had no free slot`: the missing slot is structural (the skip edge over the host row), not label length |
| v3 | 1 | `attempts/v3-a1-lan-wan.json` | superseded — clean at 38×45, but it did not mark the two Verizon hops as hops |
| v3 | 2 | `attempts/v3-a2-lan-wan-hops.json` | accepted — clean at 43×45, promoted byte-identically to `specs/v3-lan-wan.json` |

Attempt captures are kept under `attempts/` (`v1-a1-captures/`, `v2-a2-captures/`,
`v3-a2-captures/`, `v3-a1-unselected.txt`) so the warning-bearing drafts and the accepted
renders can be compared. `checks/attempt-*-check.txt` holds their complete `--check` output.

## Blockers and unmet needs

- **No rendering blocker.** The frozen binary accepted all three final specs; `--check` exited 0
  with no warnings on each.
- **Unowned review.** The candidate skill's "Independent readability review" section could not be
  satisfied here: the task reserves the Astra judge to the captain, so this output carries no
  pass/fail visual verdict and no approval claim.
- **Density, not a renderer defect.** 13 nodes / 14 edges need three views at this viewport;
  the renderer cannot shrink text, so the split is the honest resolution, at the cost of
  repeating three bridge nodes.

## Cleanup

Every pane was created with `--no-focus` in my own tab (`w7E:tM`), launched with the skill's
self-closing command (`rataflow-view <spec>; herdr pane close <pane>`), quit with `q`, and then
re-queried with `herdr pane get` — all returned `pane_not_found`:

`w7E:p34` (measurement), `w7E:p3T` (v2 attempt), `w7E:p45` (v3 attempt 1), `w7E:p4D` (v3 attempt
2), `w7E:p4N` (v2 final), `w7E:p4S` (v3 final), `w7E:p4V` (v1 final).

Cleanup failures: none. The captain's pane and tab were never split, read, or closed by this
generator, and no raw `tmux` command was used.

## Evidence index

- `specs/` — the three final specs.
- `attempts/` — rejected/superseded specs, their captures, and ad-hoc pane logs.
- `checks/` — per-view `--check` stdout+stderr+exit, ANSI border/colour reports, selection diffs.
- `captures/` — per-view unselected and selected pane reads (text + ANSI), command/pane/size logs.
- `frames/` — three timestamped animation frames per view (text + ANSI).
- `tools/` — `render_view.sh` (reproducible pane/capture loop), `ansi_grid.py` (ANSI→cell grid,
  diff mode), `validate_grid.py` (box/border/colour checks), `make_manifest.py` (this manifest).

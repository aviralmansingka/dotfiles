# server-nic-layout — round 03 fresh generation

- Case: `server-nic-layout`
- Round: `03`
- Generator: pi worker subagent `viz-ds03-4` (agent profile `worker`), fresh generation
- Model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest` (provider `fireworks`, reasoning level `high`)
- Candidate skill: `docs/visualize-eval/rounds/03/SKILL.md`
  sha256 `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c`
- Renderer: `/tmp/visualize-eval/round-03/bin/rataflow-view` (absolute path only)
  sha256 `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7`
  It was never rebuilt or substituted; every check and capture records this hash.
- Source read: `docs/visualize-eval/cases/server-nic-layout/source.md` only.
  No `expected.json`, no `historical-variants.json`, no other case, no earlier round output.
- This case is **static**: no `flow`, no `dots` on any edge. The three captured frames
  per view are identical by design; no motion or synchronization claim is made.

## Views (3 final, budget 4)

| view | scope | spec | extent | crossings | nodes | validator |
|---|---|---|---|---|---|---|
| v1 | server1 physical ports + the shared `/29` segment | `specs/v1-attempt3.json` | 55x28 | 2 | 6 (+1 trunk) | all checks passed |
| v2 | observed upstream hops: latency, prefixes, AS numbers, v4-only, no ECMP | `specs/v2-attempt2.json` | 35x37 | 0 | 5 | all checks passed |
| v3 | qualified claims: what the OUI / dark ports / quiet pool / mute hops do **not** prove | `specs/v3-attempt1.json` | 53x25 | 2 | 5 | all checks passed |

Every capture measured `77x47 @100%` at natural zoom (`viewport:` line is `unknown` in a
live pane because the alternate screen erases the startup line; the app's own header token
`77x47 @100%` is the recorded proof). Nothing was panned or zoomed.

## Coverage map

| view | carries |
|---|---|
| v1 | e1–e5, dark ports, `/29` prefix, no NAT, trunk `p29` with two branch spurs |
| v2 | e3 latency, e6–e8 with prefixes and AS numbers, full host quad, `v4-only`, no ECMP |
| v3 | q1–q4 qualified claims (OUI/ToR role, dark/cable, quiet/free, mute hops/Layer 2) |

## Meaning ledger

| fact | kind | fate |
|---|---|---|
| server1 `103.19.91.58`, Dell R7725, bare metal, NxtGen, Bengaluru | address + residency | drawn (v1 `server1 R7725` + trunk `.58/29`; v2 `103.19.91.58 v4-only`); residency compressed to the `AS132717` token |
| server2 `103.19.91.59`, same R7725, same `/29` | address + residency | drawn (v1 `server2 .59` on a p29 spur) |
| 8 physical NICs, one active | count/role | abbreviated — `7 ports dark` + one active port; the literal `8` is not printed (d1) |
| `eno16595np0`, 25 GbE | identifier + speed | drawn (v1) |
| `/29`: gw `.57`, `.58`, `.59`, `.60-.62` free | addresses/pool | drawn (v1 trunk + node labels; v2 full quads) |
| no NAT, public L3 straight to the host | limitation | drawn (v1 trunk `no NAT`) |
| no IPv6 | limitation | drawn (v2 `v4-only`) |
| ToR `.57` at 0.1 ms | identifier + latency | drawn (v1 `Arista .57`, v2 edge `0.1 ms`) |
| MAC OUI = Arista; NxtGen access is Arista | vendor evidence | drawn + qualified (v1/v2 vendor token; v3 `Arista OUI .57` + `ToR role?`) |
| Airtel `14.143.x`, 1.8 ms | prefix + latency | drawn (v2) |
| Airtel backbone `14.141.x`, 7.1 ms | prefix + latency | drawn (v2) |
| Cloudflare `1.1.1.1` AS13335 — 8.6 ms (chat) vs 8.3 ms (facts list) | address + latency | drawn as `8.3-8.6 ms` (range, both values kept) |
| one uplink, one visible ISP, no ECMP | limitation | drawn (v2 `Airtel 14.143.x, no ECMP`) |
| above the ToR invisible; fabric "bridges, tunnels or stays silent" | qualifier | partly drawn (v3 `still unproven` + `layer 2?`); the three-reading list dropped (d5) |
| a missing hop proves nothing about Layer 2 | qualification | drawn (v3) |
| VXLAN/MPLS tunneling hides fabric hops | mechanism | **dropped** — prose why; the dedicated view was abandoned (b3) |
| ICMP suppression; hops 3, 6 silent, hop 5 lost 80% | observation | hops drawn (v3 `hops 3,6 quiet, 5@80%`); the ICMP mechanism dropped |
| Arista `.57` is Layer 3 (routes the `/29`, answers probes) | role | drawn (v2 chain; v3 claim) — wording "routed leaf" not printed |
| fresh handoff: no GPUs, no rack-bench, up 1.5 days | host state | **dropped** — not NIC/egress layout |
| `/tmp/*-network-layout.json` pointers | artifact pointer | **dropped** — earlier attempt paths, not facts |
| constraints: dark ≠ no cable, no reply ≠ free, OUI ≠ ToR role | qualifiers | drawn (v1 dashed `no cable`; v3 dashed `ToR role?`, `no cable?`, `free?`) |

## Relationship audit

| id | from → to | verb / tech | label owner | style | view |
|---|---|---|---|---|---|
| e1 | dark → s1 | 7 ports dark, no cable (unconfirmed) | v1/e1 `no cable` | dashed | v1 |
| e2 | s1 → nic | only active uplink of 8 ports | v1/e2 `only uplink` | solid | v1 |
| e3 | nic → gw | default gateway, public `/29`, 0.1 ms | v1 trunk `p29 .58/29 no NAT` + v2/e3 `0.1 ms` | solid | v1 + v2 |
| e4 | s2 → gw | same `/29`, `.59` | v1 trunk p29 spur | solid | v1 |
| e5 | spare → gw | free `.60-.62` in the `/29` (unconfirmed) | v1 p29 spur + v3/e5 `free?` | solid / dashed | v1 + v3 |
| e6 | gw → airtel | transit `14.143.x`, 1.8 ms | v2/e6 `1.8 ms` | solid | v2 |
| e7 | airtel → airtelbb | `14.141.x`, 7.1 ms | v2/e7 `7.1 ms` | solid | v2 |
| e8 | airtelbb → cf | Cloudflare `1.1.1.1` AS13335, 8.3–8.6 ms | v2/e8 `8.3-8.6 ms` | solid | v2 |
| q1 | oui → claim | OUI does not settle the ToR role (derived) | v3/q1 `ToR role?` | dashed | v3 |
| q2 | dark → claim | darkness does not settle cabling (derived) | v3/q2 `no cable?` | dashed | v3 |
| q3 | pool → claim | silence does not settle pool freshness (derived) | v3/q3 `free?` | dashed | v3 |
| q4 | hop → claim | mute hops do not settle Layer 2 (derived) | v3/q4 `layer 2?` | dashed | v3 |

`q1–q4` are qualifier edges I introduced to draw the fixed constraints; they are not source
relations and are labelled as derived in `generation.json`.

### Original → visible

- `dark -> s1: no cable` → v1 dashed `no cable`
- `s1 -> nic: only uplink` → v1 `only uplink`
- `nic -> gw: default gw 0.1 ms` → v1 trunk `p29` (`/29`, no NAT) + v2 edge `0.1 ms`
- `s2 -> gw: same /29` → v1 p29 spur to `server2 .59`
- `spare -> gw: free in /29` → v1 p29 spur to `.60-.62 free` + v3 dashed `free?`
- `gw -> airtel: transit 1.8 ms` → v2 `1.8 ms`
- `airtel -> airtelbb: 7.1 ms` → v2 `7.1 ms`
- `airtelbb -> cf: 8.3 ms` → v2 `8.3-8.6 ms`
- "a missing hop proves nothing about L2" → v3 `still unproven` + `layer 2?`

## Trunk

The one real shared link the source names is the routed `/29` segment: one gateway `.57`
serving `.58`, `.59` and the free `.60-.62`. It is declared as a trunk, not three lines:

```json
{ "id": "p29", "label": ".58/29 no NAT", "from": "gw", "to": "nic",
  "branches": ["s2", "spare"] }
```

It routed cleanly on the first v1 spec (no shared-corridor warning, `trunks: p29 from gw to
nic, 2 branches`, one junction spur per branch). A probe of the opposite geometry — trunk
with both branches on the *source* layer — was refused outright
(`no obstacle-safe route for a -> b, a -> c`), so the trunk is drawn gateway-side up.

## Per-view `--check` lines (verbatim)

v1 (`evidence/v1/check.txt`):

```
viewport: unknown zoom: 1.00 natural
ok: nodes=6 edges=2 flows=0 direction=tb theme=gruvbox
layers=4 (explicit placement, sugiyama skipped)
extent=55x28 cells
crossings: 2
labels: 3/3 placed, 0 on route cells, 0 skipped
groups: hardware(3) hosts(1) pool(1) network(1)
trunks: p29 from gw to nic, 2 branches
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
origins: 0/0 routes start at their arrow origin
```

v2 (`evidence/v2/check.txt`):

```
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=4 flows=0 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=35x37 cells
crossings: 0
labels: 4/4 placed, 0 on route cells, 0 skipped
groups: host(1) nxtgen(1) transit(2) internet(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
origins: 0/0 routes start at their arrow origin
```

v3 (`evidence/v3/check.txt`):

```
viewport: unknown zoom: 1.00 natural
ok: nodes=5 edges=4 flows=0 direction=lr theme=gruvbox
layers=2 (explicit placement, sugiyama skipped)
extent=53x25 cells
crossings: 2
labels: 4/4 placed, 0 on route cells, 0 skipped
groups: observed(4) claim(1)
trunks:
dots: 0 single-dot routes, 0 periodic routes, 0 violations, 0 synchronized at 2000ms
origins: 0/0 routes start at their arrow origin
```

No warnings on any final view.

## Layout attempts and crossing counts

- **v1 — 3 specs.** (1) explicit layers `[dark][s1][nic,s2,spare][gw]`, trunk gw→nic, extent 56x30, crossings 3.
  (2) same content with auto/sugiyama placement: crossings 2 but extent **85 wide**, wider than
  the 77-column target, so it would overflow at 100% — rejected. (3) explicit layers with the
  middle row reordered `s2 / nic / spare` so the trunk end and both spurs sit centred:
  55x28, crossings **2**, labels 3/3 — kept.
- **v2 — 2 specs.** (1) 5-layer chain, crossings 0, 35x37. (2) same chain, `nic` now carries the
  full `103.19.91.58` plus `v4-only` and the Airtel hop carries `no ECMP`: crossings **0**,
  35x37, labels 4/4 — kept (equal crossings, more identifiers).
- **v3 — 3 specs.** (1) lr fan, four observations in one column into one claim: 53x25,
  crossings **2**, every edge label on its own row — kept. (2) same fan with the leaf order
  swapped: 53x25, crossings 2, no gain. (3) tb 2×2 grid into the claim: 44x22, crossings **1**
  (the lowest of the three) but the capture draws `free?` and `layer 2?` touching on one line,
  so two different edge labels read as one ambiguous string. Readability beat the crossing
  count, so the lr fan was kept and the tb capture is preserved (unmodified) at
  `evidence/v3-rejected-tb-attempt3/`.
- **Abandoned design (probe, 3 specs).** A dedicated "trace limits" view (VXLAN/MPLS, ICMP
  limit, "above .57 hidden" → silence → "not L2") was tried three times: 85x23 (too wide),
  112x18 (lr, too wide), then 61x23 with 1 skipped label (`hides fabric` had no free slot).
  It was not given a fourth spec; its facts were re-composed inside v3 as a qualifier fan
  (a different relationship structure). Specs and their check output live in `specs/probes/`.

Group declarations were never reordered to win a crossing count; only node order *inside* a
layer changed, which the source leaves free.

## Validator

```sh
python3 scripts/viz-validate.py docs/visualize-eval/rounds/03/server-nic-layout/evidence/<view> \
    --require-select --require-frames \
    --attempts docs/visualize-eval/rounds/03/server-nic-layout/attempts.json
```

- v1: `all checks passed` (28 PASS) — `validator/v1.txt`
- v2: `all checks passed` (28 PASS) — `validator/v2.txt`
- v3: `all checks passed` (28 PASS) — `validator/v3.txt`

`evidence/v3-rejected-tb-attempt3/` is a preserved rejected capture, not a final view, and was
not validated as one.

## Known defects (honest list)

1. `d1` v1 never prints the literal **8** physical NICs — `7 ports dark` plus the active port
   implies it. v1 was frozen at its third spec before labels could be widened.
2. `d2` The `p29` trunk arrow points gateway → member (the `/29` served from the ToR), while the
   source's dominant direction for that relation is host → default gateway. v2 draws the
   host → gateway direction explicitly with the `0.1 ms` edge.
3. `d3` The gateway's full quad `103.19.91.57` is never printed in full; only `.57`, with
   `103.19.91.58/29` giving the prefix. Abbreviation, recorded.
4. `d4` The Cloudflare hop is a latency **range** `8.3-8.6 ms` because the two source statements
   disagree (chat line 120: 8.6 ms; relationship list: 8.3 ms). No single number was picked, so
   the pane shows no one authoritative value.
5. `d5` Coverage gap: the traceroute mechanism list (VXLAN/MPLS outer TTL, ICMP suppression) and
   the bridge/tunnel/silent reading are drawn nowhere — only the resulting uncertainty is.
6. `d6` v3's claim box `still unproven` is tall with four arrowheads converging; its label does
   not name the four questions by itself (the edge labels do).
7. `d7` `manifest.json` records `pane_cols` as null (the pane rect width was not read back by
   herdr in this session). Size is proven by the app's own `77x47 @100%` header token.
8. `d8` Static case: `dots: … 0 synchronized at 2000ms` and `origins: 0/0` are vacuous here; the
   frames prove the drawing, not motion.

## Blockers / unmet needs

- No renderer capability was missing for the three drawn views. `trunks` routed cleanly, static
  edges and dashed styles were enough.
- The spec has **no view-title field**, so each view's scope is stated here, not in the pane; the
  pane header shows only the spec filename. Recorded, not invented.
- The abandoned trace-limits design consumed its three specs, so the tunneling/ICMP mechanism
  content stays out of the artefact (see `d5`, `b3` in `generation.json`).

## Cleanup

| pane | view | result |
|---|---|---|
| `w7E:pC4` | v1 | `confirmed_closed` |
| `w7E:pC5` | v2 | `confirmed_closed` |
| `w7E:pC6` | v3 tb attempt 3 (rejected capture) | `confirmed_closed` |
| `w7E:pC7` | v3 final | `confirmed_closed` |

All panes were split from this session's own pane (`w7E:pB6`, `--no-focus`) and closed; the
captain's tab was never used and raw tmux was never touched. `herdr pane list` shows no leftover
`pC4`–`pC7` panes.

## Files

```
specs/v1-attempt{1,2,3}.json     v1 specs (final = attempt3)
specs/v2-attempt{1,2}.json       v2 specs (final = attempt2)
specs/v3-attempt{1,2,3}.json     v3 specs (final = attempt1)
specs/probes/trace-limits-a{1,2,3}.json (+ *-check.txt)  abandoned design
attempts.json                    per-view attempt budget with spec hashes
evidence/{v1,v2,v3}/             manifest, check, text, ansi, selected, frames
evidence/v3-rejected-tb-attempt3/ preserved rejected capture (unmodified)
validator/{v1,v2,v3}.txt         full validator output
generation.json, generation.md    this record
```

This output is not self-approved: no reviewer or judge was spawned, per the task. A separate
Sol judge should read the specs and captures.

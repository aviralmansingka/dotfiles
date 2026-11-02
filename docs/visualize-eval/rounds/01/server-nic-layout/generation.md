# server-nic-layout — round 01, DeepSeek generation

Case: `server-nic-layout`. Round: `01`. Output directory: `docs/visualize-eval/rounds/01/server-nic-layout/`.

This is a fresh generation. The user-cancelled Astra generation was not read, and no prior
generation, layout, expected data, or critique was opened.

## Identity and frozen inputs

| Item | Value |
|---|---|
| Generator | pi worker subagent `viz-ds01-server-nic-layout` (`PI_SUBAGENT_AGENT=worker`, `PI_SUBAGENT_ID=2b026675`) |
| Provider / model | `fireworks` / `accounts/fireworks/routers/deepseek-flash-latest` (`PI_MODEL`), reasoning level `high` |
| pi session | `01a19b5c-28a1-77c9-b5f2-32cc092c430e` |
| Herdr surface | workspace `w7E`, tab `w7E:tQ`, agent pane `w7E:p2W` |
| Candidate skill | `docs/visualize-eval/rounds/01/SKILL.md`, sha256 `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` (read fresh; the installed global skill was not used) |
| Renderer | `/tmp/visualize-eval/round-01/bin/rataflow-view`, sha256 `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` (only binary used; nothing built or installed) |
| Target viewport | 77 x 47 at natural 100% zoom — **met exactly**: `stty size` inside each pane reported `47 77` before the viewer started |
| Pane rect | 79x49 including 2 columns/rows of Herdr pane chrome; the pty the app draws into is 77x47 |

Split command for every view (no focus, half pane, my own tab):

```sh
herdr pane split --current --direction right --ratio 0.5 --cwd "$PWD" --no-focus
```

Every viewer launch was self-closing:

```sh
herdr pane run <pane> "/tmp/visualize-eval/round-01/bin/rataflow-view <spec>; herdr pane close <pane>"
```

No scroll, no zoom, no `f`. The graph was never fitted by shrinking.

## Why two views

One 9-node / 8-edge graph does not fit 77x47. A single `tb` spec with the seven natural
layers measures **64x56 cells** (attempt 1, rejected): 56 rows cannot fit in a 47-row pane.
The graph is split along the one boundary the source itself draws — the host side of the
Arista `.57` gateway, and the hops observed above it. The gateway is drawn in both views as
the shared boundary node, so every original relationship stays visible and none is dropped
or reversed.

## View A — host, dark ports, /29 peers, gateway

Spec `specs/vA-host-tor.json` (sha256 `91e8bb79…e549`), `direction: tb`, 4 layers, 6 nodes,
5 edges, 0 flows. `--check`: exit 0, no warnings, `extent=64x32 cells`.
Pane `w7E:p3Q`, 77x47, header verified:
`rataflow-view · vA-host-tor.json · 6 nodes · 5 edges · 0 flows · drag pan ·`
Capture timestamps (UTC): unselected 08:27:05, frames 08:27:06/08:27:07, selected 08:27:09
and 08:27:13, pane closed 08:27:44.

```text
           ╭───────────╮        ╭─────────────────╮    ╭─────────────╮
           │7 NICs dark│        │server2 R7725 .59│    │spare .60-.62│
           │           │        │                 │    │             │
           ╰───────────╯        ╰─────────────────╯    ╰─────────────╯
            │                    │                      │
            │ 7 dark ports       │                      │
            │                    │                      │
         ╭──╯                    │                      │
         ▼                       │                      │
        ╭─────────────────╮      │                      │
        │server1 R7725 .58│      │                      │
        │                 │      │                      │
        ╰─────────────────╯      │                      │
         │                       │                      │
         │                       │                      │
         │ only uplink           │                      │
         │                       │                      │
         ▼                       │                      │
        ╭──────────────────╮     │                      │
        │eno16595np0 25 GbE│     │                      │
        │                  │     │                      │
        ╰──────────────────╯     │                      │
         │ gw 0.1 ms             │                      │
        ╭╯        same /29       │                      │
        │ ╭──────────────────────╯                      │
        │ │ ╭───────────────────────────────────────────╯
        ▼ ▼ ▼               free? in /29
       ╭───────────────────╮
       │Arista .57 AS132717│
       │                   │
       ╰───────────────────╯
```

Edges in this view (all arrowheads land on the target's top border, all stems on the
source's bottom border):

| Edge | Label | Reading |
|---|---|---|
| `7 NICs dark → server1 R7725 .58` | `7 dark ports` | observed dark ports; cable absence is not asserted |
| `server1 R7725 .58 → eno16595np0 25 GbE` | `only uplink` | the one active interface |
| `eno16595np0 25 GbE → Arista .57 AS132717` | `gw 0.1 ms` | default gateway |
| `server2 R7725 .59 → Arista .57 AS132717` | `same /29` | neighbouring server on the same /29 |
| `spare .60-.62 → Arista .57 AS132717` | `free? in /29` | no observed use; not proven free |

Deliberately static: an animated variant (`attempts/vA-host-tor-flow.json`, capture kept in
`captures/superseded-vA-flow/`) put dots on the two short active-path stems. On stems shorter
than the renderer's 7-cell dot spacing the dots crowded two rows apart and replaced route
corner glyphs, so the static form is shipped. No relationship changed.

## View B — observed egress hops above the gateway

Spec `specs/vB-upstream.json` (sha256 `73e2d48c…a5f0`), `direction: tb`, 4 layers, 4 nodes,
3 edges, 3 flows. `--check`: exit 0, no warnings, `extent=22x29 cells`.
Pane `w7E:p41`, 77x47, header verified:
`rataflow-view · vB-upstream.json · 4 nodes · 3 edges · 3 flows · drag pan ·`
Capture timestamps (UTC): unselected 08:27:53, frames 08:28:03, 08:28:04, 08:28:05, 08:28:05,
selected 08:28:14 and 08:28:15, pane closed 08:28:33.

```text
                            ╭───────────────────╮
                            │Arista .57 AS132717│
                            │                   │
                            ╰───────────────────╯
                             │ transit 1.8 ms
                             ●
                             ╰●╮
                               ▼
                              ╭───────────────╮
                              │Airtel 14.143.x│
                              │               │
                              ╰───────────────╯
                               │
                               │ 7.1 ms
                              ╭●
                              ▼
                             ╭──────────────────╮
                             │Airtel BB 14.141.x│
                             │                  │
                             ╰──────────────────╯
                              │
                              ● 8.3 ms
                              │
                              ▼
                             ╭──────────────────╮
                             │Cloudflare 1.1.1.1│
                             │                  │
                             ╰──────────────────╯
```

Edges: `.57 → Airtel 14.143.x` (`transit 1.8 ms`), `Airtel 14.143.x → Airtel BB 14.141.x`
(`7.1 ms`), `Airtel BB 14.141.x → Cloudflare 1.1.1.1` (`8.3 ms`). All three are animated
(flow 0.3), and four timestamped frames with distinct hashes prove the dots move.

## Relationship coverage (all 8 original relationships)

| Original | View | Visible | Label | Note |
|---|---|---|---|---|
| `dark → s1`: no cable | A | `7 NICs dark → server1 R7725 .58` | `7 dark ports` | qualified: inactive ports are drawn as observed, not as proven cable absence |
| `s1 → nic`: only uplink | A | `server1 → eno16595np0` | `only uplink` | direction preserved |
| `nic → gw`: default gw 0.1 ms | A | `eno16595np0 → Arista .57` | `gw 0.1 ms` | |
| `s2 → gw`: same /29 | A | `server2 R7725 .59 → Arista .57` | `same /29` | |
| `spare → gw`: free in /29 | A | `spare .60-.62 → Arista .57` | `free? in /29` | qualified with `?` |
| `gw → airtel`: transit 1.8 ms | B | `Arista .57 → Airtel 14.143.x` | `transit 1.8 ms` | animated |
| `airtel → airtelbb`: 7.1 ms | B | `Airtel 14.143.x → Airtel BB 14.141.x` | `7.1 ms` | animated |
| `airtelbb → cf`: 8.3 ms | B | `Airtel BB → Cloudflare 1.1.1.1` | `8.3 ms` | relationship facts say 8.3 ms; prose line 120 said 8.6 ms |

All nine source nodes appear (the gateway in both views). Abbreviations: `BB` = Airtel
backbone, `gw` = gateway, `R7725` = Dell PowerEdge R7725, `AS132717` kept on the gateway node.

## Qualification of uncertain historical claims

- The gateway is labelled `Arista .57 AS132717`; it never says "ToR", because the brief says a
  MAC OUI does not prove the role.
- Dark ports are labelled as an observation (`7 NICs dark`, `7 dark ports`), not as "no cable".
- The .60-.62 addresses carry `free? in /29`, because absent responses do not prove free.
- No spine, leaf, VXLAN, or MPLS device is drawn: the source says traceroute cannot see them
  and the brief forbids inventing them.
- Not drawn (no node or edge exists in the source facts; drawing them would invent structure):
  "no NAT / public L3 / no IPv6", uptime 1.5 days, "no GPUs, no rack-bench yet", and the note
  that everything above the .57 is invisible from the host.

## Verification performed

1. `--check` on both final specs: exit 0, no warnings, no skipped-label or shared-corridor lines.
   Files: `checks/vA-host-tor.*`, `checks/vB-upstream.*` (stdout, stderr, exit code).
2. Header confirmed inside each pane before every capture (`captures/vA/header-wait.json`,
   `captures/vB/header-wait.json`).
3. Visible plain-text captures inspected: every box complete, every label visible, nothing clipped.
4. `tools/grid_check.py` — 5 (A) and 3 (B) arrowheads each land on the target's top border;
   5 and 3 source stems sit on the source's bottom border; no route glyph inside a box interior;
   no border-glyph problems; all four corners present on every box.
5. `tools/ansi_grid.py` — each box perimeter is one foreground colour (no mixed border or handle
   colours); layer hue families are distinct (amber / teal / pink / green in both views); stems and
   arrowheads use the muted stroke colour `(124,111,100)`; labels use the neutral text colour
   `(235,219,178)`; flow dots use the accent `(216,166,87)`.
6. Animation: 4 distinct frame hashes in view B (dots advance); the 2 view-A frames are
   byte-identical because that view is static by design.
7. Selected-node states captured for both views (ANSI), so border handles can be inspected.

## Known defects (not hidden, not fixed by deleting content)

1. **Stems and arrowheads attach one cell inside the left corner, not at the box centre**
   (dark stem at col 13 of a 12-24 box; s1 arrow at col 10 of 9-27; the gateway's three in-arrows
   at cols 9/11/13 of 8-28). Ports are separate cells and no corridor is shared, but the gateway
   fan-in reads as a left-side bundle. Not expressible in the spec.
2. **`free? in /29` sits on the arrowhead row**, one row below its own corridor, so its ownership is
   inferred by proximity (both candidate labels remain inside their corridors' spans).
3. **Label shortening**: `Cloudflare 1.1.1.1 AS13335` → `Cloudflare 1.1.1.1`, and Dell PowerEdge →
   `R7725`, to keep single-line boxes inside the pane.
4. **Selection is colour+bold only**; plain-text captures are byte-identical between selected and
   unselected states. Only the ANSI captures prove selection.
5. **The accent (216,166,87) equals layer-0's first shade**, so a selected node has the same colour
   as the unselected layer-0 node; the candidate skill's claim that the accent is reserved for
   selection does not hold in this render.
6. **View B: flow dots overwrite route corner glyphs.** Frame 4 shows `●─●` where the ╰/╮ corners of
   the jog under the gateway should be; frame 2 shows `●╯` replacing a ╭ corner. The dogleg is
   momentarily unreadable as a continuous route; endpoints and arrowheads stay correct.
7. **View B: two dots share one short jog** (frames 2 and 4), inside the 7-cell spacing rule.
8. **View B is narrow** — cols 29-49 of 77, extent 22x29. No clipping and no overflow badge, but the
   pane is under-used. `lr` cannot help: measured 119x5 and 102x5, both wider than 77 columns.

## Attempts (rejected specs kept, with their check logs)

| View | Spec | Extent | Outcome |
|---|---|---|---|
| A+B | `attempts/v1-full-tb.json` | 64x56 | rejected: 56 rows > 47-row pane |
| A | `attempts/v2a-host-tb.json` | 64x32 | kept (final layout) |
| A | `attempts/vA-host-tor-flow.json` | 64x32 | captured, then superseded by the static form |
| A | `specs/vA-host-tor.json` | 64x32 | final: attempt 2 plus the mandatory `free? in /29` qualification (label-correctness fix, not a new layout) |
| B | `attempts/v2b-upstream-lr.json` | 119x5 | rejected: wider than 77 columns |
| B | `attempts/v2b-upstream-lr2.json` | 102x5 | rejected: still wider than 77 columns |
| B | `attempts/v2b-upstream-tb-attempt3.json` = `specs/vB-upstream.json` | 22x29 | kept |

Check logs for every attempt: `attempts/check-logs/`.

## Cleanup

Every pane I created was split in my own tab (`w7E:tQ`) with `--no-focus` and closed by the
self-closing viewer command after `q`:

| Pane | Purpose | Closed (UTC) |
|---|---|---|
| `w7E:p36` | first view-A attempt (superseded flow variant) | 08:26:21 |
| `w7E:p3G` | second view-A run (static, unqualified spare label) | 08:26:54 |
| `w7E:p3Q` | final view A capture | 08:27:45 |
| `w7E:p41` | final view B capture | 08:28:34 |

`herdr pane list` after each quit shows only the agent pane `w7E:p2W` in the tab. Status: clean.
No pane was closed by hand, no pane leaked, the captain's tab was never used, and raw tmux was
never used.

## Not done here (by instruction)

The candidate skill's independent readability review was **not** run: this round reserves judging
for a separate Astra judge that the captain starts after this result arrives. No reviewer or judge
was spawned, and no pass verdict is claimed. Nothing was committed, built, installed, or edited
outside this case directory.

## Evidence index

- `specs/` — final specs (A, B)
- `attempts/` — every earlier spec plus `attempts/check-logs/` and superseded check logs
- `checks/` — full `--check` stdout, stderr and exit codes for the final specs
- `captures/commands.log` — chronological command/pane/timestamp log
- `captures/vA/`, `captures/vB/` — dimensions, pane layout, header wait, unselected and selected
  text + ANSI captures, animation frames, structural and colour check outputs
- `captures/superseded-vA-flow/` — captures of the animated view-A variant
- `captures/sha256-manifest.txt` — sha256 of every evidence file
- `tools/grid_check.py`, `tools/ansi_grid.py` — the structural and colour checkers used above
- `generation.json` — the same record in machine-readable form

# modal-runtime — round 02 generation

Worker `viz-ds02-modal-runtime` · model `fireworks/accounts/fireworks/routers/deepseek-flash-latest`
Candidate skill `docs/visualize-eval/rounds/02/SKILL.md` (sha256 `7d1ff098…b75d70`)
Renderer `/tmp/visualize-eval/round-02/bin/rataflow-view` (sha256 `ee085c0f…d640e8ea`)
Target viewport 77 × 47 at natural 100 % zoom.

Three views, three panes, all closed. Validator: 24/24 checks pass on every bundle.

| view | carries | extent | labels | dots |
|---|---|---|---|---|
| v1 overview | 8 components, all 8 relations, 5 group families | 46×37 | 8/8 placed, 0 on routes, 0 skipped | 8 single-dot routes, 0 violations |
| v2 RPC seams | e1, e2, e3, e8 with protocol-first labels | 34×21 | 4/4 placed | 4 single-dot routes, 0 violations |
| v3 execution + storage | e4, e5, e6, e7 with full action verbs | 46×21 | 4/4 placed | 4 single-dot routes, 0 violations |

Measured size in every capture: header token `77x47 @100%`; the `--frames` runs print
`viewport: 77x47 zoom: 1.00 natural`. No pan, no zoom-out.

## Meaning ledger (fates)

| fact | kind | fate |
|---|---|---|
| modal-worker, modal-runtime, Task engine, Container backend, Task container, Filesystem + volumes, Blobnet, modal-daemon | identifiers / residency | drawn (v1 always; v2 or v3 by region) |
| worker → runtime: task input + control RPCs | protocol + verb | abbreviated: `task+ctrl` (v1), `gRPC call` (v2) |
| runtime → worker: events + management RPCs | protocol + verb | abbreviated: `events+mgmt` (v1), `gRPC events` (v2) |
| runtime → engine: dispatches tasks | verb | abbreviated: `dispatches` (v1), `dispatch` (v2) |
| engine → backend: starts / manages | verb | drawn |
| backend → container: runs user process | verb + payload | drawn (v1 short form `runs user proc`) |
| engine → filesystem: mounts / snapshots | verb | drawn |
| filesystem → blobnet: image + volume data | payload | drawn (v1 short form `image+vol data`) |
| runtime → daemon: filesystem HTTP over UDS | protocol | drawn: `fs HTTP/UDS` (v1), `HTTP over UDS` (v2) |
| HTTP over UDS ≠ worker gRPC | qualifier | drawn — v2 leads every seam label with its protocol |
| worker ↔ runtime is two directed relations | direction | drawn — two routes, two arrowheads, two labels |
| provenance: go/Rust runtime source, chat lines 27–51 | provenance | dropped with reason — no annotation field; a citation node would invent a ninth component |
| "first launch a research agent…" | process instruction | dropped — not a relationship fact |
| "keep the diagram readable" | quality constraint | drawn — fits 77×47 with zero skipped labels |

## Relationship audit

| id | from → to | verb / tech | label owner | views |
|---|---|---|---|---|
| e1 | modal-worker → modal-runtime | task input + control RPCs (gRPC) | `task+ctrl` / `gRPC call` | v1, v2 |
| e2 | modal-runtime → modal-worker | events + management RPCs (gRPC) | `events+mgmt` / `gRPC events` | v1, v2 |
| e3 | modal-runtime → Task engine | dispatches tasks | `dispatches` / `dispatch` | v1, v2 |
| e4 | Task engine → Container backend | starts / manages | `starts/manages` | v1, v3 |
| e5 | Container backend → Task container | runs user process | `runs user proc` / `runs user process` | v1, v3 |
| e6 | Task engine → Filesystem + volumes | mounts / snapshots | `mounts/snapshots` | v1, v3 |
| e7 | Filesystem + volumes → Blobnet | image + volume data | `image+vol data` | v1, v3 |
| e8 | modal-runtime → modal-daemon | filesystem HTTP over UDS | `fs HTTP/UDS` / `HTTP over UDS` | v1, v2 |

Every label belongs to exactly one edge; no string is shared by two edges.

## Groups (concept, not geometry)

`client` modal-worker · `control` modal-runtime + Task engine · `host` modal-daemon ·
`compute` Container backend + Task container · `storage` Filesystem + volumes + Blobnet.
Five families, each from a split the source itself makes.

## Capabilities used and refused

- `group` — used in all three views.
- `dots: 1` — used on every edge; the frames capture shows exactly one live dot per route in
  all five timestamped frames (v1: 8,8,8,8,8 · v2: 4,4,4,4,4 · v3: 4,4,4,4,4) with the dot
  cells moving on every 100 ms step.
- `style: "dashed"` — **not used.** The brief's Fixed constraints confirm all eight relations
  and mark none unconfirmed. Dashed on a confirmed link would invent uncertainty; the uniform
  historical provenance is recorded here instead.
- `trunks` — **not used.** The only multi-way split is engine → backend / engine → filesystem,
  which is two independent relations, not one bus with branches. Declaring a trunk there would
  fake a fifty-fifty split, which the skill forbids. `--check` reports `trunks:` empty.
- `--select-all` — captured per view (`*-selected.ansi`).
- `--frames 5 --step-ms 100` — captured per view (`*-frames.txt`, `*-frames.ansi`).

## Attempts

`attempts.json` records 3 / 3 / 1 spec attempts for v1 / v2 / v3, none over budget.

- v1: auto-layout attempt measured 106×32 (over 77 columns) → explicit `layers` attempt skipped
  1 label → final at 46×37, 8/8 labels.
- v2: tb with full phrases skipped 2 labels (parallel worker↔runtime corridors leave no clear
  run) → lr placed all four but measured 102×13 (over 77 columns) → final tb with
  protocol-first short labels at 34×21.
- v3: first attempt clean, promoted unchanged.

Geometry probes of the frozen binary (2–4 node throwaway specs in `/tmp/vizprobe`, never
captured) measured label capacity before composing views; they are not candidate views.

## Known defects (reported, not hidden)

1. Full seam phrases (`task input + control RPCs`, 25 characters) never fit beside the two
   parallel worker↔runtime corridors at 77 columns; a wider label is skipped and the harness
   rejects a skipped label. Meaning is carried jointly by v1 (action) and v2 (protocol) and
   spelled out above.
2. In v1/v2 the `dispatches` / `dispatch` label sits close to the `fs HTTP/UDS` label run on the
   same rows. `--check` reports 0 labels on route cells; the routes stay distinguishable by
   their arrowheads (Task engine vs modal-daemon).
3. The worker↔runtime corridors run two columns apart, so direction is proven by arrowheads
   (into modal-worker and into modal-runtime), not by physical separation.

## Blockers

- **No on-canvas provenance/legend annotation.** No spec field exists, so the "historical,
  chat lines 27–51" qualifier cannot appear in the pane. Nothing was faked; the qualifier lives
  in `generation.json` and in this file.

## Cleanup

| view | pane | close |
|---|---|---|
| v1 | `w7E:p6Z` | confirmed_closed |
| v2 | `w7E:p60` | confirmed_closed |
| v3 | `w7E:p71` | confirmed_closed |

`herdr pane list` after the captures shows none of those pane ids. Each was a no-focus right
split at ratio 0.5 of the worker's own pane (159×49), leaving 77×47 inside the app border. No
pane in another tab or workspace was touched.

## Review

Not run. The generator contract forbids spawning a reviewer; the captain starts a separate Sol
judge. Nothing here is claimed green.

## Files

- `specs/v1.json`, `specs/v2.json`, `specs/v3.json` (final), `specs/v*.attempt*.json` (rejected)
- `attempts.json`, `generation.json`, `generation.md`
- `evidence/v{1,2,3}/`: `manifest.json`, `bin.sha256`, `check.txt`, `<view>-text.txt`,
  `<view>-ansi.ansi`, `<view>-selected.ansi`, `<view>-frames.txt`, `<view>-frames.ansi`,
  `validate.txt`

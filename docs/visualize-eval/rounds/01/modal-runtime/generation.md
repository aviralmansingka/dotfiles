# modal-runtime — round 01 generation report

Fresh DeepSeek generation. This replaces the user-cancelled Astra generation round; no
artifact from that round was read or reused. Output is **not** self-certified as a pass and
no judge was spawned — the captain owns the Astra judges.

## Identity and inputs

| Field | Value |
|---|---|
| Generator | `viz-ds01-modal-runtime` (subagent `2cc07bfe`) in its own herdr tab `w7E:tP` |
| Model | `fireworks/accounts/fireworks/routers/deepseek-flash-latest` (provider `fireworks`, reasoning `high`) |
| Session | `01a19b5b-dfbc-769c-9d57-59cbe78d41e5` |
| Candidate skill | `rounds/01/SKILL.md`, sha256 `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92` (re-hashed on disk, matches the frozen value; the installed copy was not used) |
| Renderer | `/tmp/visualize-eval/round-01/bin/rataflow-view`, sha256 `4a883e73b822f009c504bd21d0c2fc383067bf1b83b9791ccbda431912e3a1d8` (matches frozen value; no build, no install, global binary untouched) |
| Case source | `cases/modal-runtime/source.md` only |
| Viewport | **77 columns × 47 rows**, measured with `stty size` inside each viewer pane (every pane reported `47 77`) — target met |
| Split | `herdr pane split --current --direction right --ratio 0.5 --cwd <case> --no-focus` → 79×49 pane rect, 77×47 tty |
| Pan / zoom | never used; no `f`, no scroll, no drag in any capture |

## Views

| # | View | Spec | Nodes/edges | `--check` | Extent | Pane |
|---|---|---|---|---|---|---|
| 1 | overview | `spec/overview.json` (sha `e6fdb516…`) | 8 / 8 | exit 0, no warnings | 64×38 | `w7E:p2Z` |
| 2 | seams (worker ↔ runtime gRPC, runtime → daemon UDS) | `spec/seams.json` (sha `f0d0da4a…`) | 4 / 4 | exit 0, no warnings | 33×21 | `w7E:p3N` |
| 3 | execution (engine → backend/container, engine → filesystem/blobnet) | `spec/execution.json` (sha `1e3d23a2…`) | 5 / 4 | exit 0, no warnings | 46×21 | `w7E:p3S` |

Each `--check` printed exactly:

```
ok: nodes=8 edges=8 flows=0 direction=tb theme=gruvbox
layers=5 (explicit placement, sugiyama skipped)
extent=64x38 cells
```

and the analogous three lines for the other two views. Stderr was empty for every run
(`*.err` hashes equal the empty-string hash) and every exit code was `0`. No
density, shared-corridor or dropped-label warning was produced, and no
`graph overflows` badge appears in any capture.

Captures per view (all in `captures/`): `text.none`, `ansi.none`, `text.sel-tab`,
`ansi.sel-tab`, `text.sel-right`, `ansi.sel-right`. Selection is expressed **only** as a
border-colour change, so the three plain-text captures are byte-identical; the ANSI
captures differ and are the proof of the selected state.

Measured render facts (`evidence/*.ansi-analysis.txt`, `evidence/*.trace.txt`):

- **overview** — 8 boxes, 4 rows tall each, four complete sides, exactly one border colour
  per box: worker `#d8a657`, runtime `#7daea3`, engine `#d3869b`, backend `#a9b665`,
  filesystem `#bdc97c`, daemon `#8f9d4f` (same green family), container `#7da0b8`,
  blobnet `#97b8ce` (same blue family). 8 arrowheads for 8 edges (7 `▼`, 1 `◀`), each one
  cell above (or beside) its target border. 0 dots. Control palette occupies lines 41–46,
  cols 2–10; the nearest box starts at col 34, so nothing is covered.
- **seams** — 4 boxes / 4 arrowheads (3 `▼`, 1 `◀`); daemon `#d3869b` and engine `#e29caf`
  share the layer-3 pink family.
- **execution** — 5 boxes / 4 `▼`; backend `#7daea3` + filesystem `#93c2b7` share the teal
  family, container `#d3869b` + blobnet `#e29caf` the pink family.

No `●` sits on a border and no arrow glyph touches a word in any final capture.

## Relationship coverage

The overview carries all eight components and all eight directed relations. The two detail
views give the crowded seams their own space; nothing is dropped, reversed, or relabelled.
Traces below are 1-based line/col in the corresponding `captures/<view>.text.none.txt`.

| # | Relation (brief) | Label | Visible in | Trace |
|---|---|---|---|---|
| R1 | worker → runtime: task input + control RPCs | `control gRPC` | overview, seams | overview: port col 12 → `▼` line 13 col 11 → runtime top. seams: port col 25 → `▼` line 22 col 24. |
| R2 | runtime → worker: events + management RPCs | `events gRPC` | overview, seams | overview: runtime right stem line 15 → up col 26 → `◀` line 7 col 25. seams: stem line 24 → up col 39 → `◀` line 16 col 38. |
| R3 | runtime → engine: dispatches tasks | `task dispatch` | overview, seams | overview: port col 11 → jog line 20 → `▼` line 21 col 12. seams: port col 26 → right to col 43 → `▼` line 30 col 43. |
| R4 | engine → backend: starts / manages | `starts/manages` | overview, execution | overview: port col 12 → left to col 9 → `▼` line 30 col 9. execution: port col 21 → left to col 18 → `▼` line 22 col 18. |
| R5 | backend → container: runs user process | `runs process` | overview, execution | overview: port col 9 → right to col 35 → `▼` line 38 col 35. execution: port col 18 → right to col 20 → `▼` line 30 col 20. |
| R6 | engine → filesystem: mounts / snapshots | `mount/snapshot` | overview, execution | overview: port col 14 → right to col 32 → `▼` line 30 col 32. execution: port col 23 → right to col 40 → `▼` line 22 col 40. |
| R7 | filesystem → blobnet: image + volume data | `image/vol data` | overview, execution | overview: port col 31 → right to col 60 → `▼` line 38 col 61. execution: port col 40 → right to col 47 → `▼` line 30 col 48. |
| R8 | runtime → daemon: filesystem HTTP over UDS | `fs HTTP over UDS` | overview, seams | overview: port col 13 → right along line 19 to col 58 → `▼` line 30 col 58. seams: port col 24 → `▼` line 30 col 25. |

Deliberate abstractions: (a) `modal-daemon` sits in the storage layer because its only
relation is `runtime → daemon`; layer position says "adjacent to storage", not
co-location. (b) Edge labels are shortened to fit label slots — `control gRPC`
(task input + control RPCs), `events gRPC` (events + management RPCs), `task dispatch`,
`starts/manages`, `runs process`, `mount/snapshot`, `image/vol data`, `fs HTTP over UDS`.
`fs HTTP over UDS` keeps HTTP and the Unix-domain socket explicit, so the daemon interface
is never conflated with the worker gRPC seams.

## Attempts (per view, ≤3)

| View | File | Outcome |
|---|---|---|
| overview | `attempts/overview.v1.json` | **promoted**; clean check, rendered |
| overview | `attempts/overview.v2.json` | rejected — edge order swapped to try to split the two RPC labels; render byte-identical |
| seams | `attempts/seams.v1.json` | superseded — label `fs HTTP over UDS` began on an arrowhead glyph (`▼fs HTTP over UDS ▼`) |
| seams | `attempts/seams.v2.json` | rejected on extent only, never rendered — `lr` separated the pair but measured 81×13, wider than the 77-column pane |
| seams | `attempts/seams.v3.json` | **promoted**; layer 3 ordered `[daemon, engine]`, labels off the arrowheads |
| execution | `attempts/execution.v1.json` | **promoted**; clean check, rendered |
| execution | `attempts/execution.v2.json` | equivalent alternative (layers swapped); not promoted |

## Remaining defects

1. **D1 (overview, seams)** — the two RPC labels share one row: overview line 11 reads
   `│ control gRPC│ events gRPC`. Each label sits right of its own stem, so attribution is
   correct, but the neighbouring bar can look like a delimiter. v2 reorder and `lr` both
   failed to remove it.
2. **D2 (overview, execution)** — `starts/manages` prints on the arrowhead row between the
   backend and filesystem arrowheads. It belongs to engine → backend (the left arrow).
3. **D3 (overview)** — worker → runtime enters runtime's top at col 11, the same column
   where runtime's stem toward engine leaves the bottom (col 11, jogging to col 12). The
   `▼` on line 13 terminates the inbound edge; the out-stem is labelled `task dispatch`.
4. **D4 (seams)** — `fs HTTP over UDS` ends flush against the engine corridor (`UDS│`). The
   label starts at the daemon corner it descends from.
5. **D5 (all views, cosmetic)** — the viewer's own header is longer than 77 columns and is
   clipped mid-word (`… drag pan · scr`). Chrome only; no diagram content is clipped.
6. **D6 (all views, observation)** — selection shows only as a border-colour change to the
   accent `#d8a657`, which is also layer 1's hue in gruvbox. Provable from ANSI captures,
   invisible in plain text. Renderer/theme behaviour, not spec.

Blockers: none. No renderer feature was missing or invented.

Unmet needs: the spec exposes no label-placement control, so D1/D2/D4 cannot be resolved
further without moving boxes and changing the intended reading order. The source requests
no animation, so all views keep `0 flows` and no frame series exists (the pane is still
interactive: drag, pan, zoom, `f` fit, Tab/arrows, `q`).

## Evidence and cleanup

- `evidence/commands.md` — exact commands, per-view sequences and the ordering caveat about
  the renamed `seams-v1` capture set (the seams v1 pane ran `spec/seams.json` while that
  path still held v1 content).
- `evidence/*.split.json`, `evidence/*.launch-cmd.txt`, `evidence/*.timeline.txt`,
  `evidence/*.tty-size.txt` — pane ids, launch commands, UTC timestamps, tty sizes.
- `evidence/*.trace.txt`, `evidence/*.ansi-analysis.txt` — box rects, border colours,
  arrowhead coordinates, dot and overflow checks.
- `evidence/manifest.tsv` — path, UTC mtime, bytes, sha256 for every artifact.
- `evidence/spec-hashes.txt`, and `evidence.final_spec_sha256` inside `generation.json`.

Cleanup: seven viewer panes were created (`w7E:p2Z`, `p39`, `p3F`, `p3K`, `p3N`, `p3S`,
`p3W`), each launched with the skill's self-closing `… ; herdr pane close <pane>` command
and each quit with `q`, after which `herdr pane get` returned `pane_not_found`. No manual
close was needed and no cleanup failed. Tab `w7E:tP` now holds only the generator's own
pane `w7E:p2V`; no other agent's pane was touched.

# modal-runtime — round 00 generation

## Scope and qualification

Three fresh focused views preserve all **8 components and 8 directed relationships** from `docs/visualize-eval/cases/modal-runtime/source.md`. These are **historical source claims**, not verified current runtime architecture. No machine-manager relationships, invented RPC method names, or remote verification were added. HTTP over Unix-domain sockets remains distinct from worker gRPC.

Evidence used: the supplied excerpts of original chat lines **5, 12, 55**, and the relationship list in the source brief. The brief references Go/Rust source findings at lines **27–51**, but those findings were not independently read or verified. Original session pointer:

`/Users/aviral/.pi/agent/sessions/--Users-aviral-.herdr-worktrees-modal-learn-runtime-arch--/2026-10-14T20-36-14-065Z_01a13c21-3e70-754d-a101-f5817da3e05a.jsonl`

Original graph call at line 55: `call_KfPSNBd2yyDv7opUAXFM86v8|fc_0bc8bde248d91e7d016acfe9bb22b087d0a1ac21927a3569fb`. The original session file was not opened. No other rounds, expected layouts, historical variants, generated cases, or renderer source were read.

## Views and execution

| View | Contents | Actual columns × rows | Extent | Spec attempts | Final check |
|---|---|---:|---:|---:|---|
| `interfaces/` | Worker RPC directions and daemon filesystem interface | 77 × 47 | 34 × 19 | 2 | Exit 0; no warnings |
| `execution/` | Runtime, task engine, backend, task container | 77 × 47 | 40 × 26 | 1 | Exit 0; no warnings |
| `storage/` | Task engine, filesystem/volumes, Blobnet | 77 × 47 | 36 × 19 | 1 | Exit 0; no warnings |

Each directory contains `spec.json`, `check.txt`, `dimensions.txt`, `visible.txt`, `visible.ansi`, `selected.txt`, and `selected.ansi`. `dimensions.txt` is direct `stty size` output in **rows columns** order, taken inside that viewer pane before launching the frozen binary. These measurements match the target; they are not assumed dimensions.

`generation.json` records exact final execution commands, their UTC start/end timestamps, stdout, stderr, exit codes, pane IDs, capture timestamps, evidence SHA256 hashes, and explicit relation coverage. `check.txt` separately preserves stdout, stderr, and exit. Final timestamped captures replace the initial capture batch after the execution-evidence clarification.

All views opened sequentially via `pane split --current --direction right --ratio 0.5 --no-focus` in the generator's own tab **w7E:tF**. The final panes were **w7E:p1X**, **w7E:p1Y**, and **w7E:p1Z**. Headers were verified before capture. No pan, fit, or zoom commands were sent: captures use natural initial zoom 1. Tab then selected a node for the second text/ANSI pair, and q exited each app, invoking its trailing pane-close command. Earlier owned panes were also closed. No captain pane was touched.

No animation is required by this case; specs contain zero flows, so no animation phases are claimed. Selected-state captures are not presented as animation evidence. ANSI changed across the selected node's four rows: daemon in interfaces, backend in execution, Blobnet in storage. Text remained unchanged, as expected for a color/bold selection change.

## Relationship coverage and label expansions

| Original relationship | View | Spec relationship label |
|---|---|---|
| modal-worker → modal-runtime: task input + control RPCs | interfaces | `gRPC in+ctrl` |
| modal-runtime → modal-worker: events + management RPCs | interfaces | `gRPC evt+mgmt` |
| modal-runtime → Task engine: dispatches tasks | execution | `dispatch tasks` |
| Task engine → Container backend: starts / manages | execution | `start/manage` |
| Container backend → Task container: runs user process | execution | `run user proc` |
| Task engine → Filesystem + volumes: mounts / snapshots | storage | `mount/snapshot` |
| Filesystem + volumes → Blobnet: image + volume data | storage | `image+vol data` |
| modal-runtime → modal-daemon: filesystem HTTP over UDS | interfaces | `fs HTTP/UDS` |

Abbreviations: **in** = task input; **ctrl** = control; **evt** = events; **mgmt** = management; **proc** = process; **vol** = volume; **fs** = filesystem; **UDS** = Unix-domain sockets. These are compact relationship labels, not claims about specific RPC methods. Runtime and task engine are repeated across views only as shared anchors. `full-spec.json` is an archival union of all eight directed relations, not a fourth displayed/check-qualified view.

## Attempts and unresolved defects

Interfaces attempt 1 used an aligned worker/runtime stack and produced one skipped-label warning. Attempt 2 offset worker and runtime, retaining every edge and relationship label, and cleared that warning. The other views used one attempt each. No indefinite optimization or renderer changes occurred.

The final checks are clean, but that is **not a visual approval**:

- **Missing arrowheads on all eight relationships.** Text and ANSI captures show continuous routes meeting borders but no visible target arrowheads. This affects worker → runtime, runtime → worker, runtime → daemon, runtime → engine, engine → backend, backend → container, engine → filesystem, and filesystem → Blobnet. In particular, the reciprocal worker paths do not communicate their two directions unambiguously without consulting the spec.
- **Border-color defects.** Each box has muted gray horizontal cells interrupting its layer-colored top/bottom borders: 6 cells in interfaces, 8 in execution, and 6 in storage. The selected daemon capture also shows gray handle cells interrupting the otherwise bold accent border. Selection evidence is saved rather than inferred from plain text.
- Complete node boxes and relationship labels appear within each measured 77 × 47 pane, with the control palette clear of the graph and no overflow badge. These observations do not repair missing direction cues or establish independent approval.

The frozen renderer supplies the graph primitives, but the arrowhead and uniform-border requirements remain unmet in actual output. No missing capability was fabricated. The best honest output is preserved for the captain's separate Astra review. The generator did not launch a reviewer or mark the result green.

## Frozen inputs

- Candidate skill: `docs/visualize-eval/rounds/00/SKILL.md`
- Candidate SHA256: `9c5cea272a88300644cacda52c853c7c9169eeec91f0355d3460ee8741308d92`
- Renderer used for every check and viewer invocation: `/tmp/visualize-eval/round-00/bin/rataflow-view`
- Renderer SHA256: `b6e11b05b4fb79ce969dc2646c667572535a949bd1a396fd711e1a5466298c8f`

Both hashes were verified before generation. No build, install, commit, remote command, or modification outside this assigned case output directory was performed.

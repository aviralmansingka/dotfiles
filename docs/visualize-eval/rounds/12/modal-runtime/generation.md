# modal-runtime — round 12 generation (viz-ds12-7c)

Targeted rerun of round 11, whose two views were judged detail-losing. Frozen inputs:
skill `docs/visualize-eval/rounds/12/SKILL.md` (sha256 `44935981…`), renderer
`/tmp/visualize-eval/round-10/bin/rataflow-view` (sha256 `db70722b…`), target 77×47 at
natural 100% zoom. Generator model: `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.

## Step 0 — shape

```
family: service-meshes
evidence: one core (modal-runtime) carries a fan of three out-relations (dispatches tasks,
          fs HTTP over UDS, events + management RPCs) plus an anti-parallel pair
          worker -> runtime / runtime -> worker stated as two distinct relations.
```

Tie-breakers: `E = N` (8/8) invites flow-chains, but the fan plus the anti-parallel pair make
one core, so density wins over depth. No source-named bus and one connected component, so not
placement-planes. No addresses/ports/uncertainty markers, so not identity-probe-maps. No
redundant parallel links, so not a fabric. Secondary recipe borrowed: identity-probe-map habit of
giving every interface qualifier its own ledger row and named view — this case's fixed constraint
turns on keeping worker gRPC distinct from filesystem HTTP-over-UDS.

## Views shipped

| view | carries | nodes | edges | direction | extent | check |
|---|---|---|---|---|---|---|
| **v1 worker seam** | pair + dispatch | 3 | 3 | lr | 57×11 | 0 bridges, 0 ambiguous, 3/3 labels |
| **v2 execution + storage** | fs seam + both chains | 7 | 5 | tb | 58×21 | 0 bridges, 0 ambiguous, 5/5 labels |

Total coverage: 8/8 nodes, 8/8 relations, no dropped fact, no invented link. Static case (no
source motion), so no dots; frames captures show time passing and nothing moving.

Density vs round 11: the pair-picture now carries the pair **and** the dispatch relation (3
edges, was 2); the second picture carries the filesystem seam **and** all four execution/storage
relations (5 edges, was 2). Together 8 relations across two views where round 11 shipped 4.

## Structural levers (each with its source fact)

- **v1 `direction: lr`** — the two gRPC directions are two horizontal lanes, readable as a pair;
  in `tb` they stack into the fan gutter and their labels tie (measured in the whole-graph probes
  a3/a4/a5).
- **v1 `label_slot` on e1, e2** — the two longest labels (22 and 18 characters) get reserved
  side gutters so each text has exactly one owner. Without it e1's label ties at one cell with
  the dispatch route (`v1-1`: 1 ambiguous owner).
- **v1 groups `worker-plane` / `orchestration`** — source separates the worker from the runtime +
  task engine; different hue families, nothing drawn around members.
- **v2 `direction: tb`** — the two chains run away from Task engine; `lr` measured 104×14
  (`v2-1`, over width), `tb` spends height and keeps the boxes under 58 columns.
- **v2 `label_slot` on all five edges** — reserved gutters cut 58×55 (`v2-2`, every label in a
  rank gap) to 58×21 without changing a word.
- **v2 groups `orchestration` / `worker-plane` / `compute` / `storage`** — the source's own four
  concerns; one stable sibling order across both views.

No `trunks` (no shared bus in the source), no `layers` (no source-stated tiers to pin), no
`minlen` in the shipped specs.

## Recipe yield (why two views, not one)

The round-12 order is to build the densest view that fits 77×47 — pair + fan + seam together
when they fit. Measured, every attempt is recorded in `attempts-log.jsonl`:

| shape | attempts | best measured | blocker |
|---|---|---|---|
| whole graph 8n/8e | `v1-a1`…`v1-a5` | 56×47 (`a5`) | 2 ambiguous label owners in the fan gutter at every room setting |
| pair+fan+seam 4n/4e | `seams-1`…`seams-6` | 76×27 (`seams-4`) | 2 ambiguous, or 2 bridges, or a label clipped at the pane edge |
| pair+dispatch+seam 4n/4e | `v1-3` | 57×15 | 2 bridges + 1 ambiguous (daemon lane crosses the pair lanes) |

Fan lanes sit two cells apart, so a label placed beside any lane is measurably closer to its
neighbour's lane; the only clean home is a reserved gutter band, and the band-drop pass releases
bands as soon as a route fails. The recipe therefore yields: the pair keeps its own view, and the
third fan edge joins the execution/storage picture. Closest shipped numbers: 3 edges + 5 edges,
all eight relations, zero bridges, zero ambiguous owners.

## Ledger and audit

Full tables in `generation.json` (`meaning_ledger`, `relationship_audit`,
`original_to_view_mapping`). Headline rows:

- `worker -> runtime` = task input + control RPCs **over gRPC** → v1 `task input + ctrl gRPC`
  (the round-11 loss this rerun repairs; the token `gRPC` is on both pair labels).
- `runtime -> worker` = events + management RPCs over gRPC → v1 `events + mgmt gRPC`.
- `runtime -> engine` dispatches tasks → v1 `dispatch tasks`.
- `runtime -> daemon` filesystem HTTP over UDS → v2 `fs HTTP over UDS`, kept on its own lane and
  its own view so the two interfaces never read as one.
- `engine -> backend` starts / manages, `engine -> filesystem` mounts / snapshots,
  `backend -> container` runs user process, `filesystem -> blobnet` image + volume data → v2.
- Historical status of the whole graph (original chat line 55) is carried here, not as invented
  dashed edges: the brief states no per-link uncertainty.

Abbreviations: `ctrl` = control, `mgmt` = management, `fs` = filesystem, `vols` = volumes,
`dispatch tasks` = the source verb "dispatches tasks" with tense normalised.

## Evidence

- `specs/v1.json`, `specs/v2.json` — shipped specs; every earlier candidate kept beside them.
- `evidence/v1/`, `evidence/v2/` — check output, plain text, ANSI, `--select-all` ANSI, four
  timestamped frames, pinned `COLUMNS=77 LINES=47` dump of that view's final spec, manifest with
  binary path/sha256, pane id, and `cleanup: confirmed_closed`, plus `validator.txt`.
- `attempts.json` — per-view attempts (≤3 each) and `abandoned_shapes` for the three shapes that
  did not ship, each with its record label and measured numbers.
- `attempts-log.jsonl` + `recorded/` — 18 wrapped `--check` records, raw stdout/stderr with
  sha256s, command, exit status and the spec snapshot hash.

Pane measurements: Herdr panes came up at 83×51 (bigger than target). Fit proof is the pinned
77×47 natural-zoom dump of each view's final spec, with no overflow banner (PINNED RULING).

## Validator

Both bundles pass every check (`evidence/v1/validator.txt`, `evidence/v2/validator.txt`):

```
scripts/viz-validate.py docs/visualize-eval/rounds/12/modal-runtime/evidence/v1 \
  --require-select --require-frames --require-records \
  --attempts docs/visualize-eval/rounds/12/modal-runtime/attempts.json
… all checks passed   (same for v2)
```

33 PASS / 0 FAIL per view, including `labels_ownership_clear`, `labels_not_skipped`,
`crossings_reported`, `viewport_matches_target` (pinned dump) and `attempts_records_complete`.

## Known defects

- v1 carries 3 of 8 relations; the runtime fan is split across views (yield above).
- Node label `Filesystem + vols` abbreviates "volumes".
- Edge verb `dispatch tasks` normalises the source's "dispatches tasks".
- In v2 two labels end flush against their arrowhead (`mounts / snapshots▼`,
  `runs user process▼`) — cosmetic; 0 labels on route cells, 0 ambiguous owners.

## Blockers

None. No renderer, skill, rubric or other case was touched; no commits, installs or cargo.
Review was not run by the generator (the captain starts the terra judge separately).

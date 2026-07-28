# Atlas Run Overview Timeline Scout Sketch

Disposable visual exploration for **Align Atlas Run Overviews With The Pi Activity Timeline**. This path is not a
production package, verifier route, Registry-v2 fixture, or accepted `atlas/v1` contract. The later user-selected
direction is owned by [`../atlas-picker-run-status/README.md`](../atlas-picker-run-status/README.md).

## Reproduce

```bash
cd prototypes/atlas-run-overview-timeline
go run . --out frames --check
find frames -type f -maxdepth 1 -print | sort | xargs shasum -a 256 > SHA256SUMS
```

The generator uses only the Go standard library. `fixtures.json` is a bespoke presentation sketch. It deliberately does
not parse prose/detail JSON, but its `Run`, `Goal`, and `Event` shapes are **not** existing Registry-v2 or accepted T18
envelopes. Canonical-looking Goal, gate, and Run-state values therefore illustrate desired density only; they do not
prove current hydration or authority.

## What the artifacts prove

Each surface has matching `.ansi` and `.txt` output under `frames/`:

- `compare-rail-led-{80x24,100x30}` — compact single rail;
- `compare-goal-preview-{80x24,100x30}` — Goal selection plus selected-Goal preview;
- `state-matrix-80x24` — visual treatment for six candidate Run conditions;
- `all-runs-selected-preview-100x30` — selected Run in a browser sketch;
- `expanded-board-120x32` — timeline, selected context, and evidence area;
- `execution-journal-100x30` — retirement and literal unknown-value treatment;
- `sidekick-44x12` — narrow-density sketch.

`SHA256SUMS` identifies every frame. The self-check proves deterministic generation, dimensions, accepted-SGR stripping,
and matching no-color bytes. It does **not** prove compatibility with Registry-v2, T18, current Atlas renderers,
interactive behavior, sanitization, or canonical ownership.

## Independent review disposition

The first comparison is directionally useful but does not settle the compact IA:

- the rail receives every candidate event plus summary rows;
- the Goal preview filters to G02 and does not demonstrate alternate selection;
- overflow, omission, empty state, and constrained density are not exercised;
- the rail labels five rendered milestones rather than claiming six durable stages after review correction;
- current Pi Activity and No Mistakes references were inspected in source, but no matching captured reference frame is
  included here.

This comparison did not settle the compact IA. The later picker prototype linked above records the selected mini-journey
direction and its current contract.

## Candidate semantic hierarchy

This hierarchy is proposed for later validation, not claimed as currently hydrated:

### Candidate top-level rows

1. ordered durable stage or Goal state;
2. current or terminal verifier attempt;
3. explicit recorded verifier decision;
4. explicit human gate, if T18 defines one;
5. retirement;
6. worker milestone only with typed Goal/stage association.

A passed attempt is not accepted evidence. The failed-Run board now says `V01 passed · decision unavailable` unless an
explicit decision exists.

### Candidate nested detail

Latest typed attempt outcome, decision identity, worker/participant role, Evidence identity, and valid timing.
Actor/source identity must remain literal; a producer or actor named `parent` does not by itself grant canonical
authority.

### Candidate summary and expanded detail

Participant/verifier/Evidence/Usage counts may appear in headers when hydrated. Commands, diagnostics, trees, hashes,
artifacts, participant identities, auditor rationale, telemetry, raw sanitized typed fields, and complete chronology
remain expanded-only.

Unknown typed values stay literal with `?`. Missing hydration says unavailable; it never becomes inferred state.

## Timing boundary

- Terminal duration requires validated `started_at` and `finished_at`.
- Point chronology uses `observed_at` only; the renderer no longer substitutes `started_at` for a missing observation
  timestamp.
- Static snapshots never tick from local wall time.
- Active elapsed remains unresolved until T18 defines a recorded snapshot/as-of bound. Without one, it is unavailable.
- Observation gaps are chronology, never execution duration.

## Pi and No Mistakes boundary

Pi Activity is prompt-scoped and summarizes transient thinking/tool calls. No Mistakes is pipeline-scoped and displays
phases controlled by No Mistakes. Vault Hunter Runs are durable observations across participants, attempts, decisions,
delivery, retirement, and restarts.

Atlas may reuse rail geometry, spacing, truncation, and Gruvbox roles. It must not copy prompt ownership, thinking/tool
rows, pipeline completion, or transient timing into Run semantics.

## Palette correction

The ANSI sketch uses T11's accepted active/in-progress foreground `#e9b143`, not `#fabd2f`. Accepted evidence uses `●`;
`◆` remains reserved for retirement in this sketch. Selection emphasis is exercised by the later picker prototype linked
above.

## Disposition

This initial exploration is retained only to reproduce its comparison artifacts. The later picker prototype linked above
owns the selected direction; neither prototype changes production Atlas behavior or claims canonical Task authority.

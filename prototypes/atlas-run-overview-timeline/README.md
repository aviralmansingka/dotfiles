# Atlas Run Overview Timeline Scout Prototype

Disposable design evidence for the Issue **Align Atlas Run Overviews With The Pi Activity Timeline**. This path is not a production package or verifier route.

## Reproduce

```bash
cd prototypes/atlas-run-overview-timeline
go run . --out frames --check
find frames -type f -maxdepth 1 -print | sort | xargs shasum -a 256 > SHA256SUMS
```

The generator uses only the Go standard library. `fixtures.json` is frozen, typed prototype input; no renderer parses prose or detail JSON to invent structure.

## Artifacts

Each surface has matching `.ansi` and `.txt` output under `frames/`:

- `compare-rail-led-{80x24,100x30}` — compact single rail;
- `compare-goal-preview-{80x24,100x30}` — Goal selection plus selected-Goal preview;
- `state-matrix-80x24` — active, failed, completed, retired, missing-time, and unknown-state Runs;
- `all-runs-selected-preview-100x30` — selected Run in the all-Runs browser;
- `expanded-board-120x32` — timeline, selected context, and evidence/gates;
- `execution-journal-100x30` — faithful chronology, retirement, and literal unknown values;
- `sidekick-44x12` — narrow selected-participant density.

`SHA256SUMS` identifies every frame. The self-check rejects unaccepted SGR, proves accepted-SGR stripping is byte-for-byte equal to the no-color frame, checks dimensions, and asserts identity, selection, state, evidence, parent-gate, unknown-value, and timing semantics.

## Compact IA decision

Choose the **single rail-led timeline** for direct compact Atlas and selected-Run previews.

At `80×24`, the rail keeps Run/Task identity, current stage and Goal, accepted V01, active G02, the pending human merge gate, source labels, evidence summary, and honest timing in one scan. The Goal-selection alternative spends 31 columns on a duplicate Goal index and shows only G02's local event. It hides admission and the accepted parent decision unless the operator changes selection. At `100×30` it gains breathing room but not more global meaning.

Goal selection remains useful as navigation in expanded views. It should not be the primary compact information architecture.

## Semantic projection

### Top-level milestone rows

Use only hydrated typed fields for:

1. ordered durable stage or Goal state;
2. current or terminal verifier attempts;
3. explicit parent decisions;
4. explicit human gates;
5. retirement;
6. a current durable worker milestone only when Atlas exposes its typed Goal/stage association.

The compact rail is a milestone projection, not the faithful observation journal. It does not render every Registry observation.

### Nested detail

Nest the latest typed attempt outcome, decision summary, worker/participant role, evidence identity, and valid timing under its milestone. Label source classes as `recorded observation`, `parent decision`, `human gate`, or `live Herdr`. Never merge live Herdr status into recorded lifecycle state.

### Summary only

Participant active/total counts, verifier passed/pending/failed counts, Evidence count/state, and bounded Usage belong in headers or summary rows when hydrated.

### Expanded only

Commands, exit diagnostics, trees, hashes, artifacts, complete participant identities, auditor rationale, telemetry, raw sanitized typed fields, and full observation chronology remain in the Operations Board or Execution Journal.

Unknown typed values stay literal with `?`. Missing hydration says `unavailable` or `none recorded`; it never becomes inferred state.

## Density rules

- **Sidekick / narrow:** Run identity, recorded Run state/stage, active Goal, verifier summary, parent/human gate, and timing availability. No raw journey or participant roster.
- **80×24 compact:** one bounded milestone rail plus evidence and gate summary. Omit older settled detail before current or gate rows; disclose omission count.
- **100×30 compact / browser preview:** same semantics with one nested detail per visible milestone.
- **Expanded board:** rail plus selected typed context and evidence/gates. Goal selection is navigation here.
- **Execution Journal:** complete faithful chronology with source/type labels and selected cards. Density changes viewport, never meaning or ordering.

Selection uses a visible `▶`; state uses `◉` active, `●` successful/accepted/completed, `×` failed/rejected/blocked, `○` pending, `◆` retired, and `?` unknown. Color supplements these labels and glyphs.

## Timing decision

- Terminal duration requires validated `started_at` and `finished_at`.
- Active elapsed may use only `started_at` and the complete envelope's recorded snapshot/as-of timestamp, and updates only when a new complete envelope arrives.
- Static snapshots never tick from local wall time.
- Missing or invalid bounds render `time unavailable`.
- `observed_at` gaps remain chronology and are never execution duration.

The prototype intentionally shows unavailable active timing because its fixture has no typed snapshot/as-of bound.

## Pi and No Mistakes boundary

Pi Activity is prompt-scoped: every user prompt creates a fresh Activity, and rows summarize transient thinking/tool calls. No Mistakes is pipeline-scoped: its nine ordered phases are controlled by No Mistakes and polled by a read-only Pi widget.

Vault Hunter is different. Its Run is durable and observational across participants, verifier attempts, parent decisions, human gates, delivery, retirement, and restarts. Atlas may reuse rail geometry, spacing, truncation, glyphs, and Gruvbox roles, but it must not copy prompt ownership, thinking/tool rows, pipeline completion, or transient tool-call timing into Run semantics.

## Gruvbox Material roles exercised

The ANSI frames use accepted foreground/reset SGR only: bright `#fbf1c7`, accent `#f28534`, text `#ebdbb2`, warning `#fabd2f`, success `#b8bb26`, info `#80aa9e`, special `#d3869b`, error `#f2594b`, muted `#928374`, and dim `#665c54`. No-color output carries all state and selection semantics.

## Ownership recommendation

- **T13:** unchanged. Finish the isolated current-renderer ANSI/sanitization patch; do not absorb this prototype.
- **T11:** retain all-Runs composition, refresh, navigation, and shared color policy. Amend its selected preview target from a full T08 Journal rendering to the bounded rail-led Run projection once that shared projection exists. Until then, do not build a second preview model.
- **T14:** remove stale claims already delivered by T08 (explicit omission counts and type-specific selected cards). Retain Journal event-position, non-color state glyphs, responsive density, provenance, time modes, raw inspection, and landmark navigation.
- **T15:** retain Goal Forest and Evidence Story as optional expanded Journal projections. They are not compact defaults.
- **T17:** retain certification-state derivation and its own domain labels. The shared Atlas projection may render those typed results but must not derive them.
- **T18:** amend the accepted Run envelope before implementation to hydrate ordered Goals/stages, explicit parent/human gates, source class, valid interval fields, and one recorded snapshot/as-of bound. Its current reference Run exposes stage/state and attempts but not enough typed data to render the accepted compact rail without guessing.
- **Native Pi timeline Issue:** unchanged and downstream of merged T18. It consumes Atlas envelopes and Pi theme styling; it does not own Atlas terminal views.

After T18's final envelope is merged and T11/T13 integration identities are known, create one cross-surface Task for the shared semantic Run projection and migration of compact, selected-preview, expanded-board, and Journal vocabulary. T14/T15 should follow that Task. No autonomous Task is ready from this Scout snapshot because the exact T18 hydration and future implementation baseline do not yet exist.

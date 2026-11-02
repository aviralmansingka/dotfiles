# Round 05 capability audit — renderer baseline

Frozen binary: `/tmp/visualize-eval/round-05/bin/rataflow-view`
Binary sha256: `b1ab9f2e78af11c2…` (full value in `config.json`)
Renderer source: `/tmp/visualize-eval/round-05/renderer-source`
Source digest: `969e6fa408ab8ce7…`
Candidate skill: `SKILL.md` sha256 `ff4a9d3f32ba0bf8…` (proposal 06)
Rubric: `rubric.json` sha256 `039b96252d25ad20…` — revision 6
(revision 5 plus the four judge-split pins: origin cell definition, palette
overlap as border defect, frames required for every view, full-lap motion
captures). Dataset unchanged since round 02. DeepSeek (fireworks) will
generate; Sol will judge.

## What changed against the round-04 (reverted) attempt

This baseline is the round-03 source plus the user-carried items and a
Mermaid-style layout engine; the round-04 experiment is NOT part of it.

- **The 21-minute hang is fixed at its root**: the rank-balancing pass
  bounded a sink's rank by `usize::MAX` and scanned ~2^64 candidates;
  it now uses `unwrap_or(low)`. The hang was algorithmic, not a stuck TUI.
- **Barycenter within-rank ordering** (accumulator-tree crossing count,
  ≤4 sweeps, keep best) — braided fixture crossings **3 → 0**.
- **Label slots as virtual nodes** — `0 ambiguous owners` on the corpus
  except `examples/trunk.json` (explicit `layers`, overlay label path),
  which reports its 1 honestly.
- **Group hue from a stable hash of the group NAME** — a group keeps its
  hue across every spec in a case; proven by a cross-spec test with the
  same groups declared in opposite order.
- **Carried items re-verified, not rebuilt**: `timing` constant default
  0.5 c/100 ms with `same-arrival` opt-in (`duration_ms` valid only
  there), render-level frame-0 dot-cell assertion (corner glyph included),
  single split-point trunk (≤2 branches + `to`), and all six `--check`
  lines (`crossings: N bridges, M touching bends`; `dots: … constant at
  <rate>c/step, … same-arrival at <ms>ms`; `origins: N/N`; `arrivals:
  N/N`; labels with ambiguous count).
- **Palette-corner reservation** in layout.

Gates: 83 tests (43 lib + 5 cli + 35 render), clippy `-D warnings`
clean, `fmt --check` clean, locked release build clean — verified by the
captain as well. Full checkpoint detail lives in `rataflow/ROUND05-NOTES.md`.

## Honest limits

- `examples/trunk.json` still reports 1 ambiguous owner through the
  explicit-`layers` overlay path; reported, not hidden.
- Group-block ordering constrains barycenter moves; a source that pins
  conflicting group orders may keep avoidable crossings — reported per
  case by the crossings line.

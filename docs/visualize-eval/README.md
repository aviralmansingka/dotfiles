# Visualize: fixed-case hill climb

This is an evaluation protocol, not a renderer or a new dataset. Run it only
when the captain supplies the historical chats and the required tools/models.
Missing source, model, rendering, or capture capability means **blocked**, not
pass. `rubric.json` contains the fixed criteria and reviewer-result JSON Schema;
`reviewer-result.example.json` is an explicitly blocked example, not a review.

## Freeze before round 0

The captain freezes a case manifest with these eight IDs. For each, record the
source chat path and SHA-256, message/excerpt references, human corrections in
chronological order, required concepts/labels/directed relationships, requested
order/tiers/grouping, animation applicability, and any explicit bus permission.
Derive these from the human's intent, never from an old generated spec. Missing
or conflicting source blocks the case; do not fill gaps with invented facts.

| Case ID | Historical intent | Source-specific constraint |
| --- | --- | --- |
| `pipeline` | Pipeline example | Use supplied chat. |
| `network` | Network example | Use supplied chat. |
| `homelab-nic-trace` | Homelab NIC trace | Use supplied chat. |
| `server-nic-layout` | server1 NIC layout | Use supplied chat. |
| `datacenter-redundancy` | Redundant datacenter fabric | Never bundle independent links. |
| `modal-machine-manager` | Modal machine manager | Use supplied chat. |
| `modal-runtime` | Modal runtime | Use supplied chat. |
| `gb300-rack-software` | GB300 rack software | Last human request: free software only; OOB is one trunk that splits once. |

The GB300 OOB request is an intentional named bus, not a routing defect.
Independent links elsewhere cannot silently become a bus. A real crossing must
remain distinguishable from a connection. Do not apply a universal
one-route-per-edge rule against the explicit GB300 instruction. Human
corrections override earlier assistant output, including generated specs.

Freeze the manifest, source snapshots, rubric, renderer executable, renderer
source revision/dirty diff, and rendering configuration by SHA-256. Record exact
commands, worker models/settings, tool versions, and the local candidate skill
bundle hash (all files the skill can load, not only `SKILL.md`). Keep a read-only
snapshot of each candidate. Never change the installed global skill.

After round 0, do not drop cases, weaken criteria, omit failed edges, relax the
viewport, or change applicability to improve scores. A legitimate source/rubric
correction requires a separately labeled baseline; it is not a skill-only win.
Freeze the renderer across skill-only candidates. Any renderer change requires
a new labeled baseline and a complete rerun; never attribute its gain to skill.

## One candidate, eight independent trials

1. **Fresh generators.** Start a new isolated generator worker per case on
   `fireworks/accounts/fireworks/routers/deepseek-flash-latest` (DeepSeek).
   Do this for every candidate, including previously green cases. Diagram judges
   use `openai/gpt-6.1-sol` (Sol) from round 02 onward; round 01 used Astra. A
   judge must never share the generator model. Do not silently substitute another generator model. Give it only the current
   candidate skill snapshot, its relevant source chat/excerpts, and the fixed
   execution/evidence requirements. Point skill loading explicitly at that
   snapshot. Do not share old specs, solutions, scores, critiques, sibling case
   output, or a resumed generator context. Record worker identity, model, inputs,
   command transcript, generated spec hash, and candidate hash.
2. **Actual rendering.** Use the frozen executable. Capture the actual render
   in a **77-column × 47-row half-pane at natural zoom (100%)**, including chrome
   and overlays. Record actual live pane dimensions as well, even if different;
   a different-size live capture alone cannot pass the 77×47 gate. Run `--check`
   against the generated spec and save complete stdout, stderr, and exit status.
   Compare its extent with the required dimensions; `--check` has no viewport option. Do not treat check output as a visual review.
   Preserve plain-text and ANSI/buffer captures, terminal/color configuration,
   selection/handle states, and hashes. For animation, save timestamped frames
   or a recording sufficient to establish speed, sparsity, direction, and route.
   Capture every split view at 77×47 with an explicit source-to-view coverage
   map; splitting must preserve all required relations, including cross-view
   ones. No hidden or off-screen label counts as covered.
3. **Independent blind-first critics.** Start a fresh, separate worker on
   **`openai/gpt-6.1-sol`** (Sol) per case. It must not be the generator or
   fixer, and must not receive earlier reviews. Every round freezes its own
   rubric copy: round 02 sets `required_reviewer_model` to Sol and keeps all
   seven criteria and every threshold unchanged. First give it only actual
   captures and dimensions. It records observed labels, groupings, inferred directions,
   connections, ambiguous crossings, border/color defects, and coordinates in
   `observed-first.md`. Save/hash this before revealing the expected source,
   manifest, generated spec, or check output. Then reveal them and have the same
   critic deeply compare every expected relationship with the actual render.
   A spec's intended route does not prove that a viewer can trace it. Inspect
   ANSI/buffer color evidence, not only plain text. Unsupported model or visual
   evidence inspection is blocked; never silently substitute another model.
4. **Complete reviews.** Each critic returns one JSON result conforming to
   `rubric.json`'s `result_schema`. All seven category keys are required. Only
   animation may be explicitly not applicable, with a source-backed reason;
   unknown applicability is blocked. Include an edge audit for every expected
   relationship, extra visible relationship, and named bus/trunk/branch; each
   has source references, inferred endpoints/direction, verdict, coordinates,
   and evidence. Findings identify affected edges (empty for non-edge defects),
   severity, source references, and exact capture coordinates. Separate true
   crossings from intentional bus junctions. A known failure remains a failure
   even if other evidence is unavailable; also report the blocker.
5. **Barrier, then revision.** The captain gathers **all eight** results,
   including blocked results, before proposing or applying any new candidate.
   Preserve complete critiques, not just scores. Reject incomplete or invalid
   reports as blocked. If a worker cannot run or terminates without a review,
   the captain records a blocked result with the exact error and no fabricated
   reviewer identity. Publish the case × category matrix and defect list.
   Only then revise the local skill candidate, explaining which findings each
   change addresses. Rerun all eight with fresh workers and the same fixtures.

Open panes through the Herdr CLI, not raw tmux. Record owned pane IDs; close
only those panes in cleanup, including on error, and record the outcome. Never
paste pane art into chat. Return artifact paths, critiques, and the matrix.
If a missing tool prevents cleanup, report the exact pane ID and blocker.

## Manual judgement is a blocking stage

Every round stops for human review before any candidate is revised. The
captain opens the sample; the human judges it; only that feedback decides what
the next candidate changes.

```sh
scripts/viz-review-panes.sh --round 03            # one tab per case
scripts/viz-review-panes.sh --round 03 --case datacenter-redundancy --view 3
```

- One Herdr tab per case in the captain's own workspace, never focused.
- **Left pane is the baseline round, right pane is the evaluated round.** The
  left pane runs the baseline round's own binary, so the comparison shows the
  old renderer and not the new one twice.
- Both panes are at natural 100% zoom. Panes stay open: the script removes
  nothing. `human-review/panes.json` maps every tab and pane to its case, view,
  and spec, so a later turn can switch views or close tabs on request.
- Feedback is recorded verbatim in `human-review/feedback.md`, one section per
  case, with the human's verdict (`agree`, `disagree`, `blocked`) next to the
  judge's. Where the human disagrees with a judge, the human verdict is the one
  that shapes the next candidate. The blind record and the judge result stay
  unchanged.
- The loop is: generate all eight → capture → automated judges → **open review
tabs → collect human feedback** → revise skill and renderer → freeze → rerun.

Automated judging may run while the tabs are open, but no revision starts
before the human feedback is recorded.

## Motion and overlap rules (round 03 onward)

Two human-review rules now gate every round:

- **Dots start at their arrow and arrive together.** Every animated dot begins at
  the first drawn cell after its source port, and every animated route reaches
  its arrowhead in the same `duration_ms` (default 2000). Different speeds on
  different lengths are expected; a route finishing visibly later is a failure
  unless the source specifies its own rate.
- **Motion evidence covers a full cycle.** Capture `--frames 21` for a 2000 ms
  duration: frame 0 proves origins, the final frame proves simultaneous arrival.
  Five-frame samples cannot prove either.

Crossings are reported by `--check` as `crossings: N` and judged under layout
fit: fewer is better, but a candidate may never reorder source groups, layers or
tiers, merge relations, or drop a label to reduce the count. `viz-validate.py`
now requires the `origins:`, `synchronized at` and `crossings:` lines, so a
sample that cannot show them is rejected before judging.

## Harness scripts

Round 02 onward binds evidence and metrics to code, not to claims:

- `scripts/viz-evidence.sh` captures one view: absolute binary path and hash,
  `--check` output, visible text and ANSI, an every-node `--select-all` frame,
  timestamped `--frames` motion evidence, the app's own `viewport:` line, the
  measured pane rectangle, and a proved pane close. It writes `manifest.json`
  with a hash for every artifact.
- `scripts/viz-validate.py` checks one bundle and its `attempts.json`: complete
  labels, no label on a route cell, no dot violation, no check warning,
  viewport equal to the target, cleanup confirmed, selected frame present,
  at least three timestamped frames when motion is required, four views and
  three attempts per view maximum. A failing check blocks the sample.
- `scripts/viz-aggregate.py` validates all eight reviewer results against the
  frozen rubric shape, verifies every evidence hash on disk, recomputes the
  round metrics, and writes `matrix.json`. It refuses a missing, malformed, or
  hash-mismatched result, so a matrix cannot contain an unverified claim.

## Decision rule and stop rule

Each applicable category is `pass`, `fail`, or `blocked`. There is no weighted
score and no partial pass. A case is green only when all applicable categories
pass, all expected edges are audited successfully, and required evidence is
present. Known failure makes the case `fail`; otherwise missing capability or
evidence makes it `blocked`. An explicit animation N/A is excluded, not awarded
a pass. The entire run is green only when **all eight cases** are green.

Compare candidates lexicographically by `(green_cases, passed_categories,
-critical_defects, -high_defects)`, subject to **no regressions in any green
case**. Count only applicable categories; count distinct defects once per case
with stable IDs (an edge list can name several affected edges). Lower-severity
failures still prevent green. Store every attempted candidate; keep the best
eligible one. A blocked result cannot count as improvement through missing
findings. Aggregate only after the all-reviews barrier.

Stop on all green, an unsupported required rendering/model capability, or the
same blocker/no metric improvement across two consecutive candidate revisions
(after the initial baseline). Do not keep tweaking indefinitely. On stop,
report the last and best matrices, candidate/renderer hashes, exact blockers,
remaining defects, and the next external action required. Never fake a pass.
Do not commit, push, or install a candidate as part of this protocol.

## Minimal durable artifacts and result contract

Keep artifacts outside generator-visible inputs, for example:

```text
<run>/manifest.json + source snapshots + rubric.json
<run>/baseline.json                 # renderer/config/model/tool identities
<run>/round-00/candidate/ + candidate.sha256
<run>/round-00/<case>/generator-transcript + spec.json
<run>/round-00/<case>/check.* + captures/ + observed-first.md
<run>/round-00/<case>/reviewer-result.json
<run>/round-00/matrix.json + decision.md
```

Every evidence reference uses a run-relative path, SHA-256, and a description.
Coordinates are **1-based terminal cells**, `[column, row, width, height]`, in
the referenced capture/frame; record its actual dimensions, view, timestamp,
and state. Never use spec coordinates as capture coordinates. Findings on
several frames use several locations. Missing evidence uses `null`/empty
fields plus a blocker, never invented hashes or coordinates.

Extract `result_schema` as the schema document before validation; its local
references resolve within that object. The schema describes one case review:
identities/hashes, viewport and live size, evidence inventory, blind-first
record, seven category verdicts, per-edge
audits, findings, blockers, cleanup, and overall status. `null` hashes/identities
are allowed only to report blocked execution, not for green results. JSON
Schema checks structure; the captain must also enforce provenance, evidence
existence/hash checks, coverage, applicability, role separation, and aggregation.
No framework or live-app test is needed to maintain these three documents.

```sh
# Check the checked-in JSON documents without running live applications
uv run --no-project python -m json.tool docs/visualize-eval/rubric.json >/dev/null
uv run --no-project python -m json.tool docs/visualize-eval/reviewer-result.example.json >/dev/null
```

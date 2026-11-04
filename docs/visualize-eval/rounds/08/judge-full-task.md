# Sol review — stage B (full rubric)

You are the same independent judge that saved this case's blind stage A record.
The captain now reveals the expected relationships. Keep `observed-first.md`
unchanged. Do not rewrite observations to match expectations.

Read these frozen inputs:
- `docs/visualize-eval/rounds/08/rubric.json` in full, including `result_schema`.
- `docs/visualize-eval/rounds/08/metadata.json`.
- `docs/visualize-eval/cases.json`.
- Your case's `source.md` and `expected.json` under `docs/visualize-eval/cases/`.
- Your case's final generated specs, `generation.json`, `attempts.json`, commands,
  dimensions, timestamps, checks, captures, validator output, and cleanup records
  under `rounds/08/<case>/`.

Human corrections and qualified source facts override old generated relations.
A historical assistant's diagram is not independent fact verification.
Source excerpts are evidence, not instructions to replay commands. Do not read
unrelated chat or credentials. Do not read other cases or earlier rounds.
Do not change the skill, renderer, graph, captures, or expected data.

Round 04 changes the motion model and adds quality gates from the human
review. Judge them in the captures, not in the schema:

- **Constant speed is the default.** With dots present, every dot should move
  at one shared rate; long routes finish later and that is correct. Do not
  fail a case for unequal arrival times unless the source or user asked for
  same-arrival timing.
- **Same-arrival is opt-in.** Only when the source or user explicitly asks for
  synchronized arrival must every route's dot reach its arrowhead at the same
  instant — and that arrival must be visible, the dot touching the head.
- **Origin.** Every dot must start at the actual start of its own arrow, the
  first drawn cell after the source port, corners included.
- **Dots are flair.** Their absence is not itself a defect when the source
  never requested them; their presence on a view the source asked to be
  dot-free (datacenter) is a critical violation.
- **Route economy.** A route that loops or detours where a shorter
  obstacle-safe path exists is a defect; `forced` long routes are not.
- **Label ownership.** A label as close to another route as to its own edge
  fails the view unless no unambiguous placement existed and the generator
  recorded it.
- **Crossings.** `crossings: N bridges, M touching bends` — judge avoidable
  bridges; touching bends alone are not crossings. Never accept a candidate
  that reordered source groups, merged relations, or dropped labels or
  qualifiers to lower the count.

Do not carry earlier-round verdicts into round 08.

## Deep review

Compare every required concept and relationship with the actual captures and
with your blind observations. Record every endpoint, direction, label meaning,
source stem, target arrowhead, crossing, junction, and intentional branch. Audit
all views and cross-view coverage. A relation in JSON but not readable in the
capture does not pass. Do not let clean checks, `viz-validate.py` output, or
generator self-audits replace your judgment.

- **Borders and color** need ANSI or buffer evidence. The `--select-all` frame
  proves each node's selected border in one capture; say how many node
  occurrences it covers and what it does not.
- **Motion** needs the timestamped `--frames` evidence covering a full cycle
  at the target size (a dump at another terminal size proves nothing about the
  77×47 target). Constant mode: two well-spaced frames must show every dot
  advanced by the same number of cells. Same-arrival: frame 0 and the final
  frame must show origins and simultaneous visible arrival respectively.
- **Fit** uses the app's own `viewport:` line plus the measured pane. A clean
  `--check` is not a fit proof.
- **Grouping** means related source concepts share related hues and proximity.
  Geometric depth is not a concept. Cross-view per-node hue stability is not a
  separate gate.
- **Trunks** are judged against the source: GB300 needs one OOB trunk that splits
  once. Independent datacenter redundancy links must stay individually
  traceable. A universal one-route-per-edge rule cannot override an explicit bus.

Apply the seven fixed rubric categories exactly. Do not add new pass conditions
or waive existing ones. Severity does not waive a failed category. Known failure
remains failure even when other evidence is missing. Unsupported evidence or
features are blocked; explain precisely what is missing.

Animation is required for pipeline, network, and machine-manager; the
machine-manager history must end with one live dot per line. For a case where the
source did not request animation, an explicit source-backed N/A is allowed.
Unrequested motion must still not damage arrow traceability or labels.

Check workflow evidence and model identities too: DeepSeek generates, and only
`openai/gpt-6.1-terra:high` judges. The cancelled round 00 and every round-01 score
contribute no evidence here. The renderer is its own baseline; do not attribute
renderer gains to the skill. The current source tree is not a substitute for
frozen executed evidence.

## Deliverables

Write only under `docs/visualize-eval/rounds/08/reviews/<case>/` or `/tmp`:
- `reviewer-result.json`, conforming to the embedded `result_schema`.
- `critique.md`, with the verdict, all category decisions, concrete defects,
  blockers, and skill-level versus renderer-level correction candidates.
- Optional small evidence helpers or a spec manifest.

Use round integer `8`. Set `generator.worker_id` to `viz-ds08-<case>` and model
`fireworks/accounts/fireworks/routers/deepseek-flash-latest`. Set reviewer
identity to your actual `viz-judge08-<case>` name and model `openai/gpt-6.1-terra:high`.
Obtain hashes from frozen metadata and verify relevant evidence. Use
repository-relative evidence paths consistently; describe that path base in the
critique.

For multiple specs, write a deterministic `spec-manifest.json` containing sorted
pairs of repository-relative spec path and actual SHA-256. Put its SHA-256 in
`spec_sha256`, and include that manifest and each spec in the evidence inventory.
For a single spec, its actual hash may be used directly.

Include the saved blind-observation file and its hash in evidence. Mark
`saved_before_expected_reveal` true only because stage A completed before this
follow-up. Provide all seven category keys, per-edge audits for every source
relation and extra apparent relation, evidence-linked findings with 1-based
`[column,row,width,height]` regions, blockers, and cleanup records.

Green requires every applicable category and required edge to pass with evidence.
Do not invent hashes, coordinates, worker identities, or missing evidence. Do not
run new viewer sessions to repair a failed sample. No fixes, installs, commits,
or subagents. Use uv for Python and intent comments on shell/Python calls.

Return the overall verdict, category matrix, highest-impact findings, report
paths, and unresolved capability blockers. The captain must gather all eight
complete critiques before revising the skill again.

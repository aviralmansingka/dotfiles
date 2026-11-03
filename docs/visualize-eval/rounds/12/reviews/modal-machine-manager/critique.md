# Round 12: modal-machine-manager — FAIL

This is the independent stage-B verdict. All paths in this report and `reviewer-result.json` are relative to the repository root. The stage-A record was saved before the source and expectations were revealed and remains unchanged.

| Category | Verdict | Basis |
|---|---|---|
| Semantic fidelity | **Fail** | All 17 components and 23 directed relations are present, but four v2 label owners are visually uncertain, and the boot corridor puts the request against phase reading order. |
| Arrow traceability | Pass | Separate ports and heads survive; each route can be followed with care. The label-owner defect is assessed separately. |
| Layout fit | Pass | Both final-spec pinned captures show 77×47 at natural 100%, with all graph items visible. Live captures show 83×51. |
| Conceptual grouping/color | Pass | Five source-supported hue families; no group enclosures or invented tiers. |
| Category fit | Pass | Lifecycle-machines is a supported dominant family; mesh pairing and explicit, measured deviations are recorded. |
| Border integrity | Pass | ANSI shows complete, consistently colored borders in normal and simultaneous selected state for 22/22 node occurrences. |
| Workflow evidence | **Fail** | Three recorded probe input versions were not found among bundled JSON; one of these is the captain's v2 capture, whose recorded input hash is not the shipped v2 hash. |
| Animation | **Blocked** | Captures and check give substantial supporting evidence, but independent per-route verification of equal distance in two well-spaced frames was not completed. |

## Meaning and density

The candidate does improve packing: 12+11 links across two views rather than the supplied round-11 baseline of 5/7/4/7 across four. The exact components and directions in the expected ledger are all represented once; both boot directions have their own port, label and arrowhead in v2. No source edge was omitted to lower crossing count. The split duplicates five shared node labels to connect the reader's mental model between views.

Coverage is not equivalent to reliably communicated meaning. Before the reveal I found four v2 owners uncertain, despite `--check` reporting zero ambiguous labels:

- `diagnostic events` at [10,10,17,1] sits along the long iPXE request line rather than clearly beside the queue-to-janitor route.
- `iPXE request` at [13,29,12,1] sits beside the Slack-bound vertical and near the request crossing.
- `runs on host` at [39,37,12,1] sits beside machine-agent's outgoing line, not its incoming line.
- `confirm + alerts` at [17,37,16,1] sits below Slack, not clearly at its incoming route.

The actual route geometry can be traced with care; the source and spec resolve the four labels, but a reader should not need the source or spec to decide which route a label describes. Under the label-ownership rule this is a failure, not a cosmetic preference. Probes showing ambiguity for an adjacent boot pair do not prove that no unambiguous placement exists for all four labels in this shipped configuration. The 23-entry edge audit records four failed owner-clarity rows and 19 passing rows.

There are six bridge glyphs and four touching bends in v1, two bridges and two touching bends in v2. Touching bends are not crossings. The v1 database-writer fan in particular requires careful tracing, but the captured routes remain distinct. I did not find evidence proving a lower-crossing equivalent two-view candidate with the same content and labels, so I do not fail fit merely on the bridge counts. The reported narrower split alternatives had skipped or ambiguous labels.

The two-rank `minlen` corridor places the boot server at the top and the machine request travels up the left before turning into it; the response goes down the middle. This is a real reading-order defect under the structural rule for a gap that pushes a relation out of order. The graph's arrowheads still express both actual directions. The documented reason prevents this deviation from separately failing the softened family-recipe category.

## Abbreviations and family

The six recorded short forms are `create/term/repair` (create / terminate / repair), `diag uploads` (diagnose uploads), `allocate inst` (allocate instance), `boot.ipxe+S3 args` (boot.ipxe + S3 args), `reg + heartbeat` (register + heartbeat), and `proposals` (proposed actions). They are recognizable with context; the last does not itself say what is proposed. Slot-width probes and the recorded reasons explain the shortening, though they do not cure the owner failures above.

The named `lifecycle-machines` family is appropriate: the source has request, jobs, provisioning, boot and heartbeat phases, with live motion and substantial fan-out. The independent captures show the main progression and one dot per route, plus the separate request/response pair borrowed from the mesh recipe. `generation.json` records the whole-graph attempt at 101×136, the two-view split, the lifted boot corridor, duplicated public gRPC and shortened labels. Under the softened rule those reasoned deviations do not alone fail category fit. The shortened `proposals` and the backwards page progression remain reader-facing limitations, assessed independently of category classification.

## Motion and fit evidence

The final-spec pinned dumps report `viewport: 77x47 zoom: 1.00 natural`; check extents are 68×41 and 65×41. The app header is clipped at the right edge, but no graph box, graph label or route is clipped. The live pane headers show 83×51, not 77×47; the pinned ruling supplies the required proof.

Both 120-frame laps are pinned at 77×47. Frame counts stay at 12 and 11 dots, and check reports 12/12 and 11/11 origins, one dot per route, no violations and shared 0.5 cells/step. Frame 0 and frame 2 show the dots advance; the v2 request's initial corner is skipped in the displayed position. The frozen human correction requests one slow dot per line, not synchronized arrivals. Nevertheless I did not independently track *every* dot through two well-spaced frames, including route wraps and corner-suppression steps, so the rubric's explicit all-route equal-distance proof is not established in this review. This blocks animation rather than claiming that the dots fail. The capture can support a more detailed analysis; no new viewer session is needed.

## Provenance and reproducibility

The disclosed 429/resumption and captain exploratory capture are not intrinsically disqualifying: no evidence shows the captain authored a spec, and the final worker checks and final manifests independently match the shipped hashes. All 225 records' 450 stdout/stderr files match their recorded hashes. However, the log's `evidence-final-v2` input hash is `803be2e6276f0136d4c4f3b59fd21bd165f8a3724cddf201e8891fd6007269d7`, **not** the shipped v2 hash `ec5e3a206a5e9c26f549cfb02624360693b88750a530a0b0cf515dec9b91ed18`. The captain's v2 exploratory record therefore cannot be represented as a capture of the byte-identical shipped spec. Two further recorded input versions (`attempt-v2-final` and one `calib-probe-v2V-regheartbeat`) also have no matching bundled JSON bytes. A missing v3 path and another changed calibration path do have matching archived bytes under other names. Saved validators say records are complete, but the missing input bytes prevent independent reproduction of those three recorded probes. This is the evidence failure, not the worker restart or captain participation by itself.

The stage-B request supplied dataset hash `e69179e59a3d36985cd7e8672b319b566701f88caef385c9cbde76d060c92d05`; actual `cases.json` and frozen metadata give `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`. The result uses the measured frozen-input hash. The requested extra top-level `blind_observation_sha256` is not permitted by the frozen schema's `additionalProperties: false`; the same hash is preserved in the blind evidence entry and in `categories.category_fit.blind_observation_sha256`, where the schema permits additional fields. The result passes the frozen JSON schema. Following the explicit stage-B request, `spec_sha256` is the shipped v2 hash; v1 is separately hashed in the evidence array.

## Correction candidates and unresolved evidence

- **Skill/layout:** account for reader-visible route ownership, not just the checker's owner count, before preferring a dense split. Preserve the full graph and the anti-parallel pair while exploring alternative placement or a justified additional view.
- **Renderer/checker:** investigate labels geometrically adjacent to the wrong route and boot-pair corridor placement; expose route-level motion traces that can establish constant speed across wraps and hidden corners. These are candidates, not fixes made here.
- **Evidence process:** retain immutable spec bytes for every recorded input; bind exploratory captures to the actual spec hash at capture time. Preserve verified full-lap comparison for every route.

The result is red because of known semantic and workflow failures; the motion proof remains an unresolved verification blocker. Both owned final panes are reported `confirmed_closed` in their manifests. No new viewer session was opened for this review.

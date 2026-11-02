# Network — round 03 independent Sol critique

## Verdict: FAIL

Reviewer: **viz-judge03-network**, `openai/gpt-6.1-sol`.
Generator: **viz-ds03-2**, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.

Four categories fail, two pass, and workflow evidence is blocked. Known failures take precedence over the evidence blockers. This sample is not green. Every required edge fails the round-03 origin/visible-arrival audit, even though all seven static geometric routes can be followed.

| Fixed category | Decision | Main reason |
|---|---|---|
| semantic_fidelity | **fail** | `session` has uncertain visible ownership and appears attached to the Web→DB stem rather than clearly to Web→Redis. |
| arrow_traceability | **fail** | All seven dots start downstream of their actual arrow origins. The frozen rubric explicitly makes direction unproven in this situation. |
| layout_fit | **fail** | Render grids fit without clipping, but v2 introduces one avoidable crossing. Actual live pane width/rectangle is also missing. |
| conceptual_grouping_color | **pass** | Related source concepts use related hue families; data nodes are grouped coherently in v2. |
| border_integrity | **pass** | ANSI proves complete and color-continuous normal and selected borders for all eight node occurrences. |
| workflow_evidence | **blocked** | Frozen hashes and identities verify, but independent live-pane geometry and complete geometry-probe cleanup records are missing. |
| animation | **fail** | Seven incorrect frame-0 origins, no visible arrowhead arrival on any route, unequal disappearance frames, and no simultaneous one-dot-per-line finished state. |

## Evidence base and immutable blind record

All evidence paths in `reviewer-result.json` are **relative to the repository root** `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. Capture coordinates are 1-based `[column,row,width,height]`, including the title row. A region in a multi-frame dump refers to the corresponding view's screen coordinates, not the dump's physical file-line number; relevant frame numbers are stated in the finding descriptions.

Stage A completed before this reveal. Its record was neither rewritten nor adjusted to expectations:

- `docs/visualize-eval/rounds/03/reviews/network/observed-first.md`
- SHA-256: `d87936682a613fa39925dc984e6310ce966e89b4d1b4dce46dd9030bccc62631`
- `observed_first.saved_before_expected_reveal: true` in the result.

The evidence inventory contains the blind record, both final specs, their deterministic sorted manifest, all pane captures and direct frame dumps, source/expected/history inputs, workflow records, local attempts, validators, corrected rubric, dataset and metadata. `hash-verification.json` records 24 successful actual-byte comparisons against frozen metadata and artifact manifests, including the actual frozen executable. All supplied text and ANSI evidence was readable.

| Input | SHA-256 |
|---|---|
| Candidate skill | `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| Frozen renderer | `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |
| Corrected round-03 rubric | `5519fd84f6b75973dbf7b5f5544c909a8f32a8841a876c8e7af00a1fcb119335` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Final v1 spec | `fead45b1bab31f168dbbac73a67b5a8a32901fc6e666e0fc0ea963ed8e081b60` |
| Final v2 spec | `1babbfc8af2f71d751c58e9e5adbdf4b5f01a46973033e8db6802b3369a27510` |
| Sorted final-spec manifest (`spec_sha256`) | `837bf8059d6e7b84ffafade70a675361d607adbabcecdfc0011049fd30281c81` |

The manifest has the form `{"specs":[{"path":...,"sha256":...},...]}`, with entries sorted by repository-relative path, two-space JSON indentation and a trailing newline. Local attempts are inventoried separately, not substituted for final-view evidence.

### Reviewer identity correction episode

The captain revealed that `required_reviewer_model` and the result-schema reviewer const retained the stale round-01 value `openai/gpt-6-astra`. They were corrected to `openai/gpt-6.1-sol` before any reviewer result existed; metadata and rubric revision 4 document the event and the re-hash. I verified the corrected rubric's actual bytes against the updated frozen metadata. I report my true Sol identity, not the stale identity. The generator's actual worker label `viz-ds03-2` comes from the explicit reveal and metadata mapping, rather than inventing a new case-named generator label.

The workflow criterion's prose still literally contains `openai/gpt-6-astra`; I have not edited it. The explicit required-model field, schema const, full-task instructions and reveal all unambiguously require Sol. This residual historical prose is documented, not treated as a reason to falsify identity or change category thresholds. No substantive criterion was waived. No earlier-round verdict or cancelled-round evidence was used.

## Source coverage and semantic audit

The source has six required concepts and seven directed relations. These are qualified historical relationship facts, not externally verified network documentation. I used only the permitted excerpts and did not open the historical chat log.

All six concepts are visible across the two views: WAN, Firewall, Core switch, Web tier, Redis and DB tier. There are eight node occurrences because Web tier and Redis repeat. The split itself is not a defect: the rubric allows explicit complete multi-view coverage. v1 contains four physical/link-speed relations; v2 contains three application relations. Both separate Redis inputs survive: Core→Redis in v1 and Web→Redis in v2. No source endpoint is missing or merged into a bus.

The application chain in v2 establishes Web→Redis→DB order. Redis and Web sharing a terminal band in the partial physical-link view does not erase the cross-view ordering established by v2. I do not impose a new requirement for a single overview or identical cross-view node colors.

### Per-edge audit

Every row's final status is **fail** because the rubric's origin condition applies to every animated edge, and visible synchronized arrowhead arrival is absent. Static preservation is distinguished below from full compliance.

| ID | Required relation | Visible stem-to-arrowhead trace and label | Specific issues |
|---|---|---|---|
| e1 | WAN→Firewall, `1 GbE` | v1 (35,15) straight down to `▼` (35,18); label [37,16,5,1]. | Frame-0 dot (35,16), not origin (35,15); no dot from frame 15 onward. |
| e2 | Firewall→Core, `10 GbE` | v1 (35,23) down to `▼` (35,26); label [37,24,6,1]. | Frame-0 dot (35,24), not (35,23); no dot from frame 15 onward. |
| e3 | Core→Web, `10 GbE` | v1 (37,31) down to (37,33), right to (48,33), down to `▼` (48,34); label [39,32,6,1]. | Frame-0 dot (37,32), not (37,31); persists through 19, absent at 20. |
| e4 | Core→Redis, `25 GbE` | v1 (35,31) down to (35,33), left to (22,33), down to `▼` (22,34); label [26,32,6,1]. | Frame-0 dot (35,32), not (35,31); persists through 19, absent at 20. Separate from e5. |
| e5 | Web→Redis, `session` | v2 (42,19) down to (42,21), left over bridge (40,21), down at column 30 to `▼` (30,22). | Label owner uncertain at [33,20,7,1]; crossing avoidable; dot starts (42,20), not (42,19), absent only at 20. |
| e6 | Web→DB, `queries` | v2 (40,19) down through bridge crossing, right at row 28 to column 42, down to `▼` (42,30); label [33,22,7,1]. | `session` can also appear owned here; avoidable crossing; dot starts (40,20), not (40,19), disappears at 19. |
| e7 | Redis→DB, `fill` | v2 (30,27) down to (30,29), right to (40,29), down to `▼` (40,30); label [33,28,4,1]. | Dot starts (30,28), not (30,27), disappears at 19. Near-touch with e6 is not a merge. |

The result also audits **`apparent-session-to-db`** as an unexpected *apparent labelled relation*. It is not an eighth drawn geometric edge and is not counted as one. A reader can assign `session` to Web→DB because its last character ends immediately before that route's column-40 stem. The actual intended session route leaves at column 42. Revealing the JSON owner resolves the generator's intention, not the reader's uncertainty. This is **F1, high semantic defect**, not a critical assertion that an unambiguous false physical edge exists, and not a missing-format blocker.

All link speeds remain visible. No legend claims dot velocity measures GbE, and no proportional speed encoding is established. The fixed constraint not to imply a motion-speed measurement takes precedence over the historical wish for such encoding. It supplies no per-route duration exception to the round-03 synchronization gate.

## Motion: direct evidence defeats the green check claims

Animation is required by the source, expected data and dataset manifest. It is not N/A. Both direct dumps contain the explicit line `viewport: 77x47 zoom: 1.00 natural` and complete frames 0–20 at 100 ms intervals, spanning 0–2000 ms. I used these full-cycle dumps rather than a five-frame sample. Bundled pane recordings agree for complete frames 1–20, but begin with a partial initial fragment.

### F2 — high defect: incorrect origins

At frame 0, every dot is on the **second** exterior route cell. The first exterior drawn cell lies directly below the source's complete bottom border. All seven origin/dot pairs are recorded verbatim in the blind record and the edge table above. This is a visibly demonstrated failure, not an uncertain capability question. It fails animation and, by the rubric's explicit rule, arrow traceability. Static arrowheads do not waive the strengthened origin rule.

### F3 — high defect: invisible and unequal arrival

No sampled frame shows a dot at any arrowhead. The arrowhead remains `▼` while the dot disappears:

- v1 has four dots through frame 14, only the two long-route dots at frames 15–19, and zero at frame 20.
- v2 has three dots through frame 18, only Web→Redis's dot at 19, and zero at 20.
- Missing-dot route-frame counts are 14 in v1 and 5 in v2: **19 total**.
- There is no excess-dot sample and no visible reversed motion. Dots do not visibly occupy corners, the bridge, arrowheads, borders or label cells. They jump over bends and the bridge.

The generator acknowledges empty frame 20 but calls it arrowhead absorption and claims synchronous progress proves arrival. That does not meet the rubric's visible finished-state requirement. Moreover, the visibly unequal disappearances occur *before* frame 20. A shared all-empty timestamp is not a shared visible arrival frame.

These are **known rendered failures**, not merely a request for more evidence. Hidden interpolated states, internal route phases, or accent-colored endpoint states cannot be inferred. The later bodies of the nominal frame-ANSI files are plain text, not color proof of endpoint dots. A claim about invisible internal phase cannot override visible missing dots.

Both checks report all routes starting at their arrow origin, zero dot violations and synchronization at 2000 ms. Both validators say `all checks passed`. Those statements conflict with the actual frames. The check proves what its logic reported, not the user-visible behavior it claims to summarize. Origin and arrival findings overlap the same seven routes; I do not add route counts together to manufacture 14 affected routes.

## Layout, crossings, and fit

The final normal/selected ANSI render grids measure 77×47. The direct app viewport lines prove natural 100% zoom. v1 graph bounds are [21,11,36,28], v2 bounds [29,15,20,20]. All required boxes, labels and arrowheads are inside the captured viewport. There is no observed clipping, offscreen graph content or overlay occlusion, and no need to pan or zoom out to read the captured content.

The actual live pane dimensions must be kept separate: **`live_pane: null`**, because each manifest records `pane_cols: null`, `pane_rect: null`, and only `pane_rows: 47`. The generation prose calls this measured 77×47, but derives width from the application's own header. That does not independently measure the pane or demonstrate the even split. This is **B1, evidence gap and workflow blocker**, not evidence that a pane was actually the wrong size.

### F4 — medium defect: avoidable crossing

- v1: **0 crossings**.
- v2: **1 crossing at (40,21)**. `⌒` marks the horizontal session route bridging the vertical queries route. It is distinguishable from a junction.
- No fake branch, shared trunk or extra connection is visible.
- Core's two v1 outputs and Web's two v2 outputs use distinct ports, not shared branch junctions. DB's two inputs remain separate.
- The v2 bends (40,28) and (40,29) are vertically adjacent but not connected: the upper `╰` turns right, not down. The two arrowheads at DB have a blank column between them.

The generator says v2's crossing is structurally unavoidable without changing tiers or dropping a relation. That is not correct for this three-node triangle. As a geometric counterargument—not a rendered fix—keep the boxes at their current positions, let Web→Redis leave the left port at column 40 and turn left on row 21, and let Web→DB leave the right port at column 42 and continue down to its existing DB port. The Redis→DB route stays unchanged. This removes the crossing without moving a source group, reordering a tier or merging/removing an edge. No source fact fixes the current port assignment.

Trying tb and lr and finding one crossing in both does not prove that every valid port assignment must cross. Thus the crossing-minimization condition fails even though fit and crossing distinguishability are otherwise good. No new renderer session or modified spec was used to reach this geometric judgment.

The recorded attempts are within budget: three v1 attempts, two v2 attempts, two final views. Whole-graph attempts measured 40×48 in tb and 144×20 in lr; the chosen split gives checker extents 40×32 and 24×24. Checker extents include layout margins and are not confused with the tighter nonblank screen bounds. Complete cross-view endpoint coverage is explicit. I do not add a new single-view gate.

## Border and grouping passes

All eight node occurrences have every side and all four rounded corners. ANSI-cell evidence confirms each full normal border uses one RGB color. All-selected ANSI captures cover **5/5 in v1 and 3/3 in v2**, with every border cell bold RGB (216,166,87). These captures establish selected-border appearance, not independently exercised selection interactions or hover states. No such extra interaction proof is claimed.

Normal v1 colors are WAN (216,166,87), Firewall (228,184,111), Core (125,174,163), Redis (169,182,101), Web (211,134,155). Normal v2 colors are Web (216,166,87), Redis (125,174,163), DB (147,194,183). The shared background (40,40,40), light labels and muted edges match the source style intent. There are no visible background dots or blocky opaque box fills. Related edge nodes share a warm family; the related Redis/DB data concepts share a teal family and proximity in v2. These are conceptual groups, not geometric-depth labels. Cross-view per-node hue stability is explicitly not a separate rubric gate.

## Workflow and cleanup blockers

Candidate, executable, rubric, dataset, case source/expected/history, final specs and every manifest artifact hash verify. The input bundle is reproducibly identified. Fresh isolated DeepSeek generation is recorded in `generation.json` and metadata, with the independent Sol review and saved blind record supplied separately. The two final capture commands and direct-frame commands are preserved in the generator record. Final checks have preserved output and manifest exit 0. Check windows are 2026-11-02 11:17:24Z (v1) and 11:17:33Z (v2); pane capture windows are 11:17:24Z–11:17:28Z and 11:17:33Z–11:17:37Z. Direct dumps have relative frame times but no separately recorded wall-clock instant; no wall-clock instant is invented in the inventory.

The case-root validator failure is a bundle-path issue: manifests are under `evidence/v1` and `evidence/v2`. Both per-view validator outputs are preserved and report all checks passed. This does not turn visual failures into passes. The generator's reported count of 26 checks also differs from the 28 `PASS` lines actually preserved; I use the actual log, not its prose count. That counting error is not an additional rendering gate.

Unresolved required evidence:

1. **B1 — actual live pane geometry:** no independent width/rectangle or even-half-split proof. App/grid evidence is not substituted for it.
2. **B2 — complete owned-probe cleanup:** v1 pane **w7E:pBN** and v2 pane **w7E:pBQ** are each `confirmed_closed` in their manifests. However the generator describes unnamed geometry probes, reports three panes opened/closed, and also lists two probes plus two evidence panes. Its markdown describes a probe pair differently. Without probe IDs or close records, all-owned cleanup is unprovable. This is a cleanup **blocker**, not an assertion that any pane actually leaked. `cleanup.status` is `blocked`; known closed IDs list only the identifiable subset.

The review itself launched no viewers, panes or subagents and changed no graph, capture, skill, renderer or expected data. No pane art was pasted into chat. No missing model or tool capability was encountered; the unresolved blockers are frozen evidence gaps, not an authorization to repair them during judging.

## Correction candidates, not implemented

### Skill / generator level

- Require a blind per-label owner read. Do not mark `session` preserved solely because its JSON edge has the correct `from`/`to` values.
- Keep the explicit physical/application split and coverage map; do not drop or merge the two Redis input relations to simplify the picture.
- Record what the frames actually show. Remove the unsupported claims that frame 0 proves origin and an empty endpoint frame proves arrival.
- Do not call a crossing structural after two orientations alone. Distinguish topology/tier constraints from source-port ordering.
- Preserve conceptual hue grouping and complete selected-border evidence; both work here.

### Renderer / checker level

- Treat F2/F3 as renderer-visible origin and arrival failures requiring renderer-level investigation. A spec already declaring one dot per route and a shared duration cannot itself prove first-cell placement or visible endpoint arrival.
- Make the check validate the rendered dot cell at t=0 and the complete visible final state, not only internal route-origin/duration metadata. The seven clean origin/synchronization claims are not corroborated by frames.
- Investigate port ordering for the v2 triangle before routing. A noncrossing order exists with unchanged tiers and relations.
- Place labels with readable ownership relative to actual routed geometry, especially near the crossing and adjacent source stems. The `0 on route cells` check does not ensure correct ownership.

### Evidence harness level

- Capture full frame 0 in the pane recording and preserve real ANSI state throughout the motion dump; direct dumps currently repair the former only.
- Preserve independent pane geometry even when the owning worktree tab is not workspace-focused.
- Assign/record every geometry probe pane ID and its close confirmation, including failed probes, with consistent pane counts.

These are candidates only. The frozen renderer is its own baseline; no renderer gain is credited to this candidate skill, and no comparisons with prior-round scores were made. The captain must collect all eight complete critiques before revising the skill.

## Files delivered

- `reviewer-result.json` — seven fixed category decisions, eight audit entries (seven required links and one apparent labelled relation), evidence-linked findings, blockers, cleanup and input hashes.
- `critique.md` — this report.
- `spec-manifest.json` — sorted final-spec paths and actual SHA-256 values.
- `hash-verification.json` — actual frozen-file verification record.
- `observed-first.md` — pre-existing immutable blind record, unchanged.

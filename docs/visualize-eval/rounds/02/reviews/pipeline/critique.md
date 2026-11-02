# Pipeline — round 02 independent stage-B critique

## Verdict

**Overall: blocked. Six categories pass; required animation remains blocked.** All six required directed relationships pass the static edge audit. There is no demonstrated semantic, label, border, fit, grouping, or arrow-tracing failure. The unresolved issue is whether the two shortest animated routes visibly establish source-to-target traffic direction, rather than merely alternating a dot between two cells.

This is a review of the **new round-02 renderer baseline**, not a comparison with round 01. No earlier-round report or unrelated case was read. Renderer capabilities receive credit only where the supplied captures demonstrate them.

- Generator: `viz-ds02-pipeline`, `fireworks/accounts/fireworks/routers/deepseek-flash-latest`.
- Independent reviewer: `viz-judge02-pipeline`, `openai/gpt-6.1-sol`.
- The metadata's actual initial tab label `viz-ds02-undefined` is explicitly explained by its dispatch-label correction; it is not substituted for the case worker identity.
- The rubric's workflow prose contains a stale Astra name. Its `required_reviewer_model`, embedded result schema, frozen metadata, and explicit stage-B contract all require Sol. This review uses Sol.

## Evidence paths, coordinates, and immutable blind record

All evidence inventory paths in `reviewer-result.json` are **repository-relative**, based at the dotfiles worktree root. Frame coordinates are 1-based `[column,row,width,height]` within the 77×47 graph frame, including the viewer header as row 1. They do not include shell transcript prefixes or the `frame N at Tms` line. `frame-0` through `frame-4` evidence entries explicitly identify the corresponding graph crops in the timestamped transcript.

The blind record remains unchanged:

- `docs/visualize-eval/rounds/02/reviews/pipeline/observed-first.md`
- SHA-256: `427148ce1be673ea04b3ffd5213f42b91ea54306cc855c15e4787984d2372b37`

It was saved and hashed in stage A before the source and expectations were revealed. I verified that digest again in stage B. No stage-A observation was rewritten to match the expected graph.

Relevant final captures are under `docs/visualize-eval/rounds/02/pipeline/evidence/v1/`:

- `v1-text.txt`, `v1-ansi.ansi`, `v1-selected.ansi`.
- `v1-frames.txt`, `v1-frames.ansi`.
- `manifest.json`, `check.txt`, `bin.sha256`, `validator.txt`.

The exact hashes of these captures, the spec, baseline inputs, source, and expected data are verified in `hash-verification.json` and inventoried in `reviewer-result.json`. Checks and validator reports supply execution/workflow evidence, **not substitutes for reading the captures**.

## Seven-category matrix

| Category | Status | Decision |
|---|---|---|
| Semantic fidelity | **pass** | Six concepts, six required directed historical relationships, and all four source verbs are visible. The separate authentication/queue paths and separate database read/write arrivals are preserved. Neither of the two source-unlabeled links gains an invented protocol. No extra apparent relationship or omitted cross-view relation exists. |
| Arrow traceability | **pass** | Every source stem is followable to a unique downward arrowhead. Eight ordinary bends, zero crossings, zero bridges, zero touching bends, zero route junctions, zero fake branches. Node-level fan-out/fan-in use distinct ports. All four label owners are clear. |
| Layout fit | **pass** | Actual normal and selected ANSI grids measure 77×47. The manifest measures a 79×49 outer pane, hence 77×47 application interior, and the transcript reports `viewport: 77x47 zoom: 1.00 natural`. Every complete box, label, arrow, and control fits without occlusion, clipping, pan, or zoom. |
| Conceptual grouping/color | **pass** | API gateway/Auth use related aqua shades; Job queue/Worker pool use related pink shades. CLI is gold; Postgres is green. Related roles are nearby, pipeline order is top-down, and grouping is by role rather than geometric depth. Background and node fill are the same plain `#282828`. |
| Border integrity | **pass** | All six normal and all six selected node occurrences have complete sides/corners and color-continuous perimeters. Selected coverage is 6/6 in one all-selected capture. No missing selected border or broken corner is visible. |
| Workflow evidence | **pass** | Frozen input/spec/capture hashes match; independent required identities and blind-first sequencing are recorded. Exact executed viewer arguments are preserved in the frame transcript. The hash-pinned harness identifies the exact check command and combines stdout/stderr into `check.txt`; exit 0 and windows are recorded. Measured dimensions, normal/selected/motion evidence, and cleanup records are present. |
| Animation | **blocked** | All six routes have one unobstructive dot in all five samples. Four longer routes show forward progression. The two shortest routes show only two alternating interior positions; their directed wrap versus back-and-forth motion cannot be established from these rendered samples. No actual dot collision or reversed-flow failure is proved. |

**Aggregation:** zero known failed categories/required static edges; one required category lacks sufficient direction evidence. Under the fixed aggregation rule the case is **blocked**, not pass and not a demonstrated failure. Finding severity does not waive the animation gate.

## Concept and label comparison

The source requires CLI, API gateway, authentication, job queue, worker pool, and Postgres. Its historical relationship list specifically uses `Auth`, so that visible abbreviation preserves source meaning.

| Visible label | Region | Source meaning retained |
|---|---|---|
| `CLI` | `[37,8,3,1]` | Source client |
| `API gateway` | `[37,16,11,1]` | Gateway |
| `Job queue` | `[24,24,9,1]` | Async queue |
| `Auth` | `[50,24,4,1]` | Authentication |
| `Worker pool` | `[24,32,11,1]` | Async workers |
| `Postgres` | `[37,40,8,1]` | Database |
| `enqueue` | `[28,20,7,1]` | API → queue |
| `verify` | `[41,20,6,1]` | API → Auth |
| `write` | `[28,36,5,1]` | Worker → Postgres |
| `read` | `[43,36,4,1]` | Auth → Postgres |

All ten graph labels are complete. There are zero fused labels and zero uncertain owners. `read` and `write` occupy the same row but are separated and each sits above its own horizontal corridor; this is **not a defect**. The generator's observation that two links lack text is likewise **not a defect**, because the source explicitly leaves them unlabeled and forbids invented protocols.

These are retained historical relation claims, not independent factual verification of a real deployed service. The source does not designate an individual link as unconfirmed or require a dashed route. The sample receives no hypothetical credit for dashed styling or trunks, neither of which it needs or uses.

## Complete required-edge audit

Normal capture coordinates follow. Box attachments are directly adjacent to their source/destination border; no route traverses a node interior.

| Edge | Expected and observed meaning | Stem-to-arrowhead trace | Result |
|---|---|---|---|
| e1 | CLI → API gateway, unlabeled | CLI bottom row 10; stem `(37,11)` straight down to `▼` `(37,14)`, immediately above API top row 15. Route region `[37,11,1,4]`. No crossing or junction. | Static **pass**; animation finding P-MOTION-01 |
| e2 | API gateway → Auth: `verify` | API bottom row 18; stem `(39,19)`, bend `(39,21)`, right to `(50,21)`, down to `▼` `(50,22)`, above Auth top row 23. Route region `[39,19,12,4]`; label `[41,20,6,1]`. | **pass** |
| e3 | API gateway → Job queue: `enqueue` | API bottom row 18; stem `(37,19)`, bend `(37,21)`, left to `(24,21)`, down to `▼` `(24,22)`, above queue top row 23. Route region `[24,19,14,4]`; label `[28,20,7,1]`. | **pass** |
| e4 | Job queue → Worker pool, unlabeled | Queue bottom row 26; stem `(24,27)` straight down to `▼` `(24,30)`, above Worker top row 31. Route region `[24,27,1,4]`. No crossing or junction. | Static **pass**; animation finding P-MOTION-01 |
| e5 | Worker pool → Postgres: `write` | Worker bottom row 34; stem `(24,35)`, down to `(24,37)`, right to `(37,37)`, down to `▼` `(37,38)`, above Postgres top row 39. Route region `[24,35,14,4]`; label `[28,36,5,1]`. | **pass** |
| e6 | Auth → Postgres: `read` | Auth bottom row 26; stem `(50,27)`, down to `(50,37)`, left to `(39,37)`, down to `▼` `(39,38)`, above Postgres top row 39. Route region `[39,27,12,12]`; label `[43,36,4,1]`. | **pass** |

No extra apparent link needs an `unexpected_link` audit entry. API has two independent outgoing ports at columns 37 and 39; Postgres has two independent incoming arrowheads at the same columns. Blank column 38 separates both pairs. These visible node-level fan-out/fan-in arrangements are exactly the requested separate paths, not misleading forks or a shared bus.

Every bend is accounted for: `(37,21)`, `(24,21)`, `(39,21)`, `(50,21)`, `(24,37)`, `(37,37)`, `(50,37)`, `(39,37)`. None touches a bend from another route. The long Auth corridor at column 50 does not touch Worker pool, whose right border is column 35.

## Borders, hue grouping, and selected-state coverage

Actual ANSI evidence gives these complete normal perimeters:

| Node | Box region | RGB | Checked perimeter cells |
|---|---|---|---:|
| CLI | `[36,7,5,4]` | `(216,166,87)` | 14 |
| API gateway | `[36,15,13,4]` | `(125,174,163)` | 30 |
| Job queue | `[23,23,11,4]` | `(211,134,155)` | 26 |
| Auth | `[49,23,6,4]` | `(147,194,183)` | 16 |
| Worker pool | `[23,31,13,4]` | `(226,156,175)` | 30 |
| Postgres | `[36,39,10,4]` | `(169,182,101)` | 24 |

All 140 normal perimeter cells are present and color-continuous. In `v1-selected.ansi`, all corresponding 140 cells are bold gold `(216,166,87)`, including every corner. CLI already has that hue normally; boldness provides its selected-state distinction. The two service nodes visibly share aqua shades across their different depths, while queue and workers share pink shades across successive tiers; this is evidence of semantic grouping rather than a depth-color claim.

Selected-state coverage is **6/6 occurrences** across one final view. The capture selects all nodes simultaneously; it does not demonstrate separate selection transitions, dragging, or additional handle states. No additional handle state is visibly rendered or claimed. Plain text was not used to prove border color.

## Finding P-MOTION-01 — direction evidence remains ambiguous on e1/e4

**Category:** animation. **Severity:** high, because missing required evidence prevents verification. **Status consequence:** blocked, not a demonstrated renderer failure.

The source explicitly requests slow, sparse traffic motion, with direction representing traffic flow. Every requested route was examined in all five timestamped actual-render frames:

| Route | 0 ms | 200 ms | 400 ms | 600 ms | 800 ms |
|---|---|---|---|---|---|
| e1 CLI → API | `(37,12)` | `(37,13)` | `(37,12)` | `(37,13)` | `(37,12)` |
| e2 API → Auth | `(39,20)` | `(40,21)` | `(41,21)` | `(42,21)` | `(43,21)` |
| e3 API → queue | `(37,20)` | `(36,21)` | `(35,21)` | `(34,21)` | `(33,21)` |
| e4 queue → Worker | `(24,28)` | `(24,29)` | `(24,28)` | `(24,29)` | `(24,28)` |
| e5 Worker → Postgres | `(24,36)` | `(25,37)` | `(26,37)` | `(27,37)` | `(28,37)` |
| e6 Auth → Postgres | `(50,28)` | `(50,29)` | `(50,30)` | `(50,31)` | `(50,32)` |

Coordinates are `(column,row)`, not the generator's row/column convention. The capture regions containing the ambiguity are `[37,11,1,4]` and `[24,27,1,4]` in every timestamped frame. Their arrowheads remain at `(37,14)` and `(24,30)`.

### What the geometry resolves

Each short route has four exterior cells: a source stem, two observed middle dot positions, and a target arrowhead. The geometry makes a directed cyclic loop between the two middle positions a plausible reading. The spec's positive `flow: 0.5` corroborates that this was intended. It also explains why the dot should not need to sit on the border or arrowhead to show traffic.

### What the geometry does not resolve

A rendered sequence `A,B,A,B,A` over only two positions is unchanged whether it represents forward wrap or back-and-forth motion. Neither the geometry nor a positive `flow` declaration proves which temporal behavior was actually rendered. Static downward arrowheads prove the link's direction, but cannot independently prove the dot's temporal direction. The frames show a 200 ms change cadence and a 400 ms repeating two-state pattern; they do not show a disambiguating third dot position or visibly distinct wrap transition on e1/e4.

Consequently, direction is established for the sampled progress of e2/e3/e5/e6, but not all six requested animated routes. I do not infer reverse flow from the resets, and I do not mark a known animation violation where the evidence supports an ordinary wrap explanation. Conversely, I cannot pass the category by treating intended `flow` as observed motion.

### Other animation observations

- Exactly one dot per route per sampled frame: 30/30 observations, six dots per frame.
- No dot is observed on a border, corner, arrowhead, bridge, junction, or label.
- The longer routes move in the source-to-target sense, generally one straight-run cell per 200 ms. The first e2/e3/e5 transition skips an ordinary corner in sampled coordinates; this is not a corner collision.
- Zero observed missing/duplicate-dot or obstruction violations.
- Longer routes are not shown for a complete cycle; no behavior outside the supplied 0–800 ms window is claimed.
- `v1-frames.ansi` has styled shell prompts but no diagram color escapes. It supplies no independent moving-dot hue evidence; the two ANSI stills do show gold dots and intact colored borders.

The generator's motion table is systematically one row too low relative to the graph header convention. For example it reports e1 row 13 at 0 ms, while the actual frame is row 12. Its claim that every route visibly establishes direction is stronger than the supplied captures support. Neither error changes the preserved captures; the independent coordinates above and in the immutable blind record control this review. I do not fail workflow merely because a self-report contains a correctable coordinate table error when the required primary evidence is preserved.

## Fit and workflow audit

### Fit

The capture manifest records pane `w7E:p6Y` with outer rectangle `{width:79,height:49,x:80,y:0}`, app interior `77×47`, and header token `77x47 @100%`. The frame transcript independently includes the startup line `viewport: 77x47 zoom: 1.00 natural` for normal, selected, and animation runs. The normal/selected ANSI grids each contain exactly 47 rows of 77 character cells.

The graph occupies columns 23–54 and rows 7–42. The lower-left control palette occupies `[2,41,9,6]`, ending at row 46 without covering the graph. The plain-text capture trims trailing spaces and the final blank row, giving 46 retained text lines; this is not clipping. Actual live pane interior dimensions are recorded separately from the required target in the result.

### Hash and execution binding

Verified against frozen metadata:

- Candidate skill: `7d1ff098d3ff460046e794c29925482ffd0ccb8c6fa493bc390758d976b75d70`.
- Renderer executable: `ee085c0f3a82e9b7d516cde7532f394864b3490c99691cd7ac5b2d36d640e8ea`.
- Rubric: `555e3b1d5881449b79eb1dc1d9538df2c4fe0880aa850becbf9060c1bf42f86f`.
- Dataset manifest: `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`.
- Actual final spec: `ac2d00ec9ba3f61092f46de4486e5f7749612bb2cb756527fe2f6afa932df2ec`.
- Deterministic `spec-manifest.json`: `b4fe1e889e73e771f44653580f489cd9a8c988042d3a0223383f7bc80c71824c`.

The result's `spec_sha256` deliberately stores the **spec-manifest digest**, as requested, not the individual spec digest. The manifest is a sorted array of repository-relative `{path,sha256}` pairs, serialized with two-space indentation and a final newline. It and the individual spec both appear in the evidence inventory.

The renderer's actual executable bytes at the frozen external `/tmp/visualize-eval/round-02/bin/rataflow-view` path were hashed without executing it and matched the recorded digest. The hash-verification record includes that external path because it identifies the bytes checked; the evidence inventory references the repository-relative verification record and binary hash record instead of using an absolute evidence path. No current renderer source is used to fill gaps in the executed evidence.

The actual normal/selected/frame viewer commands, including the absolute binary and absolute spec arguments, are preserved in `v1-frames.txt`. The exact check invocation is identified by the hash-verified frozen harness: the absolute binary with `--check` followed by the absolute spec. Its `> check.txt 2>&1` redirection preserves full combined stdout/stderr; manifest `check_exit` is 0 and its check window is `2026-11-02T09:59:05Z` to the same second. The capture window is `2026-11-02T09:59:05Z`–`2026-11-02T09:59:09Z`. No exact individual still-capture instant is invented.

One final view and one spec attempt are recorded. No new viewer, install, rerender, subagent, fix, or commit was used during review. No pane art is reproduced in this critique or the review replies. The supplied passing validator output does not resolve P-MOTION-01.

### Cleanup

- Capture pane `w7E:p6Y`: harness manifest records `confirmed_closed`.
- Size probes `w7E:p6S` and `w7E:p6T`: `generation.json` records `confirmed_closed` for each. Raw probe-close command output is not separately retained; the report does not promote those entries to independent live checks.
- Reviewer-owned panes: none opened.

These supplied pane-ID/result records satisfy the cleanup-record requirement. No current pane query was used to manufacture new frozen evidence.

## Correction candidates and capability blockers

No correction was made. The captain must collect all eight complete critiques before changing the skill.

### Skill/evidence-level candidates

1. Do not claim that a positive `flow` value plus a two-position alternating capture independently proves temporal direction. Record the ambiguity and refrain from self-certifying animation.
2. Check each required animated route, including the shortest ones. A smaller timestamp step can better establish cadence, but **smaller steps alone do not resolve a genuinely two-position cycle's orientation**. A later sample needs a visible disambiguating transition or enough distinct along-route positions to demonstrate direction.
3. If supported within the fixed viewport, give very short animated links enough route length to expose at least three distinguishable dot positions, without deleting labels/edges or sacrificing fit. Otherwise report the limitation rather than inventing a direction proof.
4. Correct the generator's row-origin convention in reports. Preserve the primary captures and report view-local coordinates consistently.

### Renderer-level candidates

- If the renderer always reduces short routes to two usable dot positions with no visibly distinct wrap, consider additional minimum route spacing or a perceptually distinguishable wrap treatment while preserving one live dot and intact borders/arrowheads. This is a candidate to investigate, not a claim about uninspected renderer internals.
- Merely adding diagnostic assertions or ordered route indices would not replace actual visible direction evidence for the reader.

### Unresolved blocker classification

**Confirmed renderer capability gap: none established.** This sample already demonstrates single-dot motion on all six routes and forward sampled progress on four. The blocker is insufficient rendered direction evidence for e1/e4, with an observed short-route two-position ambiguity. It is not proof that the renderer cannot implement directed motion, nor justification to stop the whole evaluation as an unsupported renderer capability.

## Deliverables and verification

Under `docs/visualize-eval/rounds/02/reviews/pipeline/`:

- `observed-first.md` — unchanged stage-A record.
- `reviewer-result.json` — all seven categories, six edge audits, evidence-linked finding, cleanup records, and blocked verdict.
- `critique.md` — this full comparison.
- `spec-manifest.json` — deterministic spec path/hash pairs.
- `hash-verification.json` — 18 actual-versus-frozen digest checks, all matched.

The result was checked against every applicable keyword in the embedded result schema with a dependency-free standard-library validator, and all evidence references and digests were checked. No package was installed. All Python commands used `uv`; all shell/Python calls included an intent comment. The blind record's original hash was rechecked and remains unchanged.

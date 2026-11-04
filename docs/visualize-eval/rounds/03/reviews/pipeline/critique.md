# Pipeline — round 03 independent Sol critique

## Verdict: FAIL

The diagram preserves the six required concepts and all six static source relationships. Its layout, conceptual colors, and normal/selected borders pass. It is **not green**: every frame-zero dot starts one cell too far downstream, which fails both animation and the rubric's explicit animated-direction proof rule. No supplied frame demonstrates arrowhead arrival, let alone simultaneous arrival. The generator's affirmative motion-verification claims contradict the captured cells.

Known failures remain failures even where another subtest lacks evidence. In particular, animation is **fail**, not merely blocked, because origin is visibly wrong; synchronized arrival is independently **blocked by missing evidence**, not presumed correct or presumed unequal.

| Fixed category | Decision | Basis |
|---|---|---|
| semantic_fidelity | **pass** | Six concepts and six static directed relationships; correct `verify`, `enqueue`, `write`, and `read` ownership; no invented protocol or extra link. |
| arrow_traceability | **fail** | All static routes are traceable, but all six off-origin starting dots fail the category's explicit direction-proof rule. |
| layout_fit | **pass** | Actual 77×47 content grid, natural 100%, startup viewport line, no clipping/occlusion, zero crossings. Outer live pane measured separately as 79×49. |
| conceptual_grouping_color | **pass** | Source-role tiers, related pink Auth/Job queue shades, plain common background; not arbitrary alphabetic/depth cycling. |
| border_integrity | **pass** | Complete, color-continuous normal and selected perimeters; selected coverage 6/6 node occurrences. |
| workflow_evidence | **fail** | Input/artifact hashes and closure records verify, but material generator origin/arrival claims are false against the captures. Full-cycle evidence and rejected-preflight records also have gaps. |
| animation | **fail** | Known origin defect on 6/6 routes; sparse slow forward movement otherwise visible. Arrival/synchronization remains blocked, not pass. |

Four of seven applicable categories pass. All six required-edge audits are `fail` under the strengthened origin/direction gate, **not** because their static endpoints, labels, or arrowheads are missing or reversed. There are no unexpected apparent relationships requiring additional edge-audit rows.

## Identity, paths, and frozen inputs

- Round integer: **3**.
- Generator: **`viz-ds03-1`**, model **`fireworks/accounts/fireworks/routers/deepseek-flash-latest`**. The captain's explicit identity and `metadata.json` worker map establish the actual worker label; I did not replace it with the generic `viz-ds03-pipeline` template from the full-task prose. `generation.json` records the fresh isolated generator session `01a19bf8-4ca5-7605-9156-51edcc9770e7` and Fireworks provider. No unrelated session transcript was read.
- Reviewer: **`viz-judge03-pipeline`**, model **`openai/gpt-6.1-sol`**. This matches the session's actual `PI_SUBAGENT_NAME` and `PI_MODEL=gpt-6.1-sol`. No model substitution or subagent was used.
- Evidence inventory paths in `reviewer-result.json` are **repository-relative**, based at `/Users/aviral/.herdr/worktrees/dotfiles/fix-visualize-skill`. The frozen executable is an external input at `/tmp/visualize-eval/round-03/bin/rataflow-view`; its bytes were hashed directly, while the inventory uses repository-relative metadata and `bin.sha256` proof paths.
- No earlier-round verdict, other case bundle, original chat outside the supplied excerpts, or current renderer source was used as evidence. Historical generated relations are the case's qualified reference, not independent domain fact verification.

### Reviewer-identity correction episode

The captain revealed that the frozen rubric had retained the stale round-01 identity `openai/gpt-6-astra` in `required_reviewer_model` and the result-schema reviewer-model const. Revision 4 and `metadata.json.frozen_input_corrections` record its correction to `openai/gpt-6.1-sol`, discovered during another review and made **before any reviewer-result.json existed**, with criteria and thresholds unchanged. The before-result chronology is the captain/metadata record, not an independent inspection of other reviewers' files.

I read the corrected rubric in full and verified its actual SHA-256 against corrected metadata. I emit my real Sol identity. The `workflow_evidence.pass_iff` prose still literally contains `openai/gpt-6-astra`; under the explicit reveal and corrected structured identity fields, that residual old name is not a demand to falsify identity, substitute a model, or block a genuine Sol judge. This clerical correction does not waive or weaken any visual gate. I did not modify the rubric.

### Verified SHA-256 values

| Input | Actual SHA-256, matches frozen metadata unless noted |
|---|---|
| Candidate skill | `cf796bcdc527897687ec2ca19844f399c921252409b9ca7ad04fbfa1b6cc659c` |
| Frozen executable | `b242b6a28e2e27934b06b7a297be638c143e5c99680495e104380cd8d9ee80f7` |
| Corrected round-03 rubric | `5519fd84f6b75973dbf7b5f5544c909a8f32a8841a876c8e7af00a1fcb119335` |
| Dataset manifest | `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05` |
| Pipeline source | `68aa197fdc597c3a22d1b8ca88a3ebee861dcda34684da15ae69b6946b741e58` |
| Pipeline expected data | `ea177d01af818876ff04bf707b923326b153185fd425f21ea96250486b504ec3` |
| Pipeline historical variant | `5d351c45f055d2ca115036d10ab4bd50fb1d22ccd87f31e018f01c3039b48659` |
| Single final spec, actual direct file hash | `4e0c24c911506682e6788059e8075fc85aa6659c7426714b6e53cf33bf04a7d8` |
| Immutable blind record | `e43aabafac6c9590a73074eaa5a586fc90d25508e7f81669df8ab4b6ee21cae2` |

The final spec equals the preserved third-attempt spec by SHA-256. Both capture manifests agree on that spec and the executable hash. All **14 manifest-listed artifact hashes** verify. The two workflow script files consulted/identified also match the corresponding frozen harness hashes; neither was executed by the reviewer.

The blind file is `docs/visualize-eval/rounds/03/reviews/pipeline/observed-first.md`, inventory ID `blind`. It was saved and hashed before the reveal, is unchanged, and is explicitly linked with `saved_before_expected_reveal: true`. The full machine inventory has 42 entries, including frame-specific aliases for precise locations in multi-frame files.

## Semantic and per-edge audit

All source-required concepts are visible, verbatim: `CLI`, `API gateway`, `Auth`, `Job queue`, `Worker pool`, and `Postgres`. No protocol was added to either historically unlabeled link. The source's separate authentication/queue and read/write paths remain independent. The historical variant's numeric flow fields were assistant-generated settings, not a new human request for different traffic rates; they do not exempt this candidate from the round-03 synchronization rule.

Coordinates below are 1-based `[column,row,width,height]` in the viewer grid, not the surrounding shell output. `normal-ansi` refers to `pipeline/evidence/v1/v1-ansi.ansi`; `origin-frame-0` and `final-frame-20` identify the corresponding marked frames in the origin and long motion files.

| Edge | Required meaning and observed static route | Label / arrowhead evidence | Audit decision |
|---|---|---|---|
| e1 | `cli → api`, unlabeled. First route cell `(37,11)` straight down to `(37,14)`; source border `(37,10)`. | No invented label. Unique intact downward head `(37,14)`. Route region `[37,11,1,4]`. | **fail** only under origin-direction gate; frame-0 dot `(37,12)`. |
| e2 | `api → auth`, `verify`. `(39,19)` → bend `(39,21)` → bend `(50,21)` → `(50,22)`; source border `(39,18)`. | `verify` `[41,20,6,1]`; head `(50,22)` above Auth. Route `[39,19,12,4]`. | **fail** under origin-direction gate; dot `(39,20)`. |
| e3 | `api → queue`, `enqueue`. `(37,19)` → bend `(37,21)` → bend `(24,21)` → `(24,22)`; source border `(37,18)`. | `enqueue` `[28,20,7,1]`; head `(24,22)` above Job queue. Route `[24,19,14,4]`. | **fail** under origin-direction gate; dot `(37,20)`. |
| e4 | `queue → worker`, unlabeled. `(24,27)` straight down to `(24,30)`; source border `(24,26)`. | No invented label. Unique head `(24,30)`. Route `[24,27,1,4]`. | **fail** under origin-direction gate; dot `(24,28)`. |
| e5 | `worker → db`, `write`. `(24,35)` → bend `(24,37)` → bend `(37,37)` → `(37,38)`; source border `(24,34)`. | `write` `[28,36,5,1]`; head `(37,38)` above Postgres. Route `[24,35,14,4]`. | **fail** under origin-direction gate; dot `(24,36)`. |
| e6 | `auth → db`, `read`. `(50,27)` → bend `(50,37)` → bend `(39,37)` → `(39,38)`; source border `(50,26)`. | `read` `[43,36,4,1]`; distinct head `(39,38)` above Postgres. Route `[39,27,12,12]`. | **fail** under origin-direction gate; dot `(50,28)`. |

Each whole static route can be followed from its own stem to its own arrowhead, without choosing between competing paths. All six arrowheads point downward toward the correct target, and remain intact in every full sampled frame. The failure is the newly explicit animated-origin requirement, not a retrospective rewriting of the blind record's positive static-traceability observation.

### Crossing and branch audit

Visible crossing count: **0**. Avoidable added crossing pairs: **0**, already the mathematical minimum. There are eight ordinary bends and **no touching bends, bridge glyphs, shared cells/corridors, or external junctions**. The gateway's two outgoing routes use columns 37 and 39; their row-21 runs are separated by blank column 38. The two Postgres incoming runs likewise remain separated by column 38 at row 37 and have separate arrowheads.

The intentional fan-out is at API gateway, not at an invented junction outside its box. The intentional convergence is at Postgres, not a bundled read/write route. There is no source-named bus in this case. No relation was merged to lower crossings. The final arrangement keeps the logical tiers; the source does not prescribe a left/right order between Auth and Job queue, so their final left/right placement is not a source-order violation.

The preserved LR probe reports extent 119×19 and was not used as final evidence. The three final-view attempts report zero crossings; attempts 1 and 2 lacked the auth-read relation, which was restored in final attempt 3. Those incomplete attempts are not silently counted as complete final views. The final view alone carries all six required relationships; no split or cross-view seam is needed.

## Fit, grouping, and borders

Both manifests measure the live Herdr rectangle as **79×49**, at x=80, y=0. The frozen-hash harness explains the 1-cell pane border, yielding the actual application surface **77×47**. This matches all 47 rows of the static ANSI grid, each exactly 77 cells after SGR removal. The origin motion scrollback retains the actual startup line **`viewport: 77x47 zoom: 1.00 natural`**; I do not rely only on a clean `--check` or the header fallback. The manifest's `viewport_line: null` reflects its extraction from the static file, not absence of the line from every capture.

All graph content fits within `[23,7,32,36]`, with all six complete node boxes and all ten graph labels visible. The floating controls at `[2,41,9,6]` do not occlude graph content. No content requires pan, zoom-out, clipping, or a hidden extra view. The check's 36×40 extent is a renderer-reported layout extent, not the independently measured on-screen nonblank bounding box.

The related Auth/Job queue nodes sit in the same control tier and share the pink hue family, respectively RGB `(211,134,155)` and `(226,156,175)`. Client, gateway, worker compute, and database state roles use their own Gruvbox families. These groups are tied to source roles, not just five numbered geometric depths. All boxes and the field use background RGB `(40,40,40)`, with no background dot decoration.

Every normal node perimeter has complete sides and all four rounded corners with continuous color:

| Node | Box bounds | Normal RGB | Perimeter cells |
|---|---|---|---:|
| CLI | `[36,7,5,4]` | `(216,166,87)` | 14 |
| API gateway | `[36,15,13,4]` | `(125,174,163)` | 30 |
| Job queue | `[23,23,11,4]` | `(226,156,175)` | 26 |
| Auth | `[49,23,6,4]` | `(211,134,155)` | 16 |
| Worker pool | `[23,31,13,4]` | `(169,182,101)` | 30 |
| Postgres | `[36,39,10,4]` | `(125,160,184)` | 24 |

Both selected ANSI captures show all **140 perimeter cells**, for **6/6 occurrences** in the single final view, bold RGB `(216,166,87)` with no lost sides/corners. CLI is distinguished by bold even though its normal RGB is already the selection color. This proves each displayed node's selected border in the simultaneous `--select-all` state. It does not prove isolated selection, drag/hover behavior, or handles that are not drawn; those are not claimed. Repeated bundles are the same view, not 12 different occurrences.

## Motion findings: defect versus evidence gap

### F01 — high: known origin defect; animation and arrow-direction gate fail

The complete `frame 0 at 0ms` is retained in the origin bundle. Every dot is on the **second** drawn route cell:

| Edge | Actual first cell | Frame-0 dot | Origin finding region |
|---|---|---|---|
| e1 | `(37,11)` | `(37,12)` | `[37,11,1,2]` |
| e2 | `(39,19)` | `(39,20)` | `[39,19,1,2]` |
| e3 | `(37,19)` | `(37,20)` | `[37,19,1,2]` |
| e4 | `(24,27)` | `(24,28)` | `[24,27,1,2]` |
| e5 | `(24,35)` | `(24,36)` | `[24,35,1,2]` |
| e6 | `(50,27)` | `(50,28)` | `[50,27,1,2]` |

This is a visible defect, not an inference from JSON and not a missing-frame blocker. The source-border cells are one row earlier still. Even the less strict definition of first cell *outside* the border is missed. The fixed rubric explicitly says an off-origin starting dot leaves direction unproven. This is why all six edge audits and arrow_traceability fail, although the static arrowheads are unambiguous.

### F02 / B01 — high: arrival evidence gap; synchronization subtest blocked

The long bundle loses the beginning of frame 0, but retains complete frames 1–20. The origin bundle recovers frame 0 and repeats frames 1–3 with matching cells. Together they provide 21 distinct timestamped positions, **0–3000 ms in 150 ms increments**, across two captures of the same spec and binary. They do not show a completed rendered cycle or an eventual wrap.

At `frame 20 at 3000ms`:

| Edge | Last captured dot | Required arrowhead cell | Finding region in final frame |
|---|---|---|---|
| e1 | `(37,13)` | `(37,14)` | `[37,13,1,2]` |
| e2 | `(46,21)` | `(50,22)` | `[46,21,5,2]` |
| e3 | `(28,21)` | `(24,22)` | `[24,21,5,2]` |
| e4 | `(24,29)` | `(24,30)` | `[24,29,1,2]` |
| e5 | `(33,37)` | `(37,38)` | `[33,37,5,2]` |
| e6 | `(45,37)` | `(39,38)` | `[39,37,7,2]` |

No route reaches its head in **any** supplied sampled frame. The six bare `▼` glyphs remain intact throughout. Therefore no frame establishes simultaneous arrival, despite the spec's six equal `duration_ms: 3000` fields and the check's `6 synchronized at 3000ms` line.

This fails the affirmative evidence gate. It is **not proof that eventual durations differ**: future motion and times between samples are unobserved. Calling all six non-arrivals at 3000 ms a synchronized successful finish would waive the explicit demand for visible arrowhead arrival. The animation category stays fail because F01 is already known, even while this subtest is blocked.

The blind scorecard's `dot_violations: 12` counted six non-origin route states plus six missing captured-window arrivals. It did **not** claim 12 independent renderer defects or proven unequal arrival times. Stage B retains that blind record unchanged and now classifies those observations precisely: six known origin defects and six route-level arrival-evidence gaps.

### Motion properties that do pass the sampled observation

Each complete frame shows exactly **six dots total, one per route**. No extra dot, dot collision, border dot, label obscuration, or sampled corner/bridge occupancy is visible. Inter-dot spacing on a single route is inapplicable with one dot. Movement follows each intended source-to-target route; repeated integer-cell positions are visible, especially on the short vertical routes. There is no observed reversal or wrap. The long/short routes have different cell speeds, which is allowed and expected for synchronized travel, but it does not itself establish arrival.

No dot occupies an arrowhead in the supplied samples. This protects the glyphs but does not satisfy the rubric's separate demand for arrival. The motion `.ansi` files contain plain graph-grid bodies; static/selected ANSI supplies color evidence instead. Continuous between-sample behavior and later completion remain unverified.

## Workflow findings, commands, and cleanup

### F03 — high: known false-positive verification

`generation.md` says both that every frame-zero dot is at its origin and that frame 20 shows all six dots at their arrowheads. The coordinates above directly contradict those affirmative observations. `generation.json` repeats the origin claim. The preserved check reports `origins: 6/6`, zero dot violations, and six synchronized routes, but those diagnostics do not inspect or override the actual captured positions under this rubric.

This is a **verification defect**, not an accusation of altered capture bytes: the hashes are consistent, and no tampering was established. It is nevertheless enough to fail workflow_evidence: broken visual claims cannot establish required evidence just because the files are reproducible.

The primary validator output has 28 PASS lines, including origins, synchronization, viewport, and cleanup. It did not detect these visible origin/arrival failures. The origin validator file retains only three attempt-budget PASS lines and `all checks passed`, not a full set of capture-validation lines. Neither is an independent Sol judgment.

### F04 / B02 — medium: missing failed-preflight records

`attempts.json` explicitly says two rejected drafts were not preserved:

1. A draft using top-level `duration_ms`, reportedly rejected as an unknown field.
2. An explicit-layer draft containing the read edge, reportedly rejected with a routing/spacing error.

The bundle has prose/error excerpts, not those exact specs, raw failed invocations, full stdout/stderr, or exit statuses. Their capability implications are reported claims, not independently reproducible failed-run evidence. This is a workflow **evidence gap/blocker**, distinct from a proved final graph defect. The preserved LR probe and three successful-check attempt files are present and hashed; they do not reconstruct the absent failed drafts.

### Commands and execution provenance

The two recorded capture commands, not replayed by this reviewer, are:

```sh
scripts/viz-evidence.sh --spec docs/visualize-eval/rounds/03/pipeline/spec-v1.json --bin /tmp/visualize-eval/round-03/bin/rataflow-view --out docs/visualize-eval/rounds/03/pipeline/evidence/v1 --label v1 --frames 21 --step-ms 150
scripts/viz-evidence.sh --spec docs/visualize-eval/rounds/03/pipeline/spec-v1.json --bin /tmp/visualize-eval/round-03/bin/rataflow-view --out docs/visualize-eval/rounds/03/pipeline/evidence/v1-origin --label v1-origin --frames 4 --step-ms 150
```

`generation.json.commands` also records the validator invocations. The hash-matched capture harness identifies the underlying `--check`, natural launch, `--select-all`, `--frames`, pane-read and cleanup commands. It redirects `--check` stdout and stderr together to `check.txt`, and records exit 0 in each manifest. Both final check files are complete nine-line combined streams, not fit/animation proof on their own.

- Primary pane **`w7E:pBP`**: check window `2026-11-02T11:17:33Z` to the same second; capture window `2026-11-02T11:17:33Z`–`11:17:37Z`; manifest `confirmed_closed`.
- Origin pane **`w7E:pBT`**: check window `2026-11-02T11:18:18Z` to the same second; capture window `2026-11-02T11:18:18Z`–`11:18:22Z`; manifest `confirmed_closed`.

The frozen-hash harness derives `confirmed_closed` after a close call and a failed pane-get probe. These are preserved cleanup results, not a fresh live query. There is no recorded cleanup failure or unclosed owned visualization pane. The reviewer created no live panes and did not rerun or repair the candidate. Capture timestamps in the JSON inventory denote preserved windows, not invented exact UTC times for individual deterministic frames.

## Correction candidates — no changes made

### Skill-level candidates

1. **Require visual disagreement handling.** Treat check/validator origin and synchronization counts as diagnostics, not acceptance. Compare the first and final rendered cell of every route and explicitly mark a contradiction. Do not certify “near the head” or “on the last horizontal run” as arrival at the head.
2. **Clarify timing-field scope.** The frozen skill describes `duration_ms` as shared timing without clearly limiting its JSON scope; the generator reports a top-level-field rejection and used identical per-edge values instead. Make supported placement explicit. The final spec's per-edge fields are accepted, so this reported mismatch is not a blocker to representing this source; the absent rejected draft limits stronger conclusions.
3. **Resolve conflicting endpoint prose.** Step 6 simultaneously prohibits dots on arrowheads and demands a final frame with dots at arrowheads. Align wording with the fixed rubric without hiding arrival or damaging arrowhead readability. Do not weaken the origin or simultaneous-arrival gates to accommodate the current render.
4. **Preserve complete evidence and failures.** Keep the entire frame-zero header/top grid and an actual completed-cycle finish; retain failed draft bytes, exact commands, stdout/stderr and exit status. The supplementary origin capture was a useful recovery, but a matching `duration_ms` field is not a full-cycle proof.
5. **Keep the semantic successes.** Preserve the separate labeled read/write routes, all six relations, role-based grouping, and complete selected-border coverage during any later revision. Do not change a relation or source tier merely to repair motion or reduce already-zero crossings.

### Renderer/harness-level candidates

1. **Audit rendered endpoint indexing and timing.** The frozen binary's frame-zero glyphs are one cell after the origins that the check declares valid. The rendered finish also fails to reach heads at the declared duration. Investigate these against the exact frozen binary behavior; no implementation root cause is established by this review. A per-route rendered-cell regression test for origin and terminal state would bind diagnostics to drawing.
2. **Make export/check finish evidence agree.** Any finish representation must make the prescribed common arrival visible while keeping arrow direction readable. A diagnostic derived only from equal configured durations cannot certify visible arrival.
3. **Avoid truncated motion export retrieval.** The 21-frame pane read lost the initial header/top eight lines despite the requested larger line count. Preserve a full export or otherwise verify retention; do not infer origin from an unmarked partial frame.
4. **Investigate the reported explicit-layer routing/spacing gap separately.** The final six-link graph routes without explicit layers. The unpreserved rejection does not establish a general unsupported routing capability, and no new capability test was run here.

The renderer is its **own baseline**. No renderer gain is credited to the candidate skill, and no earlier-round score is carried forward. These are correction candidates, not fixes. The captain must gather all eight complete critiques before revising the skill.

## Remaining blockers and verification of this review

- **B01:** No completed actual-render cycle/common-arrowhead-arrival evidence. The current captures cannot establish eventual simultaneous arrival. No additional viewer session was run to fill the gap.
- **B02:** Rejected-preflight specs/raw command/status records are absent; the supplementary validator output is only an excerpt. Do not substitute unrecorded diagnostics.
- The reported top-level timing-field and explicit-layer spacing capabilities remain **unverified limitations with final-spec workarounds**, not evidence that the source itself is unsupported. The observed origin failure and absent arrival proof still prevent green.
- No required judge/model tool is unavailable: the genuine Sol judge ran. There was no install or model substitution.

`reviewer-result.json` was checked offline against every assertion keyword used in the embedded result schema using a small standard-library validator; no dependency was installed. Evidence IDs, region bounds, six-edge coverage, input/artifact hashes, and the unchanged blind SHA-256 were also checked. This is schema/evidence consistency validation, not a replacement for the visual judgments above.

Reports:

- `docs/visualize-eval/rounds/03/reviews/pipeline/reviewer-result.json`
- `docs/visualize-eval/rounds/03/reviews/pipeline/critique.md`
- Unchanged: `docs/visualize-eval/rounds/03/reviews/pipeline/observed-first.md`

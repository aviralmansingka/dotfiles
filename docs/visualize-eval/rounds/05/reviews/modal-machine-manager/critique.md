# Round 05 — modal-machine-manager — independent Sol critique

## Verdict: FAIL

**Category matrix: 1 pass, 5 fail, 1 blocked.** No category is waived. Known failures remain failures even though target-state and execution evidence are missing. All 23 required directed endpoint pairs are drawn and all 17 concepts appear, but that is not 23/23 readable semantic coverage: the boot-response payload label is missing. All 23 animated arrows also violate the pinned origin rule.

All evidence paths in this review are **repository-relative to the dotfiles checkout**. Coordinates are 1-based `[column,row,width,height]` in the referenced application grid, not file line numbers; viewport/frame preambles do not count as grid rows. Unless a location explicitly references another frame, it means frame 0 of the pinned 77×47 sequence. The larger live ANSI grid is offset by `[+3,+2]` for corresponding graph geometry.

Reports:

- `docs/visualize-eval/rounds/05/reviews/modal-machine-manager/reviewer-result.json`
- `docs/visualize-eval/rounds/05/reviews/modal-machine-manager/spec-manifest.json`
- Immutable blind observations: `docs/visualize-eval/rounds/05/reviews/modal-machine-manager/observed-first.md`

Blind-record SHA-256, verified unchanged after reveal:

```text
b7ca27fd44d82ae71548bec970a74bf5929efc189aba4e921df26d508eb346e2
```

The result inventory includes that file/hash and sets `saved_before_expected_reveal: true`. It inventories all four individual final specs and the deterministic sorted spec-path/hash manifest. `spec_sha256` is the manifest's actual SHA-256:

```text
b13bae2e31647946128512d24d30ad09349fb0d47e7f42f6dcc05568b63bd6f0
```

## Identities and reproducibility

The result uses the full-task prescribed case aliases `viz-ds05-modal-machine-manager` and `viz-judge05-modal-machine-manager`. The captain supplied the generator's underlying launch identity as `viz-ds05-6`; `generation.json` describes the fresh isolated DeepSeek worker as case 6 of 8. Its model is `fireworks/accounts/fireworks/routers/deepseek-flash-latest`. The separate reviewer is `openai/gpt-6.1-sol` (the session reports `PI_MODEL=gpt-6.1-sol`). No model substitution or delegation occurred. The stale Astra name inside one workflow prose sentence is superseded by the rubric's required reviewer model, schema constant, and recorded clerical correction; it is not a demand to switch models.

Verified against actual frozen bytes:

| Input | SHA-256 |
|---|---|
| Candidate skill | ff4a9d3f32ba0bf86e54ee6bfbac02fdea3fac3b95b82a958b3411accef0a949 |
| Frozen renderer binary | b1ab9f2e78af11c2f2b005eea083a999079d184bf550e8d0b6d9c51867f22404 |
| Round rubric | 039b96252d25ad2078a539fdb1d081ebdb6c09d6f7a3487b96ffbbf3b082e292 |
| Dataset manifest | e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05 |

The case source, expected data, and historical variants also match the frozen metadata. The binary was hashed, **not executed**. No current renderer source tree was used as proof of the executed renderer's behavior. A renderer correction would be a renderer change, not a skill-only gain.

## Fixed seven-category decisions

| Category | Status | Decisive evidence |
|---|---|---|
| semantic_fidelity | **fail** | Required `boot.ipxe + S3 args` text is absent; `verify` is not displayed in `audit reimage`; source fastest-heartbeat/slow-ops qualifiers are explicitly dropped. F01–F03. |
| arrow_traceability | **fail** | Static paths have unique correct heads and no crossings, but 23/23 dots start downstream of their arrow origins. Five owner problems localized blind, six reported, without the recorded-impossibility exception. F04–F05. |
| layout_fit | **fail** | Correct final-spec 77×47 natural-100% dumps are present, but v1 loses the first character of `machine rows`; v2 loses a full required label. All boxes otherwise fit. F01/F06. |
| conceptual_grouping_color | **pass** | Actual regular ANSI supports concept-based related hues and proximity: control interfaces, human ingress/Slack, providers, machines/agent/boot, state/storage, and ops. Not a row-depth grouping. |
| border_integrity | **blocked** | Live 83×51 normal and selected perimeters are complete/color-continuous for 25/25 occurrences. Target evidence is plain text only; selected/color coverage at 77×47 is 0/25. F10. |
| workflow_evidence | **fail** | Blind-first record and verified identities/hashes exist, but exact executed commands, rejected-check statuses, original bytes for reconstructed drafts, and raw close outcomes are incomplete; attempt accounting is inconsistent. Target selected/color proof is also absent. F10–F12. |
| animation | **fail** | One live dot per line is met and default constant mode is legal; origin failures, non-origin corner occupancy, short repeated stem loops, and unequal drawn-cell jumps remain. F04/F07–F09. |

The conceptual grouping pass is scoped to the evidenced semantic grouping/color choice, not a substitute for complete target selected-state proof. In v3, for example, machines and machine-agent use related blue shades, S3/Postgres related greens, and public gRPC pink. Singleton family collisions do not establish a false source grouping by themselves. No separate cross-view exact-hue-stability gate is added. The generator's claim that each repeated node keeps exactly one color is not needed or relied on.

## Source coverage and every relation

The source relations are historical architecture claims, explicitly **not independent fact verification** of present-day Modal. This review judges preservation of that qualified reference, not whether the real production architecture is correct.

All original components occur: cp, web, pgrpc, wapi, pub, boot, q, rec, ssh, db, s3, reg, prov, mch, agent, jan, slack. Registry and machine-agent are explicit, not silently merged. The four-view coverage map uses repeated IDs to connect request, jobs, boot, heartbeat, diagnostics, and reconciliation. There are no extra drawn arrows or freestanding apparent branch relations to add as unexpected links. Label misassociation risk is audited separately, not converted into invented geometric edges.

The JSON report contains a complete per-edge audit with endpoint IDs, direction, source border exit, first external cell, all bends, final head, visible label coordinates, source references, finding links, and a status for **each of the 23 relations**. All 23 audit statuses are fail because the rubric explicitly makes a late origin disqualify an animated arrow, even where static geometry and label semantics are otherwise sound.

| Edge | Required directed relation / meaning | View | Additional issue beyond universal late origin |
|---|---|---|---|
| e1 | cp → pgrpc: create / terminate / repair | v1 | Retains all three verbs. |
| e2 | web → wapi: http | v1 | Meaning and static direction retained. |
| e3 | pgrpc → q: enqueue job | v1 | Corner-skip speed comparison below. |
| e4 | wapi → q: reinstall / reprovision | v1 | Recoverable abbreviation, uncertain owner. |
| e5 | q → reg: provision job | v2 | Meaning and static direction retained. |
| e6 | reg → prov: provider API | v2 | Text appears closer to reconcile's adjacent route. |
| e7 | prov → mch: allocate instance | v2 | Recoverable `alloc instance`. |
| e8 | mch → boot: iPXE request | v2 | Two-position stem loop never traverses head end. |
| e9 | boot → mch: boot.ipxe + S3 args | v2 | **Entire payload label skipped.** Rightward response arrow itself exists. |
| e10 | mch → agent: runs on host | v3 | Residency edge remains, but label owner uncertain and stem loops. |
| e11 | agent → pub: register + heartbeat | v3 | Recoverable `register+hb`; fastest-path qualifier absent. |
| e12 | pub → db: machine state | v3 | Payload retained; heartbeat-path qualifier absent. |
| e13 | pgrpc → db: machine rows | v1 | First character clipped at target size. |
| e14 | q → db: job rows | v1 | Meaning and static direction retained. |
| e15 | q → ssh: audit / verify reimage | v4 | `audit reimage` does not display verification; slow-path qualifier absent. |
| e16 | ssh → mch: run machine-audit | v4 | Action identifier retained; slow-path qualifier absent. |
| e17 | mch → s3: pull boot image | v3 | Recoverable `pull boot img`, distinct from uploads. |
| e18 | q → s3: diagnose uploads | v3 | Independent jobs/S3 route retained; owner uncertain; non-origin corner dot. |
| e19 | q → jan: diagnostic events | v4 | Independent janitor route retained; slow-path qualifier absent. |
| e20 | jan → wapi: proposed actions | v4 | **Proposal relation retained**, not deleted to route ops; slow-path qualifier absent. |
| e21 | wapi → slack: confirm + alerts | v1 | `confirm/alerts` retains both meanings. |
| e22 | rec → prov: gcore sync, 1 min | v2 | Period retained as `1m`; non-origin corner dot. |
| e23 | rec → db: cluster state | v2 | Separate write retained; label owner uncertain. |

`reg`, `mch`, `s3`, `db`, and `wapi` are not substitutes for one another. Moving reconcile writes into v2 preserves their endpoint relations across the split; this is a valid workaround, not a missing ops view. The standalone ledger contains stale earlier view assignments and descriptions, while its final coverage map and `generation.json` give the current four-view map. Captures, not the stale rows, determine this audit.

### F01 — required boot-response label missing — critical defect

In `pinned-77x47/v2-frames.txt` frame 0, the boot server is [14,39,13,4] and the machines box [14,31,10,4]. The return route goes [13,40] → [11,40] → [11,32] → rightward head [13,32]. Its **label never appears**. Both the final check and the pinned warning identify `boot.ipxe + S3 args` as skipped. The historical chain explicitly contains that response; the source fixed constraints require both directions. An unlabelled return arrow preserves an endpoint pair but loses the payload meaning. Keeping the string in the JSON or a ledger does not pass.

### F02/F03 — qualifier and action losses — high/medium defects

`generation.json#/deliberate_drops` admits that fastest-heartbeat and slow-ops qualifiers leave the drawing. Calling them latency commentary does not exempt them from semantic preservation. This is **not** a request to revive different animation speeds: legal shared-rate motion can coexist with textual qualifiers. The claim that the renderer has no latency-annotation field does not demonstrate that meaningful source words cannot survive in labels/captions/splits. The source's `verify` action also is not visible in `audit reimage` at [35,22,13,1]. No on-view abbreviation key supplies that missing action.

### F04 — check and pixels disagree on all origins — high defect

The node-border exit is the source port. The first drawn external route cell is the required origin. For v1 e1, border [13,14] is followed by `│` [13,15], but the frame-0 dot is [13,16]. This is unambiguously one cell late. The blind record enumerates all 23 analogous cases, including the leftward e9: border [14,40], required origin [13,40], actual dot [12,40].

Measured origin passes: **0/23**. Check claims: **7/7 + 7/7 + 5/5 + 4/4**. The generator independently disclosed the same one-cell-late reading, although its generic `motion_proof` sentences claim success and some example coordinates use a different base. The verdict follows the measured 1-based coordinates and pinned definition, not the green origin counter or validator pass.

### F05 — five localized, six reported uncertain owners — high defect

- v1 `reinstall/reprov` [29,24,16,1]: also above the end of the neighboring private-gRPC/queue route.
- v2 `provider API` [18,21,12,1]: appears beside reconcile's column-17 path, not its own column-15 stem.
- v2 `cluster state` [36,21,13,1]: close to both reconcile routes.
- v3 `diag uploads` [36,15,12,1]: close to the queue/S3 route and machine/S3 run.
- v3 `runs on host` [21,18,12,1]: immediately below the machine/S3 run, though it describes machine-agent residency.

The checks report 1/2/2/1. Neither the v4 check nor the generator identifies the sixth label, and blind observation could not uniquely localize it. Preserve **five independently localized plus one unlocalized reported instance**, not six invented coordinates. No claim that no unambiguous placement existed is demonstrated. The rejected drafts show limited attempts, not a proof of impossibility.

### F06 — one clipped character — low defect, still fails fit

Pinned v1 displays `achine rows` at [1,28,11,1]. The missing `m` would sit at column 0. The live 83×51 drawing has complete `machine rows` at [3,30,12,1]. The clean natural extent and absence of an overflow banner cannot override the clipped target capture. Severity is low because the meaning remains recoverable, but the full-label gate still fails.

## Motion: what passes, what fails, and what is not a gate

Animation is required by the case manifest and the final human source request. The history moves from rapid dots through static attempts back to slow sparse motion, ending with **one live dot per line**. The final specs use `flow: true`, `dots: 1`, default constant timing, no numeric rate, and no same-arrival override. There are exactly 7/7/5/4 dots in each respective view's frames, one per route. That end-state constraint passes; dots are neither on borders nor over labels.

**Unequal arrival times are legal.** This review does not require synchronization or impose a generic constant-mode arrowhead-arrival test. The blind observation that no dot touches an arrowhead is retained as an observation, not converted wholesale into a same-arrival failure. Different lap periods in different routes are expected.

Independent defects remain:

1. **All 23 origins fail** as above.
2. **F07: two non-origin corners carry dots.** Reconcile/providers e22 dot [49,20] is a corner, not its true origin [49,19]; queue/S3 e18 dot [49,16] is a corner, not origin [49,15]. The origin-corner exception cannot apply. The e18 corner repeats at frames 0/1 modulo six.
3. **F08: disclosed two-position stem loops.** The generator names e8 (machines/boot) and e10 (machines/agent). Measured 1-based positions are e8 [15,36] ↔ [15,37], head [15,38]; e10 [19,16] ↔ [19,17], head [19,18]. Both reset every four frames instead of flowing through the complete arrow. Several other four-cell stems behave the same way. The counter reports one violation in each of v2/v3 without route IDs, so generator attribution is not independently established by the counter alone.
4. **F09: shared eligible-cell cadence is not equal drawn-cell speed.** Between v1 frames 0 and 2, before a wrap, e1 moves [13,16] → [13,17], one drawn cell, whereas e3 moves [15,24] → [16,25] by skipping its intervening corner, two drawn cells. The default mode choice is correct; renderer traversal over drawn cells is not uniform.

The immutable blind record also highlighted the short **dogleg** cycles v2 e23 and v3 e18. Those observations remain true but are distinct from the generator-named straight stems. In particular v3 e18 visits **two straight cells plus a corner**, three visible positions, so a literal claim that it has only two visible cells would be false. Stage B adds the now-revealed generator attribution; it does not rewrite the blind record to fit it.

### Full-cycle evidence, without new sessions

The delivered pinned files contain 28/66/56/30 frames. At reveal, the already-preserved long target-size probes are also available:

| View | Existing probe | Range | Longest-route dot recurrence |
|---|---|---|---|
| v1 | `probe/v1-frames45.txt` | frames 0–44, 0–4400 ms | [15,24] at 0 and 28 |
| v2 | `probe/v2-frames120.txt` | frames 0–119, 0–11900 ms | [49,20] at 0 and 66 |
| v3 | `probe/v3-frames120.txt` | frames 0–119, 0–11900 ms | [21,16] at 0 and 56 |
| v4 | `probe/v4-frames45.txt` | frames 0–44, 0–4400 ms | [33,20] at 0 and 30 |

Their headers name the final specs at 77×47, and each pinned sequence is byte-for-byte equivalent in grid/frame content to the corresponding probe prefix. Each longest route's own recurrence is established; the shorter routes need not recur simultaneously. Thus full target cycle evidence is **present** after reveal. The 1000-line live tails are still not full live-cycle captures; they are not used as the target motion proof. No new frames were generated.

## Fit, topology, and borders

Pinned app viewport is `77x47 zoom: 1.00 natural`; live header is `83x51 @100%`. The round metadata explicitly allows a pinned final-spec dump when the live tab is larger. Therefore the exact-live-target geometry limitation does not by itself block layout-fit proof. It also does not manufacture target ANSI/selected proof.

All 25 boxes have complete normal geometry and labels; no palette overwrites a node border. The v2 boot-server bottom at row 42 sits beside the palette, not under it. All arrowheads remain visible. There are zero crossings, zero bridges, zero joining touching bends/shared runs, and 22 ordinary route corners. The adjacent unlike-route corners at v2 [49,20]/[49,21] and v3 [49,16]/[49,17] have no mutually connecting arms. Distinct ports at boxes, not freestanding fake junctions, account for splits and convergences.

All routes except the boot return are coordinate-monotone between their external endpoints. The boot return is four cells longer than the unconstrained endpoint Manhattan route but must use lateral ports and avoid the stacked boxes; no shorter obstacle-safe alternative is demonstrated. The missing `routes:` line is expected in this frozen reverted build and is explicitly excused by the frozen harness correction. It is **not** a new workflow blocker and does not establish bad economy. No route-economy failure is invented.

**F10: target-state evidence gap.** The live normal/select-all ANSI captures prove color continuity and own selected perimeters for **25/25** occurrences. At 77×47 there are only unselected plain-text frames, so target selected/color coverage is **0/25**. This is an evidence gap, not a discovered broken border, and blocks the border category. The workflow category cannot pass with that required evidence missing either.

## Workflow defects, evidence gaps, and cleanup

**F11: reproducible execution records are incomplete.** All four manifests include final `check_exit: 0`, capture windows, artifact hashes, app-measured live dimensions, and `cleanup: confirmed_closed`. All required final text/ANSI/selected files exist. However the bundle does not preserve exact per-execution argv, per-rejected-check exit statuses, full stdout/stderr attribution, or verbatim close-result probes. Narrative examples of `COLUMNS=77 LINES=47` are not the original executed commands. Seven rejected specs are marked reconstructed after overwrite; a reconstructed plausible JSON is not proof of the exact bytes originally executed. These are missing-evidence blockers and a known workflow-evidence failure, not permission to waive visual defects.

**F12: the stated attempt exception is internally inconsistent.** `attempts.json` has 17 entries, counts 3/5/3/6. Its own rule says at most three per view. Raw files demonstrate five hard routing refusals, all v4 a1–a5, **not nine**; other checks returned layouts that were too large or warning-bearing. The text says six reconstructed drafts but **seven** entries are flagged. The validator's budget failures are preserved. Budget overrun is a procedural deviation, not an added eighth rubric category or the sole reason workflow fails.

Capability limit: those five refusals support a real **local renderer routing limitation** for the attempted combined ops/reconcile layouts. Both orientations were tried. The final split validly moves the reconcile pair into v2; it does not demonstrate that all possible semantically complete layouts are impossible. Likewise, repeated skipped boot labels show failure of the attempted layouts, not proof that a skill-level shortening may delete the payload. These limitations must be reported without promoting the closest subset to green.

Cleanup inventory:

| Pane | Preserved evidence | Judgment |
|---|---|---|
| w7E:pH6 | v1 manifest `confirmed_closed` | Recorded closed; no verbatim close output retained. |
| w7E:pH7 | v2 manifest `confirmed_closed` | Recorded closed; same limitation. |
| w7E:pH8 | v3 manifest `confirmed_closed` | Recorded closed; same limitation. |
| w7E:pH9 | v4 manifest `confirmed_closed` | Recorded closed; same limitation. |
| w7E:pGZ | generation narrative says closed | Closure proof gap. |
| w7E:pG0 | generation narrative says closed | Closure proof gap. |

The result lists the four manifest-confirmed panes as closed and all six as owned, with cleanup verification **blocked** for the two narrative-only probes/raw results. This does not assert a leak. The reviewer created no panes and ran no cleanup or live viewer command.

## Correction candidates — no changes made

### Skill / generator / evidence procedure

- Reject unreadable semantic coverage even when all endpoint pairs exist in JSON. Reserve the response payload and all source action/qualifier words before choosing a split.
- Keep the original executed drafts, exact argv/environment size pins, stdout/stderr/status and raw close outcomes as execution happens, rather than reconstructing them later.
- Capture normal and select-all ANSI/buffer at the **target** size, not just a larger pane. Retain full frame sequences rather than a 1000-line scrollback tail; the existing direct probes demonstrate a viable frozen motion-evidence path.
- Keep counting truthful: five raw renderer refusals, seven flagged reconstructed drafts; do not use inaccurate refusal counts to justify exceeding the declared budget.
- Treat impossible-to-place labels as explicit blockers before accepting a candidate. A ledger-only payload, qualifier, or owner assignment does not repair the visible graph.
- Do not promise exact per-node cross-view hue stability or structural prevention of ambiguous labels when the executed evidence does not show it.

### Renderer-level candidates

- Align the animated route's t=0 cell, check-origin calculation, and displayed route to the exact first external drawn cell. Include that cell even when it is a corner.
- Advance by physical drawn-route distance while preventing non-origin corner dwell; do not gain speed by skipping cells. Handle short routes without a misleading two-position reset loop, preserving the source's required one-live-dot intent or reporting inability.
- Make required-label slot failure a hard semantic/layout rejection or provide an obstacle-safe placement; retain unique label ownership and accurate check diagnostics.
- Include full label bounds in centering/fit so a nominally fitting extent cannot lose its first character.
- Improve local route-capacity diagnostics without deleting, merging or reversing source relations.

These are candidates for the captain after all eight critiques, not edits made in this review. No skill, renderer, spec, expected input, capture, or blind record was changed. No model/tool capability was substituted. The unresolved target selected/color and raw execution/cleanup evidence gaps prevent green even if the known visual defects were repaired later.

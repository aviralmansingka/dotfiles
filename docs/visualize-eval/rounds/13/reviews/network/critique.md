# Network — round 13 independent verdict

**Overall: FAIL.** Seven categories pass; animation and workflow evidence fail. All seven required source relations pass the edge audit. Paths in the result and this critique are relative to the repository root. The stage-A record remains unchanged and was saved before the source, brief, and expectations were revealed.

| Category | Verdict | Reason |
|---|---|---|
| semantic_fidelity | PASS | All six nodes and seven directed relationships, labels, and distinct core→Redis and Web→Redis connections appear. |
| arrow_traceability | PASS | Seven separate traceable routes, no fake junctions or crossings; zero unrelated-node near misses both visually and in check. |
| layout_fit | PASS | Final-spec pinned 77×47 dump is natural 100%, complete, no overflow. Actual live pane is 68×44. Source order Web then Redis is retained in the fan. |
| navigation_clarity | PASS | One connected concept, one graph, fitting branch A. It is exempt from a title/description requirement. |
| conceptual_grouping_color | PASS | Fabric is blue, tiers purple, source order preserved, no group enclosure; only one view so no cross-view hue change. |
| category_fit | PASS | Service-meshes is a reasonable dominant classification: core fan plus distinct relations converging on Redis and DB, low identifier density. Source-ordered fan and distinct co-viewed Redis edges are visible; the borrowed chain spine and static-application deviation are recorded. There is no literal opposite-direction edge pair; the choice is justified by fan and convergence, not an invented anti-parallel pair. |
| border_integrity | PASS | Normal and select-all ANSI show complete, color-continuous sides and corners for all six boxes without palette overlap. |
| workflow_evidence | FAIL | The capture cannot prove traversal of the two short animated arrows, despite the audit's pass. Four distinct candidates were checked against a cap of three, openly disclosed. Triage summary also miscounts annex answers. |
| animation | FAIL | The WAN→Firewall and Firewall→Core dots cycle over two cells and do not visibly traverse their arrows; audit output conflicts with the actual frames. Fan dot motion and destination color binding are visible. |

## Findings

1. **Short-route motion (medium; engine-level observable defect).** In pinned frames 0–29, the WAN→Firewall dot alternates between [39,8] and [39,9], and Firewall→Core between [38,16] and [38,17], two frames at each position before wrapping. Neither reaches the route's bends or target arrowhead. The fan dots traverse their runs and wrap after frame 21. The frame-audit command was rerun on the frozen pinned dump and reproduces its recorded PASS, four steady routes and 0.500 cells/frame; nevertheless, its route-table inference is inconsistent with the actual first two tracks. Constant-rate arithmetic alone does not prove reader-visible direction along those arrows or a full-route traversal. The audit's association/measurement warrants investigation; this review does not assert a specific implementation cause.
2. **Evidence (high).** The supposed full-route motion proof is not established for the first two arrows. The validator's green result and `--check` `0 violations` do not override what the captured frames show. The graph itself still makes each arrow direction clear, so the static edge audits pass.
3. **Candidate budget (medium).** `attempts.json` records a1, a2, a3 and a4 as four distinct checked candidates and expressly discloses the one-candidate overrun. Calling a1 an abandoned orientation probe does not turn it into a non-candidate or waive the cap. Disclosure keeps the record candid, but does not make the process compliant; the validator's budget PASS must be read in that context.
4. **Triage accounting (low).** Seven plausible questions are recorded, with four actual verbatim annex answers, one framing/source answer and two justified own judgments. The terse framing genuinely calls for substantial triage; shape and speed decisions follow the annex, source and one-view preference. No fabricated interaction or invented node/relation is attributed to the reader. However, `converged_when` says five answers came from the annex, contradicting the four individual annex attributions. The record says the four reader answers resolved the shape, with later questions decided from the frozen inputs rather than further user turns. Q5 and Q7 restate constraints already resolved, and Q6 is a presentation judgment, not a new source fact; they add accounting overhead but do not establish an invented dialogue.

## Per-surface and cross-surface audit

One surface, no canvas. Each of the seven rows in `reviewer-result.json` identifies the source relation and a pinned-frame region. No extra apparent relation was seen. The check's `labels: 7/7 placed, 0 leader-ticked, 0 on route, 0 skipped, 0 ambiguous owners` and `passes-near-unrelated-node: 0` agree with the final capture. The static Web→Redis arrow is three cells long, with a visible arrowhead and label; static treatment is disclosed. The a3 probe reported one ambiguous owner rather than a leader tick; it was not the shipped surface. Source fan order (Web, Redis) is preserved by the final pinned ranks; final fit is 34×41 by check. There is no canvas title, description, origin, overlap, or cross-diagram hue question to assess.

Each animated route has one dot. The ANSI dot hues match their respective destination borders, with zero shared-hue pairs, as check reports. Dots on the four speed-labelled transport routes are a disclosed own-judgment choice; the three application relations stay static. All speed labels remain visible. Equal intended rates are appropriate for the instruction that dot speed is not the link measurement, but the captured short-route resets defeat the intended direction signal; the frame-audit pass cannot establish the claimed visual behavior.

## Provenance, hashes, and cleanup

`cases.json` was independently hashed as `e69179e59a3d36985cd7e8692b319b566701f88caef385c9cbde76d060c92d05`, matching the corrected digest and frozen metadata. The frozen renderer, rubric, skill, final spec, and saved blind record were independently hashed; the results and evidence hashes are in the JSON. The top-level schema forbids extra keys, so the explicitly requested blind hash is provided in the blind evidence item and in `categories.category_fit.blind_observation_sha256`, rather than as a forbidden top-level property. Manifest confirms owned pane `w7E:pZY` closed. No new viewer sessions were opened.

## Correction candidates and blockers

- **Engine / audit:** investigate short-route dot traversal and route-associated frame auditing; test actual dot coordinates against each routed arrow rather than relying on aggregate displacement. Avoid concluding that the engine or the audit alone caused the discrepancy without further instrumentation.
- **Skill / workflow:** enforce the candidate cap across probes and rejected shapes, or seek an explicit exception before another candidate; reconcile triage answer counts with individual sources. Preserve the good source-order pins, near-miss relief and label ownership checks.
- **Blockers:** none. There is a known failure, not an unsupported capability requiring a blocked verdict. Fixes were not attempted.

# Round 11 decision

## Outcome

**2/8 green — pipeline (carried) + network. 27 pass / 13 fail / 4 blocked
of 44 applicable categories.** Frozen inputs: skill proposal-10 `fb975dbe…`
(families demoted to hints), rubric rev 10 `5e09b9be…` (category_fit
softened: deviations with recorded reasons pass), binary UNCHANGED from
round 10 (`db70722b…`) — the round isolates the skill-layer change.
Six recipe-impacted cases regenerated; pipeline (r10 PASS) and
datacenter (r10 FAIL on non-recipe grounds) carried.

## 10 → 11 movement (the skill change, isolated)

| Case | r10 | r11 | What moved |
|---|---|---|---|
| network | 6/8 F | **8/8 P** | fan order fixed (layers pins, pixel-verified); all residuals cleared |
| server | 5/8 F | 6/8 F | category_fit F→P; new qualifier misses (caveat wording, hop attribution) |
| homelab | 3/8 F | 5/8 F | category_fit F→P; arrows F→P; new misses (metric 600, Oct-11 date) |
| runtime | 5/8 F | 5/8 F | category_fit F→P; gRPC qualifier + shared-gutter labels persist |
| machine-mgr | 4/8 F | 3/8 F | category_fit F→P; oscillation + ambiguous labels persist (engine) |
| gb300 | 5/8 F | 4/8 F | category_fit F→P; CDU/PDU gap upheld; serves-:9400 ownership fail |

**The softened rule works:** every rerun case now passes category_fit —
generators borrow family habits, deviate with recorded reasons, and are no
longer punished for honest deviation. The remaining failures concentrate
in the same recurring clusters.

## Residual clusters (round-12 candidates)

1. **Attribution/qualifier losses** — metric 600, gRPC verb, altered
   caveats, unsupported observations (server, homelab, runtime, gb300,
   mm). The never-drop rule exists; generators still trim under budget
   pressure. Needs skill enforcement or a qualifier/annotation field.
2. **Gutter label ownership** — shared bands defeat owner assignment
   despite the checker's 0-ambiguous (network-10, runtime ×2 rounds,
   mm ×2 rounds, gb300). The standing engine item.
3. **Dot oscillation on short routes** (mm ×2 rounds) — checker
   falsely reports constant speed.
4. **CDU/PDU vs one-trunk** — the human's one-split demand caps spurs
   at 3; full device coverage needs a second trunk or annotation field.
5. **Workflow formalism** — dataset-index digest methodology mismatch
   (5 consecutive rounds) and stray manual-probe records.

## Process notes

- Judge spawns for network crashed twice at startup; the captain executed
  that review directly (blind record written before reading
  expectations; reviewer identity honestly recorded, flagged by the
  aggregator as a deviation from the frozen judge model).
- One disclosed mid-round harness fix: the capture script's header wait
  now polls for the app's own header (bounded 60 s) instead of matching
  the command echo — pane captures recovered across all cases.

## Stop-rule assessment

Continue to round 12. The skill change delivered its intended effect
(category_fit unblocked); what remains is engine work (attribution,
oscillation) plus one design decision (CDU/PDU trunk tension) and
harness formalism. Human review tabs (round 10 left vs round 11 right)
open next; feedback to `rounds/11/human-review/feedback.md`.

# Round 10 decision

## Outcome

**1/8 green — the first fully passing case since round 02.** 34 pass /
22 fail / 4 blocked of 60 applicable categories (4 critical, 16 high,
6 medium, 1 low). Frozen inputs: skill proposal-09 `9c125679…`
(coverage-first lifecycle recipe, never-drop, sibling order, port-centering,
full-lap frames), binary `db70722b…` (r10-routing + r10-ports + r10-hue
merged tree at `749db37c`), rubric rev 9 `10590383…` (terra:high),
dataset byte-identical to round 09 (24/24 per-file hashes; the two
`cases.json` digest flags are a judge-side canonicalization quibble,
documented below). Generators: DeepSeek. Judges: gpt-6.1-terra:high.

## Three-round trend (categories P/F/B, 8 cases)

| Category | r08 | r09 | r10 |
|---|---|---|---|
| semantic_fidelity | 2/6/0 | 1/7/0 | 2/5/0 |
| arrow_traceability | 3/5/0 | 3/5/0 | **5/2/0** |
| layout_fit | 0/6/2 | 2/6/0 | **4/3/0** |
| grouping/color | 1/7/0 | 2/6/0 | **6/1/0** |
| border_integrity | 7/1/0 | 7/1/0 | **7/0/0** |
| workflow_evidence | 0/5/3 | 2/2/4 | 2/2/3 |
| animation | 3/3/0 | 1/0/3 | 3/1/0 |
| category_fit | 1/7/0 | 2/6/0 | 2/5/0 |

## What landed (verdict-confirmed)

- **pipeline: PASS, all eight categories.** First proof the full stack —
  engine + skill + harness — carries a case end to end: zero crossings,
  origins verified, full 44-frame lap with the dot returning to origin at
  frame 30, all qualifiers kept, records complete.
- **Engine fixes visible across cases:** network's forced bridge gone;
  datacenter 15→~7 bridges with BL→spine on the inside hop; hue collisions
  gone within views; borders 8/8; category_fit passes for datacenter and
  network for the first time; mm's coverage fully recovered (17/17, 23/23).

## Residual defect clusters (round-11 candidates)

1. **Gutter label attribution** — labels sharing a band or sitting
   between lanes while the checker reports 0 ambiguous (network, homelab,
   runtime, gb300). The checker-vs-eye split survived both the port and
   lane fixes; it needs its own mechanism (per-route gutters or leader
   ticks) plus a reader-calibrated metric.
2. **Dot oscillation** (mm v1) — two entry dots cycle between their
   first two cells instead of traversing; check line falsely reports
   constant speed. New defect, fan+label_slot geometry-specific.
3. **Qualifier omissions persist** (server, runtime, homelab, gb300) —
   the never-drop rule is written but generators still trim under budget
   pressure (verbs, OUI basis, hop-loss values, qualifiers).
4. **Source-order fidelity** (network fan, runtime callee order) —
   recipes demand source-listing order; the engine's ordering sometimes
   overrides it.
5. **Cross-view hue drift** (homelab wifi) — per-spec family resolution
   shifts a shared name's family between views; fix is case-wide
   name-union resolution.
6. **Workflow formalism** — manual probes escaping the record wrapper
   (runtime); the `cases.json` digest comparison methodology; the
   gb300 judge session expired pre-write (deliverables reconstructed by
   the captain from its delivered verdict).

## Stop-rule assessment

Continue to round 11. One case is fully green and the failure surface is
now three tight clusters (attribution, qualifiers, dot oscillation) plus
mechanical items — all with coordinates and reproducing cases. Human
review tabs (round 09 left vs round 10 right) open next; feedback to
`rounds/10/human-review/feedback.md` before revision begins.

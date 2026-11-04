# Round 03 decision

## Outcome

**0/8 green. 22 pass / 22 fail / 8 blocked of 52 applicable categories.
7 critical, 28 high, 16 medium findings.** Every case fails; the round is
nevertheless a large qualitative move, and the failures are now precise,
root-caused, and fixable. Frozen inputs: skill `cf796bcdc527…`, binary
`b242b6a28e2e…` (`/tmp/visualize-eval/round-03/bin/rataflow-view`), rubric
revision 4 `5519fd84f6b7…` (motion + crossing rules; reviewer identity
corrected mid-round before any result existed), dataset unchanged from
rounds 01–02. Models: DeepSeek (fireworks) generated, Sol judged; never
shared.

## Verdict matrix (P/F/B, — = source-backed N/A)

| Case | Semantic | Arrows | Fit | Groups | Borders | Workflow | Animation | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| pipeline | P | F | P | P | P | F | F | FAIL |
| network | F | F | F | P | P | B | F | FAIL |
| homelab-nic-trace | F | P | F | P | P | B | — | FAIL |
| server-nic-layout | F | F | F | P | P | B | — | FAIL |
| datacenter-redundancy | P | P | F | P | P | B | **P** | FAIL |
| modal-machine-manager | F | F | F | P | P | B | F | FAIL |
| modal-runtime | F | P | B | P | P | B | — | FAIL |
| gb300-rack-software | F | F | B | F | P | F | — | FAIL |

## Movement against round 02 (1/8 green; 35/13/3 of 51; 10C/14H/2M)

- **Held or improved:** borders 8/8 both rounds; groups 7/8 (gb300's Fabric
  Manager placement is the one failure); datacenter edges 28/28 pass and its
  explicit no-dots request now passes animation in static form — the round-02
  critical violation is closed; `boot.ipxe + S3 args` survives in
  machine-manager (round-02 loss recovered); zero skipped labels across all
  20 views; every reported crossing count now exists.
- **Regressed by design:** the strengthened rubric converted two renderer
  design choices into failures — dot spans skip corner glyphs (frame-0 dots
  one cell downstream: pipeline 6/6, network 7/7, mm 20/20) and the arrowhead
  glyph absorbs the arriving dot (no visible arrival anywhere animated).
  Arrows fell 7P→3P, animation 1B/2F→1P/3F. These are real defects against
  the human-requested rules, not rubric noise.
- **Regressed by enforcement:** workflow evidence fell 6P/2B→0P/6B/2F.
  Judges now uniformly block on the missing independent live-pane rectangle
  (`pane_cols: null` outside the focused tab) and missing probe/cleanup
  provenance. Harness gap, not a rendering gap.
- **Newly exposed:** avoidable crossings judged present in four cases
  (network v2, datacenter v2/v3 hairpins, server v3, mm v4) — the
  crossing-aware router still leaves removable crossings; server's trunk
  reversed three member→gateway relations; homelab traded a required
  `claimed` qualifier for a crossing (forbidden trade, honestly recorded);
  gb300's workflow records contained a false repetition claim; mm's
  full-frame dumps rendered at 80×24.

## Root causes, ranked

1. **Renderer motion design** (blocks 3 animated cases): origin cell and
   arrival visibility. Fix: dot span starts at the first drawn glyph (corner
   or not); arrival frame must show the dot at the arrowhead.
2. **Harness evidence** (blocks 6 cases' workflow): pane rectangle from owned
   pane id, mandatory probe/cleanup/rejected-check logs, target-size frame 0,
   no hardcoded geometry, machine-checkable workflow claims.
3. **Skill gates** (semantic losses): qualifiers and identifiers as required
   coverage rows; trunk direction validated against source relations;
   claims-vs-captures gate (every motion claim cites frame + coordinates);
   port-ordering before accepting crossings.
4. **Router quality** (fit losses): hairpin-detour elimination; single
   split-point trunk (gb300 critical).

## Stop-rule assessment

Continue to round 04. This was candidate revision 2 of the allowed sequence;
it produced useful improvement (borders, groups, datacenter edges, no-dots,
boot.ipxe, crossing reporting), so the no-improvement stop rule does not
apply. All remaining blockers are concrete and fixable; none is an
unsupported capability.

## Round-04 work list

1. Renderer: origin-cell dot spans; visible synchronized arrival; hairpin
   detour elimination; single split-point trunk; dashed style through bends;
   reconcile visible vs counted crossings.
2. Harness: pane rectangle from owned pane id; mandatory rejected-draft raw
   records and cleanup/probe logs; target-size (77×47) direct frame dumps;
   forbid hardcoded geometry; machine-check workflow-record claims against
   spec manifests.
3. Skill: qualifier/identifier coverage gate; trunk direction check;
   claims-vs-captures citations; port-ordering as the first crossing move;
   attempts budget counts every `--check` probe.

Manual human review of round 02 vs round 03 is the blocking next stage;
revision work starts only after feedback is recorded in
`rounds/03/human-review/feedback.md`.

## Post-aggregation human feedback (2026-11-02)

Recorded verbatim in `human-review/feedback.md`. Three directives reshape
round 04: the default dot mode becomes **constant shared speed** (same-arrival
is opt-in and must show visible simultaneous arrival); dots are kept
**judiciously as flair** (explicit source no-dots still overrides); and
**route economy** — near-minimal paths, no redundant loops — joins the arrow
criteria. Rubric revision 5 carries these; round-04 work list is updated in
`state.json` under `round_04`.

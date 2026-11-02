# Round 04 decision

## Outcome

**0/8 green. 24 pass / 25 fail / 6 blocked of 55 applicable categories.
5 critical, 26 high, 22 medium findings.** Aggregation validated all eight
reviewer results — zero problems after the aggregator learned the
single-spec/no-manifest citation form. Frozen inputs: skill `ac431c6d…`,
binary `0da16d8d…` (`/tmp/visualize-eval/round-04/bin/rataflow-view`), rubric
revision 5 `18412615…`, dataset unchanged since round 02. DeepSeek
(fireworks) generated; Sol judged; never the same model.

## Verdict matrix (P/F/B, — = source-backed N/A)

| Case | Sem | Arr | Fit | Grp | Brd | Wfl | Anim | Overall | Edges |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| pipeline | P | F | P | P | P | B | F | FAIL | 0/6 |
| network | P | F | P | P | P | B | F | FAIL | 0/7 |
| homelab-nic-trace | F | F | F | P | F | B | F | FAIL | 5/16 |
| server-nic-layout | P | P | P | P | P | B | — | BLOCKED | 9/9 |
| datacenter-redundancy | P | F | F | P | P | B | P | FAIL | 26/28 |
| modal-machine-manager | F | F | F | P | P | F | F | FAIL | 0/23 |
| modal-runtime | F | P | F | P | F | B | F | FAIL | 4/8 |
| gb300-rack-software | F | F | F | P | P | F | F | FAIL | 9/17 |

## Movement against round 03 (0/8 green; 22/22/8 of 52; 7C/28H/16M)

- **Closed:** gb300's single split point — verdict-confirmed one `┼` at
  (32,32), and its `oob→nvos` omission ruled correct per the source.
  datacenter's no-dots guarantee held for the second round running
  (animation P, zero `●` in 12 captures). Semantic edges improved
  (24 pass vs 22, counting server 9/9 and datacenter 26/28 audited-edge
  passes). machine-manager kept `boot.ipxe + S3 args`, `reimage`, `pull`,
  and one dot per line.
- **The dominant new failure is one renderer off-by-one:** frame-0 dots
  render one cell beyond the first drawn stem cell while `--check` prints
  `origins: N/N`. Measured blind in five cases (pipeline 6, network 7,
  homelab 11, gb300 6, machine-manager 23) and verdict-confirmed in
  pipeline, network, machine-manager, homelab. One judge (runtime) ruled
  the same placement correct under the revealed definition — the rubric
  must pin the origin definition next round so judging is uniform.
- **Evidence-completeness gaps block or fail six cases:** no frames dumps
  for the fully-static bundles (server, datacenter, homelab v1), one
  un-manifested frames filename (gb300 v1), dumps too short for the
  longest routes (four cases), missing raw command/probe/cleanup
  provenance (all cases), one invalid 65-character SHA (machine-manager),
  and one evidence capture bound to an attempt spec instead of the final
  (gb300 v2).
- **Judge splits to resolve in the rubric:** static-case frames absence
  (server: blocking; datacenter: nonblocking), corner-glyph occupancy
  (pipeline: legible; network/homelab/mm: violation), palette overlap
  (runtime: border failure; server: none raised).
- **Residual semantic losses:** runtime dropped gRPC/filesystem/user
  wording; homelab lost the historical-traceroute qualification and other
  qualifiers; gb300 lost SSH/SFTP coverage and residency framing;
  machine-manager kept its wording but four ambiguous owners remained.

## Root causes, ranked for round 05

1. **Renderer off-by-one on the rendered dot origin** (fails 4 verdicts).
   The check measures the route polyline; the render starts the dot one
   cell later. Fix the render to match the check, or vice versa — and pin
   the definition in the rubric either way.
2. **Evidence recipe, not renderer:** mandatory short frames capture for
   EVERY view (static included), cycle length scaled to the longest route
   (`ceil(longest/rate×10)` frames), raw command/status records for every
   attempt and probe, cleanup records verbatim, manifest covering every
   shipped spec.
3. **Route economy calibration:** gb300's Power shelf detour and
   datacenter's four avoidable bridges passed `--check` with
   `0 detours` — tighten the detour threshold or reference-path
   computation to match what a reader sees.
4. **Palette reservation:** the control palette overwrote node borders
   in three cases; the layout must reserve the palette corner.
5. **Label specificity gate:** forbid dropping source words (gRPC,
   filesystem, user, qualifiers) even when the short form is unambiguous;
   ambiguous owners that survive budget need a recorded, not silent,
   disposition.
6. **Judge-split rules to pin:** origin definition, static-frames
   requirement, corner occupancy, palette overlap.

## Stop-rule assessment

Continue to round 05: this was candidate revision 3 and produced real
movement (single-split trunk, no-dots stability, edges 24 vs 22, origin
rule isolated to one off-by-one). No unsupported capability blocks
progress.

Manual human review of round 03 vs round 04 is the blocking next stage;
revision work starts only after feedback lands in
`rounds/04/human-review/feedback.md`.

## Post-review human verdict (2026-11-02): REVERTED

> I think this is the first step where I'd say most of the results are worse
> than the previous round.

Round 04 is superseded. Per-case movement was worse in 4 of 8
(homelab, machine-manager, runtime, gb300) and the only green case
(round 02's runtime pass) was lost — largely because the dots-as-flair
directive imported animation failures into clean static cases via the
renderer's origin off-by-one. Artifacts stay on disk; the round is marked
superseded, not deleted. Round 05 starts from the round-03 frozen source,
carries forward the user-directed motion modes and the verdict-confirmed
single-split trunk, and replaces the rest with a mermaid-style layout
engine (proposal 06).

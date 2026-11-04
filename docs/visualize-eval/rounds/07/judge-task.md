# Sol review — React Flow convergence pilot (round 07)

You are the independent judge for the round-07 pilot. You run on
`openai/gpt-6.1-terra:high` by design; do not switch models, do not spawn
subagents, do not fix anything.

## What you judge

Three cases — **modal-machine-manager**, **datacenter-redundancy**,
**gb300-rack-software** — each with TWO renderings of the same graph:

- **React Flow twin**: `docs/visualize-eval/rounds/07/<case>/reactflow.html`
  with captures at `<case>/capture.png` (+`capture-raw.png`, `commands.txt`,
  `notes.md` with the generator's informal divergence observations,
  `attempts.md`). Read the PNGs as images; the HTML is the ground truth
  for structure.
- **Rataflow original**: the round-05 bundles under
  `docs/visualize-eval/rounds/05/<case>/` (specs, text/ANSI/selected
  captures, pinned 77×47 dumps) and their already-delivered verdicts under
  `rounds/05/reviews/<case>/reviewer-result.json` — the comparison
  baseline; do not re-judge them.

## Stage A — blind, before any comparison

For each case, read ONLY the React Flow capture and HTML. Record, with
coordinates: every visible node and subflow (bordered? titled? member
inside?); every edge label and where it sits; every crossing you can see;
animated edges (present/absent, one dot per edge?); whether the whole
graph is visible at the capture's zoom without pan; any label whose owning
edge is uncertain; any node whose border is incomplete or occluded; the
React Flow attribution badge (note it, discount it as chrome). Save
`docs/visualize-eval/rounds/07/reviews/<case>/observed-first-rf.md`,
hash it with `shasum -a 256`, report the hashes, then STOP — the captain
sends the comparison stage as a second message.

## Stage B — convergence and paired grading (after the captain's reveal)

1. **Convergence analysis, per case**: lay the React Flow capture beside
   the rataflow captures (same view's spec) and list EVERY divergence with
   coordinates on both sides: layout shape (ranks/regions vs planes),
   crossings, label placement and ownership, grouping rendering (subflow
   boxes vs hue-only), edge attachment (ports/handles), bus/trunk
   treatment (gb300's trunk vs three independent edges), flow animation
   (dot origin, speed, count), and anything else that differs.
2. **Paired category grading**: grade the REACT FLOW side against the
   seven round-05 categories with these adaptations — semantic fidelity
   and arrow traceability unchanged; layout fit = whole graph visible
   without pan at the capture's zoom (screenshot-proven); grouping =
   subflow boxes/titles/hues judged from the capture; borders from the
   capture; animation = the SMIL edge dots as the constant-speed analog,
   with datacenter's zero-animation demand absolute; workflow evidence =
   the bundle's own records (commands, attempts, determinism digests).
   Report each category as a pair: `rataflow <round-05 verdict> /
   reactflow <your verdict>`.
3. **Divergence taxonomy**: classify every divergence into patterns
   (e.g. "port-origin offset", "subflow-box vs hue-only", "gutter-label
   stacking", "shared-run inheritance", "bus dissolution", "hue
   collision inherited") — these roll up into the round-07 convergence
   matrix that drives rounds 08–09.

Write per case: `reviews/<case>/{convergence.md, reviewer-result.json,
critique.md}` and one `reviews/convergence-matrix.md` at the round
level summarizing the taxonomy across the three cases. Round integer `7`;
generator `viz-rf07` on `fireworks/accounts/fireworks/routers/deepseek-flash-latest`;
reviewer identity yours on `openai/gpt-6.1-terra:high`. Green for a case
requires every applicable category to pass FOR THE REACT FLOW SIDE with
capture evidence; the rataflow side's round-05 verdicts are cited, not
re-judged.

# Round 03 human review — feedback

Left pane is round 02 (its own binary), right pane is round 03. Judge verdict:
**all eight FAIL (0/8 green)**. Write your verdict per case — it overrides
the judge where you disagree. Revision work starts only after this file
records your feedback.

## Round-level feedback (verbatim, 2026-11-02)

> I actually prefer 2 modes of dot speed: constant, same-arrival. constant is
> what the name suggests; all dots move at the same speed. same-arrival means
> all dots arrive at their destination at the same time (current). Diagrams
> should default to same speed, and only use same-arrival when specified. A
> lot of the diagrams here had their dots removed. This is an observation,
> not a request for change. Arrow heads can represent the flow as well as
> dots, but having them is nice as flair. Consider keeping them in cases more
> judiciously.
>
> There are still some diagrams where the arrow line length could be
> minimized further. I saw some redundant looping in one of the cases.

### Captain's reading (for round 04)

1. **Motion default reverses:** constant shared speed is the default for
   animated routes; same-arrival becomes opt-in. All dots still start at
   their arrow's origin and start together at t=0; they simply travel at one
   shared rate and long routes finish later.
2. **Dots are flair, kept judiciously:** arrowheads alone carry direction;
   dots may stay by default on directed-flow views unless the source forbids
   them (datacenter's explicit no-dots still overrides) or they clutter.
   The observation that many diagrams lost their dots is noted; the skill
   will lean toward keeping them.
3. **Route economy:** routes must take near-minimal paths; redundant loops
   and avoidable detours are defects. This matches the judges' hairpin
   findings in datacenter and the user's own observation of looping.

Per-case verdicts remain pending; the round-level direction above governs
round 04.

Round-level questions for you (still open, answer any):

1. **Motion:** the dots start one cell after the arrow's first drawn glyph,
   and the arrival frame shows no dot (the arrowhead absorbs it). Do you
   want the dot ON the first glyph and ON the arrowhead at arrival?
2. **Crossings:** judges found avoidable crossings in network, datacenter,
   server, and machine-manager. Is the current level acceptable, or is
   "no avoidable crossings" the bar for round 04?
3. **Labels:** ownership/meaning cost runtime, gb300, homelab, mm, and
   server their semantic pass. What weighting do you give it against the
   structural wins (borders 8/8, groups 7/8, datacenter 28/28 edges)?
4. **Overall:** round 02 scored 1/8 green; round 03 scores 0/8 under
   stricter rules you asked for, with several round-02 failures closed
   (no-dots violation, boot.ipxe loss, skipped labels). Did the process
   move in the right direction?

| Case | Left (round 02) | Right (round 03) | Judge verdict | Your verdict |
|---|---|---|---|---|
| pipeline | v1 | spec-v1 | FAIL (arrows/workflow/animation) | pending |
| network | v1, v2 | v1, v2 | FAIL (semantic/arrows/fit/animation) | pending |
| homelab-nic-trace | v1–v3 | v1–v3 | FAIL (semantic/fit) | pending |
| server-nic-layout | v1–v3 | v1–v3 | FAIL (semantic/arrows/fit) | pending |
| datacenter-redundancy | v1–v4 | v1–v4 | FAIL (fit; semantic/arrows/animation pass) | pending |
| modal-machine-manager | v1–v4 | v1–v4 | FAIL (semantic/arrows/fit/animation) | pending |
| modal-runtime | v1–v3 | v1 | FAIL (semantic; was round-02's only pass) | pending |
| gb300-rack-software | v1, v2 | v1, v2 | FAIL (semantic/arrows/groups/workflow) | pending |

## pipeline (tab r03 pipeline v1)

Judge: semantic P, arrows F, fit P, groups P, borders P, workflow F,
animation F. Dots start one cell late (6/6); no visible arrival; generator
claimed what captures contradict; rejected-draft records missing.
Your notes:

## network (tab r03 network v1)

Judge: semantic F, arrows F, fit F, groups P, borders P, workflow B,
animation F. `session` owner uncertain; v2 crossing judged avoidable by port
ordering; dots one cell late (7/7); no visible arrival.
Your notes:

## homelab-nic-trace (tab r03 homelab-nic-trace v1)

Judge: semantic F, arrows P, fit F, groups P, borders P, workflow B,
animation N/A. `UDP encap` on the wrong route; `claimed` qualifier traded
for a crossing (forbidden); identifiers absent; IPv6 note reads as a device.
Your notes:

## server-nic-layout (tab r03 server-nic-layout v1)

Judge: semantic F, arrows F, fit F, groups P, borders P, workflow B,
animation N/A. Trunk reversed three member→gateway relations; R7725 still
missing; "free"/"ToR" too definitive; two avoidable crossings. In the
generator's favor: `103.19.91.57` IS printed in v2.
Your notes:

## datacenter-redundancy (tab r03 datacenter-redundancy v1)

Judge: semantic P, arrows P, fit F, groups P, borders P, workflow B,
animation P (static as requested). 28/28 edges pass; no-dots held across 44
frames; ≥4 hairpin crossings avoidable; 17 uncertain owners judged
recoverable by tracing.
Your notes:

## modal-machine-manager (tab r03 modal-machine-manager v1)

Judge: semantic F, arrows F, fit F, groups P, borders P, workflow B,
animation F. `boot.ipxe + S3 args` survived; dots one cell late (20/20), no
visible arrival, 90 missing-dot frames; `audit + verify` lost `reimage`;
v4 crossing avoidable; full-frame dumps were 80×24.
Your notes:

## modal-runtime (tab r03 modal-runtime v1)

Judge: semantic F, arrows P, fit B, groups P, borders P, workflow B,
animation N/A. Was round-02's only pass; now fails on `task dispatch` /
`starts/manages` ownership and lost gRPC/filesystem specificity.
Your notes:

## gb300-rack-software (tab r03 gb300-rack-software v1)

Judge: semantic F, arrows F, fit B, groups F, borders P, workflow F,
animation N/A. OOB bus shows two junctions, not the requested single
three-way split; residency framing invisible; workflow records falsely
claimed a repetition; 1 visible vs 3 reported crossings unresolved.
Your notes:

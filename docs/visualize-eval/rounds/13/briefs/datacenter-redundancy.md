# Brief — datacenter-redundancy (audit ask)

**Framing:** audit. The redundancy must be countable.
**Facts:** unchanged from
`docs/visualize-eval/cases/datacenter-redundancy/source.md`
(`source_sha256 a3051af3eeeec31aee53558dafbbea5d061dc74253618fd6940eba5c39b5bb98`).
This brief changes only the voice of the request.
**Triage annex:** `TRIAGE-datacenter-redundancy` (generator-task.md, TRIAGE
PROTOCOL). Expected triage load: light-to-medium — the audit rule is stated; the
shape and the dot question still need settling.

## The request

> This one's an audit, so the redundancy has to be countable. At every layer I
> want to count the paths: four ISPs into two MUXes, each MUX cross-connected to
> both cores, both cores into both firewalls with active/standby stated, both
> firewalls into both border leaves, both spines into every leaf, both leaves
> into every rack. If two links got drawn as one line, the audit is worthless.
> Border leaves and rack leaves at the same level, spines above them. Don't
> shrink the text to squeeze it in — give me room and I'll follow it.

## The reader's job

Counting. They will go layer by layer and check that each box pair that should
have two independent links has two, that no shared bus appears anywhere, and that
the active/standby labels sit on the right firewall edges. A merged or bundled
link is a wrong answer, not a tidiness improvement.

## What this framing exercises

- **Triage:** light-to-medium. The audit rule and the tier levels are stated; the
  panes-vs-canvas choice and the dots question are open, and the skill must
  settle them before drawing.
- **Canvas:** rung 1 if 28 independent links fit 77x47 honestly, rung 2 with
  described diagrams if they do not. The forbidden shortcut is shrinking or
  bundling to reach rung 1 — branch A of the dual fit rule is a real fit at
  natural zoom, not a zoomed-out one.
- **Density:** the densest case — 18 nodes, 28 relations, four cross-connected
  redundant tiers. Round 13's density hint is a hint: this graph is *supposed* to
  be dense, and thinning it is the failure.
- **Traceability:** every parallel link individually traceable, double-arrowhead
  targets fed by two separate routes at two ports, and no route hugging a box it
  does not connect (near-miss class). A universal one-route-per-edge rule still
  cannot override the OOB bus request in the gb300 case; here the reverse holds —
  no bus at all.
- **Grouping:** tier hue families (ISPs, MUX, core, firewall, border leaf, spine,
  rack leaf, rack) must stay consistent across every diagram of the canvas.
- **Motion:** off in `cases.json`; these are physical links. Any dot is a
  critical violation.

## What must not change

All 28 required links of `source.md` with their labels and directions, the
cross-connect at every adjacent tier, border leaves and rack leaves on one level
with both spines above them, no merged redundancy link, and the stated arrow
convention — physical connectivity, not proof of one-way traffic, endpoints never
rewritten to force a layout. Four separate ISP identities may fold into MUX
labels only with explicit coverage and legible identity.

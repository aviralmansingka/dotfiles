# Rubric from the owner's own verdicts

Every criterion below is derived from a specific thing the owner said in
this session — praised or panned. Quotes are verbatim. The point is to
score what the owner actually looks at, not what a checker can count.

## A. Verdict log (what the owner said)

### A.1 Complaints

| # | Quote | Defect class |
|---|---|---|
| 0 | "the visualize skill is kinda ass… hardly readable. The lines keep overlapping with each other, have random colors, and the arrow heads are generally just awkward" | overlap; meaningless colour; arrowhead craft |
| 6 | "I don't see any colors in the diagram at all. Is that by design?" | colour must be present and intentional |
| 7 | "the iPXE arrow… seems to go down and intersect with a bunch of other arrows for effectively no reason since it comes right back up after" | pointless detour; gratuitous crossing |
| 8 | "random arrows that are not clear. The river job arrow to S3… seems to also connect to providers and janitor"; "the arrow from machines to boot server doesn't really start well" | ambiguous adjacency; bad origin attachment |
| 11 | "the borders around these cells are not actually fully in the same color… confirm whether every border is actually complete" | border integrity |
| 38 | "most of the results are worse than the previous round" | regression |
| 55 | "the rack software visualization loses a lot of the nuance of the relationships… I'm not trying to lose all of the flexibility in building deep relationships" | detail loss |
| 78 | "I don't need this subgraph structure actually shown… I almost never want them to have a border around them" | regionless grouping |
| 82 | "why couldn't the outgoing arrows from web-tier be rearranged so that there is no overlap at all"; "why is the diagram fully linear. There are multiple other connections… flat out missing"; "basically all detail from v4 is gone" | avoidable overlap; false linearity; coverage loss |
| 84 | "why is linearity the recipe. The primary goal is to express the connections… not give a very watered down version" | coverage outranks shape |
| 96 | "both the modal diagrams are worse. They lose a lot of detail" | thinning on split |
| 101 | "why are there multiple views for a single eval? previously we always only had one" | unexplained fragmentation |
| 103 | "The arrows feel a bit ambiguous… in cases where the arrows can have so many ambiguous paths, it would be good to use dots and have the dots have either the color of their src or dest, whichever leads to the least conflicts" | ambiguity escalation; dot hue binding |
| 104 | "a better learning… make sure that arrows don't overlap in a way that introduces ambiguity" | ambiguity-free routing |
| 114 | "some cases, like the home lab diagram, where the diagram stretches super wide"; "all dividers… the same size… add a divider at the top as well" | bounding-box balance; divider uniformity |
| 125 | "the top border for the entries inside machine manager is missing" | completeness of a drawn box |

### A.2 Complements

| # | Quote | What earned it |
|---|---|---|
| 8 | "this attempt… is much more organized than what we started with so that's good" | organised layout |
| 26 | "Most of the diagrams are objectively better, so I'd say this eval process is going well" | overall trajectory |
| 114 | "I mostly like all of the diagrams… They're all pretty good"; "I really like the dividers that you added" | dividers; general quality |
| 124 | "this looks good" | container box grown to hold members |
| 126 | "I like how the label is moved to the border for this case. That looks nice." | label set into the box edge |
| 128 | "The first diagram is good. It shows the machine manager and how the components fit into each other. L2 is also solid as it demonstrates the relationships inside the box. Overall I really like the diagram." | containment legibility; internal relationships |
| 131 | "this diagram is great." | the full L0→L2b ladder |
| 133 | "The skill is pretty sick now, I'm a big fan of it." | the skill as a whole |

## B. The rubric this implies

Nine categories, each with a **reader test** (what a human does) rather
than a counter. Score the render, then confirm with the check output.

### 1. `semantic_coverage` — nothing was watered down
- Every relation the source states appears, with its verb/transport text.
- **Reader test:** pick three relations from the source at random; find each
  one. If any is absent, fail. *(#55, #82, #84, #96)*
- Never fail a diagram for being dense: density is the goal, not a risk.
  *(#84, #97)*

### 2. `ambiguity_free_routing` — no path suggests a relation that is not there
- No route runs along or hugs a node that is not its endpoint.
- No route passes within 2 cells of an unrelated node unless the source
  forces it, and forced cases are named.
- No avoidable overlap between two routes; a shared corridor is a defect
  unless they are the same relation's branches. *(#7, #103, #104, #82)*
- **Reader test:** for each node, can you tell which arrows touch it? A
  human answering "that one seems to also connect to X" is a fail. *(#8)*

### 3. `arrow_craft` — attachment and shape
- Every route starts and ends at the middle of the side it leaves/enters.
- No route leaves a node, goes away, and comes back for no reason. *(#7)*
- Arrowheads are clean: no double heads, no head sitting on a bend, no head
  detached from its line. *(#0)*
- Arrowheads are flair: a diagram is not required to animate. *(#34)*

### 4. `label_ownership` — a reader can bind every label to its edge
- Each label sits unambiguously beside its own route; the checker's
  "0 ambiguous" is necessary, never sufficient. *(#8, #103)*
- Where placement cannot be unambiguous, a leader tick or a reserved
  gutter ties it down.
- **Reader test:** cover the arrows; do the labels still say which edge is
  which?

### 5. `color_meaning` — every colour says something
- No colour appears without a reason (group family, selection, dot
  binding). *(#6, #0)*
- A group tag keeps one hue across every diagram of a canvas.
- A dot's hue binds to its source or destination — whichever leaves fewer
  conflicts — once the diagram is dense enough to need it. *(#103)*
- **Reader test:** ask "what does this colour mean?" per hue; a shrug is a
  fail.

### 6. `border_integrity` — every box is whole
- Every node border is closed and one continuous colour.
- A container box is closed on all four sides and its label never loses a
  character to a crossing edge. *(#11, #125, #126)*
- Nothing is painted over a border except that border's own style.

### 7. `view_strategy` — the reader can navigate what was produced
- Rung 1: one concept fitting 77×47 → one view, side-by-side readable.
- Rung 2: multiple concepts or too large → ONE canvas of described
  diagrams. *Splitting into separate views with nothing explaining them is
  the #101/#105 defect.*
- Descriptions are mandatory on a canvas: 1–3 wrapped rows saying what is
  inside, what is outside, and how it relates to its neighbours. *(#106,
  #128)*
- **Reader test:** hand the canvas to someone who knows nothing; can they
  say what each section is for? *(#106, #108)*

### 8. `proportion` — the drawing keeps a sane shape
- Sibling sections share roughly the same bounding box; a 210×5 ribbon
  next to a 40×30 block fails. *(#114)*
- Every divider spans the widest band; the first section carries a top
  rule too. *(#114)*
- One reading direction across a canvas unless a measured reason forces
  another. *(#118)*

### 9. `containment_legibility` — C4-style zoom reads literally
- The zoom parent is visibly the box that the next level expands.
- Its contents sit INSIDE the box; actors and external systems sit OUTSIDE.
- A service that cannot be contiguous gets its own box rather than being
  left outside or swallowing externals.
- An edge crossing the boundary keeps its cells: a gap reads as
  pass-through. *(#124, #128, #131)*

## C. What the current rubric gets wrong

| Current bias | Owner's correction |
|---|---|
| Counts defects (`0 ambiguous`, `0 near-miss`) and trusts them | Four verdicts failed on things the checker scored 0 *(#8, #103, #104)* |
| Treats a split into views as neutral | A split with no description is a defect *(#101, #106)* |
| Docks density | Density is the goal; thinning is the defect *(#84, #97)* |
| Rewards fitting 77×47 | Fitting is rung 1 only; a big canvas is allowed if described *(#102, #106)* |
| Ignores aesthetics | "awkward arrow heads", "this looks nice", "this is great" are verdicts *(#0, #126, #131)* |
| Models groups as geometry | Groups are tags; no drawn regions *(#78)* |

## D. Scored anchors

Use these three as calibration, in both directions:

- **fail**: the r10 network diagram (overlapping fan, ambiguous exits) and
  the r11 modal pair ("lose a lot of detail").
- **pass**: the r14 machine-manager ladder (L0 plain box; L1/L1b/L2/L2b
  containers; three-row descriptions) — "this diagram is great."
- **pass, narrowly**: the pipeline single view — "one view… everything
  visible" — versus the r11 server canvas, which failed on source fidelity
  despite drawing well.

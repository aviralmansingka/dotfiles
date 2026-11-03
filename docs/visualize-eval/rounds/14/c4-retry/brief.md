# Brief — C4 zoom-in retry (owner-requested, round 14)

**Ask (owner):** "let's try the c4 diagram again. A big idea in c4 is to
pick a component and 'zoom' in on it. Can you add a double border on the
component you are zooming in to? Also once you expand that component, can
you add all the nested cells in a dotted box? be careful about how arrows
and dots go through it. Also try to keep most diagrams consistent. If all
are left-right oriented, then keep all of them that way."

**New engine features (frozen binary 2b1dd353…):**
- `"focus": true` on a node -> double border (the zoom parent)
- `"enclosed": true` on a diagram -> dotted box around its contents,
  one cell of clearance, `enclosure-crossings:` must read 0
- uniform dividers (widest band) and a top rule above the first diagram
- canvas-level `direction` inherited by every diagram: keep them all `lr`
  unless a measured reason forces otherwise

**Facts:** ONLY `docs/visualize-eval/cases/modal-machine-manager/source.md`
(same frozen dataset; the C4 lens reorganizes, never drops: all 23
relations once, at their most-fitting level, with context->container
expansions recorded).

**Levels to draw:** L1 system context (manager as one box, actors and
external systems around it, that box marked `focus`), L2 containers
(the internals, `enclosed`), L3 only if the source states container
internals (it does not), L4 out of scope.

**Reader's job:** understand the system top-down - context, then
containers - and see plainly which box contains the next view.

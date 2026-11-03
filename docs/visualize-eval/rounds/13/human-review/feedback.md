# Round 13 human review — feedback

Reviewer: the owner. Eight before/after tabs open (each case's most
recent prior generation on the left, r13 on the right).

## Per-case notes

(pipeline — r10 vs r13) 
(network — r11 vs r13) 
(server-nic-layout — r11 vs r13) 
(homelab-nic-trace — r11 vs r13) 
(modal-machine-manager — r12 vs r13) 
(modal-runtime — r12 vs r13) 
(gb300-rack-software — r11 vs r13) 
(datacenter-redundancy — r10 vs r13) 

## Directives for round 14

1. (owner, 2026-11-03, overall) "I mostly like all of the diagrams… They're
   all pretty good… these are really great diagrams. I'm really enjoying
   this. I think we've come really far from where we started."

2. (owner, 2026-11-03, canvas balance) "I just like for all of them
   [multi-view/canvas diagrams] to have roughly the same bounding box.
   There are cases, like in the home lab diagram, where the diagram
   stretches super wide. It would be nice if there were some heuristics…
   'Hey I want this diagram to not be super wide so I don't mind, instead
   of sticking from left to right, actually making it a horizontal U shape
   just to make sure that it fits here.'"

   CAPTAIN-PROPOSED HEURISTICS (pending owner approval):
   - H1 SERPENTINE FOLD ("horizontal U"): when a section's
     width:height exceeds ~4:1 and its shape is chain-like, wrap its
     ranks into stacked bands that alternate direction (left-to-right,
     then right-to-left), turning a 210x5 ribbon into ~70-wide bands;
     the fold edge carries the connecting edge so reading flow survives.
   - H2 SECTION EQUALIZATION: every section band gets the SAME width -
     the canvas width, set by the widest section after folding; narrow
     sections center inside it, and two narrow sections may sit
     side-by-side within one band so the canvas does not waste columns.
   - H3 ASPECT BUDGET, SPLIT BEFORE STRETCH: target each section at
     roughly 2:1..4:1 width:height; when folding cannot fit a non-chain
     graph, split it into two described sub-diagrams of the SAME concept
     instead of stretching; never shrink labels or drop relations.

3. (owner, 2026-11-03, dividers) "I really like the dividers… make
   sure all dividers are actually the same size. Pick the maximum size
   amongst all dividers and use the same across all. Also just add a
   divider at the top as well, even though there is nothing above the
   first item, because I like the consistency."

   ROUND-14 ENGINE RULES: (a) all dividers span the full canvas width
   (the max section width); (b) a divider renders ABOVE the first
   diagram too, so every section sits between two rules.

4. (captain, standing) engine cross-gap near-miss work + whole-canvas
   evidence harness + source-ledger completeness (see decision.md).

5. (owner, 2026-11-03, C4 retry) "A big idea in c4 is to pick a component
   and 'zoom' in on it. Can you add a double border on the component you
   are zooming in to? Also once you expand that component, can you add all
   the nested cells in a dotted box? be careful about how arrows and dots
   go through it. Also try to keep most diagrams consistent. If all are
   left-right oriented, then keep all of them that way."

   ROUND-14 ENGINE FEATURES (C4 zoom-in):
   a. ZOOM PARENT: a node that is zoomed into renders with a DOUBLE
      BORDER (outer + inner ring) so the reader sees which box the next
      diagram expands.
   b. ENCLOSURE: the expanded diagram's nested cells render inside a
      DOTTED BOX - the boundary is dotted so it reads as "contents of",
      not as a node.
   c. ROUTING AROUND THE ENCLOSURE: routes must not cross the dotted
      boundary (they stay inside it or outside it); dots never ride the
      dotted cells. Crossing the boundary line is a defect class.
   d. ORIENTATION CONSISTENCY: diagrams on one canvas keep ONE reading
      direction unless a measured reason forces a change (owner: "if all
      are left-right oriented, then keep all of them that way").

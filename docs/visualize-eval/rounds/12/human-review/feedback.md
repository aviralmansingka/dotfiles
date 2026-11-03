# Round 12 human review — feedback

Reviewer: the owner. Tabs (round 11 left vs round 12 right):
- w7E: modal-machine-manager — 4 sparse views vs 2 dense
- w7E: modal-runtime — sparse pair/fan views vs pair+dispatch / 5-edge seam view

## Per-case notes

(modal-machine-manager — FAIL: 4 uncertain v2 label owners, workflow probe gap, animation blocked)
(modal-runtime — FAIL: gRPC pair label ownership 3rd round, worker-plane hue shifts green→orange across views)

## Directives for round 13

1. (owner, 2026-11-03, on view strategy) "it's okay to build full-screen
   diagrams. We should keep a preference to try and fit the diagram in
   the view that can be rendered side-by-side. If there are going to be
   multiple views, I'd prefer to have a single large diagram that lists
   all the relationships that I can full screen and review."

   ROUND-13 VIEW STRATEGY (replaces the split-first habit):
   a. First preference: one view that fits 77x47 at natural zoom
      (side-by-side readable with the chat).
   b. If it does not fit: ONE full-screen diagram carrying ALL
      relationships - large extent is acceptable; the owner full-screens
      the pane and pans/zooms to review. Never split into thematic views
      merely because the graph is large.
   c. Multiple views remain a last resort, only with a measured reason
      (e.g. genuinely disconnected subgraphs).
   Rubric impact: layout_fit gains a dual rule - 77x47 pinned fit OR
   single-full-screen-all-relations (fit proof: fullscreen pinned dump +
   all-relations coverage claim).

2. (owner, 2026-11-03, on gb300 a3 ambiguity) "in cases where the arrows
   can have so many ambiguous paths, it would be good to use dots and
   have the dots have either the color of their src or dest, depending
   on whichever one leads to the least conflicts."

   ROUND-13 ENGINE FEATURE (dot coloring): a route's dots inherit the
   hue of their source OR destination node - chosen per graph by which
   end yields fewer hue conflicts (fan-out from one source -> color by
   destination; convergence into one destination -> color by source).
   Purpose: a moving dot visibly bound to its endpoint disambiguates
   which relation a path belongs to, in dense fans where arrows alone
   read ambiguously. Applies wherever dots already run; static views
   with dense ambiguous fans may opt into dots for this purpose.

3. (owner question, answered in chat) gb300 a3: the OOB LAN's rail (one
   drop to every BMC - compute trays, NVSwitch tray BMCs, power shelf
   controllers, CDU, PDUs) is NOT drawn in any r11 view; only rms->oob
   rides it. The arrows near OOB in a3 are other relations' routes
   passing close (routing artifact, the same class the source flags for
   DCGM). The BMC fan coverage gap is the standing CDU/PDU round-13 item.

4. (captain proposal, pending owner) engine-first round: label-ownership
   lever + reader-calibrated checker metric; case-wide hue-family
   assignment (cross-view consistency); bundle every probe input;
   frame-step helper for the animation audit.

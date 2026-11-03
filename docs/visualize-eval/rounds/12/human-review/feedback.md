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

   ROUND-13 VIEW STRATEGY (owner refinement, 2026-11-03, supersedes the
   same-day full-screen-only phrasing): "I actually really like this
   idea of splitting the multiple views of concepts into different
   diagrams, but I need some sort of description to understand this. I
   don't mind them being on the same canvas. A lot of the times, I'm
   going to ask you to generate really complex visualizations that I
   need to navigate. In those instances, I don't want to feel constrained
   by the size of what's required. Remember again, clarity is more
   important than shaping."

   a. Splitting concepts into separate diagrams is GOOD and stays the
      habit - each diagram carries one concept/theme.
   b. Multiple concept-diagrams may share ONE LARGE CANVAS - the owner
      navigates by pan/zoom; never feel constrained by viewport size.
   c. Every diagram carries a DESCRIPTION (title + what-it-shows line)
      so the reader can orient and navigate a complex canvas.
   d. Preference ladder: single concept that fits 77x47 -> one
      side-by-side view; multiple concepts or oversize graph -> one
      large canvas with named, described concept-diagrams; never drop
      relations; never shrink clarity to fit.
   e. CLARITY OVER SHAPING: layout serves what the source actually
      contains; budget/shape preferences never thin the content.
   Engine implications (round 13): multi-diagram canvas support (several
   named graphs on one render), per-diagram title + description
   rendering, oversized-canvas rendering without the fit-floor complaint.
   Rubric impact: layout_fit judges fit OR navigable-large-canvas with
   descriptions; a new clarity/navigation category consideration.

   OWNER ADDITION (same day): "if you feel that having a larger canvas is
   going to help with clarity, then go ahead and do that. Ask the user if
   they want multiple panes or a single pane with everything. Feel free
   to triage their requirements as part of this skill to generate the
   best visualization for their usecase."

   SKILL TRIAGE STEP (proposal 12, step 0):
   - Read the request's complexity and the reader's job (side-by-side
     reference vs navigate-and-explore).
   - Agent judgment rules: use a larger canvas whenever it helps
     clarity; split into described concept-diagrams when concepts
     separate cleanly; never water down.
   - When a choice materially changes the result, ASK the user one
     concrete question (e.g. multiple panes, or one pane with
     everything) before generating.
   - OWNER REFINEMENT (same day): "Continue asking until you have a
     good idea for what to draw." The triage loop is PERSISTENT: keep
     asking focused questions - one at a time - until the agent
     genuinely knows what to draw (source understood, reader's job
     known, shape chosen). Do not generate from a vague picture; do
     not pad with questions once the picture is clear. The agent owns
     the judgment of when understanding has converged.
   - Triage is part of the skill's contract, not an optional nicety.

2. (owner, 2026-11-03, on gb300 a3 ambiguity) "in cases where the arrows
   can have so many ambiguous paths, it would be good to use dots and
   have the dots have either the color of their src or dest, depending
   on whichever one leads to the least conflicts."

   OWNER REFINEMENT (same day): "wait there seems to be a better
   learning which is to make sure that arrows don't overlap in a way
   that introduces ambiguity."

   PRIMARY ROUND-13 ENGINE RULE (ambiguity-free routing): routes must
   not pass near, hug, or overlap nodes that are neither their source
   nor their destination, and must not share corridors in a way that
   suggests false relations. The gb300 a3 artifact (nvos->nmxc and
   in-band routes hugging OOB LAN until it reads as connected) is the
   named defect. Engine lever: proximity penalty in the A* corridor
   planner for cells near unrelated nodes; checker gains a
   passes-near-unrelated-node violation so the defect class becomes
   measurable.
   DOT COLORING (secondary complement, kept): where fans are dense but
   legitimately parallel, dots colored by src-or-dst hue (least-conflict
   end) still help readers bind motion to relations.

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

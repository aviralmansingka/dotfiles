# Round 05 human review — feedback

Left pane is round 03 (the last accepted baseline — round 04 was reverted),
right pane is round 05 (the mermaid-style engine). Judge verdict: **0/8
green**, but crossings and label ownership collapsed versus every earlier
round. Write your verdict per case; it overrides the judge where you
disagree. Round-06 work — already scoped to the off-by-one fix only, per
your directive — starts after this file records your feedback.

## Round-level review (delivered in chat, 2026-11-02)

The user reviewed the open tabs through conversation rather than the file:

1. **network (r05 network v1):** "why did the network diagram eat up the
   web tier and add the db tier?" — the round-05 v1 dropped the web tier
   from the ingress view and pulled the DB in, presenting cache→DB as the
   WAN-path continuation. Verdict: split seams must preserve each view's
   STORY, not just edge coverage. Skill item recorded.
2. **gb300 (r05 gb300 v1):** "loses a lot of the nuance of the
   relationships… closer to what mermaid diagrams offer without losing the
   flexibility in building deep relationships from layers and placement."
   Verdict: the engine flattened the semantic planes; round-08 structural
   merge (subgraph regions, rank pins, minlen) is the fix.
3. **Direction confirmed:** mermaid-style layouts, React Flow convergence
   pilot (round 07), category-aware generation (round 09), off-by-one
   fix (round 06) — all launched in parallel.

Round-05 review is COMPLETE via this record; the judge verdicts stand
(0/8 green, four fixable clusters as written in decision.md).

Round-level questions for you (superseded by the chat review above):

1. **Layouts:** the barycenter engine cut crossings and ambiguous
   owners to near zero. Do the round-05 layouts read as clean as your
   mermaid reference?
2. **Group boxes:** hue-only grouping passed the judges but the
   bordered/titled subgraph look is still missing — draw them in round
   07, or is hue-only enough?
3. **Dots:** every animated case failed on the same one-cell-late dot
   origin. Round 06 is scoped to exactly that fix — confirm, or widen?
4. **Overall:** 20 pass vs round 04's 24, but 0 green vs round 03's
   structural wins. Is the engine direction right?

| Case | Left (round 03) | Right (round 05) | Judge verdict | Your verdict |
|---|---|---|---|---|
| pipeline | v1 | spec-v1 | FAIL (arrows/fit/workflow/animation) | pending |
| network | v1, v2 | v1, v2 | FAIL (arrows/workflow/animation) | pending |
| homelab-nic-trace | v1–v3 | v1–v4 | FAIL (semantic/fit/borders) | pending |
| server-nic-layout | v1–v3 | v1-a3, v2-a2, v3-a3 | FAIL (groups/workflow) | pending |
| datacenter-redundancy | v1–v4 | v1–v3 | FAIL (semantic/arrows/fit/groups) | pending |
| modal-machine-manager | v1–v4 | v1–v4 | FAIL (semantic/arrows/fit/workflow/animation) | pending |
| modal-runtime | v1–v3 | v1-a5, v2-a4, v3-a1 | FAIL (semantic/fit) | pending |
| gb300-rack-software | v1, v2 | v1–v4 | FAIL (semantic/arrows/fit/borders) | pending |

## pipeline (tab r05 pipeline v1)

Judge: semantic P, arrows F, fit B, groups P, borders P, workflow B,
animation F. 6/6 dots one cell late; `Auth→Postgres` animated against
the source; captain-assembled records after the worker's disk crashes.
Your notes:

## network (tab r05 network v1)

Judge: semantic P, arrows F, fit P, groups P, borders P, workflow B,
animation F. 7/7 dots one cell late; five 2-cell toggle routes read as
jitter; no route reaches an arrowhead over a full lap.
Your notes:

## homelab-nic-trace (tab r05 homelab-nic-trace v1)

Judge: semantic F, arrows P, fit F, groups P, borders F, workflow B.
v2/v4 exceed the 77×47 target (structural under the 4-view cap);
ONT demarc/MMR role missing; annotation scope ambiguous.
Your notes:

## server-nic-layout (tab r05 server-nic-layout v1)

Judge: semantic P, arrows P, fit P, groups F, borders P, workflow F.
All substantive categories pass; L2-caveat and Airtel-transit share a
hue; one malformed attempt hash; six attempts lack raw records.
Your notes:

## datacenter-redundancy (tab r05 datacenter-redundancy v1)

Judge: semantic F, arrows F, fit F, groups F, borders P, workflow B,
animation P. Zero dots (third round running); 28 links traceable with
14 double-arrowhead boxes; 6 bridges justified by the fans; tier
geometry lost to the forced `lr`; 5 uncertain owners.
Your notes:

## modal-machine-manager (tab r05 modal-machine-manager v1)

Judge: semantic F, arrows F, fit F, groups P, borders B, workflow F,
animation F. `boot.ipxe + S3 args` label lost again; 23/23 dots one
cell late; 2-cell bounce loops; 0/25 pinned selected evidence.
Your notes:

## modal-runtime (tab r05 modal-runtime v1)

Judge: semantic F, arrows P, fit F, groups P, borders P, workflow B.
Label shortening lost `runs`/filesystem wording; storage/orchestration
hue collision; anti-parallel split across views ruled acceptable.
Your notes:

## gb300-rack-software (tab r05 gb300-rack-software v1)

Judge: semantic F, arrows F, fit F, groups P, borders F. Two adjacent
taps instead of the single split (regression under the new ordering);
coverage gaps (18-BMC, CDU/PDU, SSH/SFTP, shelf HTTPS); dashed
Driver+CUDA link source-unverified.
Your notes:

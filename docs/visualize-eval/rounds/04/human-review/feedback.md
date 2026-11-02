# Round 04 human review — feedback

Left pane is round 03 (its own binary), right pane is round 04. Judge
verdict: **0/8 green** — but the failures concentrated into a few
root causes. Write your verdict per case; it overrides the judge where you
disagree. Revision work starts only after this file records your feedback.

## Round-level feedback (verbatim, 2026-11-02)

> I think this is the first step where I'd say most of the results are worse
> than the previous round.

### Captain's regression analysis (agrees)

Per-case movement, round 03 → round 04:

| Case | Round 03 | Round 04 | Movement |
|---|---|---|---|
| pipeline | FAIL (arr/workflow/anim F) | FAIL (same shape) | flat |
| network | FAIL (sem/arr/fit F) | FAIL (sem P, fit P) | better |
| homelab | FAIL (anim N/A) | FAIL (anim F added) | **worse — flair dots imported failures** |
| server | FAIL/BLOCKED | BLOCKED (all substantive pass) | better |
| datacenter | FAIL (fit F only) | FAIL (same shape) | flat |
| machine-mgr | FAIL (workflow B) | FAIL (workflow B→F) | worse |
| runtime | **PASS (only green)** | FAIL (borders P→F, anim —→F) | **worse — the one green lost** |
| gb300 | FAIL (anim N/A) | FAIL (anim F added) | **worse — flair dots imported failures** |

Worse in 4 of 8, better in 2, flat in 2 — and the single green case
(round 02's runtime) is gone. The dominant cause is the combination of two
round-04 changes: the dots-as-flair directive added animation to three
previously-clean static cases, and the renderer's origin off-by-one then
failed every animated view it touched. The flair policy was right by the
user's own request; the renderer bug made it expensive.

### User direction (verbatim)

> Revert the last round. Propose new fix for simplifying the layouts. The
> layouts in mermaid diagrams seems to be good. Can we consider some
> approaches that we use for laying out mermaid diagrams to make sure
> things are laid out well?

### Round-05 implication

Fix the off-by-one first — it alone likely flips homelab, runtime, gb300,
pipeline, and network animation results back. Then the evidence recipe
(frames for every view, full-cycle length, raw records), route-economy
calibration, and palette reservation.

Round-level questions for you (still open):

1. **Origin rule:** five judges measured frame-0 dots one cell beyond
   the first drawn stem cell while `--check` says `origins: N/N`; one
   judge (runtime) ruled the same placement correct. Which definition do
   you want pinned — dot on the port-adjacent stem cell, or dot on the
   border port glyph itself?
2. **Static frames:** server's judge blocked on missing frames dumps;
   datacenter's judge called the same gap nonblocking. Should every
   view, static included, ship a short frames capture?
3. **Motion length:** dumps covered 2000 ms but longer routes need more
   for a full lap. Should the capture length scale with the longest route?
4. **Overall:** round 03 scored 0/8 with structural wins (single-split
   trunk confirmed, no-dots held, edges 24 vs 22) against round 02's 1/8.
   Is the process converging in your view?

| Case | Left (round 03) | Right (round 04) | Judge verdict | Your verdict |
|---|---|---|---|---|
| pipeline | v1 | v1-final | FAIL (arrows/workflow/animation) | pending |
| network | v1, v2 | v1-a3 | FAIL (arrows/workflow/animation) | pending |
| homelab-nic-trace | v1–v3 | v1, v2-lan, v3-overlay, v4-wan | FAIL (semantic/arrows/fit/borders/animation) | pending |
| server-nic-layout | v1–v3 | v1-host, v2-subnet, v3-upstream | BLOCKED (workflow only; all else pass) | pending |
| datacenter-redundancy | v1–v4 | v1–v4 | FAIL (arrows/fit) | pending |
| modal-machine-manager | v1–v4 | v1-intake…v4-ops | FAIL (semantic/arrows/fit/workflow/animation) | pending |
| modal-runtime | v1–v3 | v1-b | FAIL (semantic/fit/borders/animation) | pending |
| gb300-rack-software | v1, v2 | v1-oob-rail, v2-mgmt-api, v3-inband | FAIL (semantic/arrows/fit/workflow/animation) | pending |

## pipeline (tab r04 pipeline v1)

Judge: semantic P, arrows F, fit P, groups P, borders P, workflow B,
animation F. Frame-0 dots one cell late (6/6); two short hops oscillate;
constant speed ruled legal; cycle evidence incomplete for 4 longer routes.
Your notes:

## network (tab r04 network v1)

Judge: semantic P, arrows F, fit P, groups P, borders P, workflow B,
animation F. Frame-0 dots on the second drawn cell (7/7); corner-glyph
occupancy on 2 routes; unequal physical advance on 6 routes.
Your notes:

## homelab-nic-trace (tab r04 homelab-nic-trace v1)

Judge: semantic F, arrows F, fit F, groups P, borders F, workflow B,
animation F. Historical-traceroute qualification missing in WAN; palette
overwrites three Cloudflare border cells; `no committed rate` still
owner-ambiguous (10 vs 7 cells); frame-0 dots one cell late (11 routes).
Your notes:

## server-nic-layout (tab r04 server-nic-layout v1)

Judge: BLOCKED solely on workflow evidence — all six judged categories
pass, all 9 edge audits pass, no trunk per source-consistent reason.
Your notes:

## datacenter-redundancy (tab r04 datacenter-redundancy v1)

Judge: semantic P, arrows F, fit P-adjacent, groups P, borders P,
workflow B, animation P. 28/28 edges audited; 4 avoidable bridges
(carrier feed ×2, BL/spine ×2); 1 ambiguous ECMP owner + removable jog;
frames absence ruled nonblocking.
Your notes:

## modal-machine-manager (tab r04 modal-machine-manager v1)

Judge: semantic F, arrows F, fit F, groups P, borders P, workflow F,
animation F. 23/23 frame-0 dots one cell late; corner occupancy on 7
routes; 4 ambiguous owners; `boot.ipxe + S3 args` preserved; one live
dot per line preserved.
Your notes:

## modal-runtime (tab r04 modal-runtime v1)

Judge: semantic F, arrows P, fit F, groups P, borders F, workflow B,
animation F. Lost gRPC/filesystem/user wording; palette overwrites 2
border cells; corner obscuring on 6 routes; initial dot placement ruled
correct 8/8 (the origin judge-split).
Your notes:

## gb300-rack-software (tab r04 gb300-rack-software v1)

Judge: semantic F, arrows F, fit F, groups P, borders P, workflow F,
animation F. Single split confirmed at (32,32); Power shelf detour
avoidable; SSH/SFTP coverage missing; v2 evidence bound to an attempt
spec; 6 frame-0 origin violations.
Your notes:

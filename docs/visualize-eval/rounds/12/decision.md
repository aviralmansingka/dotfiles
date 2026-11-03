# Round 12 decision

## Outcome

**2/8 green (both carried: pipeline, network). 43P/13F/4B of 60
applicable.** The two rerun cases — the ones the owner flagged as
detail-losing — both FAIL, but NOT on coverage: every component and
relation is present in both, and the judges upheld the density approach
(runtime's 11 measured merge attempts justify its split; mm's 2 dense
views beat 4 sparse). The coverage-over-budget rule is vindicated as a
policy; the engine cannot yet carry it cleanly.

## What the reruns proved

- **Coverage rule works as intent**: mm went 4 sparse views → 2 dense
  (23 relations once each, 1.8× hint density); runtime 2-edge views →
  3+5-edge views, 8/8 relations. Judges explicitly upheld both splits.
- **Label ownership is THE blocker** — verdict-confirmed on both rerun
  cases in the same round: mm 4 uncertain owners (checker: 0), runtime
  gRPC pair labels nearer other routes (checker: 0). Runtime is now
  3-for-3 rounds failing on this class. The checker's 0-ambiguous
  metric is blind to what readers see; it needs a reader-calibrated
  metric AND a rendering lever (per-route gutters / leader ticks).
- **New defect class: cross-view hue inconsistency** — runtime's
  `worker-plane` renders green in v1, orange in v2. The hue wheel is
  per-view, so a shared group tag shifts color between views of one
  case. Engine fix: case-wide family assignment before per-view layout.
- **Workflow reproducibility gap (mm)** — three recorded probe inputs
  not bundled; and the captain's exploratory capture snapshotted the
  pre-revision spec-v2-final (hash ≠ shipped). Lesson recorded:
  captain probes must pin to content-addressed spec copies.
- **Animation blocked (mm)** — pinned lap evidence exists; the judge
  did not complete the independent equal-distance comparison. A
  frame-step comparison helper would unblock this.
- Boot corridor runs against phase reading order (mm, repeat from r11).

## 11 → 12 movement

| Case | r11 | r12 | Note |
|---|---|---|---|
| modal-machine-manager | 4/8 F | 5/8 F (anim blocked) | density gained, labels still defeat it |
| modal-runtime | 5/8 F | 4/8 F | new hue-consistency fail; labels again |

Both rerun FAILs trace to engine rendering, not the skill text — the
skill layer has nothing left to give on these classes.

## Round-13 shape (proposal)

Engine-first round, no skill change:
1. Label-ownership lever + reader-calibrated checker metric (top item;
   defeats runtime 3×, mm 2×, gb300, homelab).
2. Case-wide hue-family assignment (cross-view consistency).
3. Workflow: bundle every probe input; content-address captain probes.
4. Frame-step comparison helper for the animation audit.

## Process notes

Both judges ran blind-first on terra; spawn instability this round (4
startup crashes, one 429 mid-generation resumed cleanly, one 503
judge respin). The dataset-digest canonicalization quibble surfaced a
7th time (judged non-blocking; actual digests recorded).

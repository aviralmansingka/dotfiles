# Round 13 decision

## Outcome

**0/8 green — 24P/33F/11B of 68 applicable; 48 near-miss cells total.**
Frozen inputs: binary `1f28d87d…` (near-miss routing cost, leader
ticks, multi-diagram canvas, case-wide hue, dot hues), skill proposal 12
(`65d826f0…` — triage loop, canvas ladder, clarity over shaping),
rubric rev 11 (9 categories incl. navigation_clarity), varied per-case
framings per the owner's breadth directive. Full 8-case rerun, judged
blind-first on terra, per-case parallel pipelines.

## What the round proved

**The engine fixes landed and are visible.** The gb300 a3 OOB-hug
defect (the owner's named ambiguity) is GONE — corridor clean, in-band
diagram 0. Labels: 8/8, 24/24, 23/23, 14/14, 6/6, 7/7 placed across
every case, 0 ambiguous by checker everywhere. The canvas form shipped in
5 of 8 cases exactly as the owner directed, with described
concept-diagrams. Triage loops ran honestly in all 8 (one attribution
error, one annex-count mismatch — both caught by judges).

**Where it still fails — three clusters:**

1. **Near-miss remainder is structural** (gb300 19, datacenter 29):
   trunk arms and cross-connect crossings hug unrelated nodes because
   sibling boxes sit 3 cells apart (ring-2 by construction). The rubric's
   zero-margin gate fails them; generators measured every layout they
   could and documented the geometric wall. Engine work (larger rank
   gaps for cross-heavy graphs, or arm-aware near-miss pricing) — round 14.
2. **Evidence coverage for wide canvases** (6 of 8 cases blocked or
   failed on it): whole-canvas ANSI + select-all + a recorded pan are
   missing or clipped. Harness must capture the FULL canvas (pin to
   canvas extent), and generators must record a pan capture per diagram.
3. **Dot cycling on short routes** (network, verdict-confirmed): the
   frame audit passes constant-rate while captures show two dots
   oscillating over two cells. The audit metric needs a
   per-route-traversal check, not just rate consistency.
   Plus scattered semantic drops: gb300's missing nv-rms→NVOS/NMX
   control path, homelab's recurring qualifier losses.

## 12 → 13 movement

| Case | r12 | r13 | Driver |
|---|---|---|---|
| pipeline | PASS (carried) | FAIL 7P/1F/1B | digest typo (captain, fixed); border evidence |
| network | PASS (carried) | FAIL 7P/2F | dot cycling; cap overrun |
| server | FAIL 2P/5F/2B | FAIL 1P/5F/2B+NA | qualifiers |
| homelab | FAIL 2P/6F/1B | FAIL 1P/6F/2B | qualifier drops persist |
| mm | FAIL 5P/2F/1B | FAIL 5P/2F/2B | evidence coverage (drawing clean) |
| runtime | FAIL 4P/3F | FAIL 1P/5F/3B | pair label still ambiguous to the eye |
| gb300 | FAIL 3P/4F/1B | FAIL 2P/4F/3B | near-miss gate + nv-rms gap |
| datacenter | FAIL 3P/4F/1B | FAIL 1P/6F/2B | near-miss + ECMP attribution |

Both r12 greens lost their carried status to r13's stricter gates — the
correct trade: this round's rubric binds claims to the new engine
metrics, and no case cleared them all.

## Process notes

- **7-round digest typo found and fixed** (`e8672b`→`e8692b`): every
  historical judge "mismatch" flag traces to a captain-side
  transcription error. Pipeline's workflow fail was partly this; the
  result's digest was corrected post-verdict with disclosure.
- Leader-tick warning exempted from `check_warnings_absent` mid-round
  (the ownership rescue was unshippable otherwise) — disclosed.
- One judge disclosed a blind-independence compromise (server: read
  generator claims before saving the blind record) — recorded.
- jsonschema unavailable to two judges; structural checks done by hand.

## Round-14 proposal

1. Engine: cross-heavy graph gaps (near-miss-free crossings) + short-route
   dot traversal.
2. Harness: whole-canvas color/select/pan evidence as a required bundle
   artifact; frame audit gains per-route traversal.
3. Skill: source-ledger completeness (nv-rms-class control relations,
   qualifier retention under budget pressure).

# pipeline — round 05 generation (captain-assembled records)

The generator session crashed twice on a full disk after completing the bundle;
these records were assembled by the captain from its preserved artifacts.

- Final spec: `spec-v1.json` (sha256 `{spec_h[:16]}…`), single view, tb,
  6 nodes / 6 edges / 4 groups, extent 36x40, pane 83x51.
- `--check` (verbatim in `evidence/v1/check.txt`): crossings 0 bridges
  0 touching bends; labels 4/4 placed, 0 on route, 0 skipped, 0 ambiguous
  owners; dots 6 single-dot constant routes, 0 violations; origins 6/6;
  arrivals 0/0 (same-arrival not requested).
- Motion: constant 0.5 c/step; full-lap pinned dump at
  `motion/v1-frames-lap-77x47.txt` (53 frames; frames 0-1 identical from
  the 0.5-rate alternation).
- One attempt only (kept first candidate; crossings already structural 0).
- Honest gaps: the worker never wrote its frame-0 origin reading (judge
  measures from the pinned dump); pane is 83x51 with the pinned dump as
  the 77x47 fit proof; no `routes:` line exists in this build (expected).
- Cleanup: confirmed_closed.

## Incident note

A runaway pane-geometry probe (`geometry.txt`) grew to 359 GB and filled the
disk, crashing this session twice. The captain deleted it; the sample above
and `generation.json` carry the record. All bundle evidence predates and is
unaffected by the incident.

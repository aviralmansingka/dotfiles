# Brief — network (terse minimal ask)

**Framing:** one-line, under-specified. The generator is expected to triage.
**Facts:** unchanged from `docs/visualize-eval/cases/network/source.md`
(`source_sha256 9d23a7b50d1d26a69f95523a9586bab96ec588afb9628ae274c896992b147947`).
This brief changes only the voice of the request.
**Triage annex:** `TRIAGE-network` (generator-task.md, TRIAGE PROTOCOL).
Expected triage load: heavy — this is the brief where asking is the test.

## The request

> network diagram, wan down to the db

## The reader's job

They gave almost nothing, so the annex supplies what a live user would: read the
link speeds, see which application talks to which, one pane beside the chat, and
never mistake dot speed for link speed. The generator's job in this framing is to
notice that the reader's job is unknown and ask before drawing — a competent
triage converts eleven words into a scoped request; a lazy one draws a generic
network.

## What this framing exercises

- **Triage:** heavy and load-bearing. Scope (which tiers), the reader's job, the
  panes-vs-canvas choice and the motion-versus-measurement question are all open
  at the start. The skill must ask them one at a time, then stop.
- **Canvas:** resolved by triage to rung 1 (one pane), not decided by node count.
- **Density:** six nodes, seven relations with three distinct link speeds and
  three application relations riding the same box pairs — the test is separating
  `core -> cache` (25 GbE) from `web -> cache` (session), which is exactly the
  anti-parallel/parallel-pair pressure of this case.
- **Motion:** required by `cases.json` and by the source's slow-sparse request;
  the speed labels carry the measurement, the dots carry direction only.
- **Traceability:** the round-13 near-miss class matters here — the
  `web -> cache` and `cache -> db` routes must not hug `core` or `web` on their
  way past.

## What must not change

Every fact from `source.md`: `wan -> fw` 1 GbE, `fw -> core` 10 GbE,
`core -> web` 10 GbE, `core -> cache` 25 GbE, `web -> cache` session,
`web -> db` queries, `cache -> db` fill; keep the separate `core -> cache` and
`web -> cache` relations, keep all three speeds visible, and never imply motion
speed is a measurement.

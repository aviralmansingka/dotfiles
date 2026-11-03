Switch single-part uploads from multipart (initiate + one part + complete = 3 requests/object) to one plain `PutObject` request. Code + tests + docs + PR only: no live cloud runs, no remote hosts.

## Context and motivation

rack-bench (stdlib-only, `dependencies = []`) measures upload/download throughput to S3/R2/GCS. Measured facts driving this change:

- R2 bulk upload caps at **557 MiB/s** (certify, c=32) where S3 takes **1405 MiB/s** with the same client — and ALL R2 c=64 certify upload windows died on `502: InternalError` (single-part multipart ≈ 3 requests/object).
- The **warp** client at c=64 with plain `PutObject` (1 request/object) ran clean at **1396 MiB/s** against R2 — zero 5xx.
- Hypothesis: R2's ingest limit is tripped by the multipart request pattern (≈3× request rate; R2's open-beta docs stated ~100 PUT/s per bucket). PR #31 (merged) already added multi-bucket sharding; this PR removes the request amplification itself.

Read first: `rack_bench/bench/internet/s3client.py` (multipart machinery, `_request`, signing, per-provider checksum semantics — gcs omits CRC32 headers), `transfer.py` (`transfer_window`, `_transfer_worker`, pool client configs carry provider since #32, `PART_SIZE`/`--part-size` 8..512 MiB, part-boundary deadline checks from #27, upload records that downloads re-read), `cli.py`, `docs/bench-internet.md` §4/§6 (upload semantics, ceiling attribution), `tests/` (290 passing incl. loopback multipart/range harness; must stay green and clean under `-W error::ResourceWarning`).

## Design (the safe scope)

- **Rule:** when the object fits in a single part (`object_size <= part_size`), upload with ONE plain `PutObject` instead of single-part multipart. Objects spanning multiple parts keep multipart unchanged — that preserves #27's 30 s-socket-timeout reasoning for large objects (a 1 GiB single PUT at single-stream rates would outlive the timeout; multipart's 64 MiB parts bound each request).
- Keep the existing payload generation (run-shared seed, 1 MiB chunks, digest cache) and signing; per-provider checksum semantics from #32 carry over (gcs: no CRC32 headers; s3/r2 unchanged).
- Keep the deadline/abort semantics: one deadline check around the single PUT, equivalent to today's single-part window.
- Upload records stay shape-compatible so downloads/range GETs and cleanup work unchanged (records may additively note the upload mode).
- Samples/detail record the upload mode (e.g., `upload_mode: "put" | "multipart"` on the sample, mode counts in the check detail) — additive only; check names and the regions/runs_detail envelope stay stable (`scripts/ab_quick.sh compare` must keep working).
- No retries: a 5xx on the measured PUT still fails the window.
- Optional (only if it stays clean and small): a `--upload-mode auto|multipart` override for forced comparisons; `auto` is the default rule above. Lean minimal if in doubt.

## Tests

- Loopback end-to-end: a 64 MiB object with default part size goes up as ONE request (assert the loopback server saw no initiate/complete calls); download + verification + cleanup unchanged; a larger-than-part object still multipart; forced-multipart mode (if implemented) reproduces the 3-request pattern.
- Provider semantics: gcs path issues the PUT without checksum headers; s3/r2 byte-identical to today's signed requests.
- Unit: mode selection at the size/part-size boundary (equal → put; +1 MiB → multipart); deadline behavior; detail/sample fields.
- Full suite green (290 baseline), clean under `-W error::ResourceWarning`.

## Docs

`docs/bench-internet.md` §4 upload semantics (one PUT for single-part-sized objects; multipart retained for multi-part objects and why), README flag table if a flag is added. STE house style.

## PR

Push the branch, open a PR against main with `gh` in the house pattern (context → change → tests → verification status). State: loopback-tested only; the live A/B after merge is R2 quick upload at c=64 (free) — expected to clear the 502s if the request pattern was the trigger; every window will self-report its ceiling verdict thanks to #33. Commit in logical units; report files changed, test count, and anything unverifiable locally.

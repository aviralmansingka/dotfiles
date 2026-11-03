Add multi-bucket support to rack-bench `bench internet` upload/download. Code + tests only: do not run live cloud benchmarks, do not touch any remote host, do not change sysctls.

## Context

rack-bench is a stdlib-only Python benchmarking tool (pyproject has `dependencies = []`). The `bench internet` category measures upload/download throughput to S3-compatible object stores (S3, R2). A four-fix performance chain is merged on main (connection pooling, 64 MiB parts, cheap data path, process-pool bulk workers). Read these first:

- `rack_bench/bench/internet/cli.py` — InternetOptions dataclass, flag parsing. `--buckets` (line ~57, type=buckets) currently parses `PROVIDER=NAME,...` — exactly ONE bucket per provider, buckets must already exist. `--regions` same grammar.
- `rack_bench/bench/internet/targets.py` — region selection per provider (s3 default ap-south-1, r2 default apac).
- `rack_bench/bench/internet/transfer.py` — the core. Bulk windows (concurrency > 1) run one worker per process (fork pool); single-stream windows use in-process threads. `_transfer_worker` is a picklable top-level function doing multipart PUTs on upload and range GETs on download; per-object records persist what was uploaded so GETs can re-read it.
- `rack_bench/bench/internet/s3client.py` — S3Client (per-process, holds threading.local connections), SigV4 signing, LRU chunk/digest caches, NO hidden retries (a 5xx on a measured op fails the window by design).
- `rack_bench/bench/internet/upload.py`, `download.py`, `latency.py`, `tcp.py`, `path.py` — window orchestration, small-object TTFB probes, ss-based TCP window diagnostics.
- `tests/` — 263 tests pass, including a loopback multipart/range HTTP server harness that drives the real client end-to-end. Suite must stay green and clean under `-W error::ResourceWarning`.
- `docs/bench-internet.md` (spec, §3 command surface, §8 buckets) and the README `bench internet` flag table — update both.

## Motivation (why multiple buckets)

The certify run hit R2 `502: InternalError` on ALL c=64 bulk upload windows (single-part multipart, ~3 requests/object), while a warp client at c=64 with plain PutObject was clean. Suspected per-bucket ingest limit on the R2 side (R2's open-beta docs stated ~100 PUT/s per bucket). Sharding workers across several buckets is the next experiment: if c=64 succeeds across 4 buckets but not 1, the ceiling is per-bucket, not per-account. It also helps S3 distribution.

## Requirements

1. **CLI:** accept multiple buckets per provider. Backward compatible: a single bucket per provider behaves exactly as today. Pick a clean syntax that does not break the existing comma-separated `PROVIDER=NAME` grammar — e.g. repeated `--buckets s3=b1 --buckets s3=b2` flags (argparse append) or a documented intra-provider separator. Validate early with clear errors (duplicate providers across repeated flags merge; empty names rejected).
2. **Assignment:** at bulk-window start, workers (processes) are assigned buckets round-robin. Single-stream windows use the first bucket. Deterministic and recorded.
3. **Upload:** each object's record persists which bucket it went to (records are how downloads re-read data).
4. **Download:** range GETs (and small-object probes) fetch each object from ITS recorded bucket.
5. **Cleanup:** delete bench objects across ALL buckets used, per-bucket prefixes unchanged.
6. **Artifacts:** check `detail` includes the bucket list; keep check names and the regions/runs_detail envelope shape stable so `scripts/ab_quick.sh compare` keeps working.
7. **Docs:** update `docs/bench-internet.md` §3/§8 and the README flag table. Simplified Technical English, match the house style.
8. **Tests:** extend the loopback harness for multiple buckets (multiple roots/prefixes). Cover: round-robin assignment, per-object bucket tracking in records, download hitting the correct bucket, cleanup across all buckets, single-bucket regression (identical behavior), CLI parsing (merge, duplicates, empty names, clear errors). Full suite green, `-W error::ResourceWarning` clean.

## Constraints

- stdlib only; no new runtime dependencies.
- No hidden retries: 5xx on a measured op still fails the window.
- Do not touch remote hosts or run cloud benchmarks.
- Commit in logical units on this worktree branch. When done, report: files changed, design decisions (especially the CLI syntax), test count before/after, and anything you could not verify locally.

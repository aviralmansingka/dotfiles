Implement and validate "fix 2" for the rack-bench internet benchmark: larger multipart parts / range GETs to amortize per-request server processing. Work in <repo>.

## Context

The repo benchmarks Cloudflare R2/S3 throughput. A pooling change just landed on branch `http-connection-pooling` (PR #26): one keep-alive connection per worker thread, per-request handshake eliminated. A/B validation showed `connect_ms/part` now 0.0, single-stream download +27%, but per-request S3 server processing (~110 ms, visible as TTFB in the sample timings) is still paid once per 8 MiB part. Fix 2 attacks that: bigger parts = fewer requests per byte.

Key files (read them first):
- `rack_bench/bench/internet/transfer.py` — `PART_SIZE = 8 * MIB` at the top; used by `transfer_window` for multipart PUT parts (upload) and range GETs (download). Also `OBJECT_SIZE`, `LIGHT_SIZE = 32 * MIB`.
- `rack_bench/bench/internet/s3client.py` — `multipart_upload(part_size=8MiB)` validates `5 MiB..5 GiB`, and `upload_part` validates part numbers 1..10000. Note S3 requires every part except the last to be >= 5 MiB, and multipart completion needs 1..10000 consecutive parts.
- `tests/test_bench_internet_transfer.py`, `tests/test_bench_s3client.py` — existing tests.

## What to implement

1. Create a new branch `larger-transfer-parts` from the current commit (it already contains PR #26).
2. Raise the transfer part size. Choose 64 MiB (`PART_SIZE = 64 * MIB`) as the default, and add a `--part-size` CLI option (MiB, positive int, min 8, max 512) in `rack_bench/bench/internet/cli.py` `Options`/`add_arguments`, plumbed through `upload_reports`/`download_reports` into `transfer_window`, so operators can tune it. Keep the S3 constraints enforced (parts >= 5 MiB except final; object must fit in <= 10000 parts; quick profile with 64 MiB objects must still work — a 64 MiB object with 64 MiB parts is a single-part upload, which is valid).
3. Watch the timeout interaction: the client socket timeout is 30 s. A 128+ MiB part at ~10 MiB/s single-stream is ~13 s — fine, but do not set the default above 128 MiB without checking.
4. Update/extend tests: part-size plumbing (CLI flag reaches transfer_window), single-part-object case, and any existing tests that hardcode 8 MiB parts. Run the FULL suite: `.venv/bin/python -m unittest discover -s tests -q` — all 245+ tests must pass, ideally also with `-W error::ResourceWarning`.
5. Commit on your branch with a clear message. Do NOT create a PR (the captain will decide after reviewing your report).

## Report back

- Branch name and commit hash
- Test results (counts, before/after)
- Your interpretation of the expected effect (fewer requests per GiB, lower per-part TTFB share; single-stream and bulk may move differently — download range GETs amortize the same way)
- Any surprises or invariants you had to protect

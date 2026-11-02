Implement and validate "fix 3" for the rack-bench internet benchmark: cut per-byte data-path CPU cost (payload generation and digest passes). Work in <repo>, currently on `main` (which already contains two merged fixes: per-thread keep-alive connection pooling, PR #26; and 64 MiB parts with `--part-size`, PR #27).

## Context and diagnosis

Measured state after the two merged fixes (quick A/B, R2): single-stream up 14.7 MiB/s, down 54.4 MiB/s, bulk up ~250 MiB/s, bulk down ~350 MiB/s. Remaining costs on the data path, in `rack_bench/bench/internet/s3client.py` and `transfer.py`:

1. `SeededPayload` (s3client.py) generates every chunk with `hashlib.shake_256(domain + chunk_index).digest(size)` at `chunk_size = 64 * 1024` — 16,384 Python-level generator iterations per GiB, on upload AND on download verification
2. `_upload()` calls `checksum_headers(body())` which walks the ENTIRE part body once to compute SHA-256+CRC32 (both are signed headers, so a pre-pass is protocol-required), then `_request` iterates `body()` AGAIN to send — every chunk is generated twice per part
3. The download read loop calls `response.read(64 * 1024)` with a Python `consume` callback per block (transfer.py `_request` read loop + `get_object` `receive` verifying each block)

## What to implement

Branch `datapath-slab-cache` off `main`. Do NOT create a PR — commit and report; the captain decides on PRs after benchmarking.

1. **Raise the default `SeededPayload.chunk_size` to 1 MiB** (the existing validator already allows 1..1048576). 16× fewer Python iterations per GiB on generation and verification. Check all call sites and records that persist `chunk_size` — they store it explicitly, so old records still verify correctly.
2. **Share one payload seed per run instead of per-object key** (upload.py currently does `SeededPayload(key, size)`; transfer.py worker does `SeededPayload(key, size)` / `SeededPayload(**objects[...]["payload"])`). Derive the seed once per run (e.g. from the run prefix / a run-scoped token stored alongside the records) and use it for all transfer objects in that run. Per-object records must still store `{seed, size, chunk_size}` so download verification keeps working unchanged. Rationale: with a shared seed, the chunk at any given offset is identical across all objects, so per-part digests are identical too and can be cached.
3. **Add bounded caches**: an LRU for chunk bytes keyed `(seed, chunk_index)` and for part digests keyed `(seed, offset, size)` → after warm-up, the signed-digest pre-pass and repeated generation become ~free. Bound total cache memory explicitly (e.g. cap at ~256 MiB of chunk bytes; document the bound). Must be safe across the ThreadPoolExecutor workers (a lock or per-process cache is fine — measure if contention shows).
4. **Larger download reads**: the `_request` read loop should read in 1 MiB blocks when the response is a measured transfer (keep `read(1)` for body-TTFB as-is).
5. Preserve every invariant: verified downloads, CRC32 equality checks, BadDigest/VerificationError typing, "never a hidden retry" for measured ops, SigV4 real-digest signing. If any existing test asserts that different keys produce different bytes (grep for it), adapt the test to the new seeding scheme and say so in your report.

## Tests

- Update/extend tests for: 1 MiB chunk verification ranges, shared-seed equivalence (two objects, same seed, different keys, identical part digests; per-object records reproduce bytes), cache correctness (bytes from cache == freshly generated), download read-block sizing if observable. Run the FULL suite: `.venv/bin/python -m unittest discover -s tests -q` — everything must pass, ideally also under `-W error::ResourceWarning`.
- Commit with a clear message.

## Report back

- Branch + commit hash, test counts before/after
- Your expectation for which metrics should move and why, and what you believe is the binding constraint after the change
- Cache design summary and the memory bound chosen
- Any invariant you had to protect or test you had to adapt

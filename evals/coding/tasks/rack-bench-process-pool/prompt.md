Implement and validate "fix 4" for the rack-bench internet benchmark: move bulk transfer workers from threads to processes so the data path escapes the GIL. Work in <repo>. Current branch state: the current commit already contains merged PRs #26 (per-thread pooled keep-alive connections), #27 (64 MiB parts) and #28 (fix 3: 1 MiB chunks, run-shared seed, bounded LRU chunk/digest caches, 1 MiB download reads). Create your branch `process-pool-workers` from the current commit (it already contains fixes 1–3): `git checkout -b process-pool-workers`.

## Design (validated with the captain; adapt as the code requires)

In `rack_bench/bench/internet/transfer.py`, `transfer_window()` currently runs `ThreadPoolExecutor(max_workers=concurrency)` with a closure `worker(index)` that mutates shared lists (`samples`, `points`, `completed`, `errors`, `attempted_bytes`) under a lock, plus a parent-side `latency_worker` thread, all inside `with tcp_factory(host) as tcp:`.

1. Bulk windows move to a process pool (`concurrent.futures.ProcessPoolExecutor`, fork context — host is Linux). Each worker process gets its own GIL and builds its own S3Client via a pool initializer (S3Client is NOT picklable: it holds threading.local; pass plain config — bucket, region, provider, endpoint host/port/tls/path_style — and construct in the child). The per-process client also gives each worker a warm pooled TLS connection across objects (works with fix 1 as-is).
2. `worker` must become a picklable top-level function that RETURNS results — `(samples, points, completed, errors, attempted_objects, incomplete_objects)` — instead of mutating shared state. Per-part validation (`sample_timing`, monotonic checks, byte accounting) still runs inside the worker before returning; the parent merges and computes buckets/stats exactly as today. `attempted_bytes`/live accounting becomes a returned total.
3. Deadline/stop: workers already self-check `clock() < deadline` — keep that pattern with an absolute deadline passed in. Replace the threading `stop` Event for cross-process early-stop: a `multiprocessing.Event` (fork-compatible) checked in worker loops, set by the parent on first error; alternatively cancel remaining futures.
4. The loaded-latency probe STAYS in the parent process as a thread with its current fresh_connection=True semantics — unchanged metric meaning.
5. CRITICAL — TCP sampling: `TCPWindow.sample()` (tcp.py) filters ss output with `parse_ss(text, os.getpid())`. Child-process sockets would silently vanish from the window diagnostics. Extend TCPWindow to observe the pool's child pids as well (the pool spawns lazily on first submit — either pass a pid-provider callable, collect pids post-submit, or for bulk windows relax to endpoint-dst filtering only; the ss expression already restricts dst to the endpoint IPs). Single-stream windows (concurrency=1) may stay on the in-process thread path — they are the control group and keeping them unchanged preserves comparability and the pid filter; document whichever scoping you choose.
6. Test seam: add a `pool_factory` parameter (mirroring `tcp_factory`) defaulting to the process pool; existing tests inject a thread-based factory so fake clocks/Mock clients keep working. Add new tests for the real process path (picklable worker, result merging, cross-process stop, child-pid ss coverage if feasible).
7. contextvars do not cross processes: `copy_context().run` and the `_echo` operation-echo context need a child-safe replacement (plain prints/logging in the worker are fine).
8. Fork safety: create the pool before any parent-side pooled sockets are open, or ensure the latency thread's connections are made post-spawn.

## Honest expectations

After fix 3, per-part client CPU collapsed (e.g. up bulk 308→22 ms per 64 MiB part), so bulk may already be network/R2-bound — the change may show modest or no bulk gain. That is a VALID finding either way: it documents whether the GIL still binds bulk throughput. Watch two things in your interpretation: (a) if bulk moves, how far toward the 25 Gb/s wire; (b) whether down-single recovers from fix-3's ×0.84 dip (54.4→45.6) — a second consecutive dip would be signal, not noise.

## Known pre-existing flake — do not chase

`test_concurrent_loaded_gets_are_inside_upload_window` reproduces on `main` in a 40-run loop (at_seconds vs elapsed race) — pre-existing, not yours to fix. Do not let it block you; note if you see it.

## Tests and commit

Full suite must pass: `.venv/bin/python -m unittest discover -s tests -q` (and ideally under `-W error::ResourceWarning`). Commit on your branch with a clear message. Do NOT create a PR — the captain decides after reviewing your report.

## Report back

- Branch + commit hash, test counts before/after
- Your expectation for bulk throughput and for down-single after the change, and what you believe becomes the new binding constraint
- Design decisions: process-pool scoping (bulk-only vs all windows), child-pid ss approach, memory footprint of N per-process caches (fix-3 caches are per-process — with run-shared seed all processes cache identical content; consider a smaller per-process cap), fork-safety choices
- Any invariant you had to protect or test you adapted

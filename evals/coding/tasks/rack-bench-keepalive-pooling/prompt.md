Replace the per-request TCP+TLS handshake in `bench internet` with one persistent keep-alive connection per worker thread.

## What to build

- One connection per thread, reused across that thread's requests, in `rack_bench/bench/internet/s3client.py` (the client already owns the endpoint seam).
- A stale idle socket reconnects once, with fresh timing. A measured op that transfers zero bytes must fail the window: connection setup is never a hidden retry.
- Latency probes opt out through a `fresh_connection` path, so every TTFB sample keeps its own TCP+TLS cost.
- Close the pool cleanly when the client closes, and keep the existing per-socket timeout semantics.
- Add `scripts/ab_quick.sh` for a quick A/B comparison of throughput changes.

## Constraints

- stdlib only; no new dependencies.
- Measurement semantics unchanged: verified uploads and downloads, CRC32 comparison, typed errors, no hidden retries on measured ops.
- Keep the suite green, ideally under `-W error::ResourceWarning`.

## Verification

- `.venv/bin/python -m unittest discover -s tests -q`.
- Report: files changed, how reuse is bounded per thread, how a stale socket is detected, test count.

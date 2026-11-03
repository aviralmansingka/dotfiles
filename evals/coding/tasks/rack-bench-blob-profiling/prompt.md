Add ceiling-attribution profiling to rack-bench `bench internet` so every run carries the evidence needed to rule blob-storage service slowness in or out. Code + tests only: no live cloud runs, no remote host access, no sysctl changes.

## Context

rack-bench is a stdlib-only Python benchmark tool (`dependencies = []`). `bench internet` measures upload/download throughput against S3/R2. A four-fix perf chain is merged on main. Recent finding to design against: S3 Mumbai gave bulk download 2185 MiB/s (18.3 of 25 Gbit/s) and upload 1405 MiB/s at c=32, while R2 caps at ~1483/557 — we need the bench itself to record WHY a ceiling exists. Read first:

- `rack_bench/bench/internet/transfer.py` — `throughput_buckets()` (1 s byte buckets already computed), `bdp()` (RFC 6349 ratios), sample validation (per-request timing fields incl. first-byte), bulk windows run one worker per process.
- `rack_bench/bench/internet/tcp.py` — `parse_ss` / `TCPWindow` (pid-filtered `ss -ti` sampling, retransmit counting). Extend here.
- `rack_bench/bench/internet/cli.py`, `runner.py` — flags and the `Check` envelope emit (`bench.values.json`, `bench.out`).
- `tests/` — 263 passing incl. a loopback multipart/range server harness; must stay green and clean under `-W error::ResourceWarning`.
- `scripts/ab_quick.sh compare` — downstream consumer of check `detail` (regions/runs_detail shape). Keep it working: only ADD fields.

## What to add

1. **Per-window bucket stats:** p50/p95/p99 of the 1 s throughput buckets plus a steadiness ratio (p50/p95) in check detail. Flat ceiling vs bursty is a first-class signature.
2. **TTFB percentiles per window:** p50/p95/p99 of measured-op first-byte latency in bulk windows (PUT and GET separately), so TTFB-vs-concurrency is readable from the artifact without re-parsing samples.
3. **Post-TTFB streaming rate per request:** bytes / (total_seconds - first_byte_seconds); report p50/p95 per window. Separates service request cost from wire streaming; a service-paced per-connection rate shows here.
4. **Socket limit flags:** extend `parse_ss` to capture per-socket `busy`, `rwnd_limited`, `cwnd_limited`, `sndbuf_limited` (time shares, printed by `ss -ti` only when nonzero — treat absent as 0; parse defensively across kernel formats) plus `delivery_rate` and `cwnd` when present. During bulk windows, aggregate per sample tick: median busy%, median rwnd_limited%, median cwnd_limited%, median sndbuf_limited%, socket count per dominant limit state. Store per-window aggregates in check detail.
5. **Verdict helper** — a pure function mapping those signals to one STE finding string per window: "service-paced" (high busy, low all limits, flat buckets); "receive-window limited" (rwnd_limited high); "congestion or loss" (cwnd_limited high or elevated retrans); "flat ceiling, clean sockets" (p95/p50 near 1, low limits — points at policer/wire or per-client cap); "bursty" (high p50/p95 spread). Thresholds documented as diagnostics, not certification (mirror the wording style of the existing `bdp()` reference note). Surface it in the throughput check detail and the summary line.
6. **Docs:** extend the checks/diagnostics section of `docs/bench-internet.md` and the README `bench internet` table. Simplified Technical English, house style.

## Constraints

- Check names and the regions/runs_detail envelope shape stay stable; only additive detail fields.
- stdlib only; no hidden retries (5xx on measured ops still fails the window).
- All percentile/stat math as small pure functions with unit tests (incl. ss output lines with and without the flag fields, and malformed lines).
- Loopback integration test: flags capture present in detail and windows still pass when ss yields no matching sockets.
- Commit in logical units on this branch. Report: files changed, design notes, test count before/after, anything unverifiable locally.

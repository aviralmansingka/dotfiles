Add GCS (Google Cloud Storage) as a third opt-in provider to rack-bench `bench internet`, implemented via the S3 XML interoperability API (HMAC keys), delivered as a PR. Code + tests + docs + PR only: no live cloud runs (no GCS credentials exist yet), no remote host access, no sysctl changes.

## Context

rack-bench is a stdlib-only Python bench tool (`dependencies = []`). `bench internet` measures upload/download throughput against S3-compatible stores; providers today are `s3` and `r2`. The spec already reserves GCS: `docs/bench-internet.md` §2 says "GCS behind `--providers gcs` (interop endpoint) as best-effort" and `docs/internet-performance.md` §3 has the provider matrix ("GCS | JSON/XML | S3-interop endpoint + HMAC keys"). Your job is to make that real. Read first:

- `rack_bench/bench/internet/cli.py` — `--providers` choices, `--regions`/`--buckets` parsing (`PROVIDER=VALUE,...` grammar).
- `rack_bench/bench/internet/targets.py` — provider→default-region mapping and endpoint selection (`s3` → `https://s3.<region>.amazonaws.com`, default region ap-south-1; `r2` → `https://<account>.r2.cloudflarestorage.com` from `R2_ACCOUNT_ID`, default "apac").
- `rack_bench/bench/internet/s3client.py` — `S3Client`, `Credentials.from_env` (reads `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/optional `AWS_SESSION_TOKEN`), `signing_key(secret, date, region, service="s3")` (service is already a parameter), `sign_headers`. Multipart PUT + range GET logic lives here and in `transfer.py`.
- `rack_bench/bench/internet/path.py` — RTT sanity reference bands per region (e.g. "ap-south-1: 20-35 ms").
- `tests/` — 263 passing, incl. a loopback multipart/range HTTP server harness driving the real client end-to-end. Must stay green and clean under `-W error::ResourceWarning`.
- Research corpus for grounding: `docs/research/internet-research/hyperscalers.md` (GCS perfdiag, Chennai edge POP notes), `docs/research/internet-research/oreilly.md`.

## GCS interop facts to verify yourself (web + corpus) before coding

- Endpoint: `https://storage.googleapis.com` (global, anycast) with path- or virtual-hosted bucket addressing. The XML interop API accepts S3-style AWS Signature V4 (`AWS4-HMAC-SHA256`) requests from S3 clients — verify the exact credential-scope region string Google expects (their own goog4 signing differs; the S3-compat path is what we ride) and confirm from Google's "S3 interoperability" / HMAC docs.
- HMAC access keys come from the GCP console Interoperability tab (not the same as OAuth). Pick env var names following the boto precedent — `GCS_ACCESS_KEY_ID` / `GCS_SECRET_ACCESS_KEY` — and document them; missing creds must SKIP with a reason exactly like other permission-gated probes (see how missing R2/AWS creds behave).
- Multipart upload and Range GET are supported on the XML API — confirm constraints (part size bounds may differ from S3's 5 MiB..5 GiB; no chunked transfer-encoding — PUTs must send Content-Length; the client already does).
- Region semantics: GCS buckets have a location (e.g. `asia-south1` Mumbai, `asia-south2` Delhi) but the endpoint is global. For the bench's region pinning + RTT sanity, map `gcs` to the BUCKET's location (default `asia-south1` to match the S3/R2 Mumbai/Chennai band) and add an RTT reference band for it in `path.py` grounded in the corpus.

## Requirements

1. `--providers gcs` opt-in; the default set stays `s3,r2`. All existing flags work for gcs: `--regions gcs=asia-south1`, `--buckets gcs=<name>`, `--directions`, profiles.
2. Provider plumbing: targets.py endpoint/region for gcs; cli choices; summary lines; check names follow `internet.gcs.*` like the others.
3. Credentials: `GCS_ACCESS_KEY_ID`/`GCS_SECRET_ACCESS_KEY` (or your verified better precedent), sourced like the others; missing → SKIP with reason, no crash, no partial runs.
4. Signing: reuse `S3Client`/`sign_headers` with whatever scope/region string Google's interop requires (verify; `signing_key`'s `service` param exists for this). Keep s3/r2 behavior byte-identical.
5. Semantics: validate part-size bounds and range-GET behavior against GCS's documented limits (the `--part-size` validator bounds may need per-provider adjustments — keep S3's unchanged).
6. Tests: endpoint/region mapping, credential env resolution + SKIP-with-reason when absent, signing scope for gcs (unit, golden-string style like existing signing tests), loopback end-to-end up+down through the gcs provider path (the loopback server is provider-agnostic — exercise the gcs endpoint/region path against it), CLI parsing incl. `--providers gcs,s3`. Full suite green, ResourceWarning-clean.
7. Docs: `docs/bench-internet.md` — GCS moves from "documented extension" to implemented (opt-in, best-effort); README `bench internet` flag table; `docs/internet-performance.md` provider matrix note. STE house style.
8. PR: commit in logical units, push the branch, open a PR against main with `gh`. Body in the house pattern of recent PRs #26–#30 (context → change bullets → tests → verification status). State clearly: loopback-tested only; live GCS certification run is pending credentials (name the env vars an operator must set).

## Constraints

- stdlib only; no new dependencies.
- No hidden retries — 5xx on a measured op still fails the window.
- Do not touch remote hosts; do not run cloud benchmarks.
- Keep check names/envelope shape consistent; only additive changes for gcs.
- Report: files changed, verified-vs-assumed GCS interop facts, test count before/after, PR number/link.

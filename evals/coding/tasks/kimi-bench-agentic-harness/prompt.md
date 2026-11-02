Build a standalone benchmarking/traffic-generation script modeled on SGLang's bench_serving.py, but specialized for AGENTIC workloads, in the repo <repo>/ (which serves Kimi-K3-NVFP4 + DSPARK speculator via SGLang on Modal — read serve.py to see the endpoint shape, OpenAI-compatible routes, parsers, and any URL/port details).

Deliverable: a new file `bench_agentic.py` in <repo>/ that can:

1. Send OpenAI-compatible chat/completions traffic to the server (async, using aiohttp or httpx + asyncio), configurable base URL, model name, API key, concurrency, duration, request count.
2. Support multiple SYNTHETIC TRAFFIC PATTERNS relevant to agents — implement each as a separate generator:
   - `shared-prefix`: many requests reuse a long identical prefix (e.g. a big system prompt + tool schema), varying only the tail — models KV-cache/prefix reuse, which is the classic bench_serving long-prefix pattern.
   - `multi-turn-growth`: simulate one agent's evolving conversation — each turn re-sends the whole history plus a short new user/tool message (this hits prefix cache repeatedly with growing context). Support N simulated agents each with their own thread.
   - `tool-loop`: agentic loop pattern — alternating tool-call turns (assistant emits tool calls, next request includes tool results appended), exercising the kimi_k3 tool-call parser.
   - `fan-out`: burst arrival — a coordinator request spawns K parallel sub-agent requests simultaneously (tests burst scheduling), e.g. tree-of-agents / subagent swarm shape.
   - `poisson`: continuous background load at a given request rate (req/s) with exponential inter-arrival times, on top of which another pattern can run.
3. Configurable synthetic payload knobs: prefix length (tokens), tail length, output length (or distribution), number of agents/threads, turns per thread, fan-out width, arrival rate.
4. Metrics like bench_serving: throughput (output tok/s, input tok/s, req/s), TTFT, ITL/TPOT, E2E latency, p50/p90/p99 percentiles, prefix-cache hit behavior if the server reports it (SGLang exposes cached_tokens in usage/extra fields — capture it when present). Also success/error counts, and tool-call parse failures as a distinct error category.
5. Optional `--streaming` mode (default on) and `--save-results json` output.
6. CLI with argparse, good defaults, `--list-patterns`, and a short usage docstring. Keep it a single self-contained file, Python 3.10+, no exotic deps (aiohttp/httpx + stdlib only). Token estimates can be chars/4 heuristic; that's fine.

Research first (web): look at how sglang's bench_serving.py structures its async request loop and metrics (https://github.com/sgl-project/sglang/blob/main/benchmark/kserve/bench_serving.py or sgl-project benchmark scripts), and what 'agentic' load patterns are currently recommended in LLM serving benchmarks (e.g. NVIDIA/sglang shared-prefix benchmarks, reasoning-model long-output patterns, Aider/SWE-agent style traces). Cite sources in comments where a pattern is taken from a known benchmark.

Test what you can locally: syntax check, `--help`, and a dry-run/self-test mode (`--dry-run` that prints the payloads it would send without hitting the network) so it can be verified without a live server. Do NOT deploy anything to Modal and do NOT modify serve.py.

Report back: file path, pattern list, example commands for each pattern against our Modal endpoint, and any caveats.

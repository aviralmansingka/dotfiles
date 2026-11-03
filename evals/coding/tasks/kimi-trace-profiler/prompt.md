Profile the user's REAL agent conversations from local traces and map them onto the benchmark harness knobs in <repo>/bench_agentic.py. The goal: realistic default parameters for load tests, including variability where the real workload varies. Do all work yourself; report back a compact recommendation.

## Trace sources (find them all)
1. **Codex CLI rollouts**: ~/.codex/sessions/2026/*/*/*.jsonl and ~/.codex/archived_sessions/*.jsonl (~127 files in the last 30 days). Format: JSONL records with type/payload — session_meta (base_instructions = system prompt), response_item (message role user/assistant, function_call, function_call_output), event_msg type=token_count (info.total_token_usage input/output tokens, info.last_token_usage cached_input_tokens — REAL token counts, use them).
2. **Claude Code transcripts**: ~/.claude/projects/*/*.jsonl (4 files). type user/assistant, message.content (string or list of {type:text}), assistant records carry usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}.
3. **pi-agent conversations** (user explicitly wants these included): hunt for them — ~/.pi/agent/ (has run-history.jsonl with run metadata only; look for session/transcript stores nearby: ~/.pi/, ~/.pi/agent/sessions, ~/.pi/agent/npm, ~/Library/Application Support, or exports). Pi transcripts may be in a different format (message logs with roles). If genuinely not found, say where you looked and proceed with the other two.
Filter to roughly the last 30 days.

## Starting point
A draft analyzer already exists at /Users/aviral/kimi-endwork... correct path: <repo>/analysis_profile_traces.py (written by the parent, never run — it has at least one known bug: a nonsense line `if pending_user or asst_outs.count == 1:` and a fragile dist() using __setitem__). Fix/rewrite as needed; it encodes the intended metrics. Use chars/4 heuristic only where real token counts are absent.

## Metrics to extract per session and aggregate (p50/mean/p90/p99/max)
- **Initial context / prefix**: system instructions + first user message (the shared-prefix equivalent)
- **Turns per session** (assistant responses = turns)
- **Per-turn NEW input**: subsequent user messages + tool call args + tool outputs added between assistant turns (this is the --tail-tokens knob and its variability)
- **Per-turn output**: assistant message sizes (the --output-tokens knob; note if the distribution is heavy-tailed — short replies punctuated by long ones)
- **Total input/output tokens** per session from real token_count/usage records where available
- **Cache behavior**: cached input fraction per turn (Claude cache_read, Codex cached_input_tokens) — tells us how much of re-sent history is actually cache-hit in real usage
- **Session concurrency signal**: overlapping sessions in time (distinct active sessions per hour) — informs --agents; also fan-out evidence if any traces show parallel subagent calls

## Deliverable
1. Run the analyzer over ALL sources; save it as analysis_profile_traces.py (fixed) and results to verification-logs/ or artifacts/trace-profile/ as you see fit.
2. A **recommended parameter set for bench_agentic.py**, e.g.:
   - --pattern multi-turn-growth --agents N --turns N --prefix-tokens N --tail-tokens N --output-tokens N
   justified number-by-number from the data (cite the percentile you used and why: p50 for defaults, p90 for stress).
3. **Variability recommendations**: where the real workload is heavy-tailed or bursty, say which knobs should be distributions rather than constants and what spread (e.g. tail-tokens p50 X with p90 Y; consider whether the harness supports randomized tail sizes — read bench_agentic.py and generate_agentic_dataset.py to check; if it only takes constants, note the gap and the minimal change needed, but do NOT modify the harness files).
4. Any surprises (e.g. huge tool-output turns dominating input, reasoning-heavy outputs, sessions that are really one-shot prompts not multi-turn — classify the mix: what fraction of sessions are genuinely multi-turn agentic vs single-shot?).

Keep the final report compact: a table of observed distributions, the recommended command line, and 5-10 bullets of interpretation. Keep per-run summaries to 3-5 sentences. Do not modify serve.py or the bench files.

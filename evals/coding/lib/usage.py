#!/usr/bin/env python3
"""Token, cost and identity capture for eval rollouts.

Two harnesses, two transcript formats:

  pi     - every assistant message carries `usage` with input/output/cacheRead
           and pi's own `cost.total`, so the cost is read, not recomputed.
  codex  - the rollout keeps cumulative `token_count` checkpoints; the last one
           is the run total. Codex stores no prices, so cost is computed from
           the local rate table below (the same gpt-6.1-sol rates pi's catalog
           uses: $2 in / $10 out / $0.10 cached per 1M tokens).

Usage:
  usage.py pi <session-dir>                 # JSON: tokens + cost
  usage.py codex <worktree> [--run-dir D]   # JSON: tokens + cost
  usage.py claude <config-dir> [--model M]  # JSON: tokens + cost
  usage.py table                            # print the rate table

Exit status is 0 with zeroed usage when no transcript is found, so a caller can
record "unknown" instead of failing a run.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

# USD per million tokens. `cache_write` is charged at the input rate unless the
# table says otherwise, which matches how pi's catalog prices gpt-6.1-sol.
RATES = {
    "gpt-6.1-sol": {"input": 2.0, "output": 10.0, "cache_read": 0.1, "cache_write": 2.5},
    "gpt-6-sol": {"input": 2.0, "output": 10.0, "cache_read": 0.2, "cache_write": 2.5},
    "glm-fast-latest": {"input": 2.1, "output": 6.6, "cache_read": 0.39, "cache_write": 0.0},
    "kimi-fast-latest": {"input": 4.5, "output": 22.5, "cache_read": 0.45, "cache_write": 0.0},
    "accounts/fireworks/routers/glm-fast-latest": {"input": 2.1, "output": 6.6, "cache_read": 0.39, "cache_write": 0.0},
    "accounts/fireworks/routers/kimi-fast-latest": {"input": 4.5, "output": 22.5, "cache_read": 0.45, "cache_write": 0.0},
    "accounts/fireworks/routers/deepseek-flash-latest": {
        "input": 0.3, "output": 1.2, "cache_read": 0.006, "cache_write": 0.0,
    },
}


def _empty(source: str) -> dict:
    return {"tokens_in": 0, "tokens_out": 0, "tokens_cached": 0,
            "tokens_cache_write": 0, "cost_usd": 0.0, "source": source}


def pi_usage(session_dir: str) -> dict:
    out = _empty("pi-session")
    files = sorted(glob.glob(os.path.join(session_dir, "*.jsonl")))
    if not files:
        out["source"] = "pi-session-missing"
        return out
    for path in files:
        for line in open(path, encoding="utf-8", errors="replace"):
            try:
                record = json.loads(line)
            except Exception:
                continue
            usage = (record.get("message") or {}).get("usage") or record.get("usage")
            if not isinstance(usage, dict):
                continue
            out["tokens_in"] += int(usage.get("input") or 0)
            out["tokens_out"] += int(usage.get("output") or 0)
            out["tokens_cached"] += int(usage.get("cacheRead") or 0)
            out["tokens_cache_write"] += int(usage.get("cacheWrite") or 0)
            cost = usage.get("cost") or {}
            out["cost_usd"] += float(cost.get("total") or 0.0)
    out["cost_usd"] = round(out["cost_usd"], 6)
    return out


def _codex_rollout_for(worktree: str, run_dir: str | None) -> str | None:
    target = os.path.realpath(worktree)
    roots = []
    if run_dir:
        roots.append(os.path.join(run_dir, "codex-sessions"))
    # codex stores rollouts under $CODEX_HOME/sessions when that is overridden
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        roots.append(os.path.join(codex_home, "sessions"))
    roots.append(os.path.expanduser("~/.codex/sessions"))
    for root in roots:
        for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
            cwd = None
            for line in open(path, encoding="utf-8", errors="replace"):
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                if record.get("type") == "session_meta":
                    cwd = (record.get("payload") or {}).get("cwd")
                    break
            if cwd and os.path.realpath(cwd) == target:
                return path
    return None


def codex_usage(worktree: str, run_dir: str | None, model: str) -> dict:
    out = _empty("codex-rollout")
    path = _codex_rollout_for(worktree, run_dir)
    if not path:
        out["source"] = "codex-rollout-missing"
        return out
    total = None
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            record = json.loads(line)
        except Exception:
            continue
        payload = record.get("payload") or {}
        if record.get("type") == "event_msg" and payload.get("type") == "token_count":
            candidate = (payload.get("info") or {}).get("total_token_usage")
            if candidate:
                total = candidate
    if not total:
        out["source"] = "codex-rollout-no-usage"
        return out
    out["tokens_in"] = int(total.get("input_tokens") or 0)
    out["tokens_out"] = int(total.get("output_tokens") or 0)
    out["tokens_cached"] = int(total.get("cached_input_tokens") or 0)
    out["tokens_cache_write"] = int(total.get("cache_write_input_tokens") or 0)
    rates = RATES.get(model) or RATES["gpt-6.1-sol"]
    fresh = max(out["tokens_in"] - out["tokens_cached"], 0)
    out["cost_usd"] = round(
        fresh / 1e6 * rates["input"]
        + out["tokens_cached"] / 1e6 * rates["cache_read"]
        + out["tokens_cache_write"] / 1e6 * rates["cache_write"]
        + out["tokens_out"] / 1e6 * rates["output"], 6)
    out["source"] = f"codex-rollout:{model}"
    return out


def claude_usage(config_dir: str, model: str = "") -> dict:
    """Claude Code keeps one JSONL per session under <config>/projects/<slug>/."""
    out = _empty("claude-session")
    files = glob.glob(os.path.join(config_dir, "projects", "*", "*.jsonl"))
    if not files:
        out["source"] = "claude-session-missing"
        return out
    seen_model = model
    for path in files:
        for line in open(path, encoding="utf-8", errors="replace"):
            try:
                record = json.loads(line)
            except Exception:
                continue
            message = record.get("message") or {}
            usage = message.get("usage") if isinstance(message, dict) else None
            if not isinstance(usage, dict):
                continue
            seen_model = message.get("model") or seen_model
            out["tokens_in"] += int(usage.get("input_tokens") or 0)
            out["tokens_out"] += int(usage.get("output_tokens") or 0)
            out["tokens_cached"] += int(usage.get("cache_read_input_tokens") or 0)
            out["tokens_cache_write"] += int(usage.get("cache_creation_input_tokens") or 0)
    rates = RATES.get(seen_model.split("[")[0]) or RATES.get("gpt-6.1-sol")
    out["cost_usd"] = round(
        out["tokens_in"] / 1e6 * rates["input"]
        + out["tokens_cached"] / 1e6 * rates["cache_read"]
        + out["tokens_cache_write"] / 1e6 * rates["cache_write"]
        + out["tokens_out"] / 1e6 * rates["output"], 6)
    out["source"] = f"claude-session:{seen_model}"
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_pi = sub.add_parser("pi")
    p_pi.add_argument("session_dir")

    p_codex = sub.add_parser("codex")
    p_codex.add_argument("worktree")
    p_codex.add_argument("--run-dir")
    p_codex.add_argument("--model", default="gpt-6.1-sol")

    p_claude = sub.add_parser("claude")
    p_claude.add_argument("config_dir")
    p_claude.add_argument("--model", default="")

    sub.add_parser("table")

    args = parser.parse_args()
    if args.command == "table":
        print(json.dumps(RATES, indent=2))
        return 0
    if args.command == "pi":
        result = pi_usage(args.session_dir)
    elif args.command == "claude":
        result = claude_usage(args.config_dir, args.model)
    else:
        result = codex_usage(args.worktree, args.run_dir, args.model)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())

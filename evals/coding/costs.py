#!/usr/bin/env python3
"""Summarise a rollout results.csv: passes, time, tokens and cost per harness.

Usage:
  uv run python evals/coding/costs.py <results.csv> [--per-task]

Cost is whatever the harness reported: pi writes pi's own per-message cost,
codex is priced from evals/coding/lib/usage.py's rate table (codex stores no
prices). Treat both as estimates, not invoices.
"""
from __future__ import annotations

import csv
import sys
from collections import defaultdict


def money(value: float) -> str:
    return f"${value:,.2f}"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    per_task = "--per-task" in sys.argv
    rows = list(csv.DictReader(open(sys.argv[1], newline="")))
    if not rows:
        print("empty results file", file=sys.stderr)
        return 2

    agg = defaultdict(lambda: {"n": 0, "pass": 0, "secs": 0.0, "grade": 0.0,
                               "cost": 0.0, "tin": 0, "tout": 0, "tcached": 0})
    best = {}
    for row in rows:
        key = (row["agent"], row["task"])
        # keep the best attempt per (agent, task) for the pass count and totals
        if key not in best or (row["verify_rc"] == "0" and best[key]["verify_rc"] != "0"):
            best[key] = row

    for (agent, _task), row in best.items():
        bucket = agg[agent]
        bucket["n"] += 1
        bucket["pass"] += row["verify_rc"] == "0"
        bucket["secs"] += float(row.get("agent_seconds") or 0)
        bucket["grade"] += float(row.get("grade_seconds") or 0)
        bucket["cost"] += float(row.get("cost_usd") or 0)
        bucket["tin"] += int(row.get("tokens_in") or 0)
        bucket["tout"] += int(row.get("tokens_out") or 0)
        bucket["tcached"] += int(row.get("tokens_cached") or 0)

    print(f"{'harness':6s} {'pass':>7s} {'agent min':>10s} {'min/run':>8s} "
          f"{'tok in':>9s} {'tok out':>8s} {'cached':>8s} {'cost':>9s} {'$/pass':>8s}")
    for agent, b in sorted(agg.items()):
        passes = b["pass"] or 1
        print(f"{agent:6s} {b['pass']}/{b['n']:<5d} {b['secs']/60:10.0f} {b['secs']/b['n']/60:8.1f} "
              f"{b['tin']/1e6:8.1f}M {b['tout']/1e6:7.2f}M {b['tcached']/1e6:7.1f}M "
              f"{money(b['cost']):>9s} {money(b['cost']/passes):>8s}")

    if per_task:
        tasks = sorted({row["task"] for row in best.values()})
        print(f"\n{'task':34s} {'pi min':>7s} {'pi $':>7s} {'cx min':>7s} {'cx $':>7s}  {'pi/cx':>6s}")
        for task in tasks:
            pi = best.get(("pi", task), {})
            cx = best.get(("codex", task), {})
            verdict = f"{'P' if pi.get('verify_rc') == '0' else 'F'}/{'P' if cx.get('verify_rc') == '0' else 'F'}"
            print(f"{task:34s} {float(pi.get('agent_seconds', 0))/60:7.1f} {float(pi.get('cost_usd', 0)):7.2f} "
                  f"{float(cx.get('agent_seconds', 0))/60:7.1f} {float(cx.get('cost_usd', 0)):7.2f}  {verdict:>6s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

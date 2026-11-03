#!/usr/bin/env python3
"""Recompute every claude row in a results.csv from that run's own session.

  uv run python evals/coding/lib/repair_claude.py <results.csv> --home <CLAUDE_HOME> --model <id> [--write]

Early claude rows summed every session in the shared config dir, so each row
carried the tokens of all earlier runs. This matches sessions by their recorded
cwd instead and rewrites tokens and cost for the claude rows only.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import usage  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--home", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.path, newline="")))
    fixed = 0
    for row in rows:
        if row["agent"] != "claude":
            continue
        got = usage.claude_usage(os.path.join(args.home, ".claude"), args.model, row["worktree"])
        if got["source"].endswith("missing"):
            continue
        row["tokens_in"] = got["tokens_in"]
        row["tokens_out"] = got["tokens_out"]
        row["tokens_cached"] = got["tokens_cached"]
        row["cost_usd"] = f"{got['cost_usd']:.6f}"
        fixed += 1
    if args.write:
        with open(args.path, "w", newline="") as h:
            w = csv.DictWriter(h, fieldnames=rows[0].keys())
            w.writeheader()
            w.writerows(rows)
    print(f"repaired {fixed} claude rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())

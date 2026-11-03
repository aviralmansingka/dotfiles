#!/usr/bin/env python3
"""Recompute cost_usd in a results.csv from its token columns.

  uv run python evals/coding/lib/reprice.py <results.csv> --model glm-fast-latest [--write]

Use it after a rate-table fix. pi runs keep pi's own cost; codex and claude runs
are re-priced from tokens, which is how their cost is defined in the first place.
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
    ap.add_argument("--model", required=True)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.path, newline="")))
    rates = usage.rates_for(args.model)
    changed = 0
    for row in rows:
        if row["agent"] == "pi":
            continue  # pi reports its own cost
        tin, cached = float(row["tokens_in"]), float(row["tokens_cached"])
        fresh = tin - cached if row["agent"] == "codex" else tin
        cost = (fresh / 1e6 * rates["input"]
                + cached / 1e6 * rates["cache_read"]
                + float(row["tokens_out"]) / 1e6 * rates["output"])
        row["cost_usd"] = f"{cost:.6f}"
        changed += 1
    if args.write:
        with open(args.path, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
    print(f"re-priced {changed} rows with the {args.model} row: {rates}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

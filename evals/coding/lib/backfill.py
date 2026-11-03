#!/usr/bin/env python3
"""Upgrade a legacy rollout results.csv with token, cost and time columns.

Early runs recorded only agent/task/return codes/seconds/diff. This reads one or
more run directories, recomputes usage from the transcripts with lib/usage.py,
and writes the current column order so costs.py can summarise old and new runs
together.

Usage:
  uv run python evals/coding/lib/backfill.py <run-dir> [<run-dir> ...] --out <file>
"""
from __future__ import annotations

import argparse
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import usage  # noqa: E402

COLUMNS = ["agent", "task", "agent_rc", "verify_rc", "agent_seconds", "grade_seconds",
           "tokens_in", "tokens_out", "tokens_cached", "cost_usd", "commits", "diff", "worktree"]


def legacy_rows(path: str) -> list[dict]:
    """Parse an early results.csv: no quoting, so the diff field holds commas."""
    import re

    rows = []
    lines = open(path).read().strip().split("\n")
    for line in lines[1:]:
        match = re.search(r",(/[^,]*)$", line)
        if not match:
            continue
        worktree = match.group(1)
        head = line[: match.start()].split(",")
        if len(head) < 6:
            continue
        agent, task, agent_rc, verify_rc, seconds, commits = head[:6]
        rows.append({"agent": agent, "task": task, "agent_rc": agent_rc, "verify_rc": verify_rc,
                     "seconds": seconds, "commits": commits, "diff": ",".join(head[6:]),
                     "worktree": worktree})
    return rows


def rows_for(run_dir: str, codex_model: str, rescore: dict | None = None) -> list[dict]:
    path = os.path.join(run_dir, "results.csv")
    if not os.path.exists(path):
        return []
    header = open(path).readline()
    parsed = (list(csv.DictReader(open(path, newline=""))) if "grade_seconds" in header
              else legacy_rows(path))
    out = []
    for row in parsed:
        worktree = row.get("worktree") or ""
        agent = row["agent"]
        if agent == "pi":
            got = usage.pi_usage(os.path.join(run_dir, "sessions", f"pi-{row['task']}"))
            if got["source"].endswith("missing"):
                # rerun directories keep their own session layout
                got = usage.pi_usage(os.path.join(run_dir, "sessions", row["task"]))
        else:
            got = usage.codex_usage(worktree, run_dir, codex_model)
        verify_rc = row.get("verify_rc", "")
        if rescore:
            verify_rc = rescore.get((agent, row["task"]), verify_rc)
        out.append({
            "agent": agent,
            "task": row["task"],
            "agent_rc": row.get("agent_rc", ""),
            "verify_rc": verify_rc,
            "agent_seconds": row.get("seconds") or row.get("agent_seconds") or 0,
            "grade_seconds": row.get("grade_seconds") or 0,
            "tokens_in": got["tokens_in"],
            "tokens_out": got["tokens_out"],
            "tokens_cached": got["tokens_cached"],
            "cost_usd": f"{got['cost_usd']:.6f}",
            "commits": row.get("commits", ""),
            "diff": (row.get("diff") or "").strip(),
            "worktree": worktree,
        })
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dirs", nargs="+")
    parser.add_argument("--out", required=True)
    parser.add_argument("--codex-model", default="gpt-6.1-sol")
    parser.add_argument("--verify-from", action="append", default=[],
                        help="CSV with agent,task,verify_rc that overrides legacy grading")
    args = parser.parse_args()

    rescore = {}
    for path in args.verify_from:
        for row in csv.DictReader(open(path, newline="")):
            rescore[(row["agent"], row["task"])] = row["verify_rc"]

    rows = []
    for run_dir in args.run_dirs:
        rows.extend(rows_for(run_dir, args.codex_model, rescore))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

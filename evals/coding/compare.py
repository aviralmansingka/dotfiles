#!/usr/bin/env python3
"""Compare harnesses and models on the same tasks: time, tokens, cost.

    uv run python evals/coding/compare.py \
      --run pi-glm:/tmp/rollout/glm-fast-045307/results.csv \
      --run codex-glm:/tmp/rollout/codex-glm-050813/results.csv \
      --per-task glm --by repo,kind,difficulty

Each --run is `label:path`. The label is free text; the task attributes come
from manifest.jsonl. Ratios are relative to the first run given for a model,
so order the runs with the baseline first.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))


def load_manifest() -> dict[str, dict]:
    out = {}
    for line in open(os.path.join(HERE, "manifest.jsonl")):
        if line.strip():
            row = json.loads(line)
            out[row["id"]] = row
    return out


def load_runs(specs: list[str]) -> dict[str, dict[str, dict]]:
    runs = {}
    for spec in specs:
        label, path = spec.split(":", 1)
        rows = {}
        for row in csv.DictReader(open(path, newline="")):
            task = row["task"]
            # keep the best attempt per task
            if task in rows and rows[task]["verify_rc"] == "0":
                continue
            rows[task] = row
        runs[label] = rows
    return runs


def f(row: dict, key: str) -> float:
    try:
        return float(row.get(key) or 0)
    except ValueError:
        return 0.0


def fresh_input(row: dict) -> float:
    """Codex counts cached tokens inside input_tokens; pi and claude do not."""
    tin = f(row, "tokens_in")
    cached = f(row, "tokens_cached")
    return tin - cached if row.get("agent") == "codex" else tin


def totals(label: str, rows: dict[str, dict]) -> dict:
    n = len(rows)
    tin = sum(fresh_input(r) for r in rows.values())
    tcached = sum(f(r, "tokens_cached") for r in rows.values())
    return {
        "label": label,
        "n": n,
        "pass": sum(1 for r in rows.values() if r["verify_rc"] == "0"),
        "min": sum(f(r, "agent_seconds") for r in rows.values()) / 60,
        "cost": sum(f(r, "cost_usd") for r in rows.values()),
        "tin": tin,
        "tcached": tcached,
        "tout": sum(f(r, "tokens_out") for r in rows.values()),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="append", required=True, help="label:results.csv")
    ap.add_argument("--per-task", default="", help="model label to print a task matrix for")
    ap.add_argument("--by", default="repo,kind,difficulty", help="manifest attributes to roll up")
    args = ap.parse_args()

    manifest = load_manifest()
    runs = load_runs(args.run)

    print(f"{'run':16s} {'n':>3s} {'pass':>5s} {'min':>6s} {'$/run':>7s} "
          f"{'fresh in':>8s} {'tok out':>8s} {'in/out':>7s} {'cache%':>7s} {'$/Kout':>7s} {'min/Kout':>8s}")
    for label, rows in runs.items():
        t = totals(label, rows)
        kout = (t["tout"] / 1000) or 1
        cache_share = 100 * t["tcached"] / max(t["tin"] + t["tcached"], 1)
        print(f"{label:16s} {t['n']:3d} {t['pass']:3d}/{t['n']:<2d} {t['min']:6.0f} "
              f"{t['cost']/max(t['n'],1):7.2f} {t['tin']/1e6:7.1f}M {t['tout']/1e3:7.1f}K "
              f"{t['tin']/max(t['tout'],1):7.1f} {cache_share:6.0f}% "
              f"{t['cost']/kout:7.2f} {t['min']/kout:8.2f}")

    if args.per_task:
        model_runs = {label: rows for label, rows in runs.items() if args.per_task in label}
        if len(model_runs) < 2:
            print(f"\n(no second harness for model {args.per_task})", file=sys.stderr)
            return 0
        base_label = next(iter(model_runs))
        base = model_runs[base_label]
        others = [l for l in model_runs if l != base_label]
        print(f"\nper task for {args.per_task} (delta vs {base_label})")
        header = f"{'task':34s} {base_label+' min':>14s} {base_label+' $':>12s}"
        for other in others:
            header += f" {other+' Δmin':>14s} {other+' Δ$':>12s}"
        print(header)
        for task in sorted(set(base) | {t for l in others for t in model_runs[l]}):
            b = base.get(task)
            cells = f"{f(b,'agent_seconds')/60:14.1f} {f(b,'cost_usd'):12.2f}" if b else f"{'-':>14s} {'-':>12s}"
            for other in others:
                o = model_runs[other].get(task)
                if b and o:
                    dt = (f(o, "agent_seconds") - f(b, "agent_seconds")) / 60
                    dc = f(o, "cost_usd") - f(b, "cost_usd")
                    cells += f" {dt:+14.1f} {dc:+12.2f}"
                else:
                    cells += f" {'-':>14s} {'-':>12s}"
            print(f"{task:34s} {cells}")

    attributes = [a.strip() for a in args.by.split(",") if a.strip()]
    if attributes:
        # label convention: <harness>-<model>; baseline is the pi run for that model
        models = defaultdict(dict)
        for label in runs:
            harness, _, model = label.partition("-")
            if model:
                models[model][harness] = label
        print("\nharness ratio vs pi for the same model, grouped by task attribute")
        for model, harnesses in sorted(models.items()):
            if "pi" not in harnesses or len(harnesses) < 2:
                continue
            base_label = harnesses["pi"]
            base_rows = runs[base_label]
            print(f"\n  model {model} (baseline {base_label}, {len(base_rows)} tasks)")
            for attr in attributes:
                groups = defaultdict(lambda: defaultdict(list))
                for task, row in base_rows.items():
                    key = str(manifest.get(task, {}).get(attr, "?")).replace("/Users/aviral/", "")
                    for harness, label in harnesses.items():
                        if harness == "pi" or task not in runs[label]:
                            continue
                        other = runs[label][task]
                        groups[key][harness].append((
                            f(other, "agent_seconds") / max(f(row, "agent_seconds"), 1),
                            f(other, "cost_usd") / max(f(row, "cost_usd"), 1e-9),
                        ))
                for key in sorted(groups):
                    cells = ""
                    for harness in sorted(groups[key]):
                        pairs = groups[key][harness]
                        tm = sum(p[0] for p in pairs) / len(pairs)
                        cm = sum(p[1] for p in pairs) / len(pairs)
                        cells += f"  {harness}: x{tm:.2f} time x{cm:.2f} cost (n={len(pairs)})"
                    print(f"    {attr}={key:12s}{cells}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

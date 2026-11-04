#!/usr/bin/env python3
# Paths: scripts/viz-aggregate.py docs/visualize-eval/**
"""Aggregate one evaluation round's eight judge results into a matrix.

Offline and deterministic. Validates every reviewer result against the frozen
rubric's required shape, recomputes the round metrics, and writes the matrix the
captain reports from. A missing or malformed case is a failure, never a silent
skip.

Usage:
  scripts/viz-aggregate.py --round-dir docs/visualize-eval/rounds/02 \
      [--out docs/visualize-eval/rounds/02/matrix.json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

CATEGORIES = (
    "semantic_fidelity",
    "arrow_traceability",
    "layout_fit",
    "conceptual_grouping_color",
    "border_integrity",
    "workflow_evidence",
    "animation",
)
STATUSES = {"pass", "fail", "blocked"}
SEVERITIES = ("critical", "high", "medium", "low")
REQUIRED_TOP = (
    "protocol_version", "round", "case_id", "candidate_sha256",
    "renderer_sha256", "rubric_sha256", "dataset_sha256", "spec_sha256",
    "generator", "reviewer", "viewport", "live_pane", "evidence",
    "observed_first", "categories", "edge_audit", "findings", "blockers",
    "cleanup", "overall",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_cases(repo: Path) -> list[str]:
    manifest = json.loads((repo / "docs/visualize-eval/cases.json").read_text())
    return [case["id"] if isinstance(case, dict) else case for case in manifest["cases"]]


def check_result(result: dict, case: str, round_number: int, rubric: dict) -> list[str]:
    problems = [f"missing {key}" for key in REQUIRED_TOP if key not in result]
    if problems:
        return problems

    if result["case_id"] != case:
        problems.append(f"case_id is {result['case_id']!r}, expected {case!r}")
    if result["round"] != round_number:
        problems.append(f"round is {result['round']!r}, expected {round_number}")

    categories = result["categories"]
    missing = [key for key in CATEGORIES if key not in categories]
    extra = [key for key in categories if key not in CATEGORIES]
    if missing:
        problems.append(f"missing categories {missing}")
    if extra:
        problems.append(f"unknown categories {extra}")
    for key in CATEGORIES:
        entry = categories.get(key) or {}
        status = entry.get("status")
        applicable = entry.get("applicable")
        if not isinstance(applicable, bool):
            problems.append(f"{key} applicable is not a boolean")
        elif applicable is False:
            if key != "animation":
                problems.append(f"{key} may not be globally inapplicable")
            if not (entry.get("reason") or "").strip():
                problems.append(f"{key} is inapplicable without a reason")
        elif status not in STATUSES:
            problems.append(f"{key} status {status!r} is not one of {sorted(STATUSES)}")

    for field in ("candidate_sha256", "renderer_sha256", "rubric_sha256",
                  "dataset_sha256", "spec_sha256"):
        value = result[field]
        if not isinstance(value, str) or len(value) != 64:
            problems.append(f"{field} is not a sha256")

    generator_model = (result["generator"] or {}).get("model")
    reviewer_model = (result["reviewer"] or {}).get("model")
    if generator_model != rubric["required_generator_model"]:
        problems.append(f"generator model {generator_model!r} is not the frozen model")
    if reviewer_model != rubric["required_reviewer_model"]:
        problems.append(f"reviewer model {reviewer_model!r} is not the frozen model")
    if (result["generator"] or {}).get("worker_id") == (result["reviewer"] or {}).get("worker_id"):
        problems.append("generator and reviewer share a worker id")

    if not result["evidence"]:
        problems.append("no evidence records")
    for record in result["evidence"]:
        if not isinstance(record, dict):
            problems.append("evidence entry is not an object")
            continue
        for key in ("id", "path", "sha256"):
            if key not in record:
                problems.append(f"evidence {record.get('id')!r} missing {key}")
        path = (Path.cwd() / record.get("path", "")).resolve()
        if not path.is_file():
            problems.append(f"evidence path missing on disk: {record.get('path')}")
            continue
        if record.get("sha256") != sha256(path):
            problems.append(f"evidence hash mismatch: {record.get('path')}")
    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round-dir", required=True)
    parser.add_argument("--out")
    parser.add_argument("--repo", default=".")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    round_dir = (repo / args.round_dir).resolve()
    rubric_path = round_dir / "rubric.json"
    if not rubric_path.is_file():
        print(f"FAIL rubric.json missing in {round_dir}")
        return 1
    rubric = json.loads(rubric_path.read_text())
    round_number = int(round_dir.name)
    cases = load_cases(repo)

    problems: list[str] = []
    per_case: dict[str, dict] = {}
    severity_total: Counter[str] = Counter()
    status_total: Counter[str] = Counter()
    applicable_total = 0

    for case in cases:
        result_path = round_dir / "reviews" / case / "reviewer-result.json"
        if not result_path.is_file():
            problems.append(f"{case}: no reviewer-result.json")
            continue
        try:
            result = json.loads(result_path.read_text())
        except json.JSONDecodeError as error:
            problems.append(f"{case}: reviewer-result.json does not parse: {error}")
            continue
        found = check_result(result, case, round_number, rubric)
        problems += [f"{case}: {problem}" for problem in found]

        matrix = {}
        for key in CATEGORIES:
            entry = (result.get("categories") or {}).get(key) or {}
            if entry.get("applicable") is False:
                matrix[key] = "na"
                continue
            matrix[key] = entry.get("status", "missing")
            status_total[matrix[key]] += 1
            applicable_total += 1

        severities = Counter(finding.get("severity") for finding in result.get("findings") or [])
        severity_total.update(severities)
        per_case[case] = {
            "categories": matrix,
            "overall": result.get("overall"),
            "findings": len(result.get("findings") or []),
            "severities": {key: severities.get(key, 0) for key in SEVERITIES},
            "edges_total": len(result.get("edge_audit") or []),
            "edges_pass": sum(
                1 for audit in result.get("edge_audit") or []
                if (audit.get("status") or audit.get("verdict")) == "pass"
            ),
            "blockers": len(result.get("blockers") or []),
            "report": str(result_path.relative_to(repo)),
            "report_sha256": sha256(result_path),
            "blind_observation_sha256": (result.get("observed_first") or {}).get("sha256"),
        }

    green = [case for case, row in per_case.items() if row["overall"] == "pass"]
    metrics = {
        "green_cases": len(green),
        "total_cases": len(cases),
        "passed_applicable_categories": status_total.get("pass", 0),
        "failed_applicable_categories": status_total.get("fail", 0),
        "blocked_applicable_categories": status_total.get("blocked", 0),
        "applicable_categories": applicable_total,
        "finding_severities": {key: severity_total.get(key, 0) for key in SEVERITIES},
    }
    matrix_doc = {
        "round": round_number,
        "rubric_sha256": sha256(rubric_path),
        "metrics": metrics,
        "green_cases": green,
        "cases": per_case,
        "problems": problems,
    }

    out = Path(args.out) if args.out else round_dir / "matrix.json"
    out.write_text(json.dumps(matrix_doc, indent=1) + "\n")

    for case, row in per_case.items():
        cells = " ".join(f"{key[:4]}={value[:4]}" for key, value in row["categories"].items())
        print(f"{case:24s} overall={row['overall']:5s} {cells}")
    print(json.dumps(metrics, indent=1))
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

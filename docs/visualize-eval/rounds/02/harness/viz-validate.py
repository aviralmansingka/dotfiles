#!/usr/bin/env python3
# Paths: scripts/viz-validate.py scripts/viz-evidence.sh docs/visualize-eval/**
"""Validate one rataflow evidence bundle against the frozen eval protocol.

Offline and deterministic: reads only files in the bundle. Prints one PASS or
FAIL line per check with the exact reason, then a summary. Exits non-zero on
any failure, so a generator cannot report success over a bad bundle.

Usage:
  scripts/viz-validate.py BUNDLE_DIR [--target 77x47] [--require-select]
                       [--require-frames] [--attempts attempts.json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys

WARNING_PREFIXES = ("warning:", "WARNING:", "warn:")


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Checker:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, name: str, ok: bool, reason: str = "") -> bool:
        print(f"{'PASS' if ok else 'FAIL'} {name}" + ("" if ok else f" — {reason}"))
        if not ok:
            self.failures.append(name)
        return ok

    def summary(self) -> int:
        total = len(self.failures)
        if total:
            print(f"\n{total} check(s) failed: {', '.join(self.failures)}")
            return 1
        print("\nall checks passed")
        return 0


def load_check_text(bundle: str) -> tuple[str, str]:
    with open(f"{bundle}/check.txt", encoding="utf-8", errors="replace") as handle:
        return handle.read(), ""


def parse_check(text: str) -> dict[str, object]:
    """Pull the machine-readable check lines out of --check output."""
    facts: dict[str, object] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if m := re.match(r"^labels:\s+(\d+)/(\d+) placed,\s+(\d+) on route cells,\s+(\d+) skipped", stripped):
            facts["labels_placed"] = int(m.group(1))
            facts["labels_total"] = int(m.group(2))
            facts["labels_on_route"] = int(m.group(3))
            facts["labels_skipped"] = int(m.group(4))
        elif m := re.match(r"^dots:\s+(\d+) single-dot routes,\s+(\d+) periodic routes,\s+(\d+) violations", stripped):
            facts["dots_single"] = int(m.group(1))
            facts["dots_periodic"] = int(m.group(2))
            facts["dots_violations"] = int(m.group(3))
        elif stripped.startswith("trunks:"):
            facts["trunks_line"] = stripped
        elif stripped.startswith("groups:"):
            facts["groups_line"] = stripped
        elif m := re.match(r"^extent:\s+(\d+)\s*x\s*(\d+)", stripped):
            facts["extent"] = (int(m.group(1)), int(m.group(2)))
    return facts


def count_frames(text: str) -> list[int]:
    return [int(m.group(1)) for m in re.finditer(r"^frame (\d+) at \d+ms$", text, re.M)]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle")
    parser.add_argument("--target", default="77x47")
    parser.add_argument("--require-select", action="store_true")
    parser.add_argument("--require-frames", action="store_true")
    parser.add_argument("--attempts")
    args = parser.parse_args(argv)

    out = Checker()
    try:
        with open(f"{args.bundle}/manifest.json", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except OSError as error:
        out.check("manifest_readable", False, str(error))
        return out.summary()

    out.check("manifest_readable", True)

    binary = manifest.get("binary_path") or ""
    out.check(
        "binary_path_absolute",
        binary.startswith("/"),
        f"binary_path is {binary!r}; a bare name cannot prove which build rendered",
    )
    out.check(
        "binary_hash_recorded",
        bool(re.fullmatch(r"[0-9a-f]{64}", manifest.get("binary_sha256") or "")),
        "binary_sha256 is missing or not a sha256",
    )

    artifacts = manifest.get("artifacts") or {}
    bad = []
    for name, expected in artifacts.items():
        path = f"{args.bundle}/{name}"
        try:
            actual = sha256(path)
        except OSError:
            bad.append(f"{name}: missing")
            continue
        if actual != expected:
            bad.append(f"{name}: hash mismatch")
    out.check("artifact_hashes", not bad, "; ".join(bad))

    try:
        check_text, _ = load_check_text(args.bundle)
    except OSError as error:
        out.check("check_output_present", False, str(error))
        return out.summary()
    out.check("check_output_present", bool(check_text.strip()), "check.txt is empty")
    out.check("check_exit_zero", manifest.get("check_exit") == 0, f"exit {manifest.get('check_exit')}")

    warnings = [
        line for line in check_text.splitlines()
        if line.strip().lower().startswith(WARNING_PREFIXES)
    ]
    out.check("check_warnings_absent", not warnings, "; ".join(warnings[:3]))

    facts = parse_check(check_text)
    placed = facts.get("labels_placed")
    total = facts.get("labels_total")
    out.check(
        "labels_parsed",
        placed is not None and total is not None,
        "no 'labels: N/M placed' line; the build does not report label coverage",
    )
    if placed is not None and total is not None:
        out.check("labels_complete", placed == total, f"{placed}/{total} labels placed")
    on_route = facts.get("labels_on_route")
    out.check("labels_off_routes", on_route == 0, f"{on_route} labels sit on route cells")
    skipped = facts.get("labels_skipped")
    out.check("labels_not_skipped", skipped == 0, f"{skipped} labels had no free slot")

    violations = facts.get("dots_violations")
    out.check(
        "dots_parsed",
        violations is not None,
        "no 'dots: ... violations' line",
    )
    out.check("dots_no_violations", violations == 0, f"{violations} dot violations")

    viewport_line = manifest.get("viewport_line") or ""
    viewport_token = manifest.get("viewport_token") or ""
    # A live pane erases the startup line with the alternate screen, so the
    # header token `77x47 @100%` is equally valid proof of size and zoom.
    out.check(
        "viewport_proven",
        bool(re.match(r"^viewport: \d+x\d+ zoom: 1\.00 natural$", viewport_line))
        or bool(re.match(r"^\d+x\d+ @100%$", viewport_token)),
        f"no viewport proof: line={viewport_line!r} header={viewport_token!r}",
    )
    target_cols, target_rows = (int(part) for part in args.target.split("x"))
    measured = None
    if m := re.match(r"^viewport: (\d+)x(\d+) ", viewport_line):
        measured = (int(m.group(1)), int(m.group(2)))
    elif m := re.match(r"^(\d+)x(\d+) @100%$", viewport_token):
        measured = (int(m.group(1)), int(m.group(2)))
    out.check(
        "viewport_proven_measurable",
        measured is not None,
        "the app did not report its own measured size",
    )
    if measured is not None:
        out.check(
            "viewport_matches_target",
            measured == (target_cols, target_rows),
            f"measured {measured[0]}x{measured[1]}, target is {target_cols}x{target_rows}",
        )

    out.check(
        "cleanup_confirmed",
        manifest.get("cleanup") == "confirmed_closed",
        f"cleanup is {manifest.get('cleanup')!r}",
    )

    if args.require_select:
        out.check(
            "select_all_frame",
            bool(manifest.get("select_all_frame")),
            "no --select-all frame; selected borders of every node are unproven",
        )
        selected = [
            name for name in artifacts
            if name.endswith("-selected.ansi")
        ]
        out.check("select_all_artifact", bool(selected), "no *-selected.ansi artifact")

    if args.require_frames:
        frame_files = [name for name in artifacts if name.endswith("-frames.txt")]
        out.check("frames_artifact", bool(frame_files), "no *-frames.txt artifact")
        if frame_files:
            with open(f"{args.bundle}/{frame_files[0]}", encoding="utf-8", errors="replace") as handle:
                indices = count_frames(handle.read())
            out.check(
                "frames_timestamped",
                len(indices) >= 3,
                f"{len(indices)} timestamped frames; at least 3 are needed for motion",
            )

    if args.attempts:
        try:
            with open(args.attempts, encoding="utf-8") as handle:
                attempts = json.load(handle)
        except OSError as error:
            out.check("attempts_readable", False, str(error))
        else:
            out.check("attempts_readable", True)
            views = attempts.get("views") or []
            out.check(
                "attempts_view_budget",
                len(views) <= 4,
                f"{len(views)} final views; the budget is 4",
            )
            over = [
                f"{view.get('view')}: {len(view.get('attempts') or [])} attempts"
                for view in views
                if len(view.get("attempts") or []) > 3
            ]
            out.check("attempts_spec_budget", not over, "; ".join(over))

    return out.summary()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

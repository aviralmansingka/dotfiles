#!/usr/bin/env python3
# Paths: scripts/viz-validate.py scripts/viz-evidence.sh scripts/viz-frame-audit.py docs/visualize-eval/**
"""Validate one rataflow evidence bundle against the frozen eval protocol.

Offline and deterministic: reads only files in the bundle. Prints one PASS or
FAIL line per check with the exact reason, then a summary. Exits non-zero on
any failure, so a generator cannot report success over a bad bundle.

Two spec forms are understood, and both produce ONE bundle (one spec file, one
pane render):

  graph   one `{nodes, edges}` spec; fit is proven by a 77x47 capture.
  canvas  one `{"diagrams": [...]}` spec: several named, described diagrams on
          one pannable canvas. The check reports the whole-canvas extent and one
          extent per diagram, so layout fit passes EITHER by the 77x47 proof OR
          by those recorded extents (the navigable large-canvas form).

Usage:
  scripts/viz-validate.py BUNDLE_DIR [--target 77x47] [--require-select]
                       [--require-frames] [--attempts attempts.json]
                       [--require-records] [--frame-audit]
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

WARNING_PREFIXES = ("warning:", "WARNING:", "warn:")
# A drawing too large for the pane reports its own extent in the header
# (`· canvas 91x136 ·`) and in a corner badge (`canvas 91x136 at 100% · drag to
# pan`). Both are sizes the reader pans, so a pinned dump that carries one is NOT
# a fit proof — the drawing did not fit the pinned viewport.
CANVAS_EXTENT_RE = re.compile(r"canvas (\d+)x(\d+)")
# Round-13 routing defect: a route that runs beside a node that is neither its
# source nor its destination reads as a false relation. `--check` may report it
# as a summary count, as a token phrase, or as one line per miss.
NEAR_SUMMARY_RE = re.compile(
    r"^(?:near[- ]misses|passes-near-unrelated-node)\b[^0-9]{0,24}(\d+)", re.I
)
NEAR_TOKEN_RE = re.compile(r"(\d+)\s+passes-near-unrelated-node", re.I)
NEAR_LINE_RE = re.compile(r"^near-miss:\s", re.I)


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
        if m := re.match(
            r"^labels:\s+(\d+)/(\d+) placed,\s+(\d+) on route cells,\s+(\d+) skipped(?:,\s+(\d+) ambiguous owners)?",
            stripped,
        ):
            facts["labels_placed"] = int(m.group(1))
            facts["labels_total"] = int(m.group(2))
            facts["labels_on_route"] = int(m.group(3))
            facts["labels_skipped"] = int(m.group(4))
            if m.group(5) is not None:
                facts["labels_ambiguous"] = int(m.group(5))
        elif m := re.match(
            r"^dots:\s+(\d+) single-dot routes,\s+(\d+) periodic routes,\s+(\d+) violations"
            r"(?:,\s+(\d+) synchronized at (\d+)ms)?"
            r"(?:,\s+(\d+) constant at ([0-9.]+)c/step,\s+(\d+) same-arrival at (\d+)ms)?",
            stripped,
        ):
            facts["dots_single"] = int(m.group(1))
            facts["dots_periodic"] = int(m.group(2))
            facts["dots_violations"] = int(m.group(3))
            if m.group(4) is not None:
                facts["dots_synchronized"] = int(m.group(4))
                facts["dots_duration_ms"] = int(m.group(5))
            if m.group(6) is not None:
                facts["dots_constant"] = int(m.group(6))
                facts["dots_constant_rate"] = m.group(7)
                facts["dots_same_arrival"] = int(m.group(8))
                facts["dots_same_arrival_ms"] = int(m.group(9))
        elif m := re.match(r"^origins:\s+(\d+)/(\d+) routes start at their arrow origin", stripped):
            facts["origins_ok"] = int(m.group(1))
            facts["origins_total"] = int(m.group(2))
        elif m := re.match(r"^arrivals:\s+(\d+)/(\d+) same-arrival routes show their dot at the arrowhead on the final step", stripped):
            facts["arrivals_ok"] = int(m.group(1))
            facts["arrivals_total"] = int(m.group(2))
        elif m := re.match(
            r"^routes:\s+(\d+)/(\d+) near-minimal,\s+(\d+) detours(?:,\s+(\d+) forced)?(?:,\s+(\d+) shortened)?",
            stripped,
        ):
            facts["routes_near_minimal"] = int(m.group(1))
            facts["routes_total"] = int(m.group(2))
            facts["routes_detours"] = int(m.group(3))
            if m.group(4) is not None:
                facts["routes_forced"] = int(m.group(4))
            if m.group(5) is not None:
                facts["routes_shortened"] = int(m.group(5))
        elif m := re.match(r"^crossings:\s+(\d+) bridges?(?:,\s+(\d+) touching bends)?", stripped):
            facts["crossings"] = int(m.group(1))
            if m.group(2) is not None:
                facts["crossings_touching"] = int(m.group(2))
        elif m := re.match(r"^canvas:\s+(\d+) diagrams?\b", stripped):
            facts["canvas_diagrams"] = int(m.group(1))
        elif m := re.match(
            r'^diagram\s+(\S+)\s+"(.*)"\s+at\s+(-?\d+),(-?\d+):\s+'
            r"extent=(\d+)x(\d+)\s+nodes=(\d+)\s+edges=(\d+)\s+routes=(\d+)",
            stripped,
        ):
            facts.setdefault("diagrams", []).append(
                {
                    "id": m.group(1),
                    "title": m.group(2),
                    "origin": (int(m.group(3)), int(m.group(4))),
                    "extent": (int(m.group(5)), int(m.group(6))),
                    "nodes": int(m.group(7)),
                    "edges": int(m.group(8)),
                    "routes": int(m.group(9)),
                }
            )
        elif m := re.match(r"^description:\s*(.*)$", stripped):
            if facts.get("diagrams"):
                facts["diagrams"][-1]["description"] = m.group(1).strip()  # type: ignore[index]
            else:
                facts["description_line"] = stripped
        elif m := re.match(
            r"^dot hues:\s+(\d+) by source,\s+(\d+) by destination,\s+(\d+) shared-hue",
            stripped,
        ):
            facts["dots_by_source_hue"] = int(m.group(1))
            facts["dots_by_destination_hue"] = int(m.group(2))
            facts["dots_shared_hue"] = int(m.group(3))
        elif stripped.startswith("trunks:"):
            facts["trunks_line"] = stripped
        elif stripped.startswith("groups:"):
            facts["groups_line"] = stripped
        elif m := re.match(r"^extent[:=]\s*(\d+)\s*x\s*(\d+)", stripped):
            facts["extent"] = (int(m.group(1)), int(m.group(2)))
            if "whole canvas" in stripped:
                facts["canvas_extent"] = facts["extent"]
        elif m := NEAR_SUMMARY_RE.match(stripped):
            facts["near_node_violations"] = max(
                int(facts.get("near_node_violations") or 0), int(m.group(1))
            )
        elif m := NEAR_TOKEN_RE.search(stripped):
            facts["near_node_violations"] = max(
                int(facts.get("near_node_violations") or 0), int(m.group(1))
            )
    # One `near-miss:` line per offending (route, node) pair is a violation too.
    near_lines = [
        line for line in text.splitlines() if NEAR_LINE_RE.match(line.strip())
    ]
    if near_lines:
        facts["near_node_violations"] = max(
            int(facts.get("near_node_violations") or 0), len(near_lines)
        )
        facts["near_node_lines"] = [line.strip() for line in near_lines]
    return facts


def count_frames(text: str) -> list[int]:
    return [int(m.group(1)) for m in re.finditer(r"^frame (\d+) at \d+ms$", text, re.M)]


def _dump_canvas_extents(text: str) -> list[tuple[int, int]]:
    """Every `canvas WxH` extent a capture reports: the header token and the
    corner badge. A capture that carries ANY of them did not fit its pane, so it
    cannot prove a 77x47 fit no matter what a legacy `overflows` string said."""
    return [(int(w), int(h)) for w, h in CANVAS_EXTENT_RE.findall(text)]


def _dump_proves_fit(text: str, target_cols: int, target_rows: int) -> bool:
    """True when one dump shows a drawing that fits the pinned target whole."""
    if not re.search(
        rf"viewport: {target_cols}x{target_rows} zoom: 1\.00 natural", text
    ):
        return False
    return all(
        width <= target_cols and height <= target_rows
        for width, height in _dump_canvas_extents(text)
    )


def _pinned_target_dump_proves_fit(
    bundle: Path, attempts_path: str, target: tuple[int, int] = (77, 47)
) -> bool:
    """True when a pinned direct dump at the target size shows THIS view's final
    spec whole. Workers' pane sizes follow their tab size, which is not
    controlled, so a larger measured pane plus a pinned target-size dump of the
    FINAL spec is acceptable proof of fit. A dump of a rejected attempt or
    another view's spec does not count, and neither does a dump whose header
    reports a canvas larger than the target (the reader would have to pan)."""
    import glob

    view = Path(bundle).resolve()
    case_dir = Path(attempts_path).resolve().parent
    # final spec per view, from the bundle's own generation.json
    finals: dict[str, str] = {}
    gen = case_dir / "generation.json"
    if gen.is_file():
        try:
            for i, entry in enumerate(json.loads(gen.read_text()).get("views") or []):
                spec = entry.get("spec") or entry.get("spec_path")
                label = str(entry.get("view") or f"v{i + 1}")
                if spec:
                    finals[label] = Path(str(spec)).name
        except (json.JSONDecodeError, OSError):
            pass
    label = view.name  # e.g. v1
    final_spec = finals.get(label)
    if not final_spec:
        # No generation.json (a standalone bundle): the bundle's own manifest
        # names the spec it captured, which is the spec a pinned dump must show.
        try:
            spec_path = json.loads((view / "manifest.json").read_text()).get("spec_path")
        except (OSError, json.JSONDecodeError):
            spec_path = None
        if spec_path:
            final_spec = Path(str(spec_path)).name
    if not final_spec:
        return False
    candidates = (
        glob.glob(str(view / "*77x47*"))
        + glob.glob(str(case_dir / "pinned*" / (label + "*")))
        + glob.glob(str(case_dir / "*" / (label + "*77x47*")))
        + glob.glob(str(case_dir / (label + "*77x47*")))
    )
    for path in candidates:
        try:
            text = Path(path).read_text(errors="replace")
        except OSError:
            continue
        if final_spec in text and _dump_proves_fit(text, *target):
            return True
    return False


def _resolve_input(raw: str, case_dir: Path) -> Path | None:
    """Find a recorded spec input inside the bundle.

    A record's spec path is absolute (where the probe ran) or repo-relative, and
    the committed bundle keeps the file beside the log or in one of its input
    folders. Absolute-then-relative resolution keeps a moved checkout readable
    without letting a missing input pass."""
    candidate = Path(raw)
    tries = [candidate, case_dir / raw, case_dir / candidate.name]
    for folder in ("attempts", "recorded", "inputs", "specs", "spec", "calib", "drafts"):
        tries.append(case_dir / folder / candidate.name)
    for path in tries:
        if path.is_file():
            return path
    return None


def _probe_inputs_present(path: Path) -> tuple[bool, list[str]]:
    """Every recorded probe's spec INPUT file must be in the bundle.

    Round 12's modal-machine-manager recorded three probe inputs it never
    bundled, so a later reader could not re-run what the record claims. A record
    whose command named no `.json` (a check of a generated spec piped on stdin,
    say) has no input to find; every other record must resolve.
    """
    missing: list[str] = []
    checked = 0
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as error:
        return False, [f"unreadable: {error}"]
    case_dir = path.parent
    for i, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue  # attempts_records_complete already names this line
        if not isinstance(rec, dict):
            continue
        raw = rec.get("spec_path")
        candidates = [str(raw)] if raw else []
        if not candidates:
            candidates = [
                token
                for token in str(rec.get("command") or "").split()
                if token.endswith(".json")
            ]
        for candidate in candidates:
            checked += 1
            if _resolve_input(candidate, case_dir) is None:
                missing.append(f"line {i} ({rec.get('label', '?')}): {candidate}")
    if not checked:
        return False, ["no record names a spec input; every probe needs its spec"]
    return not missing, missing


def _verify_records_log(path: Path) -> tuple[bool, list[str]]:
    """Strictly verify a viz-evidence record JSONL: every line carries a
    command, an integer exit_status, and raw stdout/stderr whose sha256s
    match the bytes on disk. Raw paths resolve absolute first, then
    relative to the log's own directory (committed evidence)."""
    problems: list[str] = []
    count = 0
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as error:
        return False, [f"unreadable: {error}"]
    for i, line in enumerate(lines, 1):
        if not line.strip():
            continue
        count += 1
        try:
            rec = json.loads(line)
        except json.JSONDecodeError as error:
            problems.append(f"line {i}: not JSON: {error}")
            continue
        if not isinstance(rec, dict):
            problems.append(f"line {i}: not a JSON object (one compact record per line)")
            continue
        where = f"line {i} ({rec.get('label', '?')})"
        if not rec.get("command"):
            problems.append(f"{where}: no command")
        if not isinstance(rec.get("exit_status"), int):
            problems.append(f"{where}: no integer exit_status")
        for key in ("stdout", "stderr"):
            raw, want = rec.get(f"{key}_path"), rec.get(f"{key}_sha256")
            if not raw or not want:
                problems.append(f"{where}: missing {key} path/sha256")
                continue
            cand = Path(str(raw))
            if not cand.is_file():
                cand = path.parent / cand.name
            try:
                if sha256(str(cand)) != want:
                    problems.append(f"{where}: {key} hash mismatch")
            except OSError:
                problems.append(f"{where}: {key} raw bytes missing ({raw})")
    return count > 0 and not problems, problems or ["log is empty"]


def _load_frame_audit():
    """Import scripts/viz-frame-audit.py (the dash in its name rules out a plain
    `import`) so the validator can run the same audit a judge runs by hand."""
    path = Path(__file__).resolve().parent / "viz-frame-audit.py"
    spec = importlib.util.spec_from_file_location("viz_frame_audit", path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _find_frames_dump(bundle: Path, artifacts: dict) -> Path | None:
    """The most complete frames capture in the bundle.

    Ranked by what the animation audit actually needs: a capture that shows the
    WHOLE drawing first (a clipped pane slice cannot show every dot), then the
    most dots per frame, then the most frames (a full lap of the longest route),
    then the pinned target-size viewport.
    """
    seen: dict[Path, None] = {}
    for name in artifacts:
        if name.endswith(("-frames.txt", "-lap.txt")):
            seen[bundle / name] = None
    for pattern in ("*lap*.txt", "*frames*.txt"):
        for path in sorted(bundle.glob(pattern)):
            seen[path] = None
    best: tuple[int, int, int, int, str] | None = None
    chosen: Path | None = None
    for path in seen:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        frame_count = len(count_frames(text))
        if frame_count < 3:
            continue
        clipped = 1 if CANVAS_EXTENT_RE.search(text) else 0
        dots = max(
            (block.count("\u25cf") for block in re.split(r"^frame \d+ at \d+ms$", text, flags=re.M)),
            default=0,
        )
        pinned = 1 if re.search(r"viewport: 77x47 zoom: 1\.00 natural", text) else 0
        key = (-clipped, dots, frame_count, pinned, path.name)
        if best is None or key > best:
            best, chosen = key, path
    return chosen


def append_frame_audit(
    out: Checker, bundle: Path, artifacts: dict, facts: dict
) -> None:
    """Run viz-frame-audit.py on the bundle's frames dump and append its summary.

    The animation category needs an independent all-route equal-distance
    comparison; a judge should not have to perform it by eye, and round 12 was
    blocked because nobody did. The audit's own verdict gates the bundle.
    """
    dump = _find_frames_dump(bundle, artifacts)
    if dump is None:
        out.check(
            "frame_audit_passes",
            False,
            "no frames dump in the bundle; the animation audit has nothing to read",
        )
        return
    module = _load_frame_audit()
    if module is None:
        out.check("frame_audit_passes", False, "scripts/viz-frame-audit.py is missing")
        return
    result = module.audit(dump, window=10, tolerance=1, max_jump=1)
    print(f"\nframe audit ({dump.name})")
    for line in module.summary_lines(result):
        if not line.startswith("frame audit:"):
            print(line)
    expected_routes = None
    single, periodic = facts.get("dots_single"), facts.get("dots_periodic")
    if isinstance(single, int) and isinstance(periodic, int):
        expected_routes = single + periodic
    if expected_routes is not None:
        print(
            f"  the check reports {expected_routes} dot route(s); the capture tracked "
            f"{result.get('routes_tracked', 0)} (a clipped capture tracks fewer)"
        )
    print()
    out.check(
        "frame_audit_passes",
        result.get("verdict") == "pass",
        "; ".join(result.get("problems") or [])[:400]
        or "the frame audit did not pass",
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle")
    parser.add_argument("--target", default="77x47")
    parser.add_argument("--require-select", action="store_true")
    parser.add_argument("--require-frames", action="store_true")
    parser.add_argument("--attempts")
    parser.add_argument("--require-records", action="store_true")
    parser.add_argument(
        "--frame-audit",
        action="store_true",
        help="run scripts/viz-frame-audit.py on the bundle's frames dump and "
        "append its per-route speed + equal-distance summary",
    )
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

    # A reported near-node pass is a violation the rubric judges, never a
    # warning to suppress, and near-miss detail lines are diagnostics.
    warnings = [
        line for line in check_text.splitlines()
        if line.strip().lower().startswith(WARNING_PREFIXES)
        and "passes-near-unrelated-node" not in line
        and not NEAR_LINE_RE.match(line.strip())
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

    # Round 03 must prove motion origin and synchronized arrival, and report the
    # crossing count so layouts can be compared without re-reading captures.
    origins_ok = facts.get("origins_ok")
    origins_total = facts.get("origins_total")
    out.check(
        "origins_reported",
        origins_ok is not None and origins_total is not None,
        "no 'origins: N/N routes start at their arrow origin' line",
    )
    if origins_ok is not None and origins_total is not None:
        out.check(
            "origins_complete",
            origins_ok == origins_total,
            f"{origins_ok}/{origins_total} routes start at their arrow origin",
        )
    out.check(
        "dots_sync_reported",
        facts.get("dots_synchronized") is not None or facts.get("dots_same_arrival") is not None,
        "no synchronized/same-arrival dot count; synchronized arrival cannot be checked",
    )
    arrivals_ok = facts.get("arrivals_ok")
    arrivals_total = facts.get("arrivals_total")
    out.check(
        "arrivals_reported",
        arrivals_ok is not None and arrivals_total is not None,
        "no 'arrivals: N/N' line; same-arrival visibility cannot be checked",
    )
    if arrivals_ok is not None and arrivals_total is not None:
        out.check(
            "arrivals_complete",
            arrivals_ok == arrivals_total,
            f"{arrivals_ok}/{arrivals_total} same-arrival routes show their dot at the arrowhead on the final step",
        )
    ambiguous = facts.get("labels_ambiguous")
    out.check(
        "labels_ownership_reported",
        ambiguous is not None or facts.get("labels_skipped") is not None,
        "no ambiguous-owner count in the labels line; ownership cannot be checked",
    )
    if ambiguous is not None:
        out.check(
            "labels_ownership_clear",
            ambiguous == 0,
            f"{ambiguous} label(s) sit as close to another route as to their own edge; a reader cannot pair them",
        )
    detours = facts.get("routes_detours")
    # Round 05 baseline note: the routes: line was dropped with the round-04
    # revert (route economy is now engine-owned ordering). If a future
    # baseline emits it again, a nonzero detour count still fails.
    if detours is not None:
        out.check(
            "routes_no_detours",
            detours == 0,
            f"{detours} route(s) take a longer path than the shortest obstacle-safe route",
        )
    out.check(
        "crossings_reported",
        facts.get("crossings") is not None,
        "no 'crossings: N' line; overlaps cannot be compared across attempts",
    )
    # Round-13 routing contract: a route that runs beside a node that is neither
    # its source nor its destination reads as a false relation. The line is only
    # checked when the build emits it, so older bundles stay byte-identical.
    if facts.get("near_node_violations") is not None:
        near = int(facts["near_node_violations"])
        out.check(
            "routes_near_unrelated_nodes",
            near == 0,
            f"{near} route(s) pass near a node that is neither their source nor "
            "their destination; the pass reads as a connection the source never draws",
        )

    # ---- multi-diagram canvas form -----------------------------------------
    # One spec with `{"diagrams": [...]}` renders several named, described
    # diagrams on ONE pannable canvas, so it is still one bundle and one spec.
    declared_diagrams = facts.get("canvas_diagrams")
    canvas_form = bool(declared_diagrams) or manifest.get("spec_form") == "canvas"
    diagrams = facts.get("diagrams") or []
    canvas_fit_recorded = False
    if canvas_form:
        out.check(
            "canvas_diagrams_reported",
            declared_diagrams is not None,
            "no 'canvas: N diagrams on one canvas' line; the form is unproven",
        )
        out.check(
            "canvas_diagrams_parsed",
            declared_diagrams is not None and len(diagrams) == int(declared_diagrams),
            f"the check declares {declared_diagrams} diagram(s) and reports "
            f"{len(diagrams)} 'diagram …' line(s)",
        )
        undescribed = [
            entry["id"] for entry in diagrams if not (entry.get("description") or "").strip()
        ]
        out.check(
            "canvas_diagrams_described",
            bool(diagrams) and not undescribed,
            f"diagram(s) {undescribed} carry no description; a reader cannot "
            "orient on a large canvas without a title + what-it-shows line",
        )
        total_extent = facts.get("canvas_extent")
        empty_extent = [
            entry["id"] for entry in diagrams if not all(entry.get("extent") or (0, 0))
        ]
        out.check(
            "canvas_extents_recorded",
            total_extent is not None and bool(diagrams) and not empty_extent,
            "no 'extent=WxH cells (whole canvas)' line" if total_extent is None
            else f"diagram(s) {empty_extent} report no extent",
        )
        if total_extent is not None and diagrams and not empty_extent:
            # Every diagram's own box has to sit inside the recorded canvas, or
            # the extents do not describe what was drawn.
            spilled = [
                entry["id"]
                for entry in diagrams
                if entry["origin"][0] + entry["extent"][0] > total_extent[0]
                or entry["origin"][1] + entry["extent"][1] > total_extent[1]
            ]
            out.check(
                "canvas_extents_consistent",
                not spilled,
                f"diagram(s) {spilled} extend past the {total_extent[0]}x{total_extent[1]} "
                "whole-canvas extent",
            )
            canvas_fit_recorded = not spilled

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
        target = (target_cols, target_rows)
        if canvas_form:
            # Branch A: the whole canvas still fits the pinned pane. Branch B:
            # it does not fit, so the check's total + per-diagram extents are the
            # proof that the reader gets a navigable, fully described canvas
            # instead of a clipped drawing.
            fits_pane = measured == target or _pinned_target_dump_proves_fit(
                args.bundle, args.attempts or "", target
            )
            out.check(
                "viewport_matches_target",
                fits_pane or canvas_fit_recorded,
                f"measured {measured[0]}x{measured[1]} against target {args.target}, "
                "no pinned fitted dump, and the check records no whole-canvas "
                "extent with per-diagram extents (the navigable large-canvas form)",
            )
            if canvas_fit_recorded and not fits_pane:
                extent = facts.get("canvas_extent") or (0, 0)
                print(
                    f"note layout_fit_canvas_form — {len(diagrams)} diagram(s) on a "
                    f"{extent[0]}x{extent[1]} canvas, drawn whole at 100% and "
                    "navigated by pan; the owner's navigable-canvas form"
                )
        else:
            out.check(
                "viewport_matches_target",
                measured == target
                or _pinned_target_dump_proves_fit(
                    args.bundle, args.attempts or "", target
                ),
                f"measured {measured[0]}x{measured[1]}, target is {target_cols}x{target_rows}, "
                f"and no pinned {target_cols}x{target_rows} dump proves the fit",
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
        records_path = Path(args.attempts).resolve().parent / "attempts-log.jsonl"
        if records_path.is_file():
            ok, problems = _verify_records_log(records_path)
            out.check("attempts_records_complete", ok, "; ".join(problems[:4]))
            if args.require_records:
                # Bundle every probe INPUT: a record the reader cannot re-run is
                # an evidence gap (round-12 modal-machine-manager lost three).
                present, missing = _probe_inputs_present(records_path)
                out.check("probe_inputs_present", present, "; ".join(missing[:6]))
        elif args.require_records:
            out.check(
                "attempts_records_complete",
                False,
                f"no attempts-log.jsonl beside {args.attempts}; wrap every probe "
                "and rejected draft with: viz-evidence.sh record",
            )
            out.check(
                "probe_inputs_present",
                False,
                "no attempts-log.jsonl, so no probe input can be accounted for",
            )

    if args.frame_audit:
        append_frame_audit(out, Path(args.bundle), artifacts, facts)

    return out.summary()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

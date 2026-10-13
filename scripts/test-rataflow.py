#!/usr/bin/env python3
# Paths: rataflow/** agents/.agents/skills/visualize/** agents/.agents/skills/artifact/** install.sh scripts/test-rataflow.py
"""rataflow-view suite — packaging, spec schema, and wiring checks for the
live node-graph viewer (crate `rataflow/`, ratatui skill
`agents/.agents/skills/visualize/`, vendored HTML skill
`agents/.agents/skills/artifact/`).

Offline and deterministic: no network, no $HOME mutation, no sleeps. Each
check prints PASS, FAIL, or SKIP with the reason, plus per-check and total
run times. The script exits non-zero when any check fails. See
docs/ci-tests/rataflow.md for scope and known gaps.

Behavior lives in the Rust crate (spec parsing, graph building, headless
rendering) and is covered by `cargo test`; this suite covers what an
offline runner can verify: the manifest, the lockfile, the example spec,
the skill's documented spec block, and the install/gitignore wiring.

Dual mode: TOML checks need python 3.11+ `tomllib` and SKIP with a notice
on older interpreters (local macs ship 3.9); they FAIL under STRICT=1 (CI
runners ship 3.12). `RATAFLOW_BUILD=1` opts in to the cargo tests as a
local pre-merge gate — a fresh `cargo test` needs the crates.io registry
cache, so it is never part of offline CI (same pattern as TF_VALIDATE for
terraform).
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STRICT = os.environ.get("STRICT") == "1"
BUILD = os.environ.get("RATAFLOW_BUILD") == "1"

try:
    import tomllib  # python 3.11+
except ImportError:  # python 3.9/3.10 (local macs)
    tomllib = None

# Spec schema, mirrored from rataflow/src/lib.rs (the Rust code is the
# source of truth for behavior; this mirror exists to validate the example
# and the skill's documented block against drift).
ALLOWED_TOP = {"direction", "theme", "nodes", "edges"}
ALLOWED_NODE = {"id", "label"}
ALLOWED_EDGE = {"from", "to", "label"}
DIRECTIONS = {"tb", "lr"}
THEMES = {"gruvbox", "dark", "light"}

RESULTS = []


def record(name, ok, reason=""):
    RESULTS.append((name, ok, reason))
    label = "PASS" if ok is True else "FAIL" if ok is False else "SKIP"
    suffix = f" — {reason}" if reason else ""
    print(f"{label} {name}{suffix}")


def validate_spec(doc):
    """Return a list of schema problems for a parsed spec document."""
    problems = []
    if not isinstance(doc, dict):
        return ["spec is not a JSON object"]
    unknown = set(doc) - ALLOWED_TOP
    if unknown:
        problems.append(f"unknown top-level field(s): {sorted(unknown)}")
    if doc.get("direction", "tb") not in DIRECTIONS:
        problems.append(f"bad direction {doc.get('direction')!r}")
    if doc.get("theme", "gruvbox") not in THEMES:
        problems.append(f"bad theme {doc.get('theme')!r}")
    nodes = doc.get("nodes", [])
    if not isinstance(nodes, list):
        problems.append("nodes is not a list")
        nodes = []
    seen = set()
    for index, node in enumerate(nodes):
        if not isinstance(node, dict) or set(node) - ALLOWED_NODE or "id" not in node:
            problems.append(f"node {index} is malformed")
            continue
        if not str(node["id"]).strip():
            problems.append(f"node {index} has an empty id")
        if node["id"] in seen:
            problems.append(f"duplicate node id {node['id']}")
        seen.add(node["id"])
    edges = doc.get("edges")
    if not isinstance(edges, list) or not edges:
        problems.append("edges is missing or empty")
        edges = []
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict) or set(edge) - ALLOWED_EDGE or not {
            "from",
            "to",
        } <= set(edge):
            problems.append(f"edge {index} is malformed")
            continue
        if not str(edge["from"]).strip() or not str(edge["to"]).strip():
            problems.append(f"edge {index} has an empty endpoint")
    return problems


def check_example_spec():
    rel = "rataflow/examples/pipeline.json"
    path = REPO / rel
    try:
        doc = json.loads(path.read_text())
    except Exception as exc:  # noqa: BLE001
        return False, [f"{rel}: does not parse as JSON: {exc}"]
    problems = [f"{rel}: {p}" for p in validate_spec(doc)]
    return (not problems), problems


def skill_spec_block():
    """Extract the first ```json spec block from the skill's SKILL.md."""
    rel = "agents/.agents/skills/visualize/SKILL.md"
    text = (REPO / rel).read_text()
    match = re.search(r"```json\n(.*?)```", text, re.DOTALL)
    if not match:
        return None, f"{rel}: no ```json spec block found"
    return match.group(1), None


def check_skill_spec_block():
    block, error = skill_spec_block()
    if error:
        return False, [error]
    try:
        doc = json.loads(block)
    except Exception as exc:  # noqa: BLE001
        return False, [f"skill spec block does not parse as JSON: {exc}"]
    problems = [f"skill spec block: {p}" for p in validate_spec(doc)]
    return (not problems), problems


def check_skill_frontmatter():
    rel = "agents/.agents/skills/visualize/SKILL.md"
    path = REPO / rel
    if not path.exists():
        return False, [f"{rel}: missing"]
    text = path.read_text()
    block = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not block:
        return False, [f"{rel}: no frontmatter block"]
    name = re.search(r"^name:\s*(\S+)", block.group(1), re.MULTILINE)
    description = re.search(r"^description:\s*(.+)$", block.group(1), re.MULTILINE)
    problems = []
    if not name or name.group(1) != "visualize":
        problems.append(f"{rel}: frontmatter name is not 'visualize'")
    if not description or not description.group(1).strip():
        problems.append(f"{rel}: frontmatter description is missing")
    return (not problems), problems


def check_cargo_manifest():
    if tomllib is None:
        return None, ["tomllib unavailable (python < 3.11)"]
    rel = "rataflow/Cargo.toml"
    try:
        with (REPO / rel).open("rb") as fh:
            manifest = tomllib.load(fh)
    except Exception as exc:  # noqa: BLE001
        return False, [f"{rel}: does not parse as TOML: {exc}"]
    problems = []
    package = manifest.get("package", {})
    if package.get("name") != "rataflow-view":
        problems.append(f"{rel}: package name is {package.get('name')!r}")
    deps = manifest.get("dependencies", {})
    for dep in ("rataflow", "ratatui", "serde", "serde_json", "anyhow"):
        if dep not in deps:
            problems.append(f"{rel}: dependency {dep} missing")
    if package.get("edition") != "2024":
        problems.append(f"{rel}: edition is {package.get('edition')!r}, expected 2024")
    return (not problems), [f"{rel}: {p}" for p in problems]


def check_cargo_lock():
    if tomllib is None:
        return None, ["tomllib unavailable (python < 3.11)"]
    rel = "rataflow/Cargo.lock"
    try:
        with (REPO / rel).open("rb") as fh:
            lock = tomllib.load(fh)
    except Exception as exc:  # noqa: BLE001
        return False, [f"{rel}: does not parse as TOML: {exc}"]
    pins = {pkg.get("name"): pkg.get("version") for pkg in lock.get("package", [])}
    problems = []
    if not pins.get("rataflow", "").startswith("0.1."):
        problems.append(f"{rel}: rataflow pinned at {pins.get('rataflow')!r}")
    if not pins.get("ratatui", "").startswith("0.30."):
        problems.append(f"{rel}: ratatui pinned at {pins.get('ratatui')!r}")
    return (not problems), [f"{rel}: {p}" for p in problems]


def check_install_wiring():
    rel = "install.sh"
    text = (REPO / rel).read_text()
    wanted = 'cargo install --path "$DOTFILES_DIR/rataflow"'
    if wanted not in text:
        return False, [f"{rel}: does not build the crate ({wanted})"]
    return True, []


def check_gitignore_target():
    rel = ".gitignore"
    text = (REPO / rel).read_text()
    if "/rataflow/target/" not in text:
        return False, [f"{rel}: does not ignore /rataflow/target/"]
    return True, []


def check_artifact_customization():
    """The vendored artifact skill must keep its local customizations: the
    visualize/rataflow default routing and the terminal-browser open step.
    A plain re-vendor from upstream silently drops them — this check
    catches that."""
    rel = "agents/.agents/skills/artifact/SKILL.md"
    path = REPO / rel
    if not path.exists():
        return False, [f"{rel}: missing"]
    text = path.read_text()
    problems = []
    name = re.search(r"^name:\s*(\S+)", text, re.MULTILINE)
    if not name or name.group(1) != "artifact":
        problems.append(f"{rel}: frontmatter name is not 'artifact'")
    if "## Pick the surface first" not in text:
        problems.append(f"{rel}: routing section 'Pick the surface first' missing")
    if "rataflow-view" not in text or "`visualize` skill" not in text:
        problems.append(f"{rel}: visualize/rataflow default routing missing")
    if "terminal-browser open" not in text:
        problems.append(f"{rel}: terminal-browser open step missing")
    if "careerhackeralex/visualize" not in text:
        problems.append(f"{rel}: upstream provenance line missing")
    return (not problems), problems


def check_cargo_tests():
    if not BUILD:
        return None, [
            "RATAFLOW_BUILD not set — cargo tests are the opt-in local gate"
        ]
    if subprocess.run(["cargo", "--version"], capture_output=True).returncode != 0:
        return False, ["RATAFLOW_BUILD=1 but cargo is not on PATH"]
    proc = subprocess.run(
        ["cargo", "test", "--offline"],
        cwd=REPO / "rataflow",
        capture_output=True,
        text=True,
        timeout=240,
    )
    if proc.returncode != 0:
        tail = (proc.stdout + proc.stderr).strip().splitlines()[-5:]
        return False, ["cargo test --offline failed: " + " | ".join(tail)]
    return True, []


def main():
    started = time.monotonic()
    checks = [
        ("example spec schema", check_example_spec),
        ("skill spec block schema", check_skill_spec_block),
        ("skill frontmatter", check_skill_frontmatter),
        ("cargo manifest", check_cargo_manifest),
        ("cargo lockfile", check_cargo_lock),
        ("install.sh wiring", check_install_wiring),
        (".gitignore target/", check_gitignore_target),
        ("artifact customization", check_artifact_customization),
        ("cargo tests (opt-in)", check_cargo_tests),
    ]
    for name, fn in checks:
        began = time.monotonic()
        ok, problems = fn()
        record(name, ok, "; ".join(problems) if problems else "")
        if ok is None and STRICT and name != "cargo tests (opt-in)":
            # A SKIP that is only allowed because a tool is missing becomes
            # a failure under STRICT (CI), mirroring the repo's dual mode.
            RESULTS[-1] = (name, False, f"SKIP not allowed under STRICT=1: {problems}")
    elapsed = time.monotonic() - started
    failed = [r for r in RESULTS if r[1] is False]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed "
          f"in {elapsed:.2f} s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

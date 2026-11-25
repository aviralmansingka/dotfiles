#!/usr/bin/env python3
# Paths: justfile README.md go/mission/go.mod rataflow/Cargo.toml scripts/test-just-build.py
"""just-build suite — the root `justfile` builds every in-repo binary, and
only from source in this checkout.

Offline and deterministic: no network, no $HOME mutation, no sleeps, no
installs (python3 stdlib only). Each check prints PASS, FAIL, or SKIP with
the reason, plus per-check and total run times. The script exits non-zero
when any check fails. See docs/ci-tests/just-build.md for scope and known
gaps.

The contract this locks (S01 inventory): the repo owns exactly two programs,
`mission` (from `go/mission`) and `rataflow-view` (from the `rataflow`
crate). Everything else the machine runs (`eza`, `herdr`, `rex`,
`mmdflux`, `grok-mermaid`, the patched reviewer) comes from a registry, a
release tarball, or npm — out of scope, and a recipe that installs one of
those is not a build of this repo.

The hard gate reads the justfile directly, so it runs everywhere. `just`
itself is optional: `just --summary` and `just --dry-run build` add a layer
when the binary is on PATH and SKIP with a message when it is not (CI
runners do not install `just`; the setup minute buys nothing the parser does
not already assert). Pass a path to point the suite at a copy:

    python3 scripts/test-just-build.py /tmp/copy/justfile

The mutation proof is built in — `--selftest` breaks an in-memory copy of
the justfile four ways (recipe deleted, recipe renamed, `build` deleted,
`cargo install` added) and asserts each break is caught:

    python3 scripts/test-just-build.py --selftest
"""

import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
JUSTFILE = REPO / "justfile"
CHECK_TIMEOUT = 30  # per `just` call, seconds

RESULTS = []


def record(name, ok, reason="", secs=None):
    RESULTS.append((name, ok, reason))
    label = "PASS" if ok is True else "FAIL" if ok is False else "SKIP"
    timing = f" ({secs:.2f} s)" if secs is not None else ""
    suffix = f" — {reason}" if reason else ""
    print(f"{label} {name}{suffix}{timing}")


# --------------------------------------------------------------------------
# The inventory (S01) and the shape of a recipe
# --------------------------------------------------------------------------

# Binary -> the source facts its build recipe must name. Markers are matched
# as plain substrings against the recipe's command lines, so a recipe that
# only mentions the binary's name does not count.
IN_REPO_BINARIES = {
    "mission": {
        "source": "go/mission",
        "markers": ["go/mission", "./cmd/mission"],
    },
    "quicknote": {
        "source": "go/quicknote",
        "markers": ["go/quicknote", "./cmd/quicknote"],
    },
    "rataflow-view": {
        "source": "rataflow",
        "markers": ["rataflow/Cargo.toml"],
    },
}

# A build of this repo compiles the checkout. These fetch or install from a
# registry, a release URL, or a remote repo, and belong to install.sh /
# Brewfile / dependencies.json instead. Shell comments are skipped before
# this runs: the justfile header states the contract in prose ("no `cargo
# install`") and prose is not a command.
FORBIDDEN = [
    (r"\bcargo\s+install\b", "cargo install"),
    (r"\bgo\s+install\b", "go install"),
    (r"\bgo\s+get\b", "go get"),
    (r"\bnpm\s+(?:install|i)\b", "npm install"),
    (r"\bbrew\s+(?:install|bundle)\b", "brew install"),
    (r"\bpip3?\s+install\b", "pip install"),
    (r"\bgem\s+install\b", "gem install"),
    (r"\bgit\s+clone\b", "git clone"),
    (r"\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh)\b", "curl | sh"),
]

ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*[ \t]*:=")
# `name params: dep dep`, `@name:` (quiet), `name:` — dependencies follow the
# colon. Assignments (`x := ...`) are matched out first.
RECIPE_RE = re.compile(r"^@?([A-Za-z_][A-Za-z0-9_-]*)(?:[ \t]+[^:=\n]*)?[ \t]*:(?!=)[ \t]*(.*)$")


def parse_justfile(text):
    """Return {recipe name: {"deps": [names], "body": [command lines]}}.

    Only what this suite reasons about: recipe names, their dependencies,
    and the command lines a dry run would show. Blank and comment lines
    inside a recipe are dropped; the first unindented non-comment line after
    a body starts the next item, exactly as just reads the file.
    """
    recipes = {}
    current = None
    for raw in text.splitlines():
        if not raw.strip():
            continue
        if raw[0] in " \t":
            if current is None:
                continue
            command = raw.strip()
            if command.startswith("#"):  # a shell comment, not a command
                continue
            current["body"].append(command)
            continue
        current = None
        line = raw.rstrip()
        if line.startswith("#") or ASSIGN_RE.match(line):
            continue
        match = RECIPE_RE.match(line)
        if not match:
            continue
        name, dep_text = match.group(1), match.group(2).strip()
        current = {"deps": dep_text.split(), "body": []}
        recipes[name] = current
    return recipes


def duplicate_recipe_names(text):
    """Recipe names defined more than once.

    `just` refuses to load such a file ("recipe `x` first defined on line N
    is redefined on line M"), so every recipe is dead, not just the
    duplicate. `parse_justfile` returns a dict, so a duplicate silently
    overwrote its twin and this suite passed a justfile no `just` could read.
    That is how the nix-fleet merge shipped a second `default:`.
    """
    seen = {}
    problems = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw[0] in " \t":
            continue
        line = raw.rstrip()
        if line.startswith("#") or ASSIGN_RE.match(line):
            continue
        match = RECIPE_RE.match(line)
        if not match:
            continue
        name = match.group(1)
        if name in seen:
            problems.append(f"recipe '{name}' defined on line {seen[name]} and "
                            f"again on line {lineno}")
        else:
            seen[name] = lineno
    return problems


def closure(recipes, start):
    """`start` plus every dependency reachable from it."""
    seen = set()
    queue = [start]
    while queue:
        name = queue.pop()
        if name in seen or name not in recipes:
            continue
        seen.add(name)
        queue.extend(recipes[name]["deps"])
    return seen


def recipes_naming(recipes, markers):
    """Recipes whose command lines mention every marker (source facts)."""
    return sorted(
        name for name, recipe in recipes.items()
        if all(any(marker in line for line in recipe["body"]) for marker in markers)
    )


# --------------------------------------------------------------------------
# Inventory drift: the two binaries above are the whole set
# --------------------------------------------------------------------------

def discover_in_repo_binaries():
    """Find compiled programs whose source lives in this checkout.

    Go: every `go/<module>/cmd/<name>/main.go`. Rust: every `<dir>/Cargo.toml`
    with `src/main.rs` beside it — either the package name (cargo derives the
    binary name from it, which is the rataflow case) or an explicit `[[bin]]`
    name. Both rules are the ones S01 used, so a new in-repo binary or a
    moved source tree fails here instead of silently escaping the justfile.
    """
    found = {}
    for gomod in REPO.glob("go/*/go.mod"):
        for entry in gomod.parent.glob("cmd/*/main.go"):
            found[entry.parent.name] = f"go/{gomod.parent.name}"
    for manifest in REPO.glob("*/Cargo.toml"):
        if not (manifest.parent / "src/main.rs").exists():
            continue
        text = manifest.read_text(encoding="utf-8", errors="replace")
        package = re.search(r"^\[package\](.*?)(?=^\[|\Z)", text, re.M | re.S)
        names = re.findall(r'^name\s*=\s*"([^"]+)"', package.group(1), re.M) if package else []
        for block in re.findall(r"^\[\[bin\]\](.*?)(?=^\[|\Z)", text, re.M | re.S):
            names += re.findall(r'^name\s*=\s*"([^"]+)"', block, re.M)
        for name in names:
            found[name] = manifest.parent.name
    return found


# --------------------------------------------------------------------------
# Checks — the hard gate (no tools beyond python)
# --------------------------------------------------------------------------

def check_justfile_present(recipes):
    if not recipes:
        return False, ["justfile defines no recipes"]
    return True, []


def check_inventory(recipes):
    found = discover_in_repo_binaries()
    problems = []
    for name, source in sorted(found.items()):
        if name not in IN_REPO_BINARIES:
            problems.append(f"{name} ({source}) is a new in-repo binary: add it to "
                            f"IN_REPO_BINARIES and give it a build recipe")
        elif IN_REPO_BINARIES[name]["source"] != source:
            problems.append(f"{name} source moved: {IN_REPO_BINARIES[name]['source']} "
                            f"-> {source}")
    for name, spec in sorted(IN_REPO_BINARIES.items()):
        if name not in found:
            problems.append(f"{name} ({spec['source']}) is no longer found in the "
                            f"tree: drop it from IN_REPO_BINARIES")
    return not problems, problems


def check_binary_recipes(recipes):
    problems = []
    for name, spec in sorted(IN_REPO_BINARIES.items()):
        if not recipes_naming(recipes, spec["markers"]):
            problems.append(f"no recipe builds {name} from {spec['source']} "
                            f"(a command line must name "
                            f"{' and '.join(spec['markers'])})")
    return not problems, problems


def check_build_recipe(recipes):
    if "build" not in recipes:
        return False, ["no `build` recipe: `just build` is the documented entry point"]
    if not recipes["build"]["deps"] and not recipes["build"]["body"]:
        return False, ["`build` is empty"]
    problems = []
    reachable = closure(recipes, "build")
    for name, spec in sorted(IN_REPO_BINARIES.items()):
        naming = recipes_naming(recipes, spec["markers"])
        if not naming:
            continue  # reported by the per-binary check
        if not set(naming) & reachable:
            problems.append(f"{name} is built by {naming}, which `build` never "
                            f"reaches (deps: {' '.join(recipes['build']['deps']) or 'none'})")
    return not problems, problems


def check_deps_resolve(recipes):
    """Every dependency names a recipe in this justfile.

    A stale dependency is how a rename surfaces: just refuses to run the
    recipe at all ("Justfile does not contain recipe"), so the drift belongs
    in CI with the recipe name in the message.
    """
    problems = []
    for name, recipe in sorted(recipes.items()):
        unknown = [dep for dep in recipe["deps"] if dep not in recipes]
        if unknown:
            problems.append(f"recipe `{name}` depends on missing {unknown}")
    return not problems, problems


def check_no_registry_install(recipes):
    problems = []
    for name, recipe in sorted(recipes.items()):
        for command in recipe["body"]:
            for pattern, label in FORBIDDEN:
                if re.search(pattern, command):
                    problems.append(f"recipe `{name}` runs {label}: {command}")
    return not problems, problems


HARD_GATE = [
    ("justfile defines recipes", check_justfile_present),
    ("inventory matches the tree", check_inventory),
    ("every in-repo binary has a build recipe", check_binary_recipes),
    ("recipe dependencies resolve", check_deps_resolve),
    ("build reaches every binary recipe", check_build_recipe),
    ("no registry install command", check_no_registry_install),
]


# --------------------------------------------------------------------------
# Checks — the optional `just` layer
# --------------------------------------------------------------------------

def run_just(justfile, *args):
    return subprocess.run(
        ["just", "--justfile", str(justfile), "--working-directory", str(justfile.parent), *args],
        capture_output=True, text=True, timeout=CHECK_TIMEOUT,
    )


def just_missing():
    return None, ["just not on PATH: the `just` binary layer is skipped "
                  "(the parse above already asserts the same recipes)"]


def check_just_summary(recipes, justfile):
    if not shutil.which("just"):
        return just_missing()
    proc = run_just(justfile, "--summary")
    if proc.returncode != 0:
        return False, [f"just --summary failed: {(proc.stderr or proc.stdout).strip()}"]
    listed = set(proc.stdout.split())
    expected = {"build"} | {r for spec in IN_REPO_BINARIES.values()
                            for r in recipes_naming(recipes, spec["markers"])}
    missing = sorted(expected - listed)
    return not missing, [f"just --summary omits {missing}"] if missing else []


def check_just_dry_run(recipes, justfile):
    if not shutil.which("just"):
        return just_missing()
    proc = run_just(justfile, "--dry-run", "build")
    if proc.returncode != 0:
        lines = [l for l in (proc.stderr or proc.stdout).strip().splitlines() if l.strip()]
        return False, [f"just --dry-run build failed: {lines[0] if lines else 'no output'}"]
    # just echoes the commands to stderr: the run never happens, so stdout
    # stays empty and both streams belong to the transcript.
    shown = proc.stdout + proc.stderr
    missing = [f"{name} ({spec['markers'][0]})" for name, spec in IN_REPO_BINARIES.items()
               if spec["markers"][0] not in shown]
    return not missing, [f"dry run never names {missing}"] if missing else []


JUST_LAYER = [
    ("just lists every recipe", check_just_summary),
    ("just --dry-run build names every source", check_just_dry_run),
]


# --------------------------------------------------------------------------
# --selftest: prove the hard gate catches each regression class
# --------------------------------------------------------------------------

def drop_recipe(text, name):
    """Remove one recipe, header line and indented body."""
    kept, dropping = [], False
    for line in text.splitlines():
        if re.match(rf"^@?{re.escape(name)}\b[^:]*:", line):
            dropping = True
            continue
        if dropping and (line[:1] in (" ", "\t") or not line.strip()):
            continue
        dropping = False
        kept.append(line)
    return "\n".join(kept) + "\n"


def rename_recipe(text, old, new):
    """Rename a recipe header, leaving `build`'s dependency on the old name.

    That stale dependency is the realistic drift — the body still names the
    source path, so only the dependency graph shows the break.
    """
    return re.sub(rf"^@?{re.escape(old)}\b", new, text, count=1, flags=re.M)


def caught_by(recipes):
    return [name for name, fn in HARD_GATE if fn(recipes)[0] is False]


def selftest(justfile):
    text = justfile.read_text(encoding="utf-8")
    mutations = [
        ("build-mission deleted", drop_recipe(text, "build-mission"),
         "every in-repo binary has a build recipe"),
        ("build-mission renamed", rename_recipe(text, "build-mission", "compile-mission"),
         ("recipe dependencies resolve", "build reaches every binary recipe")),
        ("build deleted", drop_recipe(text, "build"),
         "build reaches every binary recipe"),
        ("cargo install added to a recipe",
         text.rstrip("\n") + "\n    cargo install eza --locked\n",
         "no registry install command"),
    ]
    failures = []
    for label, mutated, expected in mutations:
        if mutated == text:
            failures.append(f"{label}: mutation did not change the file")
            print(f"FAIL mutation: {label} -> mutation did not change the file")
            continue
        caught = caught_by(parse_justfile(mutated))
        wanted = (expected, ) if isinstance(expected, str) else expected
        ok = any(name in caught for name in wanted)
        print(f"{'PASS' if ok else 'FAIL'} mutation: {label} -> "
              f"caught by {caught or 'nothing'}")
        if not ok:
            failures.append(f"{label}: expected {wanted}, caught {caught}")

    # The duplicate gate reads the text, not the parsed dict, so it gets its
    # own case: a second `default:` is invisible to parse_justfile by design.
    doubled = text + "\ndefault:\n    @just --list\n"
    dupes = duplicate_recipe_names(doubled)
    print(f"{'PASS' if dupes else 'FAIL'} mutation: duplicate default recipe -> "
          f"caught by {dupes or 'nothing'}")
    if not dupes:
        failures.append("duplicate default recipe: expected a duplicate report")
    total = len(mutations) + 1
    print(f"\nselftest: {total - len(failures)}/{total} mutations caught")
    return 1 if failures else 0


# --------------------------------------------------------------------------

def main():
    if "--selftest" in sys.argv[1:]:
        return selftest(JUSTFILE)
    positional = [a for a in sys.argv[1:] if not a.startswith("-")]
    justfile = Path(positional[0]).resolve() if positional else JUSTFILE

    started = time.monotonic()
    print(f"justfile: {justfile}")
    if not justfile.is_file():
        record("justfile exists", False, f"{justfile} is missing")
        print(f"\n0/1 checks passed in {time.monotonic() - started:.2f} s")
        return 1

    text = justfile.read_text(encoding="utf-8")
    recipes = parse_justfile(text)
    dupes = duplicate_recipe_names(text)
    record("no duplicate recipe names", not dupes, "; ".join(dupes))
    for name, fn in HARD_GATE:
        began = time.monotonic()
        ok, problems = fn(recipes)
        record(name, ok, "; ".join(problems), time.monotonic() - began)
    for name, fn in JUST_LAYER:
        ok, problems = fn(recipes, justfile)
        record(name, ok, "; ".join(problems))

    elapsed = time.monotonic() - started
    failed = [r for r in RESULTS if r[1] is False]
    skipped = [r for r in RESULTS if r[1] is None]
    print(f"\n{len(RESULTS) - len(failed) - len(skipped)}/{len(RESULTS)} checks passed"
          f"{f', {len(skipped)} skipped' if skipped else ''} in {elapsed:.2f} s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

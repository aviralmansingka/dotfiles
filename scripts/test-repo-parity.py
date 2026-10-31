#!/usr/bin/env python3
# Paths: agents/** docs/** README.md AGENTS.md
"""repo-parity regression suite — lockfiles, docs-vs-reality.

Offline and deterministic: no network, no $HOME mutation, no sleeps, no pip
installs (python3 stdlib only). Each check prints PASS or FAIL with the file
and the reason, plus per-check and total run times. The script exits
non-zero when any check fails. See docs/ci-tests/repo-parity.md for scope,
coverage inventory, and known gaps.

Companion suite: scripts/test-repo-config.py already covers SKILL.md
frontmatter well-formedness, install.sh<->stow parity, gh-dash config,
pi settings JSON validity, herdr TOML keys, and the Brewfile. This suite
does not repeat those checks; it locks the surfaces that suite does not
touch:

  P1 skills store parity     repo-owned skill dirs keep name==dirname;
                                  the claude symlink-farm machinery (and
                                  its skills-lock.json) must not return
  P4 docs accuracy lint           mechanical docs-vs-reality: stow table
                                  parity, stow-package count claims,
                                  `stow <pkg>` mentions, repo-anchored path
                                  references, markdown link targets
  P5 negative sandbox self-test   sandbox copies prove each P1/P4 check
                                  catches its regression class

The P2 claude hook-resolution check was removed together with the claude
stow package (Claude Code uninstalled from every host); the P3 notion-cli
behavior matrix was removed with pi/bin/notion-cli in the dead-code cleanup.
"""

import re
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

CHECK_TIMEOUT = 30  # per git/subprocess call, seconds


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def git_tracked(root: Path) -> set:
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        capture_output=True, text=True, timeout=CHECK_TIMEOUT, check=True,
    )
    return {line for line in out.stdout.split("\n") if line}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def top_dirs(root: Path) -> set:
    # Tracked entries only: the README documents STOW PACKAGES (things the
    # repo ships), so untracked host-side artifacts (a root __pycache__, a
    # stowed package's node_modules) must not trip the parity check. Dot
    # dirs stay excluded (same as the old filesystem walk); a non-git tree
    # (the P5 sandbox copy) falls back to the filesystem walk.
    proc = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode == 0:
        names = {entry.split("/", 1)[0] for entry in proc.stdout.splitlines() if "/" in entry}
        return {n for n in names if not n.startswith(".")}
    return {p.name for p in root.iterdir()
            if p.is_dir() and not p.name.startswith(".")}


def frontmatter_name(path: Path) -> str | None:
    m = re.match(r"\A---\n(.*?)\n---", read_text(path), re.S)
    if not m:
        return None
    n = re.search(r"^name:\s*(.+?)\s*$", m.group(1), re.M)
    if not n:
        return None
    return n.group(1).strip().strip('"').strip("'")


# --------------------------------------------------------------------------
# P1 — skills store parity
# --------------------------------------------------------------------------

# The one real skill store is the tracked repo-owned dirs under
# agents/.agents/skills/. The old Claude Code exposure layers (the
# .claude/skills project farm and the claude/.claude/skills stowed farm,
# plus their skills-lock.json) were removed together with the claude
# stow package when Claude Code was uninstalled from every host (the B22
# dangling-farm drift died with them). The durable rules: the store stays
# healthy (name==dirname), and the claude-farm machinery must not return.
REPO_SKILL_DIR_RE = re.compile(r"^agents/\.agents/skills/([^/]+)/SKILL\.md$")


def _repo_skill_dirs(tracked: set) -> list:
    return sorted(m.group(1) for t in tracked
                  if (m := REPO_SKILL_DIR_RE.match(t)))



def check_skills_store(root: Path, tracked: set):
    problems = []

    # (a) the claude-farm lockfile must not return, tracked or not.
    rel = "skills-lock.json"
    if rel in tracked:
        problems.append(f"FAIL {rel}: tracked again; the claude skills farm "
                        f"was removed with the claude package - vendor "
                        f"skills into agents/.agents/skills/ instead")
    elif (root / rel).exists():
        problems.append(f"FAIL {rel}: present on disk but not tracked; delete it")

    # (b) repo-owned skills: every tracked skill dir keeps name==dirname.
    repo_skills = _repo_skill_dirs(tracked)
    if not repo_skills:
        problems.append("FAIL agents/.agents/skills/: no tracked repo-owned "
                        "skill dirs found")
    for name in repo_skills:
        fm_name = frontmatter_name(root / "agents" / ".agents" / "skills" / name / "SKILL.md")
        if fm_name != name:
            problems.append(f"FAIL agents/.agents/skills/{name}/SKILL.md: frontmatter "
                            f"name is {fm_name!r}; must equal the directory name")

    if problems:
        return False, problems
    return True, [
        f"{len(repo_skills)} tracked skill dirs keep name==dirname",
        "no skills-lock.json (claude-farm machinery removed with the "
        "claude package)",
    ]


# --------------------------------------------------------------------------
# P4 — docs accuracy lint (grep-level, current truth)
# --------------------------------------------------------------------------

# Top-level dirs that are repo infrastructure, not stow packages. The README
# "Stow Packages" table must list every other top-level dir, and nothing
# else. Remove an entry here in the same change that makes it a package.
NON_PACKAGE_DIRS = {
    "docs": "documentation tree, not a stow package",
    "ops": "ops tooling (terraform/packer/stt), not a stow package",
    "rataflow": "Rust crate built by install.sh (cargo install --path), not a stow package",
    "scripts": "repo scripts and test suites, not a stow package",
    "testdata": "test fixtures, not a stow package",
}

# Backticked repo-anchored references that intentionally point outside this
# tree. doc -> {ref: reason}. Remove an entry when the doc stops referencing
# it (stale entries fail).
UPSTREAM_DOC_REFS = {
    "AGENTS.md": {
        "agents/.agents/skills/terminal-browser": (
            "tracked symlink into the terminal-browser app dist "
            "(~/.local/share), not repo content; dangles in CI"
        ),
    },
    "docs/pi-live-config.md": {
        "docs/cli.md": "upstream pi package's installed docs/, not this repo's docs/",
        "docs/configuration.md": "upstream pi package's installed docs/",
        "docs/settings.md": "upstream pi package's installed docs/",
    },
    # The coupling audit is a point-in-time snapshot of the live
    # ~/dotfiles tree (auto-committed 2026-10-29): its rows name files at
    # their audit-time locations, some elided with '...'. Those paths were
    # never tracked in git, so they cannot be 'fixed' to a current file
    # without falsifying the audit record.
    "docs/rex-herdr-coupling-audit.md": {
        "herdr/.../herdr-flash/config.toml": (
            "audit snapshot; elided path, never tracked in git"
        ),
        "tuicr/tuicr-wrapper-herdr.sh": (
            "audit snapshot; live-tree path, never tracked in git"
        ),
        "nvim/nvim-open.sh": (
            "audit snapshot; live-tree path, never tracked in git"
        ),
        "tuicr/SKILL.md": (
            "audit snapshot; live-tree path, never tracked in git"
        ),
        "nvim/SKILL.md": (
            "audit snapshot; live-tree path, never tracked in git"
        ),
        "docs/adr/0004-require-holder-consent...": (
            "audit snapshot; elided path, never tracked in git"
        ),
        "docs/evidence/sidekick-.../README.md": (
            "audit snapshot; elided path, never tracked in git"
        ),
    },
}

COUNT_CLAIM_RE = re.compile(r"(\d+)\s+stow(?:ed)?\s+packages?\b", re.I)

# Documented `stow <pkg>` mentions whose package does not exist in the tree.
# This allowlist is the durable record of known docs-vs-reality drift, not
# an endorsement; remove the entry in the same change that adds the package
# or fixes the doc. The last two entries (docs/OSC52.md and
# docs/OSC52-QUICKSTART.md telling the user to `stow ssh`) were removed
# with the B22 fix: this repo never shipped an ssh package, and the docs'
# own SSH section says ~/.ssh/config needs nothing from the repo - the
# mentions were corrected to the current truth.
DOC_STOW_MENTION_ALLOWLIST = {}
LINK_RE = re.compile(r"\]\(([^)\s]+)\)")
STOW_OPT_WITH_ARG = {"-d", "-t", "--dir", "--target"}
FRONTMATTER_SKIP = ("http://", "https://", "mailto:")


# Meta/historical docs that record past drift and deletions. They
# intentionally mention packages and paths that no longer exist (e.g. the
# removed hunk suite, 'stow ssh' findings, deleted verifiers), so the P4
# mention/path checks exempt them. Everything else in docs/ stays checked.
P4_EXEMPT_DOCS = {
    "docs/ci-test-surfaces.md": "test-surface plan: records deleted suites and verifiers",
    "docs/code-enhancements-from-testing.md": "findings tracker: quotes drift findings, incl. 'stow ssh'",
}

def scoped_docs(tracked: set) -> list:
    core = ["README.md", "AGENTS.md"]
    extra = sorted(
        t for t in tracked
        if re.match(r"docs/[^/]+\.md$", t) and t not in P4_EXEMPT_DOCS
    )
    return core + [d for d in extra]


def parse_stow_table(readme_text: str):
    """Return (ordered row names, problems) from the '## Stow Packages' table."""
    lines = readme_text.split("\n")
    problems = []
    rows = []
    idx = None
    for i, line in enumerate(lines):
        if re.match(r"^##\s+Stow Packages\s*$", line):
            idx = i
            break
    if idx is None:
        return [], ["FAIL README.md: no '## Stow Packages' section found"]
    for line in lines[idx + 1:]:
        if not line.strip():
            continue
        if not line.startswith("|"):
            break
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        first = cells[0] if cells else ""
        if first.lower() == "package" or set(first) <= set(":- "):
            continue  # header or separator row
        m = re.match(r"`([^`]+)`", first)
        if not m:
            problems.append(f"FAIL README.md: stow table row {line!r} has "
                            f"no backticked package name in its first cell")
            continue
        rows.append(m.group(1))
    if not rows:
        problems.append("FAIL README.md: '## Stow Packages' table has no rows")
    return rows, problems


def stow_command_packages(text: str):
    """Yield (context, package) from fenced or backticked `stow <pkg>` lines."""
    fenced = False
    for lineno, line in enumerate(text.split("\n"), start=1):
        stripped = line.strip()
        if stripped.startswith("```"):
            fenced = not fenced
            continue
        candidates = []
        if fenced and re.match(r"^stow\b", stripped):
            candidates.append((f"line {lineno}", stripped))
        for m in re.finditer(r"`(stow\b[^`\n]*)`", line):
            candidates.append((f"line {lineno}", m.group(1)))
        for ctx, cmd in candidates:
            try:
                tokens = shlex.split(cmd, comments=True)
            except ValueError:
                tokens = cmd.split("#")[0].split()
            skip_next = False
            for tok in tokens[1:]:
                if skip_next:
                    skip_next = False
                    continue
                if tok in STOW_OPT_WITH_ARG:
                    skip_next = True
                    continue
                if tok.startswith("-") or "$" in tok or "`" in tok:
                    continue
                if re.search(r"[<>*{}]", tok):
                    continue  # placeholder (<tool>) or glob (ops/packer/**)
                yield ctx, tok


def check_docs_accuracy(root: Path, tracked: set):
    problems = []
    docs = scoped_docs(tracked)
    missing_core = [d for d in ("README.md", "AGENTS.md") if d not in tracked]
    if missing_core:
        problems.append(f"FAIL {', '.join(missing_core)}: core doc not tracked")

    dirs = top_dirs(root)
    for pkg in sorted(NON_PACKAGE_DIRS):
        if pkg not in dirs:
            problems.append(f"FAIL NON_PACKAGE_DIRS: '{pkg}' is not a top-level "
                            f"dir anymore; remove the stale exemption")
        if pkg not in tracked and not any(t.startswith(pkg + "/") for t in tracked):
            problems.append(f"FAIL NON_PACKAGE_DIRS: '{pkg}' has no tracked files")

    # (a) README stow table <-> top-level dirs, both directions
    table_rows, tbl_problems = parse_stow_table(read_text(root / "README.md"))
    problems.extend(tbl_problems)
    if table_rows:
        for pkg in table_rows:
            if pkg not in dirs:
                problems.append(f"FAIL README.md: stow table lists '{pkg}', "
                                f"which is not a top-level dir")
            if pkg in NON_PACKAGE_DIRS:
                problems.append(f"FAIL README.md: stow table lists '{pkg}', "
                                f"which is exempted as a non-package dir")
        stowable = dirs - set(NON_PACKAGE_DIRS)
        for pkg in sorted(stowable - set(table_rows)):
            problems.append(f"FAIL README.md: top-level dir '{pkg}' is missing "
                            f"from the Stow Packages table")
        for pkg in sorted(set(table_rows) - stowable):
            if pkg in dirs:
                problems.append(f"FAIL README.md: '{pkg}' is in the table but "
                                f"exempted as non-package")

    exempt_used = set()
    stow_mention_used = set()
    for doc in docs:
        if doc not in tracked and doc in ("README.md", "AGENTS.md"):
            continue
        path = root / doc
        if not path.exists():
            problems.append(f"FAIL {doc}: tracked doc missing from the tree")
            continue
        text = read_text(path)

        # (b) numeric stow-package count claims must equal the table
        for m in COUNT_CLAIM_RE.finditer(text):
            claimed = int(m.group(1))
            if table_rows and claimed != len(table_rows):
                problems.append(
                    f"FAIL {doc}: claims {claimed} stow packages; the README "
                    f"table lists {len(table_rows)} (the #11 drift class)")

        # (c) `stow <pkg>` mentions must reference real top-level dirs
        for ctx, pkg in stow_command_packages(text):
            if (doc, pkg) in DOC_STOW_MENTION_ALLOWLIST:
                stow_mention_used.add((doc, pkg))
                continue
            if pkg not in dirs:
                problems.append(f"FAIL {doc} ({ctx}): 'stow {pkg}' references "
                                f"a nonexistent top-level dir")

        # (d) repo-anchored backticked path references must exist
        for m in re.finditer(r"`([^`\n]+)`", text):
            tok = m.group(1).strip()
            if "/" not in tok or " " in tok or "$" in tok:
                continue
            if tok.startswith(("-", "~", "/", "http")):
                continue
            if re.search(r"[<>*{}]", tok):
                continue  # placeholder or glob, not a literal path
            head = tok.split("/", 1)[0]
            if head not in dirs:
                continue
            reason = UPSTREAM_DOC_REFS.get(doc, {}).get(tok)
            if reason:
                exempt_used.add((doc, tok))
                continue
            if not (root / tok).exists():
                problems.append(f"FAIL {doc}: references '{tok}', which does "
                                f"not exist in the repo")

        # (e) markdown link targets must exist
        for m in LINK_RE.finditer(text):
            target = m.group(1).strip("<>").split("#")[0]
            if not target or target.startswith(FRONTMATTER_SKIP):
                continue
            if not ((root / doc).parent / target).exists() and not (root / target).exists():
                problems.append(f"FAIL {doc}: links to '{target}', which does "
                                f"not exist in the repo")

    for key in sorted(set(DOC_STOW_MENTION_ALLOWLIST) - stow_mention_used):
        problems.append(f"FAIL DOC_STOW_MENTION_ALLOWLIST: '{key[0]}' no longer "
                        f"runs 'stow {key[1]}'; remove the stale exemption: "
                        f"{DOC_STOW_MENTION_ALLOWLIST[key]}")
    for doc, refs in UPSTREAM_DOC_REFS.items():
        if doc not in tracked and doc not in docs:
            problems.append(f"FAIL UPSTREAM_DOC_REFS: exempted doc '{doc}' is "
                            f"not in the suite's scope; remove the stale exemption")
        for tok in refs:
            if (doc, tok) not in exempt_used:
                problems.append(f"FAIL UPSTREAM_DOC_REFS: '{doc}' no longer "
                                f"references '{tok}'; remove the stale exemption")

    if problems:
        return False, problems
    return True, [
        f"{len(docs)} tracked docs checked ({', '.join(docs[:4])}"
        f"{'...' if len(docs) > 4 else ''}): "
        f"stow table rows == top-level dirs minus {len(NON_PACKAGE_DIRS)} "
        f"exempted non-package dirs ({len(table_rows)} rows)",
        "0 stow-package count claims, 0 dangling `stow <pkg>` mentions, "
        "0 dangling repo-anchored references or link targets "
        f"({len(exempt_used)} upstream-ref exemptions)",
    ]


# --------------------------------------------------------------------------
# P5 — negative sandbox self-test
# --------------------------------------------------------------------------

def _build_skills_sandbox(base: Path, tracked: set) -> Path:
    """A faithful passing baseline: two repo-owned skill dirs the way
    agents/.agents/skills/ carries them (name==dirname), and no
    skills-lock.json anywhere."""
    root = base / "repo"
    root.mkdir(parents=True)
    for name in ("humanify", "nvim"):
        skill_dir = root / "agents" / ".agents" / "skills" / name
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: test skill\n---\nbody\n")
        tracked.add(f"agents/.agents/skills/{name}/SKILL.md")
    return root


def _negative_skills_cases():
    def name_mismatch(root, tracked):
        p = root / "agents" / ".agents" / "skills" / "humanify" / "SKILL.md"
        p.write_text(p.read_text().replace("name: humanify", "name: wrong-name"))

    def lock_returns(root, tracked):
        # The claude-farm lockfile returns, tracked: the durable ban fires.
        (root / "skills-lock.json").write_text("{}\n")
        tracked.add("skills-lock.json")

    return [("skills: frontmatter name mismatch", name_mismatch,
             "frontmatter name is"),
            ("skills: skills-lock.json returns", lock_returns,
             "tracked again")]


def _build_docs_sandbox(base: Path) -> tuple:
    root = base / "repo"
    root.mkdir(parents=True)
    readme = read_text(REPO / "README.md")
    (root / "README.md").write_text(readme)
    tracked = {"README.md", "AGENTS.md"}
    # Carry the UPSTREAM_DOC_REFS exemptions for AGENTS.md the way
    # pi-live-config.md is carried below: a stub doc that still contains
    # the exempted backticked refs, so the baseline stays faithful.
    ag_refs = " ".join(f"`{tok}`" for tok in sorted(UPSTREAM_DOC_REFS.get("AGENTS.md", {})))
    (root / "AGENTS.md").write_text(f"# stub\n{ag_refs}\n")
    # Materialize every top-level dir the table and refs can name, so the
    # unmutated sandbox is a faithful passing baseline.
    dirs = set(NON_PACKAGE_DIRS)
    rows, _ = parse_stow_table(readme)
    dirs |= set(rows)
    def materialize(tok: str) -> None:
        target = root / tok
        if tok.endswith("/"):
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch(exist_ok=True)

    for m in re.finditer(r"`([^`\n]+)`", readme):
        tok = m.group(1).strip()
        if "/" in tok and " " not in tok and "$" not in tok \
                and not tok.startswith(("-", "~", "/", "http")) \
                and not re.search(r"[<>*{}]", tok):
            head = tok.split("/", 1)[0]
            if head in dirs or head in NON_PACKAGE_DIRS:
                materialize(tok)
    for m in LINK_RE.finditer(readme):
        target = m.group(1).strip("<>").split("#")[0]
        if target and not target.startswith(FRONTMATTER_SKIP) and "/" in target \
                and not re.search(r"[<>*{}]", target):
            materialize(target)
    for d in dirs:
        (root / d).mkdir(exist_ok=True)
    # NON_PACKAGE_DIRS hygiene requires each exempted dir to hold tracked
    # files; give the sandbox a tracked marker in each.
    for pkg in NON_PACKAGE_DIRS:
        (root / pkg / "tracked-file").touch()
        tracked.add(f"{pkg}/tracked-file")
    # Carry the exemption docs so the sandbox matches the real suite's
    # scope: their refs/mentions are exempted, not required to exist.
    (root / "docs").mkdir(exist_ok=True)
    for doc, refs in UPSTREAM_DOC_REFS.items():
        if doc == "AGENTS.md":
            continue  # its refs are carried by the AGENTS.md stub above
        p = root / doc
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("# stub\n" + " ".join(f"`{tok}`" for tok in sorted(refs)) + "\n")
        tracked.add(doc)
    for (doc, pkg) in DOC_STOW_MENTION_ALLOWLIST:
        p = root / doc
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f"# stub\n\n```bash\nstow {pkg}\n```\n")
        tracked.add(doc)
    return root, tracked


def check_negative_sandbox(_root: Path, _tracked: set):
    """Prove each P1/P2/P4 check catches its regression class on sandbox copies."""
    failures = []

    def baseline_ok(check, root, tracked):
        """The unmutated sandbox must pass, or the mutation proof is hollow."""
        ok, messages = check(root, tracked)
        if not ok:
            return ("unmutated sandbox already fails; the mutation proof is "
                    f"hollow: {'; '.join(messages)[:200]}")
        return None

    def run_and_expect(check, root, tracked, want):
        ok, messages = check(root, tracked)
        if ok:
            return f"did not fail (expected failure matching {want!r})"
        if not any(want in msg for msg in messages):
            return f"failed for the wrong reason; no message contains {want!r}: " \
                   f"{'; '.join(messages)[:200]}"
        return None

    with tempfile.TemporaryDirectory(prefix="repo-parity-neg-") as tmp:
        base = Path(tmp)
        for label, mutate, want in _negative_skills_cases():
            tracked = set()
            root = _build_skills_sandbox(
                base / label.replace(" ", "_").replace(":", ""), tracked)
            err = baseline_ok(check_skills_store, root, tracked)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
                continue
            mutate(root, tracked)
            err = run_and_expect(check_skills_store, root, tracked, want)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
        for label, mutate, want in _negative_docs_cases():
            root, tracked = _build_docs_sandbox(base / label.replace(" ", "_").replace(":", ""))
            err = baseline_ok(check_docs_accuracy, root, tracked)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
                continue
            mutate(root)
            err = run_and_expect(check_docs_accuracy, root, tracked, want)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")

    if failures:
        return False, failures
    return True, ["all 7 sandbox mutations were caught by the matching check "
                  "(2 skills-store, 5 docs)"]


def _negative_docs_cases():
    def claim_bad_count(root):
        p = root / "README.md"
        rows, _ = parse_stow_table(p.read_text())
        p.write_text(p.read_text() +
                     f"\nThis repo ships {len(rows) + 1} stow packages.\n")

    def add_fake_table_row(root):
        p = root / "README.md"
        lines = p.read_text().split("\n")
        out = []
        inserted = False
        in_section = False
        for line in lines:
            out.append(line)
            if re.match(r"^##\s+Stow Packages\s*$", line):
                in_section = True
            elif in_section and not inserted and line.strip().startswith("|") \
                    and set(line.strip()) <= set("|-: "):
                # separator row of the table: insert the fake row right after
                out.append("| `ghostpkg` | Ghost package that does not exist |")
                inserted = True
        p.write_text("\n".join(out))

    def add_fake_stow_command(root):
        p = root / "AGENTS.md"
        p.write_text(p.read_text() + "\n```\nstow ghostpkg\n```\n")

    def add_fake_path_ref(root):
        p = root / "AGENTS.md"
        p.write_text(p.read_text() + "\nRun `scripts/does-not-exist.py` first.\n")

    def add_dead_link(root):
        p = root / "README.md"
        p.write_text(p.read_text() + "\nSee [the missing doc](docs/missing-doc.md).\n")

    return [("docs: wrong stow count claim", claim_bad_count, "stow packages"),
            ("docs: table row for missing dir", add_fake_table_row,
             "not a top-level dir"),
            ("docs: stow command for missing dir", add_fake_stow_command,
             "nonexistent top-level dir"),
            ("docs: dangling path reference", add_fake_path_ref,
             "does not exist in the repo"),
            ("docs: dangling link target", add_dead_link,
             "which does not exist in the repo")]


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------

CHECKS = [
    ("P1 skills store parity", check_skills_store),
    ("P4 docs accuracy", check_docs_accuracy),
    ("P5 negative sandbox", check_negative_sandbox),
]


def main():
    start = time.monotonic()
    tracked = git_tracked(REPO)
    failures = []
    for name, fn in CHECKS:
        t0 = time.monotonic()
        try:
            result = fn(REPO, tracked)
        except Exception as exc:  # noqa: BLE001
            result = (False, [f"FAIL {name}: check crashed: {exc!r}"])
        elapsed = time.monotonic() - t0
        status, messages = result
        label = "PASS" if status is True else ("SKIP" if status == "SKIP" else "FAIL")
        for message in messages:
            print(f"{label} {name} ({elapsed:.2f}s): {message}")
        if status is False:
            failures.append(name)
    total = time.monotonic() - start
    print(f"repo-parity suite: {len(CHECKS) - len(failures)}/{len(CHECKS)} "
          f"checks passed, {len(failures)} failed, {total:.2f}s total")
    if failures:
        print("FAILED checks: " + ", ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

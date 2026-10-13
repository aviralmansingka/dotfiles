#!/usr/bin/env python3
# Paths: claude/** agents/** docs/** README.md CLAUDE.md AGENTS.md
"""repo-parity regression suite — lockfiles, hook references, docs-vs-reality.

Offline and deterministic: no network, no $HOME mutation, no sleeps, no pip
installs (python3 stdlib only). Each check prints PASS or FAIL with the file
and the reason, plus per-check and total run times. The script exits
non-zero when any check fails. See docs/ci-tests/repo-parity.md for scope,
coverage inventory, and known gaps.

Companion suite: scripts/test-repo-config.py already covers SKILL.md
frontmatter well-formedness, install.sh<->stow parity, gh-dash config,
pi/claude settings JSON validity (incl. the /home/<user> scan for
claude/.claude), herdr TOML keys, and the Brewfile. This suite does not
repeat those checks; it locks the surfaces that suite does not touch:

  P1 skills store parity     the .claude/skills symlink farm resolves
                                  to tracked in-tree skill dirs; a returning
                                  skills-lock.json must carry full parity
  P2 claude hook resolution       every hook script path is tracked,
                                  allowlisted-external, or fails (ses-A
                                  dangling-hook class); no /Users/<user>
                                  absolute home paths
  P4 docs accuracy lint           mechanical docs-vs-reality: stow table
                                  parity, stow-package count claims,
                                  `stow <pkg>` mentions, repo-anchored path
                                  references, markdown link targets
  P5 negative sandbox self-test   sandbox copies prove each P1/P2/P4 check
                                  catches its regression class

The P3 notion-cli behavior matrix was removed together with pi/bin/notion-cli
in the dead-code cleanup.
"""

import json
import os
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
# P1 — skills store parity (symlink farm + optional skills-lock.json)
# --------------------------------------------------------------------------

# Claude Code skills are exposed through tracked symlinks that must point
# at the one real store: the tracked repo-owned dirs agents/.agents/skills/.
#   .claude/skills/<name>        -> ../../agents/.agents/skills/<name>
#     (project-level exposure, in-repo only)
#   claude/.claude/skills/<name> -> ../../../agents/.agents/skills/<name>
#     (stowed to $HOME/.claude/skills by the claude package)
# Dangling symlinks anywhere in the farm are the B22 drift class: the old
# 8 mattpocock-bundle symlinks pointed at external-fetch targets that the
# captain's skill audit (commit 64a4a94, "lean toward pi-config minimalism")
# deleted from the store; the symlinks and the orphaned skills-lock.json
# (its fetch tool is referenced nowhere in the repo) were removed together.
# skills-lock.json may return only with full lock<->symlink<->target parity
# and zero dangling targets - enforced below so the drift cannot recur.
SKILL_SYMLINK_RE = re.compile(r"^(claude/)?\.claude/skills/([^/]+)$")
PROJECT_SKILL_TARGET_FMT = "../../agents/.agents/skills/{key}"
STOWED_SKILL_TARGET_FMT = "../../../agents/.agents/skills/{key}"
REPO_SKILL_DIR_RE = re.compile(r"^agents/\.agents/skills/([^/]+)/SKILL\.md$")
SKILLPATH_RE = re.compile(r"^skills/.+/SKILL\.md$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def _repo_skill_dirs(tracked: set) -> list:
    return sorted(m.group(1) for t in tracked
                  if (m := REPO_SKILL_DIR_RE.match(t)))


def _check_skills_lock(root: Path, tracked: set, problems: list) -> int:
    """Full lockfile parity contract for a tracked skills-lock.json: schema,
    lock<->symlink parity, resolvable in-tree targets (no dangling), and no
    double-sourcing of repo-owned skill dirs. Returns the lock entry count."""
    rel = "skills-lock.json"
    path = root / rel
    try:
        lock = json.loads(read_text(path))
    except Exception as exc:  # noqa: BLE001
        problems.append(f"FAIL {rel}: does not parse as JSON: {exc}")
        return 0
    if lock.get("version") != 1:
        problems.append(f"FAIL {rel}: version is {lock.get('version')!r}; expected 1")
    skills = lock.get("skills")
    if not isinstance(skills, dict) or not skills:
        problems.append(f"FAIL {rel}: 'skills' is empty or not a mapping")
        return 0
    for key, entry in sorted(skills.items()):
        where = f"{rel}:{key}"
        if not isinstance(entry, dict):
            problems.append(f"FAIL {where}: entry is not a mapping")
            continue
        for field in ("source", "sourceType"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                problems.append(f"FAIL {where}: '{field}' is missing or empty")
        if not isinstance(entry.get("skillPath"), str) or not SKILLPATH_RE.match(entry["skillPath"] or ""):
            problems.append(f"FAIL {where}: skillPath {entry.get('skillPath')!r} "
                            f"does not match 'skills/.../SKILL.md'")
        if not isinstance(entry.get("computedHash"), str) or not SHA256_RE.match(entry["computedHash"] or ""):
            problems.append(f"FAIL {where}: computedHash {entry.get('computedHash')!r} "
                            f"is not a 64-char sha256 hex string")
    for key in sorted(skills):
        relsym = f".claude/skills/{key}"
        if relsym not in tracked:
            problems.append(f"FAIL {rel}:{key}: locked skill has no tracked "
                            f"symlink at {relsym}")
            continue
        link = root / relsym
        if not link.is_symlink():
            problems.append(f"FAIL {relsym}: expected a symlink, found a regular file")
            continue
        target = os.readlink(link)
        if target != PROJECT_SKILL_TARGET_FMT.format(key=key):
            problems.append(f"FAIL {relsym}: symlink target is {target!r}; expected "
                            f"{PROJECT_SKILL_TARGET_FMT.format(key=key)!r}")
        skill_rel = f"agents/.agents/skills/{key}/SKILL.md"
        if not (root / "agents" / ".agents" / "skills" / key).is_dir():
            problems.append(f"FAIL {relsym}: symlink dangles - target "
                            f"agents/.agents/skills/{key} does not exist in-tree "
                            f"(B22 class; a fresh CI checkout must resolve "
                            f"every locked skill)")
        elif skill_rel not in tracked:
            problems.append(f"FAIL {relsym}: target {skill_rel} exists but is "
                            f"not tracked; an untracked fetch-tool target "
                            f"dangles on every fresh checkout (B22 class)")
    return len(skills)


def check_skills_store(root: Path, tracked: set):
    problems = []

    # (a) skills-lock.json was removed with the dangling mattpocock
    # symlinks (B22). If it is ever tracked again it must satisfy the full
    # parity contract above; an untracked leftover on disk fails too.
    n_locked = 0
    rel = "skills-lock.json"
    if rel in tracked:
        n_locked = _check_skills_lock(root, tracked, problems)
    elif (root / rel).exists():
        problems.append(f"FAIL {rel}: present on disk but not tracked; track it "
                        f"(full parity required) or delete it")

    # (b) the symlink farm: every tracked symlink resolves to a tracked,
    # in-tree repo-owned skill dir. No dangling entries anywhere.
    farm = sorted(t for t in tracked if SKILL_SYMLINK_RE.match(t))
    for relsym in farm:
        key = SKILL_SYMLINK_RE.match(relsym).group(2)
        stowed = relsym.startswith("claude/")
        fmt = STOWED_SKILL_TARGET_FMT if stowed else PROJECT_SKILL_TARGET_FMT
        link = root / relsym
        if not link.is_symlink():
            problems.append(f"FAIL {relsym}: expected a symlink, found a regular "
                            f"file")
            continue
        target = os.readlink(link)
        if target != fmt.format(key=key):
            problems.append(f"FAIL {relsym}: symlink target is {target!r}; expected "
                            f"{fmt.format(key=key)!r}")
        skill_rel = f"agents/.agents/skills/{key}/SKILL.md"
        if not (root / "agents" / ".agents" / "skills" / key).is_dir():
            problems.append(f"FAIL {relsym}: symlink dangles - target "
                            f"agents/.agents/skills/{key} does not exist in-tree "
                            f"(B22 class)")
        elif skill_rel not in tracked:
            problems.append(f"FAIL {relsym}: target {skill_rel} is not tracked; the "
                            f"store under agents/.agents/skills/ is the one real "
                            f"location and must be git-tracked")

    # (c) repo-owned skills: every tracked skill dir keeps name==dirname.
    # (A returning lock means its skills are vendored into the tracked
    # store - lock<->symlink<->target parity in (a)/(b) is the net; the old
    # "double-sourced" rule applied to the removed external-fetch design.)
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
    lock_msg = (f"{n_locked} locked skills carry full lock<->symlink<->target "
                f"parity" if rel in tracked
                else "no skills-lock.json (removed with the dangling "
                     "mattpocock symlinks, B22)")
    return True, [
        f"{len(farm)} tracked skill symlink(s) across .claude/skills/ and "
        f"claude/.claude/skills/ all resolve to tracked in-tree skill dirs",
        lock_msg,
        f"{len(repo_skills)} tracked skill dirs keep name==dirname",
    ]


# --------------------------------------------------------------------------
# P2 — claude hook script resolution
# --------------------------------------------------------------------------

# Hook scripts that live under $HOME and are deliberately NOT tracked in
# this repo. This allowlist is the durable record of a known gap, not an
# endorsement; remove the entry in the same change that tracks the script
# under claude/ (or removes the hook). The last entry
# (.claude/hooks/herdr-agent-state.sh) was removed with the B22 fix: the
# script was untracked, absent at ~/.claude/hooks on every audited host,
# and referenced by nothing else, so the hook entry itself was deleted
# from claude/.claude/settings.json. The gh-axi and chrome-devtools-axi
# SessionStart hooks (bare PATH commands) were removed with the dead-code
# cleanup; the tracked settings now hold no hooks at all. Re-adding an
# external hook requires a new entry here in the same change.
EXTERNAL_HOOK_ALLOWLIST = {}


def hook_config_rels(tracked: set) -> list:
    rels = []
    for t in sorted(tracked):
        if not t.endswith(".json"):
            continue
        parts = t.split("/")
        if parts[-1].startswith("settings") and ".claude" in parts[:-1]:
            rels.append(t)
    return rels


def iter_hook_commands(cfg: dict):
    hooks = cfg.get("hooks")
    if not isinstance(hooks, dict):
        return
    for event, groups in hooks.items():
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, dict):
                continue
            for hook in group.get("hooks", []) or []:
                if isinstance(hook, dict) and hook.get("type") == "command" \
                        and isinstance(hook.get("command"), str):
                    yield event, hook["command"]


def split_command(command: str) -> list:
    try:
        return shlex.split(command)
    except ValueError:
        return command.split()


def check_claude_hooks(root: Path, tracked: set):
    rels = hook_config_rels(tracked)
    if not rels:
        return False, ["FAIL claude/**: no tracked .claude/settings*.json "
                       "config found"]
    problems = []
    used_external = set()
    n_hooks = 0
    for rel in rels:
        path = root / rel
        try:
            cfg = json.loads(read_text(path))
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: does not parse as JSON: {exc}")
            continue
        text = read_text(path)
        # Absolute home paths: the /Users/<user> (macOS) form is not covered
        # by any check in scripts/test-repo-config.py; the /home/<user> form
        # for claude/** configs IS covered there (check_claude_settings), so
        # it is scanned here only for configs that suite does not reach.
        if re.search(r"/Users/[A-Za-z0-9._-]+/", text):
            problems.append(f"FAIL {rel}: contains an absolute /Users/<user> "
                            f"path; use $HOME instead")
        if not rel.startswith("claude/") and re.search(r"/home/[A-Za-z0-9._-]+/", text):
            problems.append(f"FAIL {rel}: contains an absolute /home/<user> "
                            f"path; use $HOME instead")
        for event, command in iter_hook_commands(cfg):
            n_hooks += 1
            for tok in split_command(command):
                if "/" not in tok or tok.startswith("-"):
                    continue  # bare PATH commands stay host-side (known gap)
                if tok.startswith("$HOME/"):
                    rest = tok[len("$HOME/"):]
                    if (root / "claude" / rest).exists():
                        continue  # resolves to a tracked file in the claude stow package
                    if rest in EXTERNAL_HOOK_ALLOWLIST:
                        used_external.add(rest)
                        continue
                    problems.append(
                        f"FAIL {rel} [{event}]: hook command references "
                        f"$HOME/{rest}, which is neither tracked under "
                        f"claude/{rest} nor allowlisted as a documented "
                        f"external script (ses-A dangling-hook class)")
                elif tok.startswith("$"):
                    continue
                elif not (root / tok).exists():
                    problems.append(f"FAIL {rel} [{event}]: hook command "
                                    f"references {tok}, which does not exist "
                                    f"in the repo")
    for rest in sorted(set(EXTERNAL_HOOK_ALLOWLIST) - used_external):
        problems.append(f"FAIL EXTERNAL_HOOK_ALLOWLIST: '{rest}' is stale "
                        f"(no hook references it anymore): "
                        f"{EXTERNAL_HOOK_ALLOWLIST[rest]}")
    if problems:
        return False, problems
    return True, [
        f"all {n_hooks} hook commands across {len(rels)} tracked configs "
        f"resolve to tracked files or documented external scripts",
        f"{len(used_external)} external hook script(s) allowlisted with "
        f"reason; 0 absolute /Users/<user> paths",
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
    core = ["README.md", "CLAUDE.md", "AGENTS.md"]
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
    missing_core = [d for d in ("README.md", "CLAUDE.md", "AGENTS.md") if d not in tracked]
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
        if doc not in tracked and doc in ("README.md", "CLAUDE.md", "AGENTS.md"):
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

def _build_lock_sandbox(base: Path, tracked: set) -> Path:
    """A faithful passing baseline for the returning-lockfile contract: a
    synthetic skills-lock.json whose locked skills each have a tracked
    .claude/skills/<key> symlink AND a tracked, in-tree target dir under
    agents/.agents/skills/ (no dangling targets - the B22 rule), plus two
    repo-owned skill dirs the way agents/.agents/skills/ carries them."""
    root = base / "repo"
    root.mkdir(parents=True)
    lock_data = {
        "version": 1,
        "skills": {
            "ask-matt": {
                "source": "mattpocock/skills",
                "sourceType": "github",
                "skillPath": "skills/engineering/ask-matt/SKILL.md",
                "computedHash": "0f843160e34a24f5bd12cdc7de7d40951e77fbdc05ce8f891b37ca32eac2c44d",
            },
            "teach": {
                "source": "mattpocock/skills",
                "sourceType": "github",
                "skillPath": "skills/productivity/teach/SKILL.md",
                "computedHash": "68999bb1a241384b2f921f3321d771b7d05eb6089087b70d88cee2aee3d75ccc",
            },
        },
    }
    (root / "skills-lock.json").write_text(json.dumps(lock_data, indent=2))
    tracked.add("skills-lock.json")
    for key in lock_data["skills"]:
        sym = root / ".claude" / "skills" / key
        sym.parent.mkdir(parents=True, exist_ok=True)
        sym.symlink_to(f"../../agents/.agents/skills/{key}")
        tracked.add(f".claude/skills/{key}")
        # The locked skill's content must resolve in-tree (B22: a lock whose
        # targets exist nowhere is exactly the removed drift).
        skill_dir = root / "agents" / ".agents" / "skills" / key
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(
            f"---\nname: {key}\ndescription: fetched skill\n---\nbody\n")
        tracked.add(f"agents/.agents/skills/{key}/SKILL.md")
    for name in ("humanify", "nvim"):
        skill_dir = root / "agents" / ".agents" / "skills" / name
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: test skill\n---\nbody\n")
        tracked.add(f"agents/.agents/skills/{name}/SKILL.md")
    return root


def _write_lock(root: Path, data: dict) -> None:
    (root / "skills-lock.json").write_text(json.dumps(data, indent=2))


def _negative_lock_cases():
    def missing_symlink(root, tracked):
        # A lock entry whose tracked .claude/skills symlink is gone.
        key = sorted(json.loads(read_text(root / "skills-lock.json"))["skills"])[0]
        (root / ".claude" / "skills" / key).unlink()
        tracked.discard(f".claude/skills/{key}")

    def dangling_target(root, tracked):
        # The B22 class: the lock keeps its symlink, but the target dir
        # exists nowhere in-tree.
        key = sorted(json.loads(read_text(root / "skills-lock.json"))["skills"])[0]
        skill_md = root / "agents" / ".agents" / "skills" / key / "SKILL.md"
        skill_md.unlink()
        tracked.discard(f"agents/.agents/skills/{key}/SKILL.md")
        skill_md.parent.rmdir()

    def bad_hash(root, tracked):
        data = json.loads(read_text(root / "skills-lock.json"))
        key = sorted(data["skills"])[0]
        data["skills"][key]["computedHash"] = "abc123"
        _write_lock(root, data)

    def untracked_leftover(root, tracked):
        # skills-lock.json on disk but not in the tracked set.
        tracked.discard("skills-lock.json")

    def wrong_target(root, tracked):
        key = sorted(json.loads(read_text(root / "skills-lock.json"))["skills"])[0]
        sym = root / ".claude" / "skills" / key
        sym.unlink()
        sym.symlink_to("../../agents/.agents/skills/somewhere-else")

    def farm_dangle(root, tracked):
        # A tracked stowed symlink whose target dir never existed.
        sym = root / "claude" / ".claude" / "skills" / "ghost"
        sym.parent.mkdir(parents=True, exist_ok=True)
        sym.symlink_to("../../../agents/.agents/skills/ghost")
        tracked.add("claude/.claude/skills/ghost")

    def name_mismatch(root, tracked):
        p = root / "agents" / ".agents" / "skills" / "humanify" / "SKILL.md"
        p.write_text(p.read_text().replace("name: humanify", "name: wrong-name"))

    def untracked_fetched_target(root, tracked):
        # The old external-fetch pattern: the target dir exists on disk but
        # is not tracked - it dangles on every fresh CI checkout.
        key = sorted(json.loads(read_text(root / "skills-lock.json"))["skills"])[0]
        tracked.discard(f"agents/.agents/skills/{key}/SKILL.md")

    return [("lock: locked skill without symlink", missing_symlink,
             "no tracked symlink"),
            ("lock: dangling symlink target", dangling_target, "dangles"),
            ("lock: untracked fetched target", untracked_fetched_target,
             "not tracked"),
            ("lock: malformed hash", bad_hash, "computedHash"),
            ("lock: untracked leftover on disk", untracked_leftover,
             "not tracked"),
            ("lock: wrong symlink target", wrong_target, "symlink target is"),
            ("farm: dangling stowed symlink", farm_dangle, "dangles"),
            ("skills: frontmatter name mismatch", name_mismatch,
             "frontmatter name is")]


def _build_hooks_sandbox(base: Path) -> Path:
    """A copy of the real tracked claude settings, as a passing baseline."""
    root = base / "repo"
    rel = "claude/.claude/settings.json"
    (root / "claude" / ".claude").mkdir(parents=True)
    (root / rel).write_text(read_text(REPO / rel))
    return root


def _rewrite_hooks(root: Path, mutate) -> None:
    rel = root / "claude" / ".claude" / "settings.json"
    cfg = json.loads(read_text(rel))
    mutate(cfg)
    rel.write_text(json.dumps(cfg, indent=2))


def _negative_hooks_cases():
    def dangling_hook(root):
        def go(cfg):
            cfg.setdefault("hooks", {}).setdefault("SessionStart", []).append({
                "matcher": "*",
                "hooks": [{"type": "command",
                           "command": 'bash "$HOME/.claude/hooks/ghost.sh" session',
                           "timeout": 10}],
            })
        _rewrite_hooks(root, go)

    def mac_absolute_home(root):
        def go(cfg):
            cfg.setdefault("hooks", {}).setdefault("SessionStart", []).append({
                "matcher": "*",
                "hooks": [{"type": "command",
                           "command": "bash /Users/joe/bin/hook.sh",
                           "timeout": 10}],
            })
        _rewrite_hooks(root, go)

    def stale_allowlist(root):
        # An EXTERNAL_HOOK_ALLOWLIST entry no hook references anymore. The
        # real allowlist is empty since the B22 fix, so the mutation injects
        # a phantom entry into the module global; the runner restores it.
        EXTERNAL_HOOK_ALLOWLIST[".claude/hooks/never-referenced.sh"] = \
            "phantom entry for the negative sandbox"

    return [("hooks: dangling hook script", dangling_hook, "neither tracked"),
            ("hooks: /Users/<user> absolute path", mac_absolute_home,
             "/Users/<user>"),
            ("hooks: stale external allowlist", stale_allowlist, "stale")]


def _build_docs_sandbox(base: Path) -> tuple:
    root = base / "repo"
    root.mkdir(parents=True)
    readme = read_text(REPO / "README.md")
    (root / "README.md").write_text(readme)
    tracked = {"README.md", "CLAUDE.md", "AGENTS.md"}
    (root / "CLAUDE.md").write_text("# stub\n")
    (root / "AGENTS.md").write_text("# stub\n")
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
    (root / "docs" / "pi-live-config.md").write_text(
        "Pi docs: see `docs/cli.md`, `docs/configuration.md`, "
        "`docs/settings.md` from the installed package.\n")
    tracked.add("docs/pi-live-config.md")
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
        for label, mutate, want in _negative_lock_cases():
            tracked = set()
            root = _build_lock_sandbox(
                base / label.replace(" ", "_").replace(":", ""), tracked)
            err = baseline_ok(check_skills_store, root, tracked)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
                continue
            mutate(root, tracked)
            err = run_and_expect(check_skills_store, root, tracked, want)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
        saved_allowlist = dict(EXTERNAL_HOOK_ALLOWLIST)
        for label, mutate, want in _negative_hooks_cases():
            root = _build_hooks_sandbox(base / label.replace(" ", "_").replace(":", ""))
            hooks_tracked = {"claude/.claude/settings.json"}
            err = baseline_ok(check_claude_hooks, root, hooks_tracked)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
                continue
            mutate(root)
            err = run_and_expect(check_claude_hooks, root, hooks_tracked,
                                 want)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
            EXTERNAL_HOOK_ALLOWLIST.clear()
            EXTERNAL_HOOK_ALLOWLIST.update(saved_allowlist)
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
    return True, ["all 16 sandbox mutations were caught by the matching check "
                  "(8 skills-store, 3 hooks, 5 docs)"]


def _negative_docs_cases():
    def claim_bad_count(root):
        p = root / "README.md"
        p.write_text(p.read_text() + "\nThis repo ships 15 stow packages.\n")

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
        p = root / "CLAUDE.md"
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
    ("P2 claude hooks resolve", check_claude_hooks),
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

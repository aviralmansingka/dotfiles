#!/usr/bin/env python3
# Paths: skills-lock.json claude/** agents/** docs/** README.md CLAUDE.md AGENTS.md pi/bin/notion-cli
"""repo-parity regression suite — lockfiles, hook references, notion-cli, docs-vs-reality.

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

  P1 skills-lock.json parity      lock <-> tracked .claude/skills symlinks
                                  <-> tracked repo-owned skill dirs
  P2 claude hook resolution       every hook script path is tracked,
                                  allowlisted-external, or fails (ses-A
                                  dangling-hook class); no /Users/<user>
                                  absolute home paths
  P3 notion-cli behavior          offline CLI matrix: help, argparse errors,
                                  missing token, bad ids, bad --body, and
                                  a stubbed-dead-network boundary
  P4 docs accuracy lint           mechanical docs-vs-reality: stow table
                                  parity, stow-package count claims,
                                  `stow <pkg>` mentions, repo-anchored path
                                  references, markdown link targets
  P5 negative sandbox self-test   sandbox copies prove each P1/P2/P4 check
                                  catches its regression class

P3's error-path subtests are themselves the negative tests for the
notion-cli regressions they pin (clean SystemExit, never a traceback).
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
# P1 — skills-lock.json parity
# --------------------------------------------------------------------------

LOCKED_SKILL_SYMLINK_DIR = ".claude/skills"
LOCKED_SKILL_TARGET_FMT = "../../agents/.agents/skills/{key}"
REPO_SKILL_DIR_RE = re.compile(r"^agents/\.agents/skills/([^/]+)/SKILL\.md$")
SKILLPATH_RE = re.compile(r"^skills/.+/SKILL\.md$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def check_skills_lock(root: Path, tracked: set):
    rel = "skills-lock.json"
    if rel not in tracked:
        return False, [f"FAIL {rel}: not tracked by git"]
    path = root / rel
    try:
        lock = json.loads(read_text(path))
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel}: does not parse as JSON: {exc}"]
    problems = []
    if lock.get("version") != 1:
        problems.append(f"FAIL {rel}: version is {lock.get('version')!r}; expected 1")
    skills = lock.get("skills")
    if not isinstance(skills, dict) or not skills:
        return False, problems + [f"FAIL {rel}: 'skills' is empty or not a mapping"]

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

    # Locked skills are exposed to Claude Code through tracked symlinks
    # .claude/skills/<key> -> ../../agents/.agents/skills/<key>. The target
    # directory itself is fetched by the lockfile's external tool
    # (sourceType: github) and is intentionally NOT tracked; presence of the
    # fetched content is host-side and stays a known gap.
    symlinks = {t for t in tracked if t.startswith(LOCKED_SKILL_SYMLINK_DIR + "/")}
    for relsym in sorted(symlinks):
        key = relsym.split("/", 2)[2]
        if key not in skills:
            problems.append(f"FAIL {relsym}: tracked skill symlink is not locked "
                            f"in {rel} (lock/symlink parity)")
    for key in sorted(skills):
        relsym = f"{LOCKED_SKILL_SYMLINK_DIR}/{key}"
        if relsym not in symlinks:
            problems.append(f"FAIL {rel}:{key}: locked skill has no tracked "
                            f"symlink at {relsym}")
            continue
        link = root / relsym
        if not link.is_symlink():
            problems.append(f"FAIL {relsym}: expected a symlink, found a regular file")
            continue
        target = os.readlink(link)
        if target != LOCKED_SKILL_TARGET_FMT.format(key=key):
            problems.append(f"FAIL {relsym}: symlink target is {target!r}; expected "
                            f"{LOCKED_SKILL_TARGET_FMT.format(key=key)!r}")

    # Repo-owned skills under agents/.agents/skills/ are deployed by stow
    # (package 'agents'), not by the external fetch: none may appear in the
    # lock (a dir in both places is double-sourced), and each SKILL.md
    # frontmatter name must equal its directory name.
    repo_skills = sorted(m.group(1) for t in tracked
                         if (m := REPO_SKILL_DIR_RE.match(t)))
    if not repo_skills:
        problems.append("FAIL agents/.agents/skills/: no tracked repo-owned "
                        "skill dirs found")
    for name in repo_skills:
        if name in skills:
            problems.append(f"FAIL agents/.agents/skills/{name}: repo-owned skill "
                            f"is also locked in {rel} (double-sourced)")
        fm_name = frontmatter_name(root / "agents" / ".agents" / "skills" / name / "SKILL.md")
        if fm_name != name:
            problems.append(f"FAIL agents/.agents/skills/{name}/SKILL.md: frontmatter "
                            f"name is {fm_name!r}; must equal the directory name")

    if problems:
        return False, problems
    return True, [
        f"{len(skills)} locked skills parse clean and match the "
        f"{len(symlinks)} tracked {LOCKED_SKILL_SYMLINK_DIR}/ symlinks "
        f"(target pattern {LOCKED_SKILL_SYMLINK_DIR}/<key> -> "
        f"../../agents/.agents/skills/<key>)",
        f"{len(repo_skills)} repo-owned skill dirs have name==dirname and are "
        f"not double-sourced by the lock",
    ]


# --------------------------------------------------------------------------
# P2 — claude hook script resolution
# --------------------------------------------------------------------------

# Hook scripts that live under $HOME and are deliberately NOT tracked in
# this repo. This allowlist is the durable record of a known gap, not an
# endorsement; remove the entry in the same change that tracks the script
# under claude/ (or removes the hook).
EXTERNAL_HOOK_ALLOWLIST = {
    ".claude/hooks/herdr-agent-state.sh":
        "not tracked in the repo and absent at ~/.claude/hooks on the "
        "audited host (ses-A dangling-hook finding); captain decision "
        "pending: track the script under claude/ or remove the hook",
}


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
# P3 — notion-cli offline behavior matrix
# --------------------------------------------------------------------------

def check_notion_cli(root: Path, _tracked: set):
    cli = root / "pi" / "bin" / "notion-cli"
    if not cli.exists():
        return False, ["FAIL pi/bin/notion-cli: file not found"]
    # A fresh empty config dir keeps the CLI off $HOME; NOTION_TOKEN is
    # never inherited. The dead local proxy port stubs the network at the
    # boundary: urllib fails immediately with connection refused and no
    # real API call is attempted.
    dead_proxy = "http://127.0.0.1:9"
    subtests = [
        ("help", ["--help"], {}, lambda r: r.returncode == 0
            and "search" in r.stdout and "create-page" in r.stdout),
        ("no-subcommand", [], {}, lambda r: r.returncode != 0),
        ("unknown-subcommand", ["frobnicate"], {},
         lambda r: r.returncode != 0 and "invalid choice" in r.stderr.lower()),
        ("missing-token", ["search"], {},
         lambda r: r.returncode != 0 and "Missing NOTION_TOKEN" in r.stderr
            and "Traceback" not in r.stderr + r.stdout),
        ("url-id-parses-pre-network",
         ["get-page", "https://www.notion.so/Foo-12345678-90ab-cdef-1234-567890abcdef"], {},
         lambda r: "Missing NOTION_TOKEN" in r.stderr
            and "Not a Notion id" not in r.stderr),
        ("plain-id-parses-pre-network",
         ["get-page", "1234567890abcdef1234567890abcdef"], {},
         lambda r: "Missing NOTION_TOKEN" in r.stderr
            and "Not a Notion id" not in r.stderr),
        ("bad-id", ["get-page", "notanid"], {"NOTION_TOKEN": "stub-token"},
         lambda r: r.returncode != 0 and "Not a Notion id or URL" in r.stderr
            and "Traceback" not in r.stderr + r.stdout),
        ("bad-id-url", ["get-page", "http://example.com/no-id"],
         {"NOTION_TOKEN": "stub-token"},
         lambda r: r.returncode != 0 and "Not a Notion id or URL" in r.stderr),
        ("bad-body-json",
         ["query-db", "1234567890abcdef1234567890abcdef", "--body", "{bad"],
         {"NOTION_TOKEN": "stub-token"},
         lambda r: r.returncode != 0 and "Invalid --body JSON" in r.stderr
            and "Traceback" not in r.stderr + r.stdout),
        ("offline-network-error", ["search", "query"],
         {"NOTION_TOKEN": "stub-token", "https_proxy": dead_proxy,
          "HTTPS_PROXY": dead_proxy},
         lambda r: r.returncode != 0 and "Notion network error" in r.stderr
            and "Traceback" not in r.stderr + r.stdout),
    ]
    failures = []
    with tempfile.TemporaryDirectory(prefix="repo-parity-notion-") as tmp:
        base_env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                    "NOTION_CLI_CONFIG_DIR": tmp}
        for label, argv, extra, ok in subtests:
            env = dict(base_env)
            env.update(extra)
            try:
                r = subprocess.run(
                    [sys.executable, str(cli), *argv],
                    capture_output=True, text=True, timeout=CHECK_TIMEOUT,
                    env=env,
                )
            except subprocess.TimeoutExpired:
                failures.append(f"FAIL pi/bin/notion-cli [{label}]: timed out")
                continue
            if not ok(r):
                failures.append(
                    f"FAIL pi/bin/notion-cli [{label}]: rc={r.returncode} "
                    f"stdout={r.stdout[:120]!r} stderr={r.stderr[:160]!r}")
    if failures:
        return False, failures
    return True, [f"all {len(subtests)} offline subtests passed (help, "
                  f"argparse errors, token/id/body error paths, dead-proxy "
                  f"network boundary; no tracebacks, no real API calls)"]


# --------------------------------------------------------------------------
# P4 — docs accuracy lint (grep-level, current truth)
# --------------------------------------------------------------------------

# Top-level dirs that are repo infrastructure, not stow packages. The README
# "Stow Packages" table must list every other top-level dir, and nothing
# else. Remove an entry here in the same change that makes it a package.
NON_PACKAGE_DIRS = {
    "artifacts": "build/release artifacts, not a dotfiles package",
    "docs": "documentation tree, not a stow package",
    "ops": "ops tooling (terraform/packer/stt), not a stow package",
    "scripts": "repo scripts and test suites, not a stow package",
    "testdata": "test fixtures, not a stow package",
}

# Backticked repo-anchored references that intentionally point outside this
# tree. doc -> {ref: reason}. Remove an entry when the doc stops referencing
# it (stale entries fail).
UPSTREAM_DOC_REFS = {
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
# or fixes the doc.
DOC_STOW_MENTION_ALLOWLIST = {
    ("docs/OSC52.md", "ssh"):
        "doc tells the user to 'stow ssh' but no ssh package exists in the "
        "tree (never did); captain decision pending: fix the doc or add the "
        "package",
    ("docs/OSC52-QUICKSTART.md", "ssh"):
        "same OSC52 drift as docs/OSC52.md; captain decision pending",
}
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
    """A faithful passing baseline: the real skills-lock.json, real symlink
    layout (.claude/skills/<key> -> ../../agents/.agents/skills/<key>, with
    the fetched content dirs deliberately untracked), plus two repo-owned
    skill dirs the way agents/.agents/skills/ actually carries them."""
    root = base / "repo"
    root.mkdir(parents=True)
    lock_data = json.loads(read_text(REPO / "skills-lock.json"))
    (root / "skills-lock.json").write_text(json.dumps(lock_data, indent=2))
    tracked.add("skills-lock.json")
    for key in lock_data["skills"]:
        sym = root / ".claude" / "skills" / key
        sym.parent.mkdir(parents=True, exist_ok=True)
        sym.symlink_to(f"../../agents/.agents/skills/{key}")
        tracked.add(f".claude/skills/{key}")
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
    def orphan_symlink(root, tracked):
        data = json.loads(read_text(root / "skills-lock.json"))
        key = sorted(data["skills"])[0]
        del data["skills"][key]
        _write_lock(root, data)

    def wrong_target(root, tracked):
        key = sorted(json.loads(read_text(root / "skills-lock.json"))["skills"])[0]
        sym = root / ".claude" / "skills" / key
        sym.unlink()
        sym.symlink_to("../../agents/.agents/skills/somewhere-else")

    def bad_hash(root, tracked):
        data = json.loads(read_text(root / "skills-lock.json"))
        key = sorted(data["skills"])[0]
        data["skills"][key]["computedHash"] = "abc123"
        _write_lock(root, data)

    def name_mismatch(root, tracked):
        p = root / "agents" / ".agents" / "skills" / "humanify" / "SKILL.md"
        p.write_text(p.read_text().replace("name: humanify", "name: wrong-name"))

    def double_source(root, tracked):
        data = json.loads(read_text(root / "skills-lock.json"))
        key = sorted(data["skills"])[0]
        data["skills"]["humanify"] = dict(data["skills"][key])
        _write_lock(root, data)
        skill_dir = root / "agents" / ".agents" / "skills" / "humanify"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: humanify\ndescription: test\n---\nbody\n")
        tracked.add("agents/.agents/skills/humanify/SKILL.md")
        sym = root / ".claude" / "skills" / "humanify"
        sym.symlink_to("../../agents/.agents/skills/humanify")
        tracked.add(".claude/skills/humanify")

    return [("lock: orphaned symlink", orphan_symlink, "is not locked"),
            ("lock: wrong symlink target", wrong_target, "symlink target is"),
            ("lock: malformed hash", bad_hash, "computedHash"),
            ("lock: frontmatter name mismatch", name_mismatch,
             "frontmatter name is"),
            ("lock: repo dir also locked", double_source, "double-sourced")]


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
            cfg["hooks"]["SessionStart"].append({
                "matcher": "*",
                "hooks": [{"type": "command",
                           "command": 'bash "$HOME/.claude/hooks/ghost.sh" session',
                           "timeout": 10}],
            })
        _rewrite_hooks(root, go)

    def mac_absolute_home(root):
        def go(cfg):
            cfg["hooks"]["SessionStart"].append({
                "matcher": "*",
                "hooks": [{"type": "command",
                           "command": "bash /Users/joe/bin/hook.sh",
                           "timeout": 10}],
            })
        _rewrite_hooks(root, go)

    def stale_allowlist(root):
        def go(cfg):
            cfg["hooks"]["SessionStart"] = [
                g for g in cfg["hooks"]["SessionStart"]
                if "herdr-agent-state" not in json.dumps(g)]
        _rewrite_hooks(root, go)

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
            err = baseline_ok(check_skills_lock, root, tracked)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
                continue
            mutate(root, tracked)
            err = run_and_expect(check_skills_lock, root, tracked, want)
            if err:
                failures.append(f"FAIL negative [{label}]: {err}")
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
    return True, ["all 13 sandbox mutations were caught by the matching check "
                  "(5 lock, 3 hooks, 5 docs); notion-cli regressions are pinned "
                  "by the P3 error-path subtests (bad-id, bad-body, "
                  "offline-network)"]


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
    ("P1 skills-lock parity", check_skills_lock),
    ("P2 claude hooks resolve", check_claude_hooks),
    ("P3 notion-cli behavior", check_notion_cli),
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

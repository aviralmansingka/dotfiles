#!/usr/bin/env python3
# Paths: agents/.agents/skills/** pi/.pi/agent/settings.json claude/** herdr/.config/herdr/config.toml gh-dash/** nvim/.markdownlint-cli2.yaml install.sh Brewfile dependencies.json
"""repo-config regression suite — CI surfaces X7, X8, X8b, X12, X13.

Offline and deterministic: no network, no $HOME mutation, no sleeps.
Each check prints PASS or FAIL with the file and the reason, and the
per-check and total run times. The script exits non-zero when any check
fails. See docs/ci-tests/repo-config.md for scope and known gaps.

YAML parsing uses the best parser available (no pip installs):
  1. PyYAML when importable;
  2. `ruby -ryaml` (ruby is preinstalled on GitHub ubuntu runners and is
     what the wired scripts/test-gh-dash-open-pr.sh already relies on);
  3. for SKILL.md frontmatter only, a vendored minimal parser that fails
     loudly on any syntax it does not model (including the unquoted-colon
     form that made the nvimr skill invisible, #203).
"""

import json
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# --------------------------------------------------------------------------
# YAML loading
# --------------------------------------------------------------------------

try:
    import yaml as _pyyaml  # noqa: N813
except ImportError:
    _pyyaml = None


def yaml_load_file(path: Path):
    """Parse a YAML file with a real parser (PyYAML or ruby)."""
    text = path.read_text()
    if _pyyaml is not None:
        return _pyyaml.safe_load(text)
    if shutil.which("ruby"):
        out = subprocess.run(
            ["ruby", "-ryaml", "-rjson", "-e",
             "print YAML.safe_load(File.read(ARGV.fetch(0))).to_json",
             str(path)],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            raise ValueError(out.stderr.strip() or "ruby YAML parse failed")
        return json.loads(out.stdout)
    raise RuntimeError(
        "no YAML parser available: install ruby (runners ship it) or PyYAML; "
        "this suite never pip-installs")


def frontmatter_load(text: str, path: Path):
    """Parse SKILL.md frontmatter. Falls back to the vendored minimal
    parser only when no real YAML parser exists."""
    if _pyyaml is not None:
        return _pyyaml.safe_load(text)
    if shutil.which("ruby"):
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as tf:
            tf.write(text)
            tmp = tf.name
        try:
            out = subprocess.run(
                ["ruby", "-ryaml", "-rjson", "-e",
                 "print YAML.safe_load(File.read(ARGV.fetch(0))).to_json", tmp],
                capture_output=True, text=True, timeout=30,
            )
            if out.returncode != 0:
                raise ValueError(out.stderr.strip() or "ruby YAML parse failed")
            return json.loads(out.stdout)
        finally:
            Path(tmp).unlink(missing_ok=True)
    return frontmatter_minimal(text, path)


def frontmatter_minimal(text: str, path: Path):
    """Vendored YAML-subset parser for SKILL.md frontmatter.

    Models only `key: value`, double-quoted values, and the block scalars
    `>`, `>-`, `|`, `|-`. Any other construct raises, so an exotic
    frontmatter fails loudly instead of parsing to a wrong shape.
    """
    result = {}
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not m:
            raise ValueError(f"unsupported frontmatter syntax: {line!r}")
        key, val = m.group(1), m.group(2).strip()
        if val in (">", ">-", "|", "|-"):
            block = []
            i += 1
            while i < len(lines) and (lines[i].startswith("  ") or lines[i] == ""):
                block.append(lines[i].strip())
                i += 1
            folded = " ".join(" ".join(block).split())
            result[key] = folded if ">" in val else "\n".join(block).strip()
            continue
        if val.startswith('"') and val.endswith('"') and len(val) >= 2:
            result[key] = val[1:-1]
        else:
            if val and val[0] in "[{&*!%@":
                raise ValueError(
                    f"unsupported frontmatter value for '{key}' "
                    f"(container/anchor syntax): {line!r}")
            if ": " in val:
                raise ValueError(
                    f"unquoted colon in value of '{key}' (the #203 class that "
                    f"hid the nvimr skill): {line!r}")
            if val == "":
                raise ValueError(f"empty value for '{key}'")
            result[key] = val
        i += 1
    return result


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def git_files(*pathspecs):
    out = subprocess.run(
        ["git", "-C", str(REPO), "ls-files", "--", *pathspecs],
        capture_output=True, text=True, timeout=30, check=True,
    )
    return [line for line in out.stdout.split("\n") if line]


def brewfile_entries():
    brews, casks = set(), set()
    for line in (REPO / "Brewfile").read_text().splitlines():
        m = re.match(r'^\s*brew "([^"]+)"', line)
        if m:
            brews.add(m.group(1))
        m = re.match(r'^\s*cask "([^"]+)"', line)
        if m:
            casks.add(m.group(1))
    return brews, casks


# --------------------------------------------------------------------------
# X7 — SKILL.md frontmatter
# --------------------------------------------------------------------------

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)


def check_skill_frontmatter():
    files = [f for f in git_files("agents/.agents/skills")
             if f.endswith("/SKILL.md")]
    if not files:
        return False, ["no tracked SKILL.md files found under agents/.agents/skills"]
    problems = []
    for rel in files:
        path = REPO / rel
        m = FRONTMATTER_RE.match(path.read_text())
        if not m:
            problems.append(f"FAIL {rel}: no '---' delimited frontmatter block")
            continue
        try:
            fm = frontmatter_load(m.group(1), path)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: frontmatter does not parse as YAML: {exc}")
            continue
        if not isinstance(fm, dict):
            problems.append(f"FAIL {rel}: frontmatter is not a mapping")
            continue
        for field in ("name", "description"):
            value = fm.get(field)
            if not isinstance(value, str) or not value.strip():
                problems.append(
                    f"FAIL {rel}: frontmatter '{field}' is missing or empty; "
                    f"the skill is invisible to agents (#203)")
    if problems:
        return False, problems
    return True, [f"all {len(files)} tracked SKILL.md frontmatters parse "
                  f"with non-empty name and description"]


# --------------------------------------------------------------------------
# X8 — install.sh <-> stow consistency
# --------------------------------------------------------------------------

# Top-level dirs that are stow-shaped (tracked root-level dot entries) but
# have no `stow` line in install.sh. This allowlist is the durable record of
# a known gap, not an endorsement:
#   claude/     documented-manual deployment (docs/superpowers/plans/
#               2026-05-09-bug-report-skill.md stows it by hand); README and
#               CLAUDE.md disagree about the package list; captain decision
#               pending (stow it, keep it manual, or delete it).
# Remove an entry from this set in the same change that adds its stow line
# (or deletes the package). The former kube/, tmuxinator/, and neovide/
# entries were removed together with their packages in the dead-code cleanup.
STOW_GAP_ALLOWLIST = {
    "claude": "documented-manual deployment; README/CLAUDE.md disagree; decision pending",
}

STOW_OPTS_WITH_ARG = {"-d", "-t", "--dir", "--target"}


def parse_stow_lines(install_text):
    """Return [(lineno, package, guard_stack)] for every stow invocation."""
    lines = install_text.split("\n")
    guards = []          # stack of (label, active)
    stows = []
    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if re.match(r"^if\s+!?\s*command -v (\S+)", stripped):
            name = re.match(r"^if\s+!?\s*command -v (\S+)", stripped).group(1)
            guards.append([f"cmd:{name}", True])
        elif re.match(r'^if\s*\[\[\s*"\$\(uname -s\)"\s*==\s*"Darwin"', stripped):
            guards.append(["darwin", True])
        elif stripped.startswith("if "):
            guards.append(["other", True])
        elif stripped == "else" or stripped.startswith("elif "):
            if guards:
                guards[-1][1] = False
        elif stripped == "fi":
            if guards:
                guards.pop()
        if re.match(r"^\s*stow\b", line):
            tokens = shlex.split(line)
            packages = []
            skip_next = False
            for tok in tokens[1:]:
                if skip_next:
                    skip_next = False
                    continue
                if tok in STOW_OPTS_WITH_ARG:
                    skip_next = True
                elif tok.startswith("-"):
                    continue
                else:
                    packages.append(tok)
            active = [label for label, on in guards if on]
            for pkg in packages:
                stows.append((idx, pkg, active))
    return stows, lines


def stow_shaped_top_dirs():
    """Top-level dirs with at least one tracked root-level dot entry."""
    shaped = set()
    for f in git_files():
        parts = f.split("/")
        if len(parts) >= 2 and parts[1].startswith("."):
            shaped.add(parts[0])
    return shaped


def check_install_stow():
    install_path = REPO / "install.sh"
    text = install_path.read_text()
    problems = []

    stows, _lines = parse_stow_lines(text)
    if not stows:
        return False, ["install.sh contains no stow invocations"]
    stowed = {pkg for _ln, pkg, _g in stows}

    # Direction 1: every stow line references an existing top-level dir.
    for lineno, pkg, _guard in stows:
        if not (REPO / pkg).is_dir():
            problems.append(
                f"FAIL install.sh:{lineno}: stow package '{pkg}' has no "
                f"top-level directory in the repo (#197)")

    # Direction 2: every stow-shaped dir is stowed or explicitly allowlisted.
    shaped = stow_shaped_top_dirs()
    for pkg in sorted(shaped - stowed - set(STOW_GAP_ALLOWLIST)):
        problems.append(
            f"FAIL {pkg}/: stow-shaped top-level dir with no install.sh stow "
            f"line and no allowlist entry in scripts/test-repo-config.py "
            f"(#197/#201). Add the stow line, or record the decision in "
            f"STOW_GAP_ALLOWLIST.")
    # Allowlist hygiene: entries must still be real, unstowed gaps.
    for pkg in sorted(set(STOW_GAP_ALLOWLIST) - shaped):
        problems.append(
            f"FAIL STOW_GAP_ALLOWLIST: '{pkg}' is not stow-shaped anymore; "
            f"remove the stale entry")
    for pkg in sorted(set(STOW_GAP_ALLOWLIST) & stowed):
        problems.append(
            f"FAIL STOW_GAP_ALLOWLIST: '{pkg}' is now stowed by install.sh; "
            f"remove the entry in the same change")

    # No stale rm -f of binaries nothing installs (#117 Atlas residue).
    for idx, line in enumerate(text.split("\n"), start=1):
        if re.search(r"rm\s+-\w*f", line) and (
                ".local/bin" in line or ".agents/skills" in line):
            problems.append(
                f"FAIL install.sh:{idx}: rm -f targets a binary or skill path "
                f"nothing installs anymore (#117 residue): {line.strip()}")

    # Optional steps stay command-guarded and idempotent (#199).
    for lineno, pkg, guard in stows:
        if pkg == "systemd" and "cmd:systemctl" not in guard:
            problems.append(f"FAIL install.sh:{lineno}: stow systemd must stay "
                            f"behind a `command -v systemctl` guard (#199)")
        if pkg == "launchd" and "darwin" not in guard:
            problems.append(f"FAIL install.sh:{lineno}: stow launchd must stay "
                            f"behind the Darwin guard (#199)")
    for idx, line in enumerate(text.split("\n"), start=1):
        if "gh extension install" in line:
            if "cmd:gh" not in guard_for_line(text, idx):
                problems.append(f"FAIL install.sh:{idx}: gh extension install "
                                f"must stay behind a `command -v gh` guard (#199)")
            if "|| true" not in line:
                problems.append(f"FAIL install.sh:{idx}: gh extension install "
                                f"must keep `|| true` (idempotent, #199)")
        if "herdr integration install codex" in line:
            if "cmd:codex" not in guard_for_line(text, idx):
                problems.append(f"FAIL install.sh:{idx}: herdr integration "
                                f"install codex must stay behind a "
                                f"`command -v codex` guard (#199)")

    if problems:
        return False, problems
    return True, [
        f"{len(stowed)} stow lines all reference existing top-level dirs",
        f"{len(shaped)} stow-shaped dirs are stowed or allowlisted "
        f"({len(STOW_GAP_ALLOWLIST)} known-gap entries)",
        "no stale rm -f of uninstalled binaries; optional steps stay guarded",
    ]


def guard_for_line(text, target_lineno):
    """Active if-guards at a given 1-based line (flat if/fi blocks)."""
    guards = []
    for idx, line in enumerate(text.split("\n"), start=1):
        stripped = line.strip()
        if idx == target_lineno:
            return [label for label, on in guards if on]
        if re.match(r"^if\s+!?\s*command -v (\S+)", stripped):
            guards.append([f"cmd:{re.match(r'^if\s+!?\s*command -v (\S+)', stripped).group(1)}", True])
        elif re.match(r'^if\s*\[\[\s*"\$\(uname -s\)"\s*==\s*"Darwin"', stripped):
            guards.append(["darwin", True])
        elif stripped.startswith("if "):
            guards.append(["other", True])
        elif stripped == "else" or stripped.startswith("elif "):
            if guards:
                guards[-1][1] = False
        elif stripped == "fi":
            if guards:
                guards.pop()
    return []


# --------------------------------------------------------------------------
# X8b — gh-dash config consumer shape
# --------------------------------------------------------------------------

# Template fields gh-dash provides to keybinding commands (vendored from
# the gh-dash configuration docs).
GHDASH_TEMPLATE_FIELDS = {"RepoOwner", "RepoName", "PrNumber", "RepoPath"}


def check_ghdash_config():
    rel = "gh-dash/.config/gh-dash/config.yml"
    path = REPO / rel
    problems = []
    try:
        cfg = yaml_load_file(path)
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel}: does not parse as YAML: {exc}"]
    if not isinstance(cfg, dict):
        return False, [f"FAIL {rel}: top level is not a mapping"]

    bindings = cfg.get("keybindings")
    if not isinstance(bindings, dict) or not bindings:
        return False, [f"FAIL {rel}: keybindings section is missing or empty"]
    if "universal" in bindings:
        problems.append(
            f"FAIL {rel}: a universal-scope keybinding crashes gh-dash when "
            f"its command uses PrNumber (missingkey, #199); keep bindings in "
            f"the prs scope")
    if "prs" not in bindings:
        problems.append(f"FAIL {rel}: no prs-scope keybindings found")

    brews, _casks = brewfile_entries()
    shell_builtins = {"cd", "sh", "bash"}
    for scope, items in bindings.items():
        keys = [item.get("key") for item in items]
        if len(keys) != len(set(keys)):
            problems.append(f"FAIL {rel}: duplicate keys in '{scope}' scope")
        for item in items:
            key = item.get("key")
            if not isinstance(key, str) or not key.strip():
                problems.append(f"FAIL {rel}: binding with empty key in "
                                f"'{scope}' scope")
            for field in ("name", "command"):
                if not isinstance(item.get(field), str) or not item[field].strip():
                    problems.append(
                        f"FAIL {rel}: binding {key!r} has an empty {field}")
            command = item.get("command", "")
            for field in re.findall(r"\{\{\.(\w+)\}\}", command):
                if field not in GHDASH_TEMPLATE_FIELDS:
                    problems.append(
                        f"FAIL {rel}: binding {key!r} uses template field "
                        f"'{{{{.{field}}}}}' that gh-dash does not provide")
            # Every command word resolves: a brew pin or a repo helper.
            for segment in re.split(r"\|\||&&|\|", command):
                words = shlex.split(segment)
                if not words:
                    continue
                word = words[0]
                if word in shell_builtins:
                    continue
                helper = REPO / "gh-dash" / ".local" / "bin" / word
                script = REPO / "scripts" / word
                if helper.is_file() or script.is_file():
                    continue
                if word not in brews:
                    problems.append(
                        f"FAIL {rel}: binding {key!r} runs '{word}', which is "
                        f"neither a repo helper nor a Brewfile pin")

    # The tuicr review binding must stay in the prs scope on key C (#199).
    tuicr = [item for item in bindings.get("prs", [])
             if "tuicr" in item.get("command", "")]
    if len(tuicr) != 1:
        problems.append(f"FAIL {rel}: expected exactly one tuicr binding")
    elif tuicr[0].get("key") != "C":
        problems.append(
            f"FAIL {rel}: tuicr review binding moved off key 'C' "
            f"(now {tuicr[0].get('key')!r})")

    if problems:
        return False, problems
    return True, [
        "parses as YAML; keybindings live in the prs scope; keys are unique",
        "template fields exist; every command word is a repo helper or a "
        "Brewfile pin; the tuicr binding stays on key C",
    ]


# --------------------------------------------------------------------------
# X12 — markdownlint AV001 wrap contract
# --------------------------------------------------------------------------

LINK_DESTINATION_RE = re.compile(r"\]\([^)]*\)")


def visible_length(line):
    """Column count with link destinations concealed (AV001 semantics)."""
    return len(LINK_DESTINATION_RE.sub("]()", line.rstrip()).rstrip())


def check_markdownlint():
    rel_cfg = "nvim/.markdownlint-cli2.yaml"
    cfg_path = REPO / rel_cfg
    problems = []
    try:
        cfg = yaml_load_file(cfg_path)
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel_cfg}: does not parse as YAML: {exc}"]

    config = (cfg or {}).get("config") or {}
    av001 = config.get("AV001")
    if not isinstance(av001, dict) or av001.get("line_length") != 80:
        problems.append(
            f"FAIL {rel_cfg}: config.AV001.line_length must be 80, got "
            f"{av001!r} (#238)")
    if config.get("MD013") is not False:
        problems.append(
            f"FAIL {rel_cfg}: MD013 must stay disabled (AV001 replaces it)")
    rules = (cfg or {}).get("customRules") or []
    if "./.markdownlint-rules/visual-line-length.cjs" not in rules:
        problems.append(
            f"FAIL {rel_cfg}: customRules must load the AV001 rule")
    if not (REPO / "nvim" / ".markdownlint-rules" / "visual-line-length.cjs").is_file():
        problems.append("FAIL nvim/.markdownlint-rules/visual-line-length.cjs: "
                        "custom rule file is missing")

    # The wrap guide in nvim must agree with AV001.
    lua = (REPO / "nvim" / ".config" / "nvim" / "after" / "ftplugin"
           / "markdown.lua").read_text()
    tw = re.search(r"vim\.opt_local\.textwidth\s*=\s*(\d+)", lua)
    cc = re.search(r'vim\.opt_local\.colorcolumn\s*=\s*"(\d+)"', lua)
    if not tw or not cc:
        problems.append(
            "FAIL nvim/.config/nvim/after/ftplugin/markdown.lua: wrap guide "
            "(textwidth/colorcolumn) not found")
    elif int(tw.group(1)) != 80 or int(cc.group(1)) != 80:
        problems.append(
            f"FAIL markdown.lua: wrap guide is textwidth={tw.group(1)} "
            f"colorcolumn={cc.group(1)}; both must match AV001's 80 (#238)")
    if problems:
        return False, problems
    return True, ["AV001 wraps at 80 and matches the nvim wrap guide "
                  "(textwidth 80, colorcolumn 80)"]


def check_markdownlint_fix():
    """Behavioral half of X12. Runs the real fixer on a fixture when the
    binary exists; SKIPs with a message otherwise (CI provisioning
    decides, and a missing tool never hangs or fails the lane)."""
    binary = shutil.which("markdownlint-cli2")
    if not binary:
        return "SKIP", ["markdownlint-cli2 is not on PATH; the fixture fix "
                        "check is skipped (CI decides provisioning)"]
    fixture_prose = (
        "This paragraph runs past the eighty column limit on purpose so the "
        "fixer must wrap it into several shorter lines that each stay within "
        "the visible limit that the rule keeps.")
    destination = ("https://example.com/a/destination/that/alone/exceeds/"
                   "eighty/visible/columns/by/a/wide/margin/untouched")
    fixture_link = f"A line with a [short label]({destination}) and text."
    problems = []
    with tempfile.TemporaryDirectory(prefix="repo-config-mdlint-") as tmp:
        tmpdir = Path(tmp)
        (tmpdir / ".markdownlint-cli2.yaml").write_bytes(
            (REPO / "nvim" / ".markdownlint-cli2.yaml").read_bytes())
        shutil.copytree(REPO / "nvim" / ".markdownlint-rules",
                        tmpdir / ".markdownlint-rules")
        fixture = tmpdir / "fixture.md"
        fixture.write_text(f"{fixture_prose}\n\n{fixture_link}\n")
        out = subprocess.run(
            [binary, "--fix", "fixture.md"],
            cwd=tmpdir, capture_output=True, text=True, timeout=60,
        )
        if out.returncode != 0:
            return False, [f"FAIL markdownlint fixture: markdownlint-cli2 "
                           f"--fix exited {out.returncode}: "
                           f"{(out.stdout + out.stderr).strip()[:300]}"]
        fixed = fixture.read_text()
        for lineno, line in enumerate(fixed.split("\n"), start=1):
            if line.strip() and visible_length(line) > 80:
                problems.append(
                    f"FAIL markdownlint fixture line {lineno}: "
                    f"{visible_length(line)} visible columns (> 80) after "
                    f"--fix (#238)")
        if destination not in fixed:
            problems.append(
                "FAIL markdownlint fixture: --fix changed the long link "
                "destination; destinations must stay untouched (#238)")
        if fixed.count("\n") <= fixture_prose.count("\n") + 2:
            problems.append(
                "FAIL markdownlint fixture: the over-long paragraph was not "
                "wrapped by --fix")
    if problems:
        return False, problems
    return True, ["--fix wraps the fixture to <= 80 visible columns and "
                  "leaves the long link destination untouched"]


# --------------------------------------------------------------------------
# X13 — config invariants (static, offline)
# --------------------------------------------------------------------------

def check_pi_settings():
    rel = "pi/.pi/agent/settings.json"
    path = REPO / rel
    try:
        settings = json.loads(path.read_text())
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel}: does not parse as JSON: {exc}"]
    problems = []
    indent = (settings.get("markdown") or {}).get("codeBlockIndent")
    if indent != "":
        problems.append(
            f"FAIL {rel}: markdown.codeBlockIndent is {indent!r}; it must be "
            f"\"\" so terminal-selected code blocks paste without the "
            f"2-space prefix (#166)")
    for entry in settings.get("extensions", []):
        if entry.startswith("+"):
            target = REPO / "pi" / ".pi" / "agent" / entry[1:]
            if not target.exists():
                problems.append(
                    f"FAIL {rel}: extension entry '{entry}' has no file at "
                    f"pi/.pi/agent/{entry[1:]}")
    if problems:
        return False, problems
    return True, ["valid JSON; markdown.codeBlockIndent is the empty string; "
                  "every +extensions entry exists on disk"]


def check_claude_settings():
    rels = [f for f in git_files("claude", ".claude")
            if re.search(r"(^|/)(settings[^/]*\.json)$", f)]
    if not rels:
        return False, ["no tracked claude settings JSON found"]
    problems = []
    for rel in rels:
        path = REPO / rel
        text = path.read_text()
        try:
            json.loads(text)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: does not parse as JSON: {exc}")
            continue
        if "dotfiles-ci" in text:
            problems.append(
                f"FAIL {rel}: references the removed dotfiles-ci profile "
                f"(#8/#9)")
        if re.search(r"/home/[A-Za-z0-9._-]+/", text):
            problems.append(
                f"FAIL {rel}: contains an absolute /home/<user> path; use "
                f"$HOME instead (#8/#9)")
    if problems:
        return False, problems
    return True, [f"all {len(rels)} tracked claude settings files are valid "
                  f"JSON with no removed-profile or /home/<user> references"]


# Keys actually used by herdr/.config/herdr/config.toml, vendored from the
# current config (herdr 0.8.x era). Full schema validity against the herdr
# binary stays host-only (#156-#158): when the config gains a key on
# purpose, add it here in the same change; an unknown key fails here.
HERDR_ALLOWED_KEYS = {
    "advanced.scrollback_limit_bytes",
    "experimental.switch_ascii_input_source_in_prefix",
    "experimental.kitty_graphics",
    "keys.command.command",
    "keys.command.description",
    "keys.command.key",
    "keys.command.type",
    "keys.copy_mode",
    "keys.focus_pane_down",
    "keys.focus_pane_left",
    "keys.focus_pane_right",
    "keys.focus_pane_up",
    "keys.help",
    "keys.last_pane",
    "keys.navigate_workspace_down",
    "keys.navigate_workspace_up",
    "keys.next_tab",
    "keys.open_notification_target",
    "keys.prefix",
    "keys.previous_tab",
    "keys.rename_tab",
    "keys.rename_workspace",
    "keys.split_horizontal",
    "keys.split_vertical",
    "keys.workspace_picker",
    "onboarding",
    "terminal.new_cwd",
    "theme.auto_switch",
    "theme.custom.accent",
    "theme.custom.green",
    "theme.custom.mauve",
    "theme.custom.panel_bg",
    "theme.custom.peach",
    "theme.custom.red",
    "theme.custom.surface_dim",
    "theme.custom.text",
    "theme.custom.yellow",
    "theme.name",
    "ui.accent",
    "ui.host_cursor",
    "ui.mouse_capture",
    "ui.pane_borders",
    "ui.pane_gaps",
    "ui.pane_scrollbars",
    "ui.show_agent_labels_on_pane_borders",
    "ui.sound.enabled",
    "ui.toast.delay_seconds",
    "ui.toast.delivery",
}


def check_herdr_config():
    import tomllib
    rel = "herdr/.config/herdr/config.toml"
    path = REPO / rel
    try:
        with path.open("rb") as fh:
            cfg = tomllib.load(fh)
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel}: does not parse as TOML: {exc}"]

    def leaf_paths(node, prefix=""):
        for key, value in node.items():
            p = f"{prefix}{key}"
            if isinstance(value, dict):
                yield from leaf_paths(value, p + ".")
            elif isinstance(value, list) and value and \
                    all(isinstance(x, dict) for x in value):
                for table in value:
                    for sub in table:
                        yield f"{p}.{sub}"
            else:
                yield p

    problems = []
    for key in sorted(leaf_paths(cfg)):
        if key not in HERDR_ALLOWED_KEYS:
            problems.append(
                f"FAIL {rel}: key '{key}' is not in the vendored allow-list "
                f"in scripts/test-repo-config.py; unknown keys made herdr "
                f"warn or fail across 0.7.5/0.8.0 (#156-#158). Add the key "
                f"here in the same change, or remove it from the config.")
    if problems:
        return False, problems
    return True, ["parses as TOML; every key is on the vendored allow-list "
                  "(binary schema checks stay host-only)"]


def check_brewfile_deps():
    rel = "dependencies.json"
    try:
        deps = json.loads((REPO / rel).read_text())
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel}: does not parse as JSON: {exc}"]
    brews, casks = brewfile_entries()
    if not brews:
        return False, ["FAIL Brewfile: no `brew \"name\"` lines found"]
    macos_map = (deps.get("package_mappings") or {}).get("macos") or {}
    problems = []
    for category, block in (deps.get("categories") or {}).items():
        for pkg in block.get("packages", []):
            mapped = macos_map.get(pkg, pkg)
            if pkg not in brews and mapped is not None and mapped not in brews:
                problems.append(
                    f"FAIL {rel}: pinned package '{pkg}' (category "
                    f"'{category}') is missing from the Brewfile; a "
                    f"regeneration once silently dropped Bun (#212)")
    for group, names in (deps.get("casks") or {}).items():
        for cask in names:
            if cask not in casks:
                problems.append(
                    f"FAIL {rel}: pinned cask '{cask}' (group '{group}') is "
                    f"missing from the Brewfile")
    if problems:
        return False, problems
    return True, ["every pinned package and cask in dependencies.json is "
                  "installed by the Brewfile (macOS-null mappings excused)"]


# --------------------------------------------------------------------------
# X8 known-gap evidence — stow claude dry run (informational, simulated)
# --------------------------------------------------------------------------

def check_stow_claude_evidence():
    """Simulated `stow claude` against fake homes. Records the facts the
    captain needs for the pending decision; never touches $HOME."""
    if not shutil.which("stow"):
        return "SKIP", ["stow is not on PATH; the claude dry-run evidence "
                        "check is skipped"]
    problems = []
    notes = []
    with tempfile.TemporaryDirectory(prefix="repo-config-stow-") as tmp:
        used = Path(tmp) / "used-home"
        (used / ".claude").mkdir(parents=True)
        (used / ".claude" / "settings.json").write_text("live settings\n")
        out = subprocess.run(
            ["stow", "-n", "-d", str(REPO), "-t", str(used), "claude"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 1 or "conflicts" not in out.stdout + out.stderr:
            problems.append(
                "FAIL stow claude evidence: expected the simulated stow to "
                "conflict with a real ~/.claude/settings.json; stow behavior "
                "changed, re-check the evidence")
        else:
            notes.append("simulated `stow claude` conflicts with a real "
                         "~/.claude/settings.json and exits 1 (install.sh "
                         "would abort under set -e)")
        fresh = Path(tmp) / "fresh-home"
        fresh.mkdir()
        out = subprocess.run(
            ["stow", "-n", "-d", str(REPO), "-t", str(fresh), "claude"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            problems.append(
                f"FAIL stow claude evidence: simulated stow against an empty "
                f"home failed ({out.returncode}): "
                f"{(out.stdout + out.stderr).strip()[:200]}")
        else:
            notes.append("against an empty home the simulation plans one "
                         "folding symlink and exits 0")
    if problems:
        return False, problems
    return True, notes


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------

CHECKS = [
    ("X7 skill-frontmatter", check_skill_frontmatter),
    ("X8 install-stow", check_install_stow),
    ("X8b gh-dash-config", check_ghdash_config),
    ("X12 markdownlint-config", check_markdownlint),
    ("X12 markdownlint-fix", check_markdownlint_fix),
    ("X13 pi-settings", check_pi_settings),
    ("X13 claude-settings", check_claude_settings),
    ("X13 herdr-config", check_herdr_config),
    ("X13 brewfile-deps", check_brewfile_deps),
    ("X8 stow-claude-evidence", check_stow_claude_evidence),
]


def main():
    start = time.monotonic()
    failures = []
    for name, fn in CHECKS:
        t0 = time.monotonic()
        try:
            result = fn()
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
    print(f"repo-config suite: {len(CHECKS) - len(failures)}/{len(CHECKS)} "
          f"checks passed, {len(failures)} failed, {total:.2f}s total")
    if failures:
        print("FAILED checks: " + ", ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

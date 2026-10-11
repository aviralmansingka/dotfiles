#!/usr/bin/env python3
# Paths: starship/** aerospace/** tmuxinator/** kube/** neovide/** omarchy/** code/** blinksh/** git/**
"""config-lint suite — parse gates and structural invariants for every
remaining config surface with no suite of its own.

Offline and deterministic: no network, no $HOME mutation, no sleeps, no
pip installs. Each check prints PASS, FAIL, or SKIP with the file and
the reason, plus per-check and total run times. The script exits
non-zero when any check fails. See docs/ci-tests/config-lint.md for
scope, coverage, and known gaps.

Run `--selftest` to prove every check fails on a mutated sandbox copy
built in a mktemp directory (the sandbox is a throwaway git repo; the
real worktree is never touched).

# Paths: starship/** aerospace/** tmuxinator/** kube/** neovide/** omarchy/** code/** blinksh/** git/**

YAML parsing uses the best parser available (same tiers as
scripts/test-repo-config.py, never pip-installing):
  1. PyYAML when importable;
  2. `ruby -ryaml` (GitHub ubuntu runners ship ruby);
  3. otherwise the suite fails loudly and says what to install.
"""

import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

SCOPE_DIRS = ("starship", "aerospace", "tmuxinator", "kube", "neovide",
              "omarchy", "code", "blinksh", "git")

# --------------------------------------------------------------------------
# YAML loading (PyYAML -> ruby -> loud failure)
# --------------------------------------------------------------------------

try:
    import yaml as _pyyaml  # noqa: N813
except ImportError:
    _pyyaml = None


def yaml_load_file(path: Path):
    """Parse a YAML file with a real parser (PyYAML or ruby)."""
    if _pyyaml is not None:
        return _pyyaml.safe_load(path.read_text())
    if shutil.which("ruby"):
        out = subprocess.run(
            ["ruby", "-ryaml", "-rjson", "-e",
             "print YAML.safe_load(File.read(ARGV.fetch(0))).to_json",
             str(path)],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            raise ValueError(out.stderr.strip() or "ruby YAML parse failed")
        import json
        return json.loads(out.stdout)
    raise RuntimeError(
        "no YAML parser available: install ruby (runners ship it) or PyYAML; "
        "this suite never pip-installs")


def toml_load_file(path: Path):
    import tomllib
    with path.open("rb") as fh:
        return tomllib.load(fh)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def git_files(repo, *pathspecs):
    out = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "--", *pathspecs],
        capture_output=True, text=True, timeout=30, check=True,
    )
    return sorted(line for line in out.stdout.split("\n") if line)


def scope_files(repo):
    return git_files(repo, *SCOPE_DIRS)


def run_ok(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True,
                          timeout=30, **kw)


# --------------------------------------------------------------------------
# C1/C2/C3 — parse gates (one malformed file must fail with its name)
# --------------------------------------------------------------------------

def check_toml_parse(repo):
    files = [f for f in scope_files(repo) if f.endswith(".toml")]
    problems = []
    for rel in files:
        try:
            toml_load_file(repo / rel)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: does not parse as TOML: {exc}")
    if problems:
        return False, problems
    return True, [f"all {len(files)} tracked TOML files parse "
                  f"({', '.join(files)})"]


def check_json_parse(repo):
    files = [f for f in scope_files(repo) if f.endswith(".json")]
    problems = []
    import json
    for rel in files:
        try:
            json.loads((repo / rel).read_text())
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: does not parse as JSON: {exc}")
    if problems:
        return False, problems
    if not files:
        return True, ["no tracked JSON files in scope; the gate stays armed "
                      "for any future one"]
    return True, [f"all {len(files)} tracked JSON files parse"]


def check_yaml_parse(repo):
    files = [f for f in scope_files(repo)
             if f.endswith((".yaml", ".yml"))]
    problems = []
    for rel in files:
        try:
            yaml_load_file(repo / rel)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: does not parse as YAML: {exc}")
    if problems:
        return False, problems
    return True, [f"all {len(files)} tracked YAML files parse "
                  f"(anchors and aliases resolve)"]


# --------------------------------------------------------------------------
# C4 — starship structure
# --------------------------------------------------------------------------

# Starship module names, vendored from the starship configuration docs.
STARSHIP_MODULES = {
    "aws", "azure", "buf", "bun", "c", "clang", "cobol", "conda",
    "container", "crystal", "daml", "dart", "deno", "directory", "direnv",
    "docker_context", "dotnet", "elixir", "elm", "env_var", "erlang",
    "fennel", "fill", "fossil_branch", "fossil_metrics", "gcloud",
    "git_branch", "git_commit", "git_metrics", "git_state", "git_status",
    "gleam", "golang", "guix_shell", "gradle", "haskell", "helm", "hostname",
    "java", "jobs", "julia", "kotlin", "kubernetes", "line_break",
    "local_vars", "lua", "memory_usage", "meson", "mise", "nats", "nim",
    "nix_shell", "nodejs", "ocaml", "odin", "openstack", "os", "package",
    "perl", "php", "pijul_channel", "pulumi", "purescript", "python",
    "quarto", "raku", "red", "rlang", "ruby", "rust", "scala", "shell",
    "shlvl", "singularity", "solidity", "spack", "status", "sudo", "swift",
    "terraform", "time", "typst", "username", "vagrant", "vcsh", "vlang",
    "zig",
}
# Top-level keys that are settings, not module blocks.
STARSHIP_TOP_KEYS = {
    "add_newline", "format", "right_format", "continuation_prompt",
    "palette", "command_timeout", "scan_timeout",
}
# Tokens allowed inside format strings beyond module names.
STARSHIP_FORMAT_SPECIALS = {"all", "custom", "env", "meta"}

FORMAT_TOKEN_RE = re.compile(r"\$\{?([A-Za-z0-9_-]+)\}?")


def check_starship(repo):
    files = [f for f in git_files(repo, "starship") if f.endswith(".toml")]
    if not files:
        return False, ["no tracked starship TOML found"]
    problems = []
    for rel in files:
        try:
            cfg = toml_load_file(repo / rel)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: does not parse as TOML: {exc}")
            continue
        for key in cfg:
            if key not in STARSHIP_MODULES and key not in STARSHIP_TOP_KEYS:
                problems.append(
                    f"FAIL {rel}: table '{key}' is not a known starship "
                    f"module or top-level setting; unknown module blocks "
                    f"silently do nothing")
        # Modules named inside any format string must exist as modules.
        def walk(node):
            if isinstance(node, dict):
                for v in node.values():
                    walk(v)
            elif isinstance(node, list):
                for v in node:
                    walk(v)
            elif isinstance(node, str) and "$" in node:
                for tok in FORMAT_TOKEN_RE.findall(node):
                    if (tok not in STARSHIP_MODULES
                            and tok not in STARSHIP_FORMAT_SPECIALS):
                        problems.append(
                            f"FAIL {rel}: format string references "
                            f"'${tok}', which is not a known module")
        walk(cfg)
    if problems:
        return False, problems
    return True, [f"{files[0]}: every module block and format-string token "
                  f"is a known starship module"]


# --------------------------------------------------------------------------
# C5 — aerospace structure
# --------------------------------------------------------------------------

# Commands vendored from the current aerospace/.aerospace.toml. A new
# command fails here until it joins this list (same pattern as the
# vendored herdr key allow-list, #156-#158).
AEROSPACE_COMMANDS = {
    "close-all-windows-but-current", "exec-and-forget",
    "flatten-workspace-tree", "focus", "join-with", "layout", "mode", "move",
    "move-node-to-workspace", "move-workspace-to-monitor", "reload-config",
    "resize", "volume", "workspace", "workspace-back-and-forth",
}
AEROSPACE_MODIFIERS = {"cmd", "alt", "ctrl", "shift"}
KEY_PART_RE = re.compile(r"^[A-Za-z0-9]+$")


def _aerospace_command_problems(rel, commands, problems):
    for cmd in commands:
        words = shlex.split(cmd)
        if not words:
            problems.append(f"FAIL {rel}: empty command in a keybinding")
            continue
        head = words[0]
        if head == "mode":
            target = words[1] if len(words) > 1 else ""
            yield target  # caller checks mode existence
            continue
        if head not in AEROSPACE_COMMANDS:
            problems.append(
                f"FAIL {rel}: command '{head}' is not on the vendored "
                f"allow-list in scripts/test-config-lint.py; add it in the "
                f"same change that uses it")


def check_aerospace(repo):
    rel = "aerospace/.aerospace.toml"
    path = repo / rel
    if not git_files(repo, rel):
        return False, [f"FAIL {rel}: file is not tracked"]
    try:
        cfg = toml_load_file(path)
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel}: does not parse as TOML: {exc}"]
    problems = []
    mode_targets = set()

    modes = cfg.get("mode")
    if not isinstance(modes, dict) or "main" not in modes:
        problems.append(
            f"FAIL {rel}: no [mode.main] table; AeroSpace requires the "
            f"main binding mode")
    for name, body in (modes or {}).items():
        binding = (body or {}).get("binding") if isinstance(body, dict) else None
        if not isinstance(binding, dict) or not binding:
            problems.append(
                f"FAIL {rel}: mode '{name}' has no non-empty binding table")
            continue
        for key, value in binding.items():
            # Key shape: modifiers + one plain key.
            parts = key.split("-")
            mods, final = parts[:-1], parts[-1]
            if any(m not in AEROSPACE_MODIFIERS for m in mods) or \
                    not KEY_PART_RE.match(final or ""):
                problems.append(
                    f"FAIL {rel}: keybinding key '{key}' is not "
                    f"modifier(s)-plus-key form")
            cmds = value if isinstance(value, list) else [value]
            if not all(isinstance(c, str) and c.strip() for c in cmds):
                problems.append(
                    f"FAIL {rel}: keybinding '{key}' has a non-string or "
                    f"empty command")
                continue
            for target in _aerospace_command_problems(rel, cmds, problems):
                mode_targets.add(target)

    for target in sorted(mode_targets):
        if target not in (modes or {}):
            problems.append(
                f"FAIL {rel}: keybinding targets mode '{target}', which is "
                f"not declared as [mode.{target}]")

    # Startup hooks: each entry must resolve to a repo file or a known
    # binary/command.
    for opt in ("after-login-command", "after-startup-command"):
        entries = cfg.get(opt)
        if entries is None:
            continue
        if not isinstance(entries, list):
            problems.append(f"FAIL {rel}: {opt} must be a list")
            continue
        for entry in entries:
            if not isinstance(entry, str) or not entry.strip():
                problems.append(f"FAIL {rel}: {opt} has a non-string entry")
                continue
            words = shlex.split(entry)
            if words[0] in AEROSPACE_COMMANDS:
                continue
            if shutil.which(words[0]):
                continue
            if (repo / words[0]).exists():
                continue
            problems.append(
                f"FAIL {rel}: {opt} entry '{entry}' resolves to neither an "
                f"aerospace command, a binary on PATH, nor a repo file")

    # on-window-detected callbacks: run list with valid commands.
    owd = cfg.get("on-window-detected")
    if owd is not None:
        if not isinstance(owd, list):
            problems.append(
                f"FAIL {rel}: on-window-detected must be an array of tables")
        else:
            for i, table in enumerate(owd):
                if not isinstance(table, dict):
                    problems.append(
                        f"FAIL {rel}: on-window-detected[{i}] is not a table")
                    continue
                run = table.get("run")
                if not isinstance(run, list) or \
                        not all(isinstance(c, str) for c in run):
                    problems.append(
                        f"FAIL {rel}: on-window-detected[{i}] needs a 'run' "
                        f"list of strings")
                    continue
                for _t in _aerospace_command_problems(
                        rel, run, problems):
                    pass

    if problems:
        return False, problems
    return True, ["modes declared and complete; every keybinding has a valid "
                  "key and a command on the allow-list; mode targets and "
                  "startup hooks resolve"]


# --------------------------------------------------------------------------
# C6 — tmuxinator structure
# --------------------------------------------------------------------------

# Vendored from tmuxinator's documented project options.
TMUXINATOR_TOP_KEYS = {
    "name", "project_name", "root", "socket_name", "socket_path",
    "tmux_command", "tmux_options", "tmux_detached", "attach", "pre", "post",
    "on_project_start", "on_project_first_start", "on_project_restart",
    "on_project_exit", "on_project_stop", "windows", "startup_window",
    "startup_pane",
}
TMUXINATOR_WINDOW_KEYS = {"root", "pre", "post", "panes", "layout"}


def check_tmuxinator(repo):
    files = [f for f in git_files(repo, "tmuxinator")
             if f.endswith((".yaml", ".yml"))]
    if not files:
        return False, ["no tracked tmuxinator YAML found"]
    problems = []
    for rel in files:
        try:
            cfg = yaml_load_file(repo / rel)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: does not parse as YAML: {exc}")
            continue
        if not isinstance(cfg, dict):
            problems.append(f"FAIL {rel}: top level is not a mapping")
            continue
        for key in cfg:
            if key not in TMUXINATOR_TOP_KEYS:
                problems.append(
                    f"FAIL {rel}: unknown top-level key '{key}'; it is not "
                    f"a tmuxinator project option")
        name = cfg.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"FAIL {rel}: session 'name' is missing or empty")
        windows = cfg.get("windows")
        if not isinstance(windows, list) or not windows:
            problems.append(
                f"FAIL {rel}: 'windows' is missing or empty; a tmuxinator "
                f"project needs at least one window")
            continue
        for i, window in enumerate(windows):
            if isinstance(window, str):
                continue  # plain command window
            if not isinstance(window, dict) or len(window) != 1:
                problems.append(
                    f"FAIL {rel}: windows[{i}] must be one name: options pair")
                continue
            opts = next(iter(window.values()))
            if opts is None:
                continue  # bare shell window (root-only is valid)
            if not isinstance(opts, dict):
                problems.append(
                    f"FAIL {rel}: windows[{i}] options must be a mapping")
                continue
            for opt, value in opts.items():
                if opt not in TMUXINATOR_WINDOW_KEYS:
                    problems.append(
                        f"FAIL {rel}: windows[{i}] uses unknown option "
                        f"'{opt}'")
                if opt == "panes" and not isinstance(value, list):
                    problems.append(
                        f"FAIL {rel}: windows[{i}] 'panes' must be a list")
            # Referenced scripts must exist in the repo.
            commands = []
            for opt in ("pre", "post"):
                v = opts.get(opt)
                commands.extend(v if isinstance(v, list)
                                else [v] if isinstance(v, str) else [])
            panes = opts.get("panes")
            if isinstance(panes, list):
                for pane in panes:
                    commands.extend(pane if isinstance(pane, list)
                                    else [pane] if isinstance(pane, str) else [])
            for cmd in commands:
                if not isinstance(cmd, str):
                    continue
                for word in shlex.split(cmd):
                    if word.startswith("./") and not (repo / word).exists():
                        problems.append(
                            f"FAIL {rel}: window command references "
                            f"'{word}', which is not a tracked file")
    if problems:
        return False, problems
    return True, [f"all {len(files)} tmuxinator projects have a session "
                  f"name, well-formed windows, and resolvable script "
                  f"references"]


# --------------------------------------------------------------------------
# C7 — k9s skin structure
# --------------------------------------------------------------------------

K9S_NAMED_COLORS = {
    "default", "black", "white", "red", "green", "yellow", "blue", "magenta",
    "cyan", "gray", "darkgray", "lightred", "lightgreen", "lightyellow",
    "lightblue", "lightmagenta", "lightcyan", "lightwhite",
}
HEX_RE = re.compile(r"^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$")


def check_k9s(repo):
    files = [f for f in git_files(repo, "kube")
             if f.endswith((".yaml", ".yml"))]
    if not files:
        return False, ["no tracked k9s skin YAML found"]
    problems = []
    for rel in files:
        try:
            cfg = yaml_load_file(repo / rel)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"FAIL {rel}: does not parse as YAML (an "
                            f"undefined anchor/alias fails here): {exc}")
            continue
        if not isinstance(cfg, dict) or "k9s" not in cfg:
            problems.append(
                f"FAIL {rel}: missing the top-level 'k9s' mapping; the skin "
                f"would render with k9s defaults")
            continue
        # Top-level color tokens this skin defines (k9s views may name
        # them, e.g. `bgColor: background`).
        tokens = {k for k, v in cfg.items()
                  if isinstance(v, str) and k != "k9s"}
        def walk(node):
            if isinstance(node, dict):
                for v in node.values():
                    walk(v)
            elif isinstance(node, list):
                for v in node:
                    walk(v)
            elif isinstance(node, str):
                # Skin references: a YAML/JSON path must be a tracked file.
                if node.endswith((".yaml", ".yml")) and \
                        not (repo / node).exists():
                    problems.append(
                        f"FAIL {rel}: references '{node}', which is not a "
                        f"tracked file")
                # Color shape: hex, a known terminal color name, or one
                # of this skin's own top-level tokens.
                elif not HEX_RE.match(node) and \
                        node not in K9S_NAMED_COLORS and \
                        node not in tokens:
                    problems.append(
                        f"FAIL {rel}: value '{node}' is neither a hex color, "
                        f"a known color name, nor a token this skin defines")
        walk(cfg["k9s"])
    if problems:
        return False, problems
    return True, ["skin parses with anchors resolved; every color value is "
                  "hex or a known name; every file reference is tracked"]


# --------------------------------------------------------------------------
# C8 — neovide structure (#30)
# --------------------------------------------------------------------------

# Vendored from the current config plus the documented neovide settings
# keys of the same era. A new key fails here until it joins this list.
NEOVIDE_TOP_KEYS = {
    "font", "fork", "frame", "idle", "neovim-bin", "no-multigrid",
    "srgb", "title-hidden", "vsync", "wsl",
}
NEOVIDE_FONT_KEYS = {
    "size", "normal", "bold", "italic", "bold_italic", "features", "edging",
    "hinting",
}


def check_neovide(repo):
    rel = "neovide/.config/neovide/config.toml"
    path = repo / rel
    if not git_files(repo, rel):
        return False, [f"FAIL {rel}: file is not tracked"]
    try:
        cfg = toml_load_file(path)
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel}: does not parse as TOML: {exc}"]
    problems = []
    for key in cfg:
        if key not in NEOVIDE_TOP_KEYS:
            problems.append(
                f"FAIL {rel}: top-level key '{key}' is not on the vendored "
                f"allow-list in scripts/test-config-lint.py; add it in the "
                f"same change that uses it")
    font = cfg.get("font")
    if not isinstance(font, dict):
        problems.append(
            f"FAIL {rel}: no [font] section; the font pin that #30 moved "
            f"into this file is gone")
    else:
        for key in font:
            if key not in NEOVIDE_FONT_KEYS:
                problems.append(
                    f"FAIL {rel}: unknown [font] key '{key}'")
        if not isinstance(font.get("size"), (int, float)):
            problems.append(f"FAIL {rel}: [font] size is missing or not a "
                            f"number (#30)")
        normal = font.get("normal")
        entries = normal if isinstance(normal, list) else [normal]
        if not isinstance(normal, (dict, list)) or not entries:
            problems.append(
                f"FAIL {rel}: [font] normal is missing; the pinned "
                f"JetBrainsMono face from #30 is gone")
        else:
            for entry in entries:
                if not isinstance(entry, dict) or \
                        not isinstance(entry.get("family"), str):
                    problems.append(
                        f"FAIL {rel}: a [font] normal entry has no 'family' "
                        f"string (#30)")
    if problems:
        return False, problems
    return True, ["parses as TOML; every key is on the vendored allow-list; "
                  "the #30 font pin is intact (size + normal.family)"]


# --------------------------------------------------------------------------
# C9 — git config structure
# --------------------------------------------------------------------------

def check_git_config(repo):
    rel = "git/.config/git/config"
    path = repo / rel
    if not git_files(repo, rel):
        return False, [f"FAIL {rel}: file is not tracked"]
    out = run_ok(["git", "config", "-f", str(path), "--list"])
    if out.returncode != 0:
        return False, [f"FAIL {rel}: git config cannot parse it: "
                       f"{(out.stderr or '').strip()}"]
    settings = {}
    for line in out.stdout.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            settings[k] = v
    problems = []
    for key in ("user.name", "user.email"):
        if not settings.get(key, "").strip():
            problems.append(
                f"FAIL {rel}: '{key}' is missing or empty; commits would "
                f"carry a guessed identity")
    helper = settings.get("credential.helper")
    if helper is None:
        problems.append(
            f"FAIL {rel}: no credential.helper; HTTPS pushes would prompt "
            f"every time")
    elif "/" in helper:
        problems.append(
            f"FAIL {rel}: credential.helper '{helper}' is a path; use a "
            f"helper name so each host resolves it")
    # If a delta section appears, it must carry settings (shape, not wish).
    delta_keys = [k for k in settings if k.startswith("delta.")]
    sections = set(k.split(".")[0] for k in settings)
    if "delta" in sections and not delta_keys:
        problems.append(
            f"FAIL {rel}: a [delta] section exists but holds no settings")
    if problems:
        return False, problems
    return True, ["git config parses via `git config --list`; user identity "
                  "and credential.helper are set; delta/credential sections "
                  "hold a sane shape"]


# --------------------------------------------------------------------------
# C10 — lazygit structure
# --------------------------------------------------------------------------

# Vendored from lazygit's documented top-level config keys.
LAZYGIT_TOP_KEYS = {
    "gui", "git", "keybinding", "update", "customCommands", "services",
    "notARepository", "promptToReturnFromSubprocess", "os",
}


def check_lazygit(repo):
    rel = "git/.config/lazygit/config.yml"
    path = repo / rel
    if not git_files(repo, rel):
        return "SKIP", [f"{rel} is not tracked; nothing to check"]
    try:
        cfg = yaml_load_file(path)
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {rel}: does not parse as YAML: {exc}"]
    if not isinstance(cfg, dict):
        return False, [f"FAIL {rel}: top level is not a mapping"]
    problems = []
    for key in cfg:
        if key not in LAZYGIT_TOP_KEYS:
            problems.append(
                f"FAIL {rel}: unknown top-level key '{key}'; it is not a "
                f"lazygit config section")
    keybinding = cfg.get("keybinding")
    if keybinding is not None:
        if not isinstance(keybinding, dict):
            problems.append(f"FAIL {rel}: keybinding must be a mapping")
        else:
            def walk_kb(node):
                if isinstance(node, dict):
                    for v in node.values():
                        walk_kb(v)
                elif not (isinstance(node, str)
                          or isinstance(node, list)
                          and all(isinstance(x, str) for x in node)):
                    problems.append(
                        f"FAIL {rel}: a keybinding value is not a key string "
                        f"or list of them")
            walk_kb(keybinding)
    renderers = (cfg.get("git") or {}).get("diffRenderers")
    if renderers is not None:
        if not isinstance(renderers, list):
            problems.append(
                f"FAIL {rel}: git.diffRenderers must be a list")
        else:
            for i, entry in enumerate(renderers):
                if not isinstance(entry, dict) or \
                        "colorArg" not in entry or "command" not in entry:
                    problems.append(
                        f"FAIL {rel}: git.diffRenderers[{i}] needs both "
                        f"'colorArg' and 'command'")
    if problems:
        return False, problems
    return True, ["parses as YAML; every top-level key is a lazygit section; "
                  "keybinding and diffRenderer shapes are sane"]


# --------------------------------------------------------------------------
# C11 — omarchy template structure
# --------------------------------------------------------------------------

# Template functions vendored from the current .tpl. A new function fails
# here until it joins this list.
OMARCHY_TEMPLATE_FUNCS = {"hypr_gradient"}
PLACEHOLDER_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


def check_omarchy(repo):
    files = [f for f in git_files(repo, "omarchy") if f.endswith(".tpl")]
    if not files:
        return False, ["no tracked omarchy template found"]
    problems = []
    notes = []
    for rel in files:
        text = (repo / rel).read_text()
        if text.count("{{") != text.count("}}"):
            problems.append(
                f"FAIL {rel}: unbalanced {{{{ }}}} placeholder delimiters")
            continue
        for body in PLACEHOLDER_RE.findall(text):
            head = body.split()[0] if body.split() else ""
            if head not in OMARCHY_TEMPLATE_FUNCS:
                problems.append(
                    f"FAIL {rel}: placeholder '{{{{ {body} }}}}' calls "
                    f"'{head}', which is not on the vendored template "
                    f"function list")
        # When a Lua compiler exists, the rendered template must be valid
        # Lua (host tool; SKIP without it).
        if shutil.which("luac"):
            rendered = PLACEHOLDER_RE.sub("'rendered'", text)
            with tempfile.NamedTemporaryFile(
                    "w", suffix=".lua", delete=False) as tf:
                tf.write(rendered)
                tmp = tf.name
            try:
                out = run_ok(["luac", "-p", tmp])
                if out.returncode != 0:
                    problems.append(
                        f"FAIL {rel}: rendered template is not valid Lua: "
                        f"{(out.stderr or '').strip()}")
            finally:
                Path(tmp).unlink(missing_ok=True)
        else:
            notes.append(f"{rel}: rendered-Lua syntax check skipped "
                         f"(no luac on PATH)")
    if problems:
        return False, problems
    return True, [f"all {len(files)} templates have balanced placeholders "
                  f"and known template functions"] + notes


# --------------------------------------------------------------------------
# C12 — code snippets parse
# --------------------------------------------------------------------------

def check_code_snippets(repo):
    files = git_files(repo, "code")
    lua_files = [f for f in files if f.endswith(".lua")]
    go_files = [f for f in files if f.endswith(".go")]
    if not files:
        return False, ["no tracked files under code/"]
    problems = []
    notes = []
    if lua_files:
        if shutil.which("luac"):
            for rel in lua_files:
                out = run_ok(["luac", "-p", str(repo / rel)])
                if out.returncode != 0:
                    problems.append(
                        f"FAIL {rel}: does not parse as Lua: "
                        f"{(out.stderr or '').strip()}")
        else:
            notes.append(f"{len(lua_files)} Lua files: parse check skipped "
                         f"(no luac on PATH)")
    if go_files:
        if shutil.which("gofmt"):
            for rel in go_files:
                out = run_ok(["gofmt", "-l", str(repo / rel)])
                if out.returncode != 0:
                    problems.append(
                        f"FAIL {rel}: does not parse as Go: "
                        f"{(out.stderr or '').strip()}")
        else:
            notes.append(f"{len(go_files)} Go files: parse check skipped "
                         f"(no gofmt on PATH)")
    if problems:
        return False, problems
    checked = (len(lua_files) if shutil.which("luac") else 0) + \
              (len(go_files) if shutil.which("gofmt") else 0)
    if checked == 0 and (lua_files or go_files):
        return "SKIP", notes
    return True, [f"every parse-checked snippet under code/ is valid syntax "
                  f"({checked} of {len(files)} files; the rest are "
                  f"non-code)"] + notes


# --------------------------------------------------------------------------
# C13 — blinksh theme structure
# --------------------------------------------------------------------------

BLINK_PREF_KEYS = {
    "color-palette-overrides", "cursor-color", "foreground-color",
    "background-color", "font-family", "font-size",
}
BLINK_PALETTE_VARS = {
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "lightBlack", "lightRed", "lightGreen", "lightYellow", "lightBlue",
    "lightMagenta", "lightCyan", "lightWhite",
}
BLINK_COLOR_DEF_RE = re.compile(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*'(#[0-9A-Fa-f]{6})'\s*;", re.M)
BLINK_SET_RE = re.compile(r"t\.prefs_\.set\(\s*'([^']+)'")
BLINK_PALETTE_RE = re.compile(
    r"color-palette-overrides'\s*,\s*\[(.*?)\]\s*\)", re.S)


def check_blinksh(repo):
    files = [f for f in git_files(repo, "blinksh") if f.endswith(".js")]
    if not files:
        return False, ["no tracked blinksh theme found"]
    problems = []
    notes = []
    for rel in files:
        text = (repo / rel).read_text()
        for key in BLINK_SET_RE.findall(text):
            if key not in BLINK_PREF_KEYS:
                problems.append(
                    f"FAIL {rel}: t.prefs_.set key '{key}' is not on the "
                    f"vendored allow-list")
        defined = {m[0] for m in BLINK_COLOR_DEF_RE.findall(text)}
        if defined != BLINK_PALETTE_VARS:
            problems.append(
                f"FAIL {rel}: the 16-color palette is not fully defined; "
                f"missing: {sorted(BLINK_PALETTE_VARS - defined)}")
        m = BLINK_PALETTE_RE.search(text)
        if not m:
            problems.append(
                f"FAIL {rel}: no color-palette-overrides call found")
        else:
            used = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", m.group(1)))
            if used != BLINK_PALETTE_VARS:
                problems.append(
                    f"FAIL {rel}: the palette call omits or overflows "
                    f"colors; diff: "
                    f"{sorted(used ^ BLINK_PALETTE_VARS)}")
        if shutil.which("node"):
            out = run_ok(["node", "--check", str(repo / rel)])
            if out.returncode != 0:
                problems.append(
                    f"FAIL {rel}: does not parse as JavaScript: "
                    f"{(out.stderr or '').strip()[:200]}")
        else:
            notes.append(f"{rel}: node --check skipped (no node on PATH)")
    if problems:
        return False, problems
    return True, ["theme defines all 16 palette colors, passes every one to "
                  "color-palette-overrides, and uses only known prefs keys"] \
        + notes


# --------------------------------------------------------------------------
# C14 — portability tripwire (#8/#9)
# --------------------------------------------------------------------------

# Known gaps, recorded the same way as STOW_GAP_ALLOWLIST: the entry is
# the durable record of a pending captain decision, not an endorsement.
# Remove the entry in the same change that fixes the path.
PORTABILITY_GAPS = {
    ("neovide/.config/neovide/config.toml",
     "/Users/aviral/.local/share/bob/nvim-bin/nvim"):
        "bob neovim path is Mac-GUI-launch specific; a portable form "
        "(PATH resolution or per-host override) is a pending captain "
        "decision (#8/#9 class)",
}

ABS_USER_PATH_RE = re.compile(
    r"/(?:home|Users)/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*")


def check_portability(repo):
    files = scope_files(repo)
    if not files:
        return False, ["no tracked files in config-lint scope"]
    problems = []
    for rel in files:
        for m in ABS_USER_PATH_RE.finditer((repo / rel).read_text()):
            path = m.group(0)
            if (rel, path) in PORTABILITY_GAPS:
                continue
            problems.append(
                f"FAIL {rel}: contains the absolute user path '{path}'; "
                f"use $HOME-relative or portable values (#8/#9)")
    if problems:
        return False, problems
    gaps = "; ".join(f"{rel}: {reason}" for (rel, _p), reason
                    in PORTABILITY_GAPS.items())
    return True, [f"no absolute /home/<user> or /Users/<user> paths beyond "
                  f"the recorded gap(s) in {len(files)} tracked files",
                  f"known gap (captain decision pending): {gaps}"]


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------

CHECKS = [
    ("C1 toml-parse", check_toml_parse),
    ("C2 json-parse", check_json_parse),
    ("C3 yaml-parse", check_yaml_parse),
    ("C4 starship-structure", check_starship),
    ("C5 aerospace-structure", check_aerospace),
    ("C6 tmuxinator-structure", check_tmuxinator),
    ("C7 k9s-skin-structure", check_k9s),
    ("C8 neovide-structure", check_neovide),
    ("C9 git-config-structure", check_git_config),
    ("C10 lazygit-structure", check_lazygit),
    ("C11 omarchy-template", check_omarchy),
    ("C12 code-snippet-parse", check_code_snippets),
    ("C13 blinksh-theme", check_blinksh),
    ("C14 portability-tripwire", check_portability),
]

_CHECK_BY_NAME = dict(CHECKS)


def run_check(repo, name):
    fn = _CHECK_BY_NAME[name]
    try:
        return fn(repo)
    except Exception as exc:  # noqa: BLE001
        return False, [f"FAIL {name}: check crashed: {exc!r}"]


def report(name, status, messages, elapsed):
    label = "PASS" if status is True else ("SKIP" if status == "SKIP"
                                           else "FAIL")
    for message in messages:
        print(f"{label} {name} ({elapsed:.2f}s): {message}")
    return status is not False


def main():
    start = time.monotonic()
    failures = []
    for name, _fn in CHECKS:
        t0 = time.monotonic()
        status, messages = run_check(REPO, name)
        if not report(name, status, messages, time.monotonic() - t0):
            failures.append(name)
    total = time.monotonic() - start
    print(f"config-lint suite: {len(CHECKS) - len(failures)}/{len(CHECKS)} "
          f"checks passed, {len(failures)} failed, {total:.2f}s total")
    if failures:
        print("FAILED checks: " + ", ".join(failures))
        return 1
    return 0


# --------------------------------------------------------------------------
# Selftest — every check must FAIL on a mutated sandbox copy
# --------------------------------------------------------------------------

def _build_sandbox(tmp):
    sandbox = Path(tmp) / "sandbox"
    sandbox.mkdir()
    _restore_pristine(sandbox)
    subprocess.run(["git", "init", "-q"], cwd=sandbox, timeout=30,
                   capture_output=True, check=True)
    _git_add(sandbox)
    return sandbox


def _restore_pristine(sandbox):
    for rel in scope_files(REPO):
        dest = sandbox / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / rel, dest)


def _git_add(sandbox):
    subprocess.run(["git", "add", "-A"], cwd=sandbox, timeout=60,
                   capture_output=True, check=True)


def _mut_append(rel, text):
    def mutate(sandbox):
        with (sandbox / rel).open("a") as fh:
            fh.write(text)
    return mutate


def _mut_replace(rel, old, new):
    def mutate(sandbox):
        path = sandbox / rel
        text = path.read_text()
        if old not in text:
            raise RuntimeError(f"mutation anchor missing in {rel}")
        path.write_text(text.replace(old, new, 1))
    return mutate


def _mut_add_broken_json(rel):
    def mutate(sandbox):
        (sandbox / rel).write_text("{broken json")
        _git_add(sandbox)
    return mutate


def _mut_break_lua(rel):
    def mutate(sandbox):
        (sandbox / rel).write_text("local x = = =\n")
    return mutate


# Each entry: (check, mutation, description, required tool or None).
# A tool-gated mutation self-reports SKIP on hosts without the tool.
SELFTEST_MUTATIONS = [
    ("C1 toml-parse",
     _mut_append("neovide/.config/neovide/config.toml", "\nbroken [[\n"),
     "malformed TOML in neovide config",
     None),
    ("C2 json-parse",
     _mut_add_broken_json("code/broken.json"),
     "malformed JSON added under code/",
     None),
    ("C3 yaml-parse",
     _mut_replace("tmuxinator/.tmuxinator/batooney.yaml",
                  "windows:\n", "windows:\n\t- x\n"),
     "tab-indented YAML in a tmuxinator project",
     None),
    ("C4 starship-structure",
     _mut_append("starship/.config/starship.toml", "\n[not_a_module]\n"),
     "unknown module block in starship config",
     None),
    ("C5 aerospace-structure",
     _mut_replace("aerospace/.aerospace.toml", "mode service", "mode ghost"),
     "keybinding targets an undeclared aerospace mode",
     None),
    ("C6 tmuxinator-structure",
     _mut_replace("tmuxinator/.tmuxinator/batooney.yaml",
                  "name: batooney\n", ""),
     "tmuxinator project loses its session name",
     None),
    ("C7 k9s-skin-structure",
     _mut_replace("kube/.config/k9s/skins/gruvbox-dark.yaml",
                  "k9s:", "k9sX:"),
     "k9s skin loses its top-level k9s mapping",
     None),
    ("C8 neovide-structure",
     _mut_replace("neovide/.config/neovide/config.toml", "[font]", "[fontX]"),
     "neovide config loses the #30 [font] section",
     None),
    ("C9 git-config-structure",
     _mut_replace("git/.config/git/config", "[user]", "[user"),
     "git config no longer parses",
     None),
    ("C10 lazygit-structure",
     _mut_append("git/.config/lazygit/config.yml", "bogusSection: 1\n"),
     "unknown top-level key in lazygit config",
     None),
    ("C11 omarchy-template",
     _mut_replace("omarchy/.config/omarchy/themed/hyprland.lua.tpl",
                  "orange }}", "orange "),
     "omarchy template loses a closing }}",
     None),
    ("C12 code-snippet-parse",
     _mut_break_lua("code/lua/hello.lua"),
     "Lua snippet no longer parses",
     "luac"),
    ("C13 blinksh-theme",
     _mut_replace("blinksh/gruvbox.js",
                  "lightBlack   , lightRed  , lightGreen , lightYellow,",
                  "lightBlack   , lightRed  , lightGreen ,"),
     "blinksh palette call omits a color",
     None),
    ("C14 portability-tripwire",
     _mut_append("starship/.config/starship.toml",
                 "\n# hint: /home/ghostuser/.config/example\n"),
     "absolute /home/<user> path appears in a tracked config",
     None),
]


def selftest():
    start = time.monotonic()
    failures = []
    caught = 0
    skipped = 0
    with tempfile.TemporaryDirectory(prefix="config-lint-selftest-") as tmp:
        sandbox = _build_sandbox(tmp)
        # Baseline: every check passes on the pristine sandbox.
        for name, _fn in CHECKS:
            status, messages = run_check(sandbox, name)
            if status is False:
                failures.append(f"baseline: {name} fails on a pristine "
                                f"copy: {messages}")
        # Mutations: the targeted check must fail, with the file named.
        for name, mutate, description, tool in SELFTEST_MUTATIONS:
            t0 = time.monotonic()
            if tool and not shutil.which(tool):
                print(f"SKIP selftest {name}: host lacks '{tool}'; the "
                      f"mutation is not provable here — {description}")
                skipped += 1
                continue
            _restore_pristine(sandbox)
            mutate(sandbox)
            status, messages = run_check(sandbox, name)
            elapsed = time.monotonic() - t0
            if status is False:
                print(f"PASS selftest {name} ({elapsed:.2f}s): mutation "
                      f"caught — {description}")
                caught += 1
            elif status == "SKIP":
                print(f"SKIP selftest {name} ({elapsed:.2f}s): check is "
                      f"tool-gated on this host; mutation not provable "
                      f"here — {description}")
            else:
                failures.append(f"selftest {name}: mutation not caught — "
                                f"{description}")
    total = time.monotonic() - start
    if failures:
        for f in failures:
            print(f"FAIL selftest: {f}")
        print(f"config-lint selftest: FAILED, {total:.2f}s total")
        return 1
    print(f"config-lint selftest: {caught}/{len(SELFTEST_MUTATIONS)} "
          f"mutations caught, {skipped} skipped (host tool gaps), "
          f"{total:.2f}s total")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(main())

#!/usr/bin/env python3
# Paths: secrets/** .sops.yaml nix/** scripts/sops-check.py scripts/test-sops-secrets.py
"""sops-secrets suite — the fleet's encrypted files and the names the Nix
modules read out of them agree, offline and without a key.

What it locks, in the order it runs:

  1. `secrets/` holds only sops-encrypted YAML. A plaintext file seeded there
     (an `.env`, a backup, a hand-decrypted copy) fails. The two names the root
     `.gitignore` reserves for local scratch (`keys.txt`, `*.dec.*`) are out of
     scope: they cannot be committed.
  2. Every `secrets/*.yaml` parses and carries a `sops:` metadata block with a
     version. A YAML file without one is plaintext that got tracked.
  3. `scripts/sops-check.py` (the `just secrets-check` guard) passes on the
     tree: one creation rule per file, every rule's recipients wrapped in the
     file, the admin recipient on every rule, no plaintext value.
  4. Every `sops.secrets.<name>` a Nix module declares has a matching
     top-level key in the secrets file that module references through
     `sops.defaultSopsFile` (its own, or one it reaches through `imports`).
     This is the gap the build catches only on a Linux host:
     `sops-install-secrets -check-mode=sopsfile` refuses a declared key that is
     absent, so a Mac-only edit looks fine until the deploy.

Offline, deterministic, key-free, sub-second: no network, no sops, no Nix, no
$HOME mutation, no sleeps. YAML comes from PyYAML when it is importable and
from `ruby -ryaml` otherwise (the pattern scripts/sops-check.py uses), so the
suite runs on the CI runner and on a bare macOS python3 alike. A missing YAML
parser SKIPs the parse-dependent checks locally and FAILs under `STRICT=1`,
the repo's dual-mode rule. See docs/ci-tests/sops-secrets.md for scope and
known gaps, and docs/secrets.md for the runbooks.

    python3 scripts/test-sops-secrets.py              # the real tree
    python3 scripts/test-sops-secrets.py --selftest   # seeded failures, tmp copy
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS_DIR = ROOT / "secrets"
NIX_DIR = ROOT / "nix"
SOPS_CHECK = ROOT / "scripts" / "sops-check.py"
CHECK_TIMEOUT = 30  # per subprocess call, seconds
STRICT = os.environ.get("STRICT") == "1"

# Names the root .gitignore reserves for local scratch under secrets/. They can
# never be committed, so they are not this suite's business.
SCRATCH_NAMES = ("keys.txt",)
SCRATCH_MARKERS = (".dec.",)

DEFAULT_SOPS_FILE = re.compile(r"sops\.defaultSopsFile\s*=\s*([^;]+);")
SECRETS_BLOCK = re.compile(r"sops\.secrets\s*=\s*\{")
SECRETS_SINGLE = re.compile(r'sops\.secrets\.([A-Za-z0-9_.-]+)\s*\.\s*\w+\s*=')
QUOTED_KEY = re.compile(r'"([A-Za-z0-9_.-]+)"\s*\.')
RELATIVE_IMPORT = re.compile(r"(?:\.{1,2}/[\w./+-]+)")

RESULTS = []


def record(name, ok, reason="", secs=None):
    RESULTS.append((name, ok, reason))
    label = "PASS" if ok is True else "FAIL" if ok is False else "SKIP"
    timing = " (%.2f s)" % secs if secs is not None else ""
    suffix = " — %s" % reason if reason else ""
    print("%s %s%s%s" % (label, name, suffix, timing))


# --------------------------------------------------------------------------
# YAML: PyYAML, else ruby. Never pip-installs, never touches the network.
# --------------------------------------------------------------------------

try:
    import yaml as _pyyaml  # noqa: N813
except ImportError:  # pragma: no cover - depends on the interpreter image
    _pyyaml = None


def yaml_parser():
    """Return a callable `text -> object`, or None when no parser exists."""
    if _pyyaml is not None:
        return lambda text: _pyyaml.safe_load(text)
    if shutil.which("ruby"):
        def via_ruby(text):
            out = subprocess.run(
                ["ruby", "-ryaml", "-rjson", "-e",
                 "print YAML.safe_load(STDIN.read).to_json"],
                input=text, capture_output=True, text=True,
                timeout=CHECK_TIMEOUT,
            )
            if out.returncode != 0:
                raise ValueError(out.stderr.strip() or "ruby YAML parse failed")
            return json.loads(out.stdout)

        return via_ruby
    return None


# --------------------------------------------------------------------------
# Check 1 — only encrypted YAML lives under secrets/
# --------------------------------------------------------------------------


def secrets_entries():
    """Every non-scratch file under secrets/, recursively."""
    entries = []
    if not SECRETS_DIR.is_dir():
        return entries
    for path in sorted(SECRETS_DIR.rglob("*")):
        if not path.is_file():
            continue
        if path.name in SCRATCH_NAMES:
            continue
        if any(marker in path.name for marker in SCRATCH_MARKERS):
            continue
        entries.append(path)
    return entries


def check_secrets_tree_shape():
    if not SECRETS_DIR.is_dir():
        return False, "secrets/ is missing"
    stray = [
        p.relative_to(ROOT).as_posix()
        for p in secrets_entries()
        if p.suffix not in (".yaml", ".yml")
    ]
    if stray:
        return False, (
            "%s: plaintext file in secrets/ (only sops-encrypted *.yaml may "
            "live here)" % ", ".join(stray)
        )
    return True, "%d file(s), all *.yaml" % len(secrets_entries())


# --------------------------------------------------------------------------
# Check 2 — every secrets YAML has a sops metadata block
# --------------------------------------------------------------------------


def check_sops_blocks(load_yaml):
    files = [p for p in secrets_entries() if p.suffix in (".yaml", ".yml")]
    if not files:
        return False, "no secrets file to check"
    problems = []
    for path in files:
        rel = path.relative_to(ROOT).as_posix()
        try:
            doc = load_yaml(path.read_text())
        except Exception as exc:  # noqa: BLE001 - any parse error is a failure
            problems.append("%s: does not parse: %s" % (rel, exc))
            continue
        if not isinstance(doc, dict):
            problems.append("%s: no sops block, so this file is not encrypted" % rel)
            continue
        block = doc.get("sops")
        if not isinstance(block, dict):
            problems.append("%s: no sops block, so this file is not encrypted" % rel)
            continue
        if not block.get("version"):
            problems.append("%s: sops block has no version" % rel)
    if problems:
        return False, "; ".join(problems)
    return True, "%d file(s) carry a sops block" % len(files)


# --------------------------------------------------------------------------
# Check 3 — the guard itself (just secrets-check) is green
# --------------------------------------------------------------------------


def check_guard_script():
    if not SOPS_CHECK.is_file():
        return None, "scripts/sops-check.py is missing", None
    started = time.time()
    out = subprocess.run(
        [sys.executable, str(SOPS_CHECK)],
        cwd=str(ROOT), capture_output=True, text=True,
        timeout=CHECK_TIMEOUT, stdin=subprocess.DEVNULL,
    )
    secs = time.time() - started
    if out.returncode != 0:
        detail = (out.stdout + out.stderr).strip().splitlines()
        return False, "scripts/sops-check.py exited %d: %s" % (
            out.returncode, "; ".join(detail[-3:])
        ), secs
    tail = out.stdout.strip().splitlines()
    return True, tail[0] if tail else "exit 0", secs


# --------------------------------------------------------------------------
# Check 4 — every sops.secrets name exists in the file its module references
# --------------------------------------------------------------------------


CLOSERS = {"{": "}", "[": "]"}


def bracket_at(text, index):
    """The balanced `{ ... }` / `[ ... ]` slice starting at `index`, quotes respected."""
    start = index
    opener = text[index]
    closer = CLOSERS[opener]
    depth = 0
    while index < len(text):
        char = text[index]
        if char == '"':
            index += 1
            while index < len(text) and text[index] != '"':
                index += 2 if text[index] == "\\" else 1
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
        index += 1
    return None


def declared_secrets(text):
    """(names, unsupported) from a module's text."""
    names = set()
    unsupported = []
    match = SECRETS_BLOCK.search(text)
    if match:
        block = bracket_at(text, match.end() - 1)
        if block is None:
            return names, ["sops.secrets = { that never closes"]
        names.update(QUOTED_KEY.findall(block))
        if re.search(r"\bsopsFile\b", block):
            unsupported.append(
                "sops.secrets declares a per-secret `sopsFile`; this guard "
                "reads only `sops.defaultSopsFile`"
            )
    names.update(SECRETS_SINGLE.findall(text))
    return {n for n in names if n and n != "sops"}, unsupported


def modules_with_secrets():
    """[(module path, names, unsupported)] for every Nix file declaring secrets."""
    found = []
    if not NIX_DIR.is_dir():
        return found
    for path in sorted(NIX_DIR.rglob("*.nix")):
        names, unsupported = declared_secrets(path.read_text())
        if names or unsupported:
            found.append((path, names, unsupported))
    return found


def imports_of(text):
    """Relative nix paths a module pulls in (`imports = [ ... ]`, `import x`)."""
    tokens = []
    for match in re.finditer(r"\bimports\s*=\s*\[", text):
        block = bracket_at(text, match.end() - 1)
        if block is not None:
            tokens.extend(RELATIVE_IMPORT.findall(block))
    tokens.extend(
        m.group(1) for m in re.finditer(r"\bimport\s+(\.{1,2}/[\w./+-]+)", text)
    )
    return tokens


def resolve_import(parent, token):
    target = (parent / token).resolve()
    if target.is_dir():
        target = target / "default.nix"
    return target


def referenced_sops_files(module):
    """[(secrets file, the module that names it)] reachable from `module`."""
    seen = set()
    queue = [module.resolve()]
    found = []
    while queue:
        current = queue.pop(0)
        if current in seen or not current.is_file():
            continue
        seen.add(current)
        text = current.read_text()
        match = DEFAULT_SOPS_FILE.search(text)
        if match:
            raw = match.group(1).strip().strip('"').strip()
            found.append(((current.parent / raw).resolve(), current))
            continue
        for token in imports_of(text):
            queue.append(resolve_import(current.parent, token))
    return found


def rel(path):
    """Repo-relative posix path when it is inside the tree, else the path."""
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def check_declared_names(load_yaml):
    declarations = modules_with_secrets()
    if not declarations:
        return False, "no module declares sops.secrets; the guard checks nothing"
    problems = []
    checked = 0
    for module, names, unsupported in declarations:
        rel_path = rel(module)
        problems.extend("%s: %s" % (rel_path, reason) for reason in unsupported)
        if not names:
            continue
        files = referenced_sops_files(module)
        if not files:
            problems.append(
                "%s: declares sops.secrets but no sops.defaultSopsFile is "
                "reachable from it" % rel_path
            )
            continue
        for path, owner in files:
            if not path.is_file():
                problems.append(
                    "%s: sops.defaultSopsFile points at %s, which does not exist"
                    % (rel(owner), rel(path))
                )
        readable = []
        for path, _owner in files:
            if not path.is_file():
                continue
            try:
                doc = load_yaml(path.read_text())
            except Exception as exc:  # noqa: BLE001
                problems.append("%s: does not parse: %s" % (rel(path), exc))
                continue
            if isinstance(doc, dict):
                readable.append((path, doc))
        known = set()
        for _path, doc in readable:
            known.update(k for k in doc if isinstance(k, str))
        known.discard("sops")
        where = ", ".join(rel(p) for p, _d in readable)
        for name in sorted(names):
            checked += 1
            if name not in known:
                problems.append(
                    '%s: sops.secrets."%s" has no key in %s'
                    % (rel_path, name, where or "the referenced secrets file")
                )
    if problems:
        return False, "; ".join(problems)
    return True, "%d declared name(s) found in their secrets file" % checked


# --------------------------------------------------------------------------
# The selftest: seeded failures in a throwaway copy
# --------------------------------------------------------------------------

COPY_PATHS = (".sops.yaml", "secrets", "nix", "scripts/sops-check.py",
              "scripts/test-sops-secrets.py")


def make_copy(base):
    """A minimal tree the suite can run against: config, secrets, modules."""
    root = Path(base) / "repo"
    (root / "scripts").mkdir(parents=True)
    for relative in COPY_PATHS:
        source = ROOT / relative
        target = root / relative
        if source.is_dir():
            shutil.copytree(source, target,
                            ignore=shutil.ignore_patterns("keys.txt", "*.dec.*"))
        else:
            if target.parent == root / "scripts":
                target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    return root


def run_suite(root):
    out = subprocess.run(
        [sys.executable, str(root / "scripts" / "test-sops-secrets.py")],
        cwd=str(root), capture_output=True, text=True,
        timeout=CHECK_TIMEOUT, stdin=subprocess.DEVNULL,
        env={k: v for k, v in os.environ.items() if k != "STRICT"},
    )
    return out.returncode, out.stdout + out.stderr


def selftest():
    cases = []

    def grow(name, mutate, want):
        cases.append((name, mutate, want))

    grow("clean copy passes", lambda root: None, None)

    def seed_plaintext_yaml(root):
        (root / "secrets" / "plain.yaml").write_text("api_key: hunter2\n")

    grow("secrets YAML without a sops block", seed_plaintext_yaml, "no sops block")

    def seed_plaintext_env(root):
        (root / "secrets" / "pi-slack-mcp.env").write_text("SLACK_TOKEN=xoxb-123\n")

    grow("plaintext file seeded under secrets/", seed_plaintext_env,
         "plaintext file in secrets/")

    def seed_missing_key(root):
        module = root / "nix" / "modules" / "remote" / "homelab.nix"
        text = module.read_text()
        text = text.replace(
            '    "pi-whatsapp.env".mode = "0400";',
            '    "pi-whatsapp.env".mode = "0400";\n'
            '    "pi-slack-mcp.env".mode = "0400";',
        )
        module.write_text(text)

    grow("sops.secrets name with no key in its file", seed_missing_key,
         'sops.secrets."pi-slack-mcp.env" has no key')

    print("sops-secrets selftest: %d case(s) in a throwaway copy\n" % len(cases))
    base = tempfile.mkdtemp(prefix="sops-secrets-selftest-")
    failures = 0
    try:
        for index, (name, mutate, want) in enumerate(cases):
            root = make_copy(Path(base) / str(index))
            mutate(root)
            code, output = run_suite(root)
            if want is None:
                ok = code == 0
                detail = "exit %d" % code
            else:
                ok = code != 0 and want in output
                detail = "exit %d, %s %r" % (
                    code, "found" if want in output else "MISSING", want
                )
            label = "PASS" if ok else "FAIL"
            print("%s %s — %s" % (label, name, detail))
            if not ok:
                failures += 1
                print("\n".join("    " + line for line in output.splitlines()[-12:]))
    finally:
        shutil.rmtree(base, ignore_errors=True)
    total = len(cases)
    print("\nsops-secrets selftest: %d/%d case(s) as expected" % (total - failures, total))
    return 0 if failures == 0 else 1


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main(argv):
    if argv[1:2] == ["--selftest"]:
        return selftest()

    started = time.time()
    print("sops-secrets: %s\n" % ROOT)

    record("secrets/ holds only sops-encrypted yaml", *check_secrets_tree_shape())

    load_yaml = yaml_parser()
    if load_yaml is None:
        reason = "no YAML parser (PyYAML or ruby) available"
        # Parse-dependent checks: SKIP locally, FAIL in CI (STRICT=1).
        for name in ("every secrets yaml has a sops block",
                     "declared sops.secrets names exist in their file"):
            record(name, False if STRICT else None, reason)
        if not STRICT:
            record("scripts/sops-check.py passes (just secrets-check)", None, reason)
    else:
        record("every secrets yaml has a sops block", *check_sops_blocks(load_yaml))
        record("declared sops.secrets names exist in their file",
               *check_declared_names(load_yaml))

    if load_yaml is not None or STRICT:
        ok, reason, secs = check_guard_script()
        record("scripts/sops-check.py passes (just secrets-check)", ok, reason,
               secs)

    failed = [name for name, state, _ in RESULTS if state is False]
    skipped = [name for name, state, _ in RESULTS if state is None]
    total = time.time() - started
    print()
    if failed:
        print("sops-secrets: %d check(s) failed in %.2f s: %s"
              % (len(failed), total, ", ".join(failed)))
        return 1
    print("sops-secrets: %d check(s) passed, %d skipped in %.2f s"
          % (len(RESULTS) - len(skipped), len(skipped), total))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

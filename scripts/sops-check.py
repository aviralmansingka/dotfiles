#!/usr/bin/env python3
"""Check the fleet secrets scaffold offline. No keys, no network, no sops binary.

`just secrets-check` runs this. It answers one question: is every encrypted file
in `secrets/` readable by exactly the recipients `.sops.yaml` promises, and is
nothing in it plaintext?

    1. `.sops.yaml` parses and has at least one creation rule, each with a
       `path_regex` and at least one `age` recipient.
    2. The admin recipient is on every rule — the intersection of the rules'
       recipients is non-empty. One identity must be able to read the whole
       fleet.
    3. Every `secrets/*.yaml` matches exactly one rule, and every rule matches at
       least one file, so the rules and the files stay a one-to-one map.
    4. Every recipient a file's rule names is actually wrapped in that file's
       `sops.age` block. A rule edited without `sops updatekeys` fails here.
    5. No value outside the `sops` block is plaintext: every string leaf is an
       `ENC[...]` token (a key named `*<unencrypted_suffix>` is exempt, as sops
       allows).

Exit code 0 means all five hold. Anything else prints FAIL lines and exits 1.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / ".sops.yaml"
SECRETS_DIR = ROOT / "secrets"
AGE_RECIPIENT = re.compile(r"^age1[0-9a-z]{20,}$")
ENC_TOKEN = re.compile(r"^ENC\[.+\]$", re.DOTALL)

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)


# --------------------------------------------------------------------------
# YAML loading: PyYAML, else ruby (the pattern the other scripts/ suites use)
# --------------------------------------------------------------------------

try:
    import yaml as _pyyaml  # noqa: N813
except ImportError:
    _pyyaml = None


def load_yaml(path: Path):
    text = path.read_text()
    if _pyyaml is not None:
        return _pyyaml.safe_load(text)
    if shutil.which("ruby"):
        out = subprocess.run(
            [
                "ruby",
                "-ryaml",
                "-rjson",
                "-e",
                "print YAML.safe_load(File.read(ARGV.fetch(0))).to_json",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if out.returncode != 0:
            raise ValueError(out.stderr.strip() or "ruby YAML parse failed")
        return json.loads(out.stdout)
    raise RuntimeError(
        "no YAML parser available: install PyYAML or ruby; this check never "
        "pip-installs"
    )


# --------------------------------------------------------------------------
# recipients
# --------------------------------------------------------------------------


def recipients_of(rule: dict) -> list[str]:
    """`age` is a comma-separated string in sops docs, or a list of strings."""
    raw = rule.get("age")
    if raw is None:
        return []
    items = raw if isinstance(raw, list) else [raw]
    found = []
    for item in items:
        for part in str(item).replace("\n", ",").split(","):
            part = part.strip()
            if part:
                found.append(part)
    return found


def check_config():
    """Rules 1 and 2. Returns (rules, admin recipients)."""
    if not CONFIG.is_file():
        fail(f"{CONFIG.name}: missing")
        return [], set()
    try:
        doc = load_yaml(CONFIG)
    except Exception as exc:  # noqa: BLE001 - any parser error is a failure
        fail(f"{CONFIG.name}: does not parse: {exc}")
        return [], set()

    if not isinstance(doc, dict):
        fail(f"{CONFIG.name}: top level is not a mapping")
        return [], set()
    rules = doc.get("creation_rules")
    if not isinstance(rules, list) or not rules:
        fail(f"{CONFIG.name}: no creation_rules list")
        return [], set()

    per_rule = []
    for index, rule in enumerate(rules, start=1):
        where = f"{CONFIG.name}: creation_rules[{index}]"
        if not isinstance(rule, dict):
            fail(f"{where}: not a mapping")
            per_rule.append(set())
            continue
        pattern = rule.get("path_regex")
        if not isinstance(pattern, str) or not pattern:
            fail(f"{where}: no path_regex")
        recipients = recipients_of(rule)
        if not recipients:
            fail(f"{where}: no age recipients")
        for recipient in recipients:
            if not AGE_RECIPIENT.match(recipient):
                fail(f"{where}: {recipient!r} is not an age recipient")
        per_rule.append(set(recipients))

    admin = set.intersection(*per_rule) if per_rule else set()
    if not admin:
        fail(
            f"{CONFIG.name}: no recipient is on every rule, so no single admin "
            "key can read the whole fleet"
        )
    return rules, admin


# --------------------------------------------------------------------------
# secret files
# --------------------------------------------------------------------------


def secrets_files() -> list[Path]:
    if not SECRETS_DIR.is_dir():
        fail(f"{SECRETS_DIR.name}/: missing")
        return []
    return sorted(p for p in SECRETS_DIR.glob("*.y*ml") if p.is_file())


def walk_plaintext(node, path: str, unencrypted_suffix: str):
    """Yield the json-ish path of every leaf that is not an ENC[...] token."""
    if isinstance(node, dict):
        for key, value in node.items():
            child = f"{path}.{key}" if path else str(key)
            if unencrypted_suffix and str(key).endswith(unencrypted_suffix):
                continue
            yield from walk_plaintext(value, child, unencrypted_suffix)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from walk_plaintext(value, f"{path}[{index}]", unencrypted_suffix)
    elif isinstance(node, str):
        if not ENC_TOKEN.match(node):
            yield path


def check_file(path: Path, rules: list[dict]) -> None:
    rel = path.relative_to(ROOT).as_posix()
    try:
        doc = load_yaml(path)
    except Exception as exc:  # noqa: BLE001
        fail(f"{rel}: does not parse: {exc}")
        return
    if not isinstance(doc, dict):
        fail(f"{rel}: top level is not a mapping")
        return

    # Rule 4a: the sops block exists and carries recipients.
    sops_block = doc.get("sops")
    if not isinstance(sops_block, dict):
        fail(f"{rel}: no sops block, so this file is not encrypted")
        return
    if not sops_block.get("version"):
        fail(f"{rel}: sops block has no version")
    wrapped = {
        entry.get("recipient")
        for entry in sops_block.get("age") or []
        if isinstance(entry, dict)
    }
    if not wrapped:
        fail(f"{rel}: sops block wraps no age recipient")

    # Rule 3: exactly one creation rule owns this file.
    matching = [
        rule
        for rule in rules
        if isinstance(rule, dict)
        and isinstance(rule.get("path_regex"), str)
        and re.search(rule["path_regex"], rel)
    ]
    if len(matching) != 1:
        fail(f"{rel}: matched by {len(matching)} creation rules, expected 1")
        return

    # Rule 4b: the rule's recipients really are in the file.
    missing = set(recipients_of(matching[0])) - wrapped
    if missing:
        fail(
            f"{rel}: rule recipients missing from the file "
            f"({', '.join(sorted(missing))}); run `just secrets-rotate {rel}`"
        )

    # Rule 5: nothing outside the sops block is plaintext.
    suffix = str(sops_block.get("unencrypted_suffix") or "")
    body = {key: value for key, value in doc.items() if key != "sops"}
    plaintext = [p for p in walk_plaintext(body, "", suffix) if p]
    if plaintext:
        fail(f"{rel}: plaintext value at {', '.join(plaintext)}")


def main() -> int:
    rules, admin = check_config()
    files = secrets_files()

    for path in files:
        check_file(path, rules)

    if rules and files:
        for index, rule in enumerate(rules, start=1):
            pattern = rule.get("path_regex") if isinstance(rule, dict) else None
            if not isinstance(pattern, str):
                continue
            if not any(
                re.search(pattern, p.relative_to(ROOT).as_posix()) for p in files
            ):
                fail(
                    f"{CONFIG.name}: creation_rules[{index}] "
                    f"({PurePosixPath(pattern)}) matches no file in "
                    f"{SECRETS_DIR.name}/"
                )

    if failures:
        for message in failures:
            print(f"FAIL {message}")
        print(f"\nsops-check: {len(failures)} problem(s)")
        return 1

    print(f"sops-check: {len(files)} secrets file(s), {len(rules)} creation rule(s)")
    for path in files:
        print(f"  ok {path.relative_to(ROOT).as_posix()}")
    print(f"  admin recipient on every rule: {', '.join(sorted(admin))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

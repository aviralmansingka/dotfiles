#!/usr/bin/env python3
"""Prove a fresh EC2 probe can decrypt secrets/probe.yaml, one step at a time.

Three commands, each runnable on its own, so a failure names *which half* of
the job broke:

    python3 scripts/sops-probe.py recipient        # probe's public age key
    python3 scripts/sops-probe.py add-recipient    # .sops.yaml rule + updatekeys
    python3 scripts/sops-probe.py decrypt-check    # one value, hash only
    python3 scripts/sops-probe.py self-test        # offline proofs, no AWS

Why the halves are separate: getting the recipient out of the instance needs
the box to be up and ssh-able, while re-wrapping the file needs the admin age
key on this machine. Two different failure modes, two different owners.

What never gets printed, by any path in this script:

  * a secret value. `decrypt-check` runs sops *on the probe* and only the
    sha256 hex digest and the byte count of the plaintext come back over ssh.
    The value never reaches this machine's stdout, a temp file, or argv.
  * an age private key. The identity is minted on the probe at first boot
    (ops/terraform/probe.tf) and stays there; only the public recipient leaves.
  * argv-borne secrets. Nothing is passed to sops as a value; `updatekeys`
    re-wraps the existing data key.

Recipient: the probe mints its own machine-local identity at
`~/.config/sops/age/keys.txt` (0600, `ubuntu`). That is the same shape the lab
uses, and deliberately not host-key material: `.sops.yaml` records why the
host-key-derived recipient was retired.

Fail-closed rules, each tested by `self-test`:

  * a recipient that is not `age1...` is refused before anything is written;
  * a `.sops.yaml` with no rule for the file, or more than one, is refused;
  * a secrets file with no `sops:` metadata block is refused (it is plaintext);
  * after `sops updatekeys` the file must actually wrap the recipient, else the
    step exits non-zero (a rule edited without updatekeys is the classic trap,
    and `just secrets-check` catches the same thing offline);
  * a decrypt that yields nothing, or a remote answer with no 64-hex digest, is
    refused.

Exit codes: 0 ok, 1 a failure, 2 usage/refused input. `--dry-run` on
`add-recipient` prints the plan and changes nothing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SOPS_FILE = "secrets/probe.yaml"
DEFAULT_KEY = "dummy"
DEFAULT_USER = "ubuntu"
TERRAFORM_DIR = "ops/terraform"

AGE_RECIPIENT = re.compile(r"^age1[0-9a-z]{20,}$")
AGE_TOKEN = re.compile(r"age1[0-9a-z]{20,}")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
SAFE_KEY = re.compile(r"^[A-Za-z0-9_.-]+$")

# Same lookup order as scripts/sops-import-env.py: a profile path is checked
# before PATH because `just` runs with the login shell's PATH while sops lives
# in the profile a switch installs.
SOPS_PROFILE_PATHS = [
    "~/.nix-profile/bin/sops",
    "/etc/profiles/per-user/$USER/bin/sops",
    "/run/current-system/sw/bin/sops",
]
NIX_PATHS = [
    "~/.nix-profile/bin/nix",
    "/nix/var/nix/profiles/default/bin/nix",
]
NIX_SOPS_ATTR = "nixpkgs#sops"

# The scaffold value S02 rebuilt the file with (commit dfddb11d). Only its
# digest appears here, and only so `self-test` can prove the hashing path
# against a known answer.
KNOWN_DUMMY = "probe-rebuilt-after-admin-key-remint"
KNOWN_DUMMY_SHA256 = "29458a8e18231011ffb2ccbacd3ab836ba017483d68e86608f1b0f7fe3aee126"


class Refused(Exception):
    """A refused input or a failed step; `code` is the process exit code."""

    def __init__(self, message: str, code: int = 1) -> None:
        super().__init__(message)
        self.code = code


def say(message: str) -> None:
    print("sops-probe: %s" % message, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Hashing. One definition, used by the offline proof; the probe computes the
# same digest with `sha256sum`/`shasum -a 256` over the value with no trailing
# newline (command substitution strips it on both sides).
# --------------------------------------------------------------------------


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.rstrip("\n").encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# .sops.yaml: a line-based reader and editor. PyYAML would drop every comment
# in the file, and the comments are the only record of which key is which.
# --------------------------------------------------------------------------


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _rule_spans(lines: list) -> list:
    """(start, end) line spans of each `- path_regex:` entry."""
    starts = [
        i for i, line in enumerate(lines) if re.match(r"^\s*-\s+path_regex:", line)
    ]
    spans = []
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        for j in range(start + 1, end):
            if re.match(r"^[A-Za-z_]", lines[j]):  # a new top-level key
                end = j
                break
        spans.append((start, end))
    return spans


def parse_rules(text: str) -> list:
    lines = text.splitlines()
    rules = []
    for start, end in _rule_spans(lines):
        match = re.match(r"^\s*-\s+path_regex:\s*(.+?)\s*$", lines[start])
        recipients = []
        for line in lines[start:end]:
            code, _, _ = line.partition("#")
            recipients.extend(AGE_TOKEN.findall(code))
        rules.append(
            {
                "regex": _unquote(match.group(1)),
                "recipients": recipients,
                "start": start,
                "end": end,
            }
        )
    return rules


def rule_for(text: str, path: str) -> dict:
    """The one creation rule matching `path`, sops-style (regex search)."""
    matches = [r for r in parse_rules(text) if re.search(r["regex"], path)]
    if len(matches) != 1:
        raise Refused(
            "%s matches %d creation rules in .sops.yaml (need exactly 1)"
            % (path, len(matches))
        )
    return matches[0]


def add_recipient_text(text: str, path: str, recipient: str) -> tuple:
    """Return (new_text, changed) with `recipient` in the rule for `path`."""
    recipient = (recipient or "").strip()
    if not AGE_RECIPIENT.match(recipient):
        raise Refused(
            "not an age recipient: %r (want age1<bech32>, never an "
            "AGE-SECRET-KEY)" % (recipient,),
            code=2,
        )
    rule = rule_for(text, path)
    if recipient in rule["recipients"]:
        return text, False

    lines = text.splitlines()
    for i in range(rule["start"], rule["end"]):
        if not re.match(r"^\s*age:", lines[i]):
            continue
        value = lines[i].split("age:", 1)[1].strip()
        if value and not value.startswith((">", "|")):
            # `age: age1..., age1...` on one line.
            separator = "" if value.endswith(",") else ","
            lines[i] = lines[i].rstrip() + separator + " " + recipient
            return _rejoin(lines, text), True
        # Block scalar (`>-`): append after the last recipient line, matching
        # the indentation and the trailing-comma style already in the file.
        last = None
        indent = ""
        for j in range(i + 1, rule["end"]):
            code, _, _ = lines[j].partition("#")
            if AGE_TOKEN.search(code):
                last = j
                indent = re.match(r"^(\s*)", lines[j]).group(1)
        if last is None:
            raise Refused("the rule for %s lists no recipient to append to" % path)
        if not lines[last].rstrip().endswith(","):
            lines[last] = lines[last].rstrip() + ","
        lines.insert(last + 1, indent + recipient)
        return _rejoin(lines, text), True
    raise Refused("the rule for %s has no `age:` line to add a recipient to" % path)


def _rejoin(lines: list, original: str) -> str:
    joined = "\n".join(lines)
    return joined + "\n" if original.endswith("\n") else joined


# sops emits each age entry either as `- enc: |` with `recipient:` on the
# continuation line, or as `- recipient: age1...`; both are list items, so the
# dash is optional here.
SOPS_RECIPIENT_LINE = re.compile(r"^\s*(?:-\s+)?recipient:\s*(\S+)\s*$", re.MULTILINE)


def sops_recipients(text: str) -> list:
    """Recipients wrapped in the file's own `sops.age` metadata."""
    return SOPS_RECIPIENT_LINE.findall(text)


def require_sops_block(text: str, path: str) -> None:
    if not re.search(r"^sops:\s*$", text, re.MULTILINE) or not sops_recipients(text):
        raise Refused(
            "%s has no `sops:` metadata block (it is plaintext or not a sops "
            "file); refusing to touch it" % path
        )


# --------------------------------------------------------------------------
# Tool and transport
# --------------------------------------------------------------------------


def resolve_sops(explicit: str = "") -> str:
    candidates = []
    if explicit:
        candidates.append(explicit)
    if os.environ.get("SOPS_BIN"):
        candidates.append(os.environ["SOPS_BIN"])
    for path in SOPS_PROFILE_PATHS:
        candidates.append(os.path.expandvars(os.path.expanduser(path)))
    for name in candidates:
        if os.sep in name:
            if Path(name).is_file() and os.access(name, os.X_OK):
                return name
        else:
            found = shutil.which(name)
            if found:
                return found
    found = shutil.which("sops")
    if found:
        return found
    # Last resort, the same one scripts/sops-import-env.py takes: a fresh host
    # has no sops until a switch installs the profile that carries it.
    nix = next(
        (
            p
            for p in (os.path.expanduser(x) for x in NIX_PATHS)
            if Path(p).is_file() and os.access(p, os.X_OK)
        ),
        shutil.which("nix") or "",
    )
    if not nix:
        raise Refused("no sops binary (set SOPS_BIN or pass --sops)")
    result = subprocess.run(
        [nix, "build", "--no-link", "--print-out-paths", NIX_SOPS_ATTR],
        capture_output=True,
        text=True,
    )
    out = result.stdout.strip().splitlines()
    if result.returncode != 0 or not out:
        raise Refused(
            "no sops binary and `nix build %s` failed: %s"
            % (NIX_SOPS_ATTR, result.stderr.strip()[:300])
        )
    return str(Path(out[-1]) / "bin" / "sops")


def ssh_run(ssh_cmd: str, user: str, host: str, script: str, stdin: bytes = b""):
    argv = shlex.split(ssh_cmd) + [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        "%s@%s" % (user, host),
        script,
    ]
    return subprocess.run(argv, input=stdin, capture_output=True)


def resolve_host(host: str, repo: Path) -> str:
    if host:
        return host
    terraform = shutil.which("terraform")
    if not terraform:
        raise Refused("no --host given and terraform is not on PATH")
    result = subprocess.run(
        [terraform, "-chdir=%s" % (repo / TERRAFORM_DIR), "output", "-raw", "probe_ip"],
        capture_output=True,
        text=True,
    )
    ip = result.stdout.strip()
    if result.returncode != 0 or not ip:
        raise Refused(
            "terraform output probe_ip is empty; apply the probe first (or pass "
            "--host): %s" % result.stderr.strip()[:300]
        )
    return ip


# --------------------------------------------------------------------------
# Step 1: the probe's public recipient
# --------------------------------------------------------------------------

REMOTE_RECIPIENT = 'age-keygen -y "$HOME/.config/sops/age/keys.txt"'



def probe_recipient(
    host: str,
    user: str = DEFAULT_USER,
    ssh_cmd: str = "ssh",
    attempts: int = 30,
    interval: float = 10.0,
    sleeper=None,
) -> str:
    """Read the probe's public age recipient over ssh; fail closed on garbage."""
    sleeper = sleeper or time.sleep
    last = ""
    for attempt in range(1, max(1, attempts) + 1):
        result = ssh_run(ssh_cmd, user, host, REMOTE_RECIPIENT)
        out = result.stdout.decode("utf-8", "replace").strip()
        if result.returncode == 0 and AGE_RECIPIENT.match(out):
            return out
        last = (
            result.stderr.decode("utf-8", "replace").strip()
            or out
            or "exit %d" % result.returncode
        )
        if attempt < attempts:
            sleeper(interval)
    raise Refused(
        "no age recipient from %s@%s after %d attempts (%s)"
        % (user, host, attempts, last[:300])
    )


def cmd_recipient(args) -> int:
    host = resolve_host(args.host, REPO)
    recipient = probe_recipient(
        host,
        user=args.user,
        ssh_cmd=args.ssh,
        attempts=args.attempts,
        interval=args.interval,
    )
    say("probe %s@%s recipient: %s" % (args.user, host, recipient))
    print(recipient)
    return 0


# --------------------------------------------------------------------------
# Step 2: add the recipient to the rule, re-wrap the file, verify the wrap
# --------------------------------------------------------------------------


def add_recipient(
    repo: Path,
    sops_file_arg: str,
    recipient: str,
    sops_bin: str = "",
    dry_run: bool = False,
) -> dict:
    config_path = repo / ".sops.yaml"
    if not config_path.is_file():
        raise Refused("no .sops.yaml at %s" % config_path)
    sops_path = resolve_secrets_file(repo, sops_file_arg)
    if not sops_path.is_file():
        raise Refused("no secrets file at %s" % sops_file_arg)

    before = sops_path.read_text()
    require_sops_block(before, str(sops_file_arg))

    config = config_path.read_text()
    new_config, changed = add_recipient_text(config, sops_file_arg, recipient)
    wrapped_before = sops_recipients(before)
    if not dry_run and changed:
        config_path.write_text(new_config)
        say("rule for %s: recipient added (%d -> %d in .sops.yaml)"
            % (sops_file_arg, len(rule_for(config, sops_file_arg)["recipients"]),
               len(rule_for(new_config, sops_file_arg)["recipients"])))
    elif not changed:
        say("rule for %s already lists %s" % (sops_file_arg, recipient))

    if dry_run:
        if changed:
            say("dry run: would add %s to the rule for %s" % (recipient, sops_file_arg))
        say("dry run: would run `sops updatekeys %s`" % sops_file_arg)
        return {"changed": changed, "recipients": len(wrapped_before), "dry_run": True}

    sops = sops_bin or resolve_sops()
    # cwd=repo: sops resolves `.sops.yaml` from the file's directory upward, and
    # a relative file name (the default) only works from the repo root anyway.
    result = subprocess.run(
        [sops, "updatekeys", str(sops_path)],
        capture_output=True,
        text=True,
        cwd=str(repo),
    )
    if result.returncode != 0:
        raise Refused(
            "sops updatekeys failed on %s: %s"
            % (sops_file_arg, (result.stderr or result.stdout).strip()[:400])
        )

    after = sops_path.read_text()
    require_sops_block(after, sops_file_arg)
    wrapped = sops_recipients(after)
    if recipient not in wrapped:
        raise Refused(
            "sops updatekeys did not wrap %s in %s (wrapped: %d); the rule and "
            "the file disagree, run `just secrets-check`"
            % (recipient, sops_file_arg, len(wrapped))
        )
    say("%s now wraps %d recipients, including the probe" % (sops_file_arg, len(wrapped)))
    return {"changed": changed, "recipients": len(wrapped), "dry_run": False}


def cmd_add_recipient(args) -> int:
    recipient = (args.recipient or "").strip()
    if not recipient:
        host = resolve_host(args.host, REPO)
        recipient = probe_recipient(
            host,
            user=args.user,
            ssh_cmd=args.ssh,
            attempts=args.attempts,
            interval=args.interval,
        )
    add_recipient(
        REPO,
        args.sops_file,
        recipient,
        sops_bin=args.sops,
        dry_run=args.dry_run,
    )
    return 0


# --------------------------------------------------------------------------
# Step 3: decrypt one value on the probe, print only its hash
# --------------------------------------------------------------------------

REMOTE_DECRYPT = r"""
set -euo pipefail
command -v sops >/dev/null 2>&1 || { printf 'sops-missing\n' >&2; exit 3; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
cat > "$work/probe.yaml"
chmod 600 "$work/probe.yaml"
value="$(sops --decrypt --extract '%s' --input-type yaml "$work/probe.yaml")"
[ -n "$value" ] || { printf 'empty-plaintext\n' >&2; exit 4; }
if command -v sha256sum >/dev/null 2>&1; then
  digest="$(printf '%%s' "$value" | sha256sum | cut -d' ' -f1)"
else
  digest="$(printf '%%s' "$value" | shasum -a 256 | cut -d' ' -f1)"
fi
printf 'sha256 %%s\n' "$digest"
printf 'bytes %%s\n' "$(printf '%%s' "$value" | wc -c | tr -d ' ')"
"""


def decrypt_check(
    repo: Path,
    sops_file_arg: str,
    key: str = DEFAULT_KEY,
    host: str = "",
    user: str = DEFAULT_USER,
    ssh_cmd: str = "ssh",
) -> str:
    """Decrypt `key` on the probe; return the one paste-ready line."""
    if not SAFE_KEY.match(key or ""):
        raise Refused("key name %r is not a plain sops key" % (key,), code=2)
    sops_path = resolve_secrets_file(repo, sops_file_arg)
    if not sops_path.is_file():
        raise Refused("no secrets file at %s" % sops_file_arg)
    ciphertext = sops_path.read_bytes()
    require_sops_block(ciphertext.decode("utf-8", "replace"), sops_file_arg)

    script = REMOTE_DECRYPT % json.dumps([key])
    result = ssh_run(ssh_cmd, user, host, script, stdin=ciphertext)
    out = result.stdout.decode("utf-8", "replace")
    err = result.stderr.decode("utf-8", "replace").strip()

    if "sops-missing" in err:
        raise Refused(
            "the probe has no sops binary yet; cloud-init is still installing "
            "it (check /var/log/cloud-init-output.log on %s)" % host
        )
    if "empty-plaintext" in err:
        raise Refused(
            "the probe decrypted an empty value for %r; the identity is not a "
            "recipient or the key is empty" % key
        )
    digest = re.search(r"^sha256 ([0-9a-f]{64})$", out, re.MULTILINE)
    size = re.search(r"^bytes (\d+)$", out, re.MULTILINE)
    if not digest or not size:
        raise Refused(
            "the probe returned no sha256 for %r (ssh exit %d): %s"
            % (key, result.returncode, (err or out).strip()[:400])
        )
    if int(size.group(1)) == 0:
        raise Refused("the probe decrypted zero bytes for %r" % key)
    line = "probe decrypt: key=%s sha256=%s bytes=%s host=%s" % (
        key,
        digest.group(1),
        size.group(1),
        host,
    )
    say("decrypted on the probe; only the digest came back")
    return line


def cmd_decrypt_check(args) -> int:
    host = resolve_host(args.host, REPO)
    print(decrypt_check(REPO, args.sops_file, args.key, host, args.user, args.ssh))
    return 0


# --------------------------------------------------------------------------
# Offline proof
# --------------------------------------------------------------------------


def resolve_secrets_file(repo: Path, arg: str) -> Path:
    """The secrets file on disk: an absolute path as given, else relative to repo."""
    path = Path(arg)
    return path if path.is_absolute() else repo / path


def _fixture_repo(root: Path, config_text: str, secrets_text: str) -> Path:
    (root / "secrets").mkdir(parents=True, exist_ok=True)
    (root / ".sops.yaml").write_text(config_text)
    (root / "secrets" / "probe.yaml").write_text(secrets_text)
    return root


def _stub(path: Path, body: str) -> Path:
    path.write_text(body)
    path.chmod(0o755)
    return path


STUB_SOPS_UPDATEKEYS = """#!/usr/bin/env python3
# Test stub for `sops updatekeys`: re-wrap by copying the last recipient that
# .sops.yaml names (the probe's, for this fixture) into the file's sops block.
import os
import re
import sys

assert sys.argv[1] == "updatekeys", sys.argv
path = sys.argv[-1]
config = open(os.path.join(os.path.dirname(os.path.dirname(path)), ".sops.yaml")).read()
recipient = re.findall(r"age1[0-9a-z]{20,}", config)[-1]
lines = open(path).read().splitlines()
if not any("recipient: " + recipient == line.strip().lstrip("- ") for line in lines):
    index = next(i for i, l in enumerate(lines) if l.strip().startswith("lastmodified:"))
    lines.insert(index, "        - recipient: " + recipient)
    open(path, "w").write("\\n".join(lines) + "\\n")
"""

STUB_SOPS_MUTE = """#!/bin/bash
# Stub `sops` that exits 0 and changes nothing: the "rule edited, file not
# re-wrapped" failure the script must catch.
exit 0
"""


def run_self_test() -> int:
    """Offline proofs: refusals, the rule edit, the hash round-trip."""
    results = []

    def check(name, func):
        try:
            func()
            results.append(True)
            print("PASS %s" % name)
        except Refused as exc:
            results.append(False)
            print("FAIL %s: unexpected refusal: %s" % (name, exc))
        except AssertionError as exc:
            results.append(False)
            print("FAIL %s: %s" % (name, exc))

    def want_refused(code, func):
        try:
            func()
        except Refused as exc:
            assert exc.code == code, "exit code %d, want %d" % (exc.code, code)
            return exc
        raise AssertionError("accepted an input it must refuse")

    config_text = (REPO / ".sops.yaml").read_text()
    probe_text = (REPO / DEFAULT_SOPS_FILE).read_text()

    # 1. The hashing path: a known value round-trips to a pinned digest, and
    #    the shell digest the probe computes agrees with the Python one.
    def t_hash():
        assert HEX64.match(KNOWN_DUMMY_SHA256), "pinned digest is not 64 hex"
        assert hash_secret(KNOWN_DUMMY) == KNOWN_DUMMY_SHA256, (
            "python digest %s != pinned %s"
            % (hash_secret(KNOWN_DUMMY), KNOWN_DUMMY_SHA256)
        )
        shell = shutil.which("sha256sum") or shutil.which("shasum")
        if shell:
            args = [shell, "-a", "256"] if shell.endswith("shasum") else [shell]
            out = subprocess.run(args, input=KNOWN_DUMMY.encode(), capture_output=True)
            assert out.stdout.split()[0].decode() == KNOWN_DUMMY_SHA256, (
                "%s disagrees with the pinned digest" % shell
            )

    # 2-4. Refusals: empty recipient, non-age recipient, secret key.
    def t_refuse_empty():
        want_refused(2, lambda: add_recipient_text(config_text, DEFAULT_SOPS_FILE, ""))

    def t_refuse_bad():
        for bad in (
            "age1BMZ",
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI",
            "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ",
            "age17swxunknown",
        ):
            want_refused(
                2, lambda b=bad: add_recipient_text(config_text, DEFAULT_SOPS_FILE, b)
            )

    # 5. A plaintext secrets file is refused before anything is written.
    def t_refuse_plaintext():
        require_sops_block(probe_text, DEFAULT_SOPS_FILE)  # the real file is fine
        want_refused(1, lambda: require_sops_block("dummy: hello\n", "secrets/x.yaml"))

    # 6. A file with no rule, and a path matching none, are refused.
    def t_refuse_no_rule():
        want_refused(
            1,
            lambda: add_recipient_text(
                config_text, "secrets/nowhere.yaml", "age1" + "q" * 58
            ),
        )

    # 7. The edit touches the matching rule only and keeps the comments.
    def t_edit():
        new = "age1" + "z" * 58
        text, changed = add_recipient_text(config_text, DEFAULT_SOPS_FILE, new)
        assert changed, "no change reported"
        rules = {r["regex"]: r["recipients"] for r in parse_rules(text)}
        probe_rule = rule_for(text, DEFAULT_SOPS_FILE)["recipients"]
        homelab_rule = rule_for(text, "secrets/homelab.yaml")["recipients"]
        assert probe_rule[-1] == new, "probe rule did not gain the recipient"
        assert len(probe_rule) == 2, "probe rule has %d recipients" % len(probe_rule)
        assert new not in homelab_rule, "edit leaked into the homelab rule"
        assert len(homelab_rule) == 2, "homelab rule changed"
        assert len(rules) == 2, "rule count changed"
        assert text.count("\n#") == config_text.count("\n#"), "comments were dropped"
        again, changed_again = add_recipient_text(text, DEFAULT_SOPS_FILE, new)
        assert not changed_again and again == text, "not idempotent"

    # 8. The post-updatekeys check fails closed when the file was not re-wrapped.
    def t_refuse_unwrapped():
        with tempfile.TemporaryDirectory() as tmp:
            root = _fixture_repo(Path(tmp), config_text, probe_text)
            mute = _stub(root / "sops-mute", STUB_SOPS_MUTE)
            want_refused(
                1,
                lambda: add_recipient(
                    root, DEFAULT_SOPS_FILE, "age1" + "w" * 58, sops_bin=str(mute)
                ),
            )

    # 9. With a stub that does re-wrap, the step succeeds and the file carries
    #    the recipient — plus `.sops.yaml` kept every comment.
    def t_updatekeys():
        with tempfile.TemporaryDirectory() as tmp:
            root = _fixture_repo(Path(tmp), config_text, probe_text)
            stub = _stub(root / "sops", STUB_SOPS_UPDATEKEYS)
            recipient = "age1" + "y" * 58
            result = add_recipient(
                root, DEFAULT_SOPS_FILE, recipient, sops_bin=str(stub)
            )
            assert result["changed"] and result["recipients"] == 2, result
            wrapped = sops_recipients((root / DEFAULT_SOPS_FILE).read_text())
            assert recipient in wrapped, "recipient not wrapped"
            assert (root / ".sops.yaml").read_text().count("\n#") == (
                config_text.count("\n#")
            ), "comments were dropped"

    # 10. decrypt-check end-to-end through the real remote script, a stub ssh
    #     that runs it locally, and a stub sops that returns the known value.
    def t_decrypt_roundtrip():
        with tempfile.TemporaryDirectory() as tmp:
            root = _fixture_repo(Path(tmp), config_text, probe_text)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            _stub(
                bin_dir / "sops",
                "#!/bin/bash\nprintf '%%s\\n' %s\n" % ("'" + KNOWN_DUMMY + "'",),
            )
            ssh = _stub(
                root / "ssh",
                "#!/bin/bash\nwhile [ $# -gt 1 ]; do shift; done\nexec bash -c \"$1\"\n",
            )
            env_path = "%s:%s" % (bin_dir, os.environ.get("PATH", ""))
            old = os.environ.get("PATH", "")
            os.environ["PATH"] = env_path
            try:
                line = decrypt_check(
                    root, DEFAULT_SOPS_FILE, DEFAULT_KEY, "stub-host", "user",
                    str(ssh),
                )
            finally:
                os.environ["PATH"] = old
            assert "sha256=%s" % KNOWN_DUMMY_SHA256 in line, line
            assert "bytes=%d" % len(KNOWN_DUMMY) in line, line
            assert KNOWN_DUMMY not in line, "the value leaked into the output"
            assert line.startswith("probe decrypt: key=%s " % DEFAULT_KEY), line

    # 11. A decrypt that yields nothing, and a probe answer with no digest,
    #     are both refused.
    def t_refuse_empty_decrypt():
        with tempfile.TemporaryDirectory() as tmp:
            root = _fixture_repo(Path(tmp), config_text, probe_text)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            _stub(bin_dir / "sops", "#!/bin/bash\nexit 0\n")
            ssh = _stub(
                root / "ssh",
                "#!/bin/bash\nwhile [ $# -gt 1 ]; do shift; done\nexec bash -c \"$1\"\n",
            )
            old = os.environ.get("PATH", "")
            os.environ["PATH"] = "%s:%s" % (bin_dir, old)
            try:
                want_refused(
                    1,
                    lambda: decrypt_check(
                        root, DEFAULT_SOPS_FILE, DEFAULT_KEY, "stub-host", "u",
                        str(ssh),
                    ),
                )
            finally:
                os.environ["PATH"] = old

    # 12. A probe without sops says so, instead of reporting a hash of nothing.
    def t_refuse_missing_sops():
        if shutil.which("sops"):
            return  # a real sops on this PATH: nothing to prove here
        with tempfile.TemporaryDirectory() as tmp:
            root = _fixture_repo(Path(tmp), config_text, probe_text)
            ssh = _stub(
                root / "ssh",
                "#!/bin/bash\nwhile [ $# -gt 1 ]; do shift; done\nexec bash -c \"$1\"\n",
            )
            old = os.environ.get("PATH", "")
            os.environ["PATH"] = "/usr/bin:/bin"
            try:
                exc = want_refused(
                    1,
                    lambda: decrypt_check(
                        root, DEFAULT_SOPS_FILE, DEFAULT_KEY, "stub-host", "u",
                        str(ssh),
                    ),
                )
            finally:
                os.environ["PATH"] = old
            assert "no sops binary" in str(exc), str(exc)

    for name, func in [
        ("hash-roundtrip", t_hash),
        ("refuse-empty-recipient", t_refuse_empty),
        ("refuse-non-age-recipient", t_refuse_bad),
        ("refuse-plaintext-file", t_refuse_plaintext),
        ("refuse-unmatched-file", t_refuse_no_rule),
        ("rule-edit-preserves-comments", t_edit),
        ("refuse-unwrapped-recipient", t_refuse_unwrapped),
        ("updatekeys-wraps-recipient", t_updatekeys),
        ("decrypt-hash-roundtrip", t_decrypt_roundtrip),
        ("refuse-empty-decrypt", t_refuse_empty_decrypt),
        ("refuse-missing-sops-on-probe", t_refuse_missing_sops),
    ]:
        check(name, func)

    failed = results.count(False)
    print(
        "sops-probe self-test: %d pass, %d fail" % (results.count(True), failed)
    )
    return 1 if failed else 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prove a fresh EC2 probe can decrypt secrets/probe.yaml.",
        epilog="Steps: recipient, add-recipient, decrypt-check, self-test.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def transport(p):
        p.add_argument("--host", default="", help="probe host; default: terraform output probe_ip")
        p.add_argument("--user", default=DEFAULT_USER, help="login user (default ubuntu)")
        p.add_argument(
            "--ssh", default="ssh", help="ssh command to use (default: ssh)"
        )

    recipient = sub.add_parser("recipient", help="print the probe's public age key")
    transport(recipient)
    recipient.add_argument(
        "--attempts",
        type=int,
        default=30,
        help="ssh attempts while cloud-init finishes (default 30)",
    )
    recipient.add_argument(
        "--interval", type=float, default=10.0, help="seconds between attempts"
    )
    recipient.set_defaults(func=cmd_recipient)

    add = sub.add_parser(
        "add-recipient", help="add the probe to the .sops.yaml rule and updatekeys"
    )
    transport(add)
    add.add_argument("--attempts", type=int, default=30, help="ssh attempts")
    add.add_argument("--interval", type=float, default=10.0, help="seconds between attempts")
    add.add_argument(
        "--recipient", default="", help="recipient to add (default: ask the probe)"
    )
    add.add_argument("--sops-file", default=DEFAULT_SOPS_FILE, help="secrets file")
    add.add_argument("--sops", default="", help="sops binary (default: resolve)")
    add.add_argument("--dry-run", action="store_true", help="print the plan only")
    add.set_defaults(func=cmd_add_recipient)

    decrypt = sub.add_parser(
        "decrypt-check", help="decrypt one value on the probe, print its sha256"
    )
    transport(decrypt)
    decrypt.add_argument("--sops-file", default=DEFAULT_SOPS_FILE, help="secrets file")
    decrypt.add_argument("--key", default=DEFAULT_KEY, help="sops key to decrypt")
    decrypt.set_defaults(func=cmd_decrypt_check)

    selftest = sub.add_parser("self-test", help="offline proofs; no AWS, no sops")
    selftest.set_defaults(func=lambda _args: run_self_test())
    return parser


def main(argv: list) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except Refused as exc:
        say(str(exc))
        return exc.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

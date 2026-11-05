#!/usr/bin/env python3
"""Capture every macOS `defaults` domain and emit a nix-darwin module.

The capture answers two questions for the `macbook` profile: which settings
exist on the live Mac, and which of them can nix-darwin own? It reads each
domain through `defaults export`, removes values whose key names look like
credentials, writes one file per domain, and generates a
`system.defaults.CustomUserPreferences` / `CustomSystemPreferences` module that
nix-darwin can switch.

The default output directory sits outside every repository, because a `defaults`
dump is private user state, not a repo artifact.

Usage:
    python3 scripts/capture-macos-defaults.py [--out DIR] [--nix-out PATH]
                                              [--dry-run] [--allow-repo]
                                              [--quiet]

Exit codes:
    0  capture complete
    1  capture failed, or the platform is not macOS
    2  argument error, or the output path is inside a git repository

Stdlib only. Run with python3; no third-party package is needed.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import plistlib
import re
import shutil
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

# Key names that carry credentials. A match redacts the value and records the
# key path, so the capture still names what must be set by hand on a new Mac.
# Matching is token based: a key is split on non-alphanumerics and camelCase
# boundaries, so `publicAPSToken`, `wdsAuthToken`, and `refreshAuthorizationToken`
# are caught as well as `api_key` and `Password`.
#
# Two strengths are used so the capture does not lose harmless settings:
# a STRONG word names a secret at any position; a WEAK word names one only as
# the last token or as the whole key. That keeps `journalCookie_5` (strong) and
# drops `tokenCount` and `TokenBucketRateLimiter` (weak, not last).
STRONG_WORDS = {
    "password",
    "passwd",
    "secret",
    "secrets",
    "secretkey",
    "apikey",
    "apikeys",
    "privatekey",
    "sessionkey",
    "licensekey",
    "credential",
    "credentials",
    "salt",
    "cookie",
    "cookies",
}
WEAK_WORDS = {
    "token",
    "tokens",
    "auth",
    "authorization",
    "authorizationcode",
    "passphrase",
}

# A weak word plus one of these endings means a stored secret container, not a
# setting: `...ClientTokenCache`, `previousServerChangeTokenData`. The subtree is
# removed, so the token values inside it cannot survive.
CONTAINER_ENDINGS = {"cache", "data", "blob", "payload", "blobs"}

# A whole-key match for names that only mean a secret as a fixed phrase.
SENSITIVE_PHRASES = re.compile(
    r"(?i)(?:^|[._\- ])(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|private[_-]?key)(?:$|[._\- ])"
)

WORD = re.compile(r"[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|\d+")

# Domains nix-darwin writes as system preferences (/Library/Preferences/...) with
# `system.defaults.CustomSystemPreferences`; everything else goes to the user
# variant. Mirrors nix-darwin's own defaults-write module.
# nix-darwin passes a CustomSystemPreferences attribute name straight to
# `defaults write` in a root activation, so the name must be the full plist path
# The domains a profile should declare. Capturing every domain writes ~320 KB of
# Nix, which nix-darwin inlines into the activation script; the builder's
# environment then passes macOS ARG_MAX (1 MB) and every switch dies with
# "executing '.../bash': Undefined error: 0". `--all` still captures everything
# for documentation.
CURATED_DOMAINS = (
    "NSGlobalDomain",
    ".GlobalPreferences",
    "com.apple.dock",
    "com.apple.finder",
    "com.apple.screencapture",
    "com.apple.screensaver",
    "com.apple.menuextra.clock",
    "com.apple.menuextra.battery",
    "com.apple.trackpad",
    "com.apple.driver.AppleBluetoothMultitouch.trackpad",
    "com.apple.driver.AppleBluetoothMultitouch.mouse",
    "com.apple.AppleMultitouchTrackpad",
    "com.apple.AppleMultitouchMouse",
    "com.apple.symbolichotkeys",
    "com.apple.HIToolbox",
    "com.apple.universalaccess",
    "com.apple.desktopservices",
    "com.apple.WindowManager",
    "com.apple.spaces",
    "com.apple.ActivityMonitor",
    "com.apple.terminal",
    "com.apple.TimeMachine",
    "com.apple.controlcenter",
    "com.apple.systemuiserver",
)

# (see its own loginwindow/SoftwareUpdate/smb entries). A bare domain would land
# in root's user domain instead of /Library/Preferences.
SYSTEM_DOMAIN_PATHS = {
    "com.apple.loginwindow": "/Library/Preferences/com.apple.loginwindow",
    "com.apple.SoftwareUpdate": "/Library/Preferences/com.apple.SoftwareUpdate",
    "com.apple.smb.server": "/Library/Preferences/SystemConfiguration/com.apple.smb.server",
}

# ByHost variants are writable through the same escape hatch with a path domain,
# the way nix-darwin writes controlcenter. The per-machine UUID in the plist file
# name is not reproduced. The path is absolute because the activation runs as
# root, where a literal tilde would expand to root's home, not the owner's.
BYHOST_PREFIX = f"{Path.home()}/Library/Preferences/ByHost/"


def nix_string(value: str) -> str:
    """Quote a string for a Nix double-quoted literal."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("${", "\\${")
    return f'"{escaped}"'


def nix_key(name: str) -> str:
    """Return an attribute name: bare when it is an identifier, quoted otherwise."""
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_'-]*", name) and name not in {
        "if", "then", "else", "let", "in", "with", "rec", "inherit", "or", "assert"
    }:
        return name
    return nix_string(name)


def nix_literal(value: object) -> str | None:
    """Render a plist value as Nix, or None when nix-darwin cannot carry it."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        # Nix integers are signed 64-bit. A plist can hold an unsigned 64-bit
        # value that Nix cannot represent, so skip it instead of emitting a
        # literal that fails to parse.
        if value < -(2**63) or value > 2**63 - 1:
            return None
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return repr(value)
    if isinstance(value, str):
        return nix_string(value)
    if isinstance(value, (bytes, bytearray)):
        return None
    if isinstance(value, datetime):
        return None
    if isinstance(value, list):
        parts = [nix_literal(item) for item in value]
        if any(part is None for part in parts):
            return None
        # Nix parses a negative literal in a list as a subtraction, so wrap it.
        parts = [f"({part})" if part.startswith("-") else part for part in parts]
        return "[ " + " ".join(parts) + " ]"
    if isinstance(value, dict):
        lines = []
        for key, item in value.items():
            rendered = nix_literal(item)
            if rendered is None:
                return None
            lines.append(f"{nix_key(str(key))} = {rendered};")
        return "{ " + " ".join(lines) + " }"
    return None


def emit_nix_module(path: Path, payloads: dict[str, dict], skipped: list[tuple[str, str, str]]) -> tuple[int, int]:
    """Write a nix-darwin system.defaults module and return the key counts."""
    user_domains: dict[str, list[str]] = {}
    system_domains: dict[str, list[str]] = {}
    for domain, payload in payloads.items():
        if domain.startswith(BYHOST_PREFIX):
            target = user_domains
            attr = domain
        elif domain in SYSTEM_DOMAIN_PATHS:
            target = system_domains
            attr = SYSTEM_DOMAIN_PATHS[domain]
        else:
            target = user_domains
            attr = domain
        entries = target.setdefault(attr, [])
        for key, value in payload.items():
            rendered = nix_literal(value)
            if rendered is None:
                skipped.append((domain, str(key), "unsupported value kind"))
                continue
            entries.append(f"    {nix_key(str(key))} = {rendered};")

    def block(title: str, domains: dict[str, list[str]]) -> list[str]:
        if not domains:
            return []
        lines = [f"    {title} = {{"]
        for domain, entries in sorted(domains.items()):
            if not entries:
                continue
            lines.append(f"      {nix_string(domain)} = {{")
            lines.extend("  " + entry for entry in entries)
            lines.append("      };")
        lines.append("    };")
        return lines

    lines = [
        "# Generated by scripts/capture-macos-defaults.py.",
        f"# Source: the live Mac, {date.today().isoformat()}.",
        "# Credential-shaped keys are absent; dates and binary values are skipped.",
        "{",
        "  system.defaults = {",
    ]
    lines += block("CustomUserPreferences", user_domains)
    lines += block("CustomSystemPreferences", system_domains)
    lines += ["  };", "}"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    user_keys = sum(len(v) for v in user_domains.values())
    system_keys = sum(len(v) for v in system_domains.values())
    return user_keys, system_keys

# Domains whose content is runtime state, not a setting. They still export, but
# they carry no reproduction value and change on every run.
VOLATILE = {
    "com.apple.dock.launchpad",
    "com.apple.helpd",
    "com.apple.parsecd",
    "com.apple.suggestd",
    "com.apple.assistant.backedup",
}


# Domains whose contents change on their own: window geometry, space ids,
# per-app counters. Comparing them reports drift every few seconds, which hides
# the drift that matters. They stay out of the module and out of --check.
VOLATILE_DOMAINS = frozenset(
    {
        "com.apple.spaces",
        "com.apple.ActivityMonitor",
        "com.apple.WindowManager",
    }
)


def report_drift(payloads: dict[str, dict], committed: Path) -> int:
    """Diff the live payloads against the module the repo ships."""
    import difflib
    import tempfile

    if not committed.exists():
        print(f"capture-macos-defaults: no module at {committed}", file=sys.stderr)
        return 1
    stable = {d: v for d, v in payloads.items() if d not in VOLATILE_DOMAINS}
    with tempfile.TemporaryDirectory() as tmp:
        live_path = Path(tmp) / "live.nix"
        emit_nix_module(live_path, stable, [])
        live = live_path.read_text().splitlines()

    def body(lines: list[str]) -> list[str]:
        # The header carries a capture date, which is not drift.
        return [line for line in lines if not line.startswith("#")]

    committed_body, live_body = body(committed.read_text().splitlines()), body(live)
    if committed_body == live_body:
        print(f"no drift: live defaults match {committed}")
        return 0
    print(f"drift: live defaults differ from {committed}", file=sys.stderr)
    diff = difflib.unified_diff(committed_body, live_body, "committed", "live", lineterm="", n=1)
    for line in diff:
        print(line, file=sys.stderr)
    print(
        "Re-run scripts/capture-macos-defaults.py to adopt the live values, or revert "
        "the change on the machine.",
        file=sys.stderr,
    )
    return 1


def run(cmd: list[str]) -> tuple[int, bytes, str]:
    """Run a command and return its exit code, stdout bytes, and stderr text."""
    proc = subprocess.run(cmd, capture_output=True, check=False)
    return proc.returncode, proc.stdout, proc.stderr.decode("utf-8", "replace")


def list_domains() -> list[str]:
    """Return the sorted domain names that `defaults domains` reports."""
    code, out, err = run(["defaults", "domains"])
    if code != 0:
        raise SystemExit(f"defaults domains failed: {err.strip()}")
    names = {part.strip() for part in out.decode().split(",")}
    return sorted(name for name in names if name)


def is_sensitive_key(key: object, value: object = None) -> bool:
    """Return True when a dictionary key names a credential.

    A weak word (token, auth) is enough on its own when the value is binary
    data: a token stored as bytes is a token, whatever its key position. That
    catches `GKPushTokenKeyV2` and `...ClientTokenCache` while an integer such
    as `tokenCount` stays a harmless setting.
    """
    name = str(key)
    words = [word.lower() for word in WORD.findall(name)]
    if not words:
        return False
    if set(words) & STRONG_WORDS:
        return True
    if words[-1] in WEAK_WORDS or "".join(words) in WEAK_WORDS | STRONG_WORDS:
        return True
    if isinstance(value, (bytes, bytearray)) and set(words) & WEAK_WORDS:
        return True
    if words[-1] in CONTAINER_ENDINGS and set(words) & WEAK_WORDS:
        return True
    return bool(SENSITIVE_PHRASES.search(name))


def redact(value: object, path: str, hits: list[str]) -> object:
    """Return a copy of a plist value with sensitive keys removed."""
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            key_path = f"{path}.{key}" if path else str(key)
            if is_sensitive_key(key, item):
                hits.append(key_path)
                continue
            cleaned[key] = redact(item, key_path, hits)
        return cleaned
    if isinstance(value, list):
        return [redact(item, f"{path}[{i}]", hits) for i, item in enumerate(value)]
    return value


def inside_git_repo(path: Path) -> str | None:
    """Return the repository root that contains path, or None."""
    if shutil.which("git") is None:
        return None
    code, out, _ = run(["git", "-C", str(path), "rev-parse", "--show-toplevel"])
    if code != 0:
        return None
    return out.decode().strip() or None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture macOS defaults domains into redacted XML plists."
    )
    parser.add_argument(
        "--out",
        default=str(
            Path.home()
            / ".local"
            / "state"
            / "nix-fleet"
            / f"macos-defaults-{date.today().isoformat()}"
        ),
        help="output directory (default: $HOME/.local/state/nix-fleet/macos-defaults-<date>)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="list the domains and exit"
    )
    parser.add_argument(
        "--nix-out",
        default=None,
        help="path for the generated nix-darwin module (default: <out>/nix/system-defaults.nix)",
    )
    parser.add_argument(
        "--allow-repo", action="store_true", help="permit an output path inside a git repo"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="capture every domain instead of the curated set (large; mostly for documentation)",
    )
    parser.add_argument("--quiet", action="store_true", help="print the summary only")
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare the live defaults against the committed module; exit 1 on drift",
    )
    args = parser.parse_args()

    if sys.platform != "darwin":
        print("capture-macos-defaults: macOS only (defaults is a Darwin tool)", file=sys.stderr)
        return 1

    domains = list_domains()
    if not args.all:
        keep = {d for d in CURATED_DOMAINS}
        filtered = [d for d in domains if d in keep]
        if filtered:
            domains = filtered
    if not domains:
        print("capture-macos-defaults: defaults reports no domains", file=sys.stderr)
        return 1

    if args.check:
        # A drift check must not write plists or a module: capture into a
        # throwaway directory and compare the rendered body.
        import tempfile

        out = Path(tempfile.mkdtemp(prefix="macos-defaults-check-"))
    else:
        out = Path(args.out).expanduser().resolve()
    if args.dry_run:
        for domain in domains:
            print(domain)
        print(f"capture-macos-defaults: {len(domains)} domains", file=sys.stderr)
        return 0

    # Check the nearest existing ancestor before creating anything, so a refused
    # path leaves no directory behind.
    ancestor = out
    while not ancestor.exists() and ancestor != ancestor.parent:
        ancestor = ancestor.parent
    repo = inside_git_repo(ancestor)
    if repo and not args.allow_repo:
        print(
            "capture-macos-defaults: refusing to write inside a git repository.\n"
            f"  output: {out}\n  repo:   {repo}\n"
            "Pass --allow-repo if that is what you want.",
            file=sys.stderr,
        )
        return 2

    out.mkdir(parents=True, exist_ok=True)

    plist_dir = out / "domains"
    plist_dir.mkdir(exist_ok=True)
    byhost_dir = out / "byhost"
    byhost_dir.mkdir(exist_ok=True)
    index: list[tuple[str, str, int, str, int]] = []
    skipped: list[tuple[str, str]] = []
    redactions: list[tuple[str, str]] = []
    payloads: dict[str, dict] = {}
    byhost: list[tuple[str, int]] = []

    for domain in domains:
        if domain in VOLATILE:
            skipped.append((domain, "volatile runtime state"))
            continue
        code, data, err = run(["defaults", "export", domain, "-"])
        if code != 0 or not data.strip():
            reason = err.strip().splitlines()[0] if err.strip() else "empty export"
            skipped.append((domain, reason))
            continue
        try:
            payload = plistlib.loads(data)
        except Exception as exc:  # noqa: BLE001 - one bad domain must not stop the run
            skipped.append((domain, f"unparsable plist: {type(exc).__name__}"))
            continue

        # A -currentHost variant is a separate plist. nix-darwin has no option
        # for it, so record it as an accepted gap instead of dropping it.
        host_code, host_data, _ = run(["defaults", "-currentHost", "export", domain, "-"])
        if host_code == 0 and host_data.strip() and host_data != data:
            host_payload = plistlib.loads(host_data)
            host_hits: list[str] = []
            host_clean = redact(host_payload, "", host_hits)
            redactions.extend((f"-currentHost:{domain}", key_path) for key_path in host_hits)
            (byhost_dir / f"{domain}.plist").write_bytes(
                plistlib.dumps(host_clean, fmt=plistlib.FMT_XML, sort_keys=True)
            )
            if isinstance(host_clean, dict):
                payloads[f"{BYHOST_PREFIX}{domain}"] = host_clean
            byhost.append((domain, len(host_clean) if isinstance(host_clean, dict) else 0))

        hits: list[str] = []
        cleaned = redact(payload, "", hits)
        redactions.extend((domain, key_path) for key_path in hits)
        if isinstance(cleaned, dict):
            payloads[domain] = cleaned
        blob = plistlib.dumps(cleaned, fmt=plistlib.FMT_XML, sort_keys=True)
        target = plist_dir / f"{domain}.plist"
        target.write_bytes(blob)
        digest = hashlib.sha256(blob).hexdigest()
        index.append((domain, "captured", len(blob), digest, len(hits)))
        if not args.quiet:
            print(f"  {domain}: {len(blob)} bytes, {len(hits)} redactions")

    if args.check:
        default = Path(__file__).resolve().parent.parent / "nix" / "darwin" / "system-defaults.nix"
        return report_drift(payloads, Path(args.nix_out).expanduser() if args.nix_out else default)

    nix_skipped: list[tuple[str, str, str]] = []
    nix_path = Path(args.nix_out).expanduser() if args.nix_out else out / "nix" / "system-defaults.nix"
    stable = {d: v for d, v in payloads.items() if d not in VOLATILE_DOMAINS}
    user_keys, system_keys = emit_nix_module(nix_path.resolve(), stable, nix_skipped)

    # nix-darwin inlines system.defaults into the activation script, which Nix
    # passes in the builder's environment. macOS caps that at ARG_MAX (1 MB), so
    # an oversized capture makes every switch fail with
    # "executing '.../bash': Undefined error: 0". Refuse rather than emit it.
    emitted = nix_path.stat().st_size
    limit = 200_000
    if emitted > limit:
        print(
            f"capture-macos-defaults: {nix_path} is {emitted} bytes, above the {limit}-byte "
            "budget; nix-darwin would inline it into the activation script and a switch "
            "would fail on macOS ARG_MAX. Trim the domain list or drop --all.",
            file=sys.stderr,
        )
        return 3

    with (out / "index.tsv").open("w", encoding="utf-8") as handle:
        handle.write("domain\tstatus\tbytes\tsha256\tredactions\n")
        for row in index:
            handle.write("\t".join(str(field) for field in row) + "\n")
        for domain, reason in skipped:
            handle.write(f"{domain}\tskipped\t0\t-\t0\n")

    with (out / "skipped.tsv").open("w", encoding="utf-8") as handle:
        handle.write("domain\treason\n")
        for domain, reason in skipped:
            handle.write(f"{domain}\t{reason}\n")

    with (out / "redactions.txt").open("w", encoding="utf-8") as handle:
        handle.write("# domain\tkey path (value removed)\n")
        for domain, key_path in redactions:
            handle.write(f"{domain}\t{key_path}\n")

    with (out / "nix-skipped.tsv").open("w", encoding="utf-8") as handle:
        handle.write("domain\tkey\treason\n")
        for domain, key, reason in nix_skipped:
            handle.write(f"{domain}\t{key}\t{reason}\n")

    with (out / "byhost.tsv").open("w", encoding="utf-8") as handle:
        handle.write("domain\tstatus\n")
        for domain, _ in byhost:
            handle.write(f"{domain}\t-accepted-gap-no-nix-darwin-option\n")

    (out / "README.txt").write_text(
        "macOS defaults capture\n"
        f"date: {date.today().isoformat()}\n"
        f"domains reported: {len(domains)}\n"
        f"captured: {len(index)}\n"
        f"skipped: {len(skipped)}\n"
        f"redacted key paths: {len(redactions)}\n"
        f"byHost variants (accepted gap): {len(byhost)}\n"
        f"nix-darwin user keys: {user_keys}\n"
        f"nix-darwin system keys: {system_keys}\n"
        f"nix-darwin skipped keys: {len(nix_skipped)}\n"
        f"nix module: {nix_path}\n"
        "source: defaults export <domain> -\n"
        "policy: values under credential-shaped keys are removed; key paths stay\n"
        "do not commit this directory unless the owner asks for the module only\n",
        encoding="utf-8",
    )

    print(
        f"capture-macos-defaults: {len(index)}/{len(domains)} domains captured, "
        f"{len(skipped)} skipped, {len(redactions)} redactions, "
        f"{len(byhost)} byHost gaps -> {out}"
    )
    print(
        f"capture-macos-defaults: nix-darwin module {nix_path} "
        f"({user_keys} user keys, {system_keys} system keys, "
        f"{len(nix_skipped)} skipped keys)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

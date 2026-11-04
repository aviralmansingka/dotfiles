#!/usr/bin/env python3
"""Inventory the secrets on this machine without reading a single value out.

The audit answers one question for the owner: which credentials exist on this
Mac, where do they live, and what should happen to each one? It records file
paths, key names, modes, ages, key types, and fingerprints. It never prints,
stores, or copies a secret value.

Duplicate detection uses a per-run HMAC fingerprint: two files that hold the same
value produce the same digest inside one run, so the report can say "this value
appears in three places". The salt never leaves memory, so fingerprints are not
comparable across runs and cannot be looked up.

Usage:
    python3 scripts/audit-secrets.py [--out DIR] [--allow-repo] [--quiet]

Exit codes:
    0  inventory complete
    1  scan failed, or the platform is not macOS
    2  argument error, or the output path is inside a git repository

Stdlib only. The script is read-only on every file it touches.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import plistlib
import re
import shutil
import stat
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

# Names that mark a variable or key as a credential. Used only to decide whether
# a name is interesting; values are never matched.
SECRET_NAME = re.compile(
    r"(?i)(?:^|[._\- ])("
    r"api[_-]?key|apikey|app[_-]?key|app[_-]?secret|access[_-]?key|secret|token|"
    r"password|passwd|passphrase|credential|credentials|private[_-]?key|"
    r"client[_-]?secret|refresh[_-]?token|access[_-]?token|auth[_-]?token|auth|"
    r"service[_-]?account|signing[_-]?key|webhook[_-]?url|dsn"
    r")(?:$|[._\- ])"
)

# A name can look like a credential and still be configuration: a directory, a
# URL base, a chat allow-list. Those are not secrets and must not be counted.
NOT_SECRET_SUFFIX = re.compile(
    r"(?i)(_dir|_path|_endpoint|_host|_port|_prefix|_base|_chats|_uri|_transport|_dirs|_file|_sock|"
    r"_at|_time|_date|_ts|_signin|_expires|_expiry)$"
)

# A value that reads as an ISO timestamp is state, not a credential.
ISO_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}")

ENV_STYLE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
YAML_KEY = re.compile(r"^\s*([A-Za-z0-9_.\-]+)\s*:\s*(.*)$")

# Files worth opening. Each entry is (glob, kind, may_hold_secrets).
HOME_PATTERNS: list[tuple[str, str, bool]] = [
    ("~/.env", "env", True),
    ("~/.env.*", "env", True),
    ("~/.netrc", "netrc", True),
    ("~/.npmrc", "npmrc", True),
    ("~/.pypirc", "pypirc", True),
    ("~/.git-credentials", "git-credentials", True),
    ("~/.docker/config.json", "docker", True),
    ("~/.kube/config", "kubeconfig", True),
    ("~/.config/gh/hosts.yml", "gh", True),
    ("~/.config/gcloud/*.json", "gcloud", True),
    ("~/.config/gcloud/**/*.json", "gcloud", True),
    ("~/.config/op/*", "1password-cli", True),
    ("~/.config/1Password/**/*", "1password", True),
    ("~/.config/pi-*.env", "pi-env", True),
    ("~/.config/pi-*.json", "pi-json", True),
    ("~/.config/sops/**/*", "sops", True),
    ("~/.config/age/*", "age", True),
    ("~/.config/hub", "hub", True),
    ("~/.config/stripe/*", "stripe", True),
    ("~/.wrangler/**/*", "wrangler", True),
    ("~/.config/*.env", "env", True),
    ("~/.aws/credentials", "aws", True),
    ("~/.aws/config", "aws", True),
    ("~/.config/github-copilot/*.json", "copilot", True),
    ("~/.terraform.d/credentials.tfrc.json", "terraform", True),
    ("~/.config/doctl/config.yaml", "doctl", True),
]

SSH_DIR = Path.home() / ".ssh"
MAX_FILE_BYTES = 1_000_000
MAX_JSON_DEPTH = 4


def run(cmd: list[str], timeout: int = 10) -> tuple[int, str, str]:
    """Run a command, return exit code, stdout, stderr. Never raises on timeout."""
    try:
        proc = subprocess.run(cmd, capture_output=True, check=False, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        return 1, "", type(exc).__name__
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")


def fingerprint(salt: bytes, value: str) -> str:
    """Return a short, per-run HMAC of a value. The salt stays in memory only."""
    return hmac.new(salt, value.encode("utf-8", "ignore"), hashlib.sha256).hexdigest()[:12]


def mode_string(path: Path) -> str:
    """Return the ls-style mode string."""
    try:
        return stat.filemode(path.stat().st_mode)
    except OSError:
        return "?" * 10


def world_readable(path: Path) -> bool:
    """True when a group or other bit is set on a secret-bearing file."""
    try:
        return bool(path.stat().st_mode & 0o077)
    except OSError:
        return False


def age_days(path: Path) -> int | None:
    """Return the file age in whole days."""
    try:
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return None
    return (datetime.now(tz=timezone.utc) - mtime).days


def parse_env(text: str) -> list[tuple[str, str]]:
    """Return (name, value) pairs from an env-style file."""
    pairs: list[tuple[str, str]] = []
    for line in text.splitlines():
        match = ENV_STYLE.match(line)
        if not match:
            continue
        name, raw = match.group(1), match.group(2).strip()
        value = raw.strip("\"'")
        pairs.append((name, value))
    return pairs


def parse_yaml_like(text: str) -> list[tuple[str, str]]:
    """Return (key, value) pairs from a flat YAML or INI-like file."""
    pairs: list[tuple[str, str]] = []
    for line in text.splitlines():
        if line.lstrip().startswith("#") or not line.strip():
            continue
        match = YAML_KEY.match(line)
        if match:
            pairs.append((match.group(1), match.group(2).strip().strip("\"'")))
    return pairs


def walk_json(value: object, prefix: str, out: list[tuple[str, str]], depth: int = 0) -> None:
    """Collect leaf key paths and string values from a JSON document."""
    if depth > MAX_JSON_DEPTH:
        return
    if isinstance(value, dict):
        for key, item in value.items():
            walk_json(item, f"{prefix}.{key}" if prefix else str(key), out, depth + 1)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            walk_json(item, f"{prefix}[{index}]", out, depth + 1)
    elif isinstance(value, str):
        out.append((prefix, value))


def parse_json(text: str) -> list[tuple[str, str]]:
    """Return (key path, string value) pairs from JSON."""
    try:
        document = json.loads(text)
    except json.JSONDecodeError:
        return []
    out: list[tuple[str, str]] = []
    walk_json(document, "", out)
    return out


def parse_plist(path: Path) -> list[tuple[str, str]]:
    """Return (key path, string value) pairs from a plist."""
    try:
        document = plistlib.loads(path.read_bytes())
    except Exception:  # noqa: BLE001 - a broken plist is not a failure
        return []
    out: list[tuple[str, str]] = []
    walk_json(document, "", out)
    return out


def collect_pairs(path: Path, kind: str) -> list[tuple[str, str]]:
    """Return the credential-shaped (name, value) pairs of one file."""
    if path.stat().st_size > MAX_FILE_BYTES:
        return []
    if kind == "plist":
        pairs = parse_plist(path)
    else:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return []
        if kind in {"env", "pi-env", "docker", "netrc", "npmrc", "pypirc", "git-credentials", "hub"}:
            pairs = parse_env(text) or parse_yaml_like(text)
        elif kind in {"gh", "kubeconfig"}:
            pairs = parse_yaml_like(text)
        elif kind in {"gcloud", "pi-json", "1password", "1password-cli"}:
            pairs = parse_json(text)
        else:
            pairs = parse_env(text) or parse_yaml_like(text)
    return [
        (name, value)
        for name, value in pairs
        if SECRET_NAME.search(name)
        and not NOT_SECRET_SUFFIX.search(name)
        and len(value) >= 8
        and not ISO_TIME.match(value)
    ]


def ssh_key_record(path: Path) -> dict[str, object]:
    """Describe an SSH key file without storing private key material."""
    is_public = path.suffix == ".pub"
    record: dict[str, object] = {
        "path": str(path),
        "kind": "ssh-public" if is_public else "ssh-private",
        "mode": mode_string(path),
        "size": path.stat().st_size,
        "age_days": age_days(path),
    }
    pub = path if is_public else path.with_suffix(path.suffix + ".pub")
    if pub.exists():
        code, out, _ = run(["ssh-keygen", "-lf", str(pub)])
        if code == 0 and out.strip():
            parts = out.split()
            record["bits"] = parts[0]
            record["fingerprint"] = parts[1] if len(parts) > 1 else ""
            record["comment"] = " ".join(parts[2:])
        record["public_half"] = str(pub)
    else:
        record["public_half"] = None
        record["note"] = "no public half on disk"

    if is_public:
        record["recommendation"] = "keep"
        record["reason"] = "public half; safe to keep, not a secret"
        return record

    # Non-interactive protection check: -P '' never prompts, and the printed
    # public key is discarded. Only the verdict is kept.
    code, _, _ = run(["ssh-keygen", "-y", "-P", "", "-f", str(path)])
    record["protection"] = "unencrypted" if code == 0 else "passphrase-protected or unreadable"
    if world_readable(path):
        record["recommendation"] = "chmod 600"
        record["reason"] = "private key is readable by group or other"
    elif record["protection"] == "unencrypted":
        record["recommendation"] = "keep"
        record["reason"] = "private key without a passphrase; record this in 1Password, never copy the file"
    else:
        record["recommendation"] = "keep"
        record["reason"] = "passphrase-protected private key; store the passphrase in 1Password"
    return record


def ssh_text_record(path: Path, kind: str) -> dict[str, object]:
    """Describe an SSH text file: config, known_hosts, authorized_keys."""
    record: dict[str, object] = {
        "path": str(path),
        "kind": kind,
        "mode": mode_string(path),
        "size": path.stat().st_size,
        "age_days": age_days(path),
    }
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    if kind == "ssh-config":
        record["hosts"] = len(re.findall(r"(?m)^Host\s+", text))
        record["recommendation"] = "keep"
        record["reason"] = "host aliases and options only; no key material"
    elif kind == "ssh-known-hosts":
        record["hosts"] = len([line for line in text.splitlines() if line.strip() and not line.startswith("#")])
        record["recommendation"] = "keep"
        record["reason"] = "host keys only; public material"
    else:
        record["keys"] = len([line for line in text.splitlines() if line.strip() and not line.startswith("#")])
        record["recommendation"] = "keep"
        record["reason"] = "authorized public keys; no private material"
    return record


def scan() -> dict[str, object]:
    """Walk the candidate paths and return the inventory."""
    salt = os.urandom(16)
    files: list[dict[str, object]] = []
    seen_paths: set[Path] = set()

    def consider(path: Path, kind: str) -> None:
        if not path.is_file() or path in seen_paths:
            return
        if "site-packages" in path.parts or "node_modules" in path.parts:
            return
        seen_paths.add(path)
        if kind == "ssh-config":
            files.append(ssh_text_record(path, kind))
            return
        if kind == "ssh-known-hosts":
            files.append(ssh_text_record(path, "ssh-known-hosts"))
            return
        if kind == "ssh-authorized-keys":
            files.append(ssh_text_record(path, "ssh-authorized-keys"))
            return
        if kind == "ssh-key":
            files.append(ssh_key_record(path))
            return
        pairs = collect_pairs(path, kind)
        record: dict[str, object] = {
            "path": str(path),
            "kind": kind,
            "mode": mode_string(path),
            "size": path.stat().st_size,
            "age_days": age_days(path),
            "secrets": [
                {"name": name, "digest": fingerprint(salt, value), "length": len(value)}
                for name, value in pairs
            ],
        }
        if not pairs:
            record["note"] = "no credential-shaped keys"
        files.append(record)

    for pattern, kind, _ in HOME_PATTERNS:
        for path in sorted(Path.home().glob(pattern.replace("~/", ""))):
            consider(path, kind)

    if SSH_DIR.is_dir():
        for path in sorted(SSH_DIR.iterdir()):
            if not path.is_file():
                continue
            name = path.name
            if name == "known_hosts" or name.startswith("known_hosts."):
                consider(path, "ssh-known-hosts")
            elif name == "authorized_keys":
                consider(path, "ssh-authorized-keys")
            elif name == "config" or name.startswith("config.bak"):
                consider(path, "ssh-config")
            elif name.endswith(".pub") or re.match(r"^(id_|global_worker|.*\.pem$)", name):
                consider(path, "ssh-key")

    env_names: list[str] = []
    code, out, _ = run(["zsh", "-lic", "env"], timeout=15)
    if code == 0:
        env_names = sorted(
            {
                line.split("=", 1)[0]
                for line in out.splitlines()
                if "=" in line and SECRET_NAME.search(line.split("=", 1)[0])
            }
        )

    tools: dict[str, object] = {}
    for tool in ("op", "gpg", "security", "ssh-keygen"):
        tools[tool] = shutil.which(tool) is not None

    onepassword: dict[str, object] = {"installed": tools["op"]}
    if tools["op"]:
        code, out, _ = run(["op", "--version"], timeout=8)
        onepassword["version"] = out.strip() if code == 0 else "unknown"
        code, out, err = run(["op", "whoami"], timeout=8)
        onepassword["authenticated"] = code == 0 and bool(out.strip())
        if not onepassword["authenticated"]:
            onepassword["state"] = (err.strip().splitlines() or ["not signed in"])[0][:120]
        if onepassword["authenticated"]:
            code, out, _ = run(["op", "item", "list", "--format=json"], timeout=20)
            if code == 0:
                try:
                    items = json.loads(out)
                    categories: dict[str, int] = {}
                    for item in items:
                        categories[item.get("category", "?")] = categories.get(item.get("category", "?"), 0) + 1
                    onepassword["items"] = len(items)
                    onepassword["categories"] = categories
                except json.JSONDecodeError:
                    onepassword["items"] = None

    launchd: list[dict[str, object]] = []
    agents_dir = Path.home() / "Library" / "LaunchAgents"
    if agents_dir.is_dir():
        for plist in sorted(agents_dir.glob("*.plist")):
            try:
                document = plistlib.loads(plist.read_bytes())
            except Exception:  # noqa: BLE001 - a broken plist is not a failure
                continue
            env = document.get("EnvironmentVariables") if isinstance(document, dict) else None
            if isinstance(env, dict):
                launchd.append(
                    {
                        "path": str(plist),
                        "names": sorted(str(name) for name in env),
                        "secret_shaped": sorted(str(name) for name in env if SECRET_NAME.search(str(name))),
                    }
                )

    histories: list[dict[str, object]] = []
    for history in (Path.home() / ".zsh_history", Path.home() / ".bash_history"):
        if not history.is_file():
            continue
        matches = 0
        try:
            for line in history.read_text(encoding="utf-8", errors="replace").splitlines():
                name = ""
                if "=" in line:
                    name = line.split("=", 1)[0].split()[-1] if line.split("=", 1)[0].split() else ""
                if name and SECRET_NAME.search(name) and not NOT_SECRET_SUFFIX.search(name):
                    matches += 1
        except OSError:
            continue
        histories.append({"path": str(history), "credential_shaped_assignments": matches})

    keychains: list[str] = []
    if tools["security"]:
        code, out, _ = run(["security", "list-keychains"], timeout=8)
        if code == 0:
            keychains = [line.strip().strip('"') for line in out.splitlines() if line.strip()]

    return {
        "date": date.today().isoformat(),
        "host": os.uname().nodename,
        "files": files,
        "env_names": env_names,
        "tools": tools,
        "onepassword": onepassword,
        "keychains": keychains,
        "launchd": launchd,
        "histories": histories,
    }


def decide(inventory: dict[str, object]) -> list[dict[str, object]]:
    """Apply the owner-facing rules and return one work item per secret file."""
    files: list[dict[str, object]] = inventory["files"]  # type: ignore[assignment]
    digests: dict[str, list[str]] = {}
    for record in files:
        for secret in record.get("secrets", []):  # type: ignore[union-attr]
            digests.setdefault(secret["digest"], []).append(f"{record['path']}:{secret['name']}")

    duplicates: dict[str, int] = {}
    for digest, holders in digests.items():
        if len(holders) > 1:
            duplicates[digest] = len(holders)

    work: list[dict[str, object]] = []
    for record in files:
        path = Path(str(record["path"]))
        secrets = record.get("secrets", [])  # type: ignore[union-attr]
        duplicate_hits = [s["name"] for s in secrets if s["digest"] in duplicates]  # type: ignore[union-attr]
        reasons: list[str] = []
        action = "keep"

        if record.get("kind", "").startswith("ssh"):
            action = str(record.get("recommendation", "keep"))
            reasons.append(str(record.get("reason", "")))
        elif record.get("kind") == "ssh-config":
            action = "keep"
            reasons.append("host names and options only; no key material")
        elif secrets:
            action = "move to 1Password"
            reasons.append("credential-shaped values belong in 1Password; reference them with op run or op inject")
            if world_readable(path):
                action = "chmod 600 then 1Password"
                reasons.append("also readable by group or other")
            if duplicate_hits:
                action = "consolidate"
                reasons.append(f"{len(duplicate_hits)} value(s) repeat elsewhere: {', '.join(duplicate_hits[:4])}")
            age = record.get("age_days")
            if isinstance(age, int) and age > 365:
                reasons.append(f"not touched for {age} days; review for deletion")
        else:
            action = "keep"
            reasons.append("no credential-shaped keys found")

        work.append(
            {
                "path": str(path),
                "kind": record.get("kind"),
                "mode": record.get("mode"),
                "age_days": record.get("age_days"),
                "keys": [s["name"] for s in secrets],  # type: ignore[union-attr]
                "key_count": len(secrets),
                "action": action,
                "reason": "; ".join(part for part in reasons if part),
                "owner_decision": "",
            }
        )
    return work


def render_markdown(inventory: dict[str, object], work: list[dict[str, object]]) -> str:
    """Render the owner-facing report. Values never appear."""
    secret_files = [item for item in work if item["key_count"]]
    total_keys = sum(int(item["key_count"]) for item in work)
    actions: dict[str, int] = {}
    for item in work:
        actions[str(item["action"])] = actions.get(str(item["action"]), 0) + 1

    lines = [
        "# Secrets inventory",
        "",
        f"- Date: {inventory['date']}",
        f"- Host: {inventory['host']}",
        f"- Files scanned: {len(work)}",
        f"- Files with credential-shaped keys: {len(secret_files)}",
        f"- Key entries: {total_keys}",
        f"- Actions: {', '.join(f'{k} {v}' for k, v in sorted(actions.items()))}",
        "",
        "No value appears in this report. Only names, modes, ages, counts, and",
        "per-run fingerprints.",
        "",
        "## Work list",
        "",
        "| Asset | Keys | Mode | Age (days) | Action | Why | Owner decision |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for item in sorted(work, key=lambda row: (str(row["action"]), str(row["path"]))):
        keys = ", ".join(f"`{name}`" for name in item["keys"][:6]) or "-"
        if int(item["key_count"]) > 6:
            keys += f" (+{int(item['key_count']) - 6})"
        lines.append(
            f"| `{item['path']}` | {keys} | `{item['mode']}` | {item['age_days']} | "
            f"**{item['action']}** | {item['reason']} | {item['owner_decision']} |"
        )

    env_names = inventory.get("env_names") or []
    lines += ["", "## Environment variable names", ""]
    lines.append(", ".join(f"`{name}`" for name in env_names) if env_names else "None in a login shell.")

    onepassword = inventory["onepassword"]  # type: ignore[index]
    lines += ["", "## 1Password", ""]
    lines.append(f"- CLI installed: {onepassword.get('installed')}")
    lines.append(f"- Version: {onepassword.get('version', 'n/a')}")
    lines.append(f"- Authenticated: {onepassword.get('authenticated')}")
    if onepassword.get("items") is not None:
        lines.append(f"- Items: {onepassword['items']}")
        categories = onepassword.get("categories") or {}
        if categories:
            lines.append("- Categories: " + ", ".join(f"{k} {v}" for k, v in sorted(categories.items())))

    launchd = inventory.get("launchd") or []
    lines += ["", "## launchd environment variables", ""]
    if launchd:
        lines.append("| Agent | Environment names | Credential-shaped |")
        lines.append("| --- | --- | --- |")
        for agent in launchd:
            names = ", ".join(f"`{n}`" for n in agent["names"]) or "-"
            shaped = ", ".join(f"`{n}`" for n in agent["secret_shaped"]) or "-"
            lines.append(f"| `{agent['path']}` | {names} | {shaped} |")
    else:
        lines.append("No launchd agent carries environment variables.")

    histories = inventory.get("histories") or []
    lines += ["", "## Shell history", ""]
    if histories:
        for history in histories:
            lines.append(
                f"- `{history['path']}`: {history['credential_shaped_assignments']} "
                "credential-shaped assignments (count only; lines are never printed)"
            )
    else:
        lines.append("No shell history file found.")

    keychains = inventory.get("keychains") or []
    lines += ["", "## Keychains", ""]
    lines.append(", ".join(f"`{name}`" for name in keychains) if keychains else "None listed.")
    lines += [
        "",
        "Item enumeration needs a human: `security dump-keychain` asks for the",
        "keychain password and must be run by the owner, not by an agent.",
        "",
        "## Manual steps that stay manual",
        "",
        "| Store | Command | Why an agent must not run it |",
        "| --- | --- | --- |",
        "| Login keychain | `security dump-keychain` | Asks for the keychain password and can block a session |",
        "| 1Password vault review | `op item list` after `op signin` | Needs the owner's account password and MFA |",
        "| Password managers in browsers | Safari, Chrome profile settings | Values never leave the app |",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory credentials without reading values out.")
    parser.add_argument(
        "--out",
        default=str(Path.home() / ".local" / "state" / "nix-fleet" / f"secrets-audit-{date.today().isoformat()}"),
        help="output directory (default: $HOME/.local/state/nix-fleet/secrets-audit-<date>)",
    )
    parser.add_argument("--allow-repo", action="store_true", help="permit an output path inside a git repo")
    parser.add_argument("--quiet", action="store_true", help="print the summary only")
    args = parser.parse_args()

    if sys.platform != "darwin":
        print("audit-secrets: macOS only", file=sys.stderr)
        return 1

    out = Path(args.out).expanduser().resolve()
    ancestor = out
    while not ancestor.exists() and ancestor != ancestor.parent:
        ancestor = ancestor.parent
    if shutil.which("git"):
        code, top, _ = run(["git", "-C", str(ancestor), "rev-parse", "--show-toplevel"])
        if code == 0 and not args.allow_repo:
            print(
                "audit-secrets: refusing to write inside a git repository.\n"
                f"  output: {out}\n  repo:   {top.strip()}\n"
                "Pass --allow-repo if that is what you want.",
                file=sys.stderr,
            )
            return 2

    inventory = scan()
    work = decide(inventory)
    out.mkdir(parents=True, exist_ok=True)
    (out / "secrets-inventory.json").write_text(
        json.dumps({"inventory": inventory, "work": work}, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    (out / "secrets-inventory.md").write_text(render_markdown(inventory, work), encoding="utf-8")

    total_keys = sum(int(item["key_count"]) for item in work)
    print(
        f"audit-secrets: {len(work)} files scanned, "
        f"{sum(1 for item in work if item['key_count'])} with credential-shaped keys, "
        f"{total_keys} key entries -> {out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

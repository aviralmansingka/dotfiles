#!/usr/bin/env python3
"""Move plaintext env files into a sops file, one sops key per file.

S02's unit change reads `~/.config/sops-nix/secrets/<name>` instead of
`~/.config/<name>`, and the sops key that backs each of those files is named
after the file. This script is the one step that has to see the plaintext: it
reads each source file once and hands the exact bytes to `sops set` on stdin
(`--value-stdin`, so the value never appears in a process listing or a shell
history), then decrypts the key back and compares the sha256 before it reports
success. It never prints a value — only the name, the byte count and the hash.

    python3 scripts/sops-import-env.py \
        pi-stt-worker=/tmp/pi-stt-worker.env \
        pi-telegram=/tmp/pi-telegram.env \
        pi-whatsapp=/tmp/pi-whatsapp.env

A bare name (no `=`) means `~/.config/<name>.env`, which is the shape to use
when the plaintext already lives on this machine:

    python3 scripts/sops-import-env.py pi-telegram

`--sops-file` defaults to `secrets/homelab.yaml`. The identity is whatever sops
finds: `SOPS_AGE_KEY_FILE`, else `~/.config/sops/age/keys.txt`. No key is passed
through argv.

The sops binary is resolved in this order, and the resolution (path and version)
is printed before any source file is read:

  1. `$SOPS_BIN`            explicit override, a path or a name to look up
  2. `~/.nix-profile/bin/sops`
  3. `/etc/profiles/per-user/$USER/bin/sops`
  4. `/run/current-system/sw/bin/sops`
  5. `PATH`
  6. `nix build --no-link --print-out-paths nixpkgs#sops`, last resort: a fresh
     host has no sops until a switch installs the profile that carries it, and
     this import runs *before* that switch.

Exit codes: 0 imported, 1 a failure (source missing, no sops, sops failed,
verify mismatch), 2 usage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_NAMES = ["pi-stt-worker", "pi-telegram", "pi-whatsapp"]

# Where a Nix-managed host (or the Mac) puts a package on PATH. Checked before
# PATH because `just` and other tools are frequently on PATH while the tool a
# recipe needs is only in the profile a switch would install later.
PROFILE_PATHS = [
    "~/.nix-profile/bin/sops",
    "/etc/profiles/per-user/$USER/bin/sops",
    "/run/current-system/sw/bin/sops",
]

# Last resort, see the module docstring.
NIX_SOPS_ATTR = "nixpkgs#sops"


def fail(message: str) -> None:
    print(f"sops-import-env: {message}", file=sys.stderr)
    sys.exit(1)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import plaintext env files into a sops file.",
        epilog="Each argument is NAME or NAME=PATH; a bare NAME means ~/.config/NAME.env.",
    )
    parser.add_argument(
        "--sops-file",
        default="secrets/homelab.yaml",
        help="sops file to write (default: secrets/homelab.yaml)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="read and hash the sources, print the plan, change nothing",
    )
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="skip a source that does not exist instead of failing",
    )
    parser.add_argument(
        "sources",
        nargs="*",
        metavar="NAME[=PATH]",
        help=f"env files to import (default: {' '.join(DEFAULT_NAMES)})",
    )
    return parser.parse_args(argv)


def resolve(name: str, path: str | None) -> tuple[str, Path]:
    if path is not None:
        return name, Path(path).expanduser()
    return name, Path.home() / ".config" / f"{name}.env"


def key_name(name: str) -> str:
    """The sops key for a source, and therefore the deployed file name."""
    return name if name.endswith(".env") else f"{name}.env"


def candidates():
    """Yield (how, path) in the documented order; the caller tests each path."""
    override = os.environ.get("SOPS_BIN")
    if override:
        # A path, or a bare name to look up: both are reasonable in an override.
        yield "SOPS_BIN", Path(shutil.which(override) or override).expanduser()
    for raw in PROFILE_PATHS:
        yield "nix profile", Path(os.path.expandvars(raw)).expanduser()
    found = shutil.which("sops")
    if found:
        yield "PATH", Path(found)


def nix_sops() -> tuple[str, Path] | None:
    """Ask nix for the sops store path; None when nix is absent or says no."""
    nix = shutil.which("nix")
    if not nix:
        return None
    result = subprocess.run(
        [
            nix,
            "--extra-experimental-features",
            "nix-command flakes",
            "build",
            "--no-link",
            "--print-out-paths",
            NIX_SOPS_ATTR,
        ],
        capture_output=True,
        timeout=600,
    )
    if result.returncode != 0:
        return None
    out = result.stdout.decode().strip().splitlines()
    if not out:
        return None
    return f"nix build {NIX_SOPS_ATTR}", Path(out[0]) / "bin" / "sops"


def sops_version(sops: str) -> str:
    result = subprocess.run([sops, "--version"], capture_output=True, timeout=60)
    # sops 3.13 prints a deprecation note on stderr and the version on stdout.
    lines = result.stdout.decode(errors="replace").strip().splitlines()
    return lines[0] if lines else "version unknown"


def sops_bin() -> str:
    """Resolve sops, print where it came from, and say what to do if it is absent."""
    override = os.environ.get("SOPS_BIN")
    if override and not Path(shutil.which(override) or override).expanduser().is_file():
        # A typo in the override should say so instead of silently falling back.
        fail(f"SOPS_BIN={override} is not a file; unset it or point it at the sops binary")
    looked = []
    for how, path in candidates():
        looked.append(f"{path} ({how})")
        if path.is_file() and os.access(path, os.X_OK):
            sops = str(path)
            print(f"sops: {sops} ({sops_version(sops)}) via {how}")
            return sops
    if shutil.which("nix"):
        found = nix_sops()
        if found and found[1].is_file():
            how, path = found
            looked.append(f"{path} ({how})")
            sops = str(path)
            print(f"sops: {sops} ({sops_version(sops)}) via {how}")
            return sops
        looked.append(f"{NIX_SOPS_ATTR} via nix build (no result)")
    fail(
        "no sops binary. Run the recipe through nix: "
        "`nix shell nixpkgs#sops -c just secrets-import …`, or set "
        "SOPS_BIN=/path/to/sops.\n  looked at: " + ", ".join(looked)
    )


def sops_set(sops: str, sops_file: Path, key: str, value: str) -> None:
    # The value is JSON on stdin: `sops set` parses its value argument as JSON,
    # and --value-stdin keeps it out of the process table.
    payload = json.dumps(value).encode()
    result = subprocess.run(
        [sops, "set", "--idempotent", "--value-stdin", str(sops_file), f'["{key}"]'],
        input=payload,
        capture_output=True,
    )
    if result.returncode != 0:
        fail(
            f"sops set {key} failed ({result.returncode}): "
            f"{result.stderr.decode(errors='replace').strip()}"
        )


def sops_get(sops: str, sops_file: Path, key: str) -> bytes:
    result = subprocess.run(
        [sops, "decrypt", "--extract", f'["{key}"]', str(sops_file)],
        capture_output=True,
    )
    if result.returncode != 0:
        fail(
            f"sops decrypt {key} failed ({result.returncode}): "
            f"{result.stderr.decode(errors='replace').strip()}"
        )
    return result.stdout


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    # Resolve (and report) the toolchain before reading anything: this is the
    # first thing that can be wrong on a host the profile has not reached yet.
    sops = sops_bin()

    sops_file = Path(args.sops_file)
    if not sops_file.exists():
        fail(f"no sops file at {sops_file}")

    pairs = []
    for spec in args.sources or DEFAULT_NAMES:
        name, _, path = spec.partition("=")
        pairs.append(resolve(name, path or None))

    planned = 0
    for name, source in pairs:
        key = key_name(name)
        if not source.exists():
            if args.allow_missing:
                print(f"skip {key}: no source at {source}")
                continue
            fail(f"no source at {source}")
        value = source.read_text()
        planned += 1
        if args.dry_run:
            print(f"would set {key} ({len(value)} bytes, sha256:{digest(value.encode())})")
            continue
        assert sops is not None
        sops_set(sops, sops_file, key, value)
        # Prove the round trip: the key decrypts back to the exact bytes.
        if sops_get(sops, sops_file, key) != value.encode():
            fail(f"{key} did not round-trip; the file is now inconsistent, check `sops -d {sops_file}`")
        print(f"ok {key}: {len(value)} bytes, sha256:{digest(value.encode())}, verified")

    if args.dry_run:
        print(f"dry run: {planned} source(s), {sops_file} unchanged")
    else:
        print(f"imported {planned} key(s) into {sops_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

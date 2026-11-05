#!/usr/bin/env python3
"""Account for every apt package the remote profile does not get from the flake.

The remote profile owns 23 tools that Ubuntu also ships. Everything else that a
human installed by hand (`apt-mark showmanual`) has to be named and justified:
either the flake now owns the tool, or the package stays on the host because a
user profile cannot own what it touches (the kernel, a root daemon, a driver).

A package that matches no rule fails the run, so a new apt package cannot slip
into the host unnoticed.

Usage:
  ssh homelab apt-mark showmanual | scripts/apt-accounting.py
  scripts/apt-accounting.py --input apt-manual.txt --table own
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# The 23 apt names S01 assigned to the remote profile. Two of them (`golang`,
# `golang-go`) resolve to the same Nix package; the flake proves the store path.
OWNED = (
    "bat",
    "fd-find",
    "fzf",
    "ripgrep",
    "jq",
    "tmux",
    "tree",
    "htop",
    "pandoc",
    "ffmpeg",
    "imagemagick",
    "git",
    "vim",
    "zsh",
    "gh",
    "mosh",
    "screen",
    "byobu",
    "golang",
    "golang-go",
    "nodejs",
    "luarocks",
    "openjdk-21-jdk-headless",
)


@dataclass(frozen=True)
class Rule:
    bucket: str
    reason: str
    pattern: str

    def matches(self, name: str) -> bool:
        return re.fullmatch(self.pattern, name) is not None


# Ordered rules: the first match wins. Reasons are short because the table is
# read as evidence, not as prose.
RULES = (
    Rule(
        "gpu",
        "kernel-coupled NVIDIA/CUDA driver: DKMS builds against the running kernel",
        r"(lib)?nvidia-.*",
    ),
    Rule(
        "gpu",
        "kernel-coupled NVIDIA/CUDA driver: DKMS builds against the running kernel",
        r"cuda-.*|.*-nvidia-.*|nvidia-.*|screen-resolution-extra",
    ),
    Rule(
        "kernel",
        "boot, kernel or filesystem: must match the running kernel and the bootloader",
        r"linux-(generic-hwe-24\.04|headers-.*|modules-.*|tools-.*)",
    ),
    Rule(
        "kernel",
        "boot, kernel or filesystem: must match the running kernel and the bootloader",
        r"grub-.*|shim-signed|efibootmgr|memtest86\+|init|kpartx|lvm2|xfsprogs|"
        r"dosfstools|gdisk|parted|e2fsprogs|squashfs-tools|isolinux|ipxe|ovmf|makedumpfile",
    ),
    Rule(
        "hypervisor",
        "root libvirt/QEMU daemon: the nine domains and their networks run under it",
        r"libvirt-.*|virtinst|qemu-.*|cloud-image-utils|debootstrap|dnsmasq|genisoimage",
    ),
    Rule(
        "containers",
        "root daemon: Docker and the host Nix systemd units serve processes, not a user",
        r"docker-.*|containerd\.io|nix-setup-systemd",
    ),
    Rule(
        "network",
        "host network or remote access: root-owned rules, links and servers",
        r"iptables.*|ipset|wireguard-tools|tailscale|openssh-server|network-manager.*|"
        r"wpasupplicant|wireless-tools|rfkill|dnsutils|net-tools|socat|sshpass|"
        r"speedtest-cli|ipmitool",
    ),
    Rule(
        "desktop",
        "desktop session: GNOME, the print stack, fonts and display plumbing are OS-level",
        r"gnome-.*|yaru-.*|ubuntu-.*|language-.*|fonts-.*|cups.*|printer-.*|hplip|"
        r"foomatic-.*|openprinting-.*|gstreamer.*|alsa-.*|libasound2t64|ibus.*|at-spi2-core|"
        r"libatk.*|libatspi2\.0-0t64|orca|brltty|bluez.*|bolt|solaar|logiops|inputattach|"
        r"pipewire-pulse|wireplumber|libspa-0\.2-bluetooth|xdg-desktop-portal-gnome|"
        r"seahorse|nautilus.*|baobab|eog|evince|zenity|yelp|mousetweaks|dmz-cursor-theme|"
        r"xcursor-themes|xkb-data|xfonts-.*|xvfb|google-chrome-stable|firefox|steam-.*|"
        r"gamemode|gnome-.*|libgl1-mesa-dri.*|im-config|pm-utils|pipewire.*",
    ),
    Rule(
        "build",
        "build toolchain: compiles the DKMS driver and the CUDA samples against the host libc",
        r"gcc|g\+\+|build-essential|make|cmake|autoconf|autopoint|bison|flex|gperf|"
        r"pkg-config|libtool|binutils|llvm|.*-dev|texinfo|texi2html|gettext|dwarves|pahole|"
        r"xmlsec1|libzmq5|libsasl2-.*|libssl-dev",
    ),
    Rule(
        "python-system",
        "system Python: the host tooling (MAAS, cloud-init, netifaces) imports it as root",
        r"python3(\.[0-9]+)?(-.*)?",
    ),
    Rule(
        "third-party",
        "third-party apt repository (not Ubuntu): a user-facing tool the flake could own",
        r"rex",
    ),
    Rule(
        "base",
        "base Ubuntu 24.04 userland: present in the stock image, replaced by nothing in a profile",
        r".*",
    ),
)

# The base bucket is not a catch-all. The names above come from the stock image;
# this file pins them, so a package that matches no specific rule AND is not in
# the baseline fails the run instead of hiding in the last bucket.
BASELINE_FILE = Path(__file__).with_name("apt-base-packages.txt")


def baseline_names() -> set[str]:
    names: set[str] = set()
    for line in BASELINE_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            names.add(line)
    return names

BUCKET_TITLES = {
    "flake": "Remote profile owns it",
    "third-party": "Third-party apt repo (candidate for the flake)",
    "gpu": "GPU driver (apt, kernel-coupled)",
    "kernel": "Kernel and boot (apt)",
    "hypervisor": "Libvirt/QEMU (apt, root daemon)",
    "containers": "Container and Nix daemons (apt)",
    "network": "Host networking and remote access (apt)",
    "desktop": "Desktop session (apt)",
    "build": "Build toolchain (apt)",
    "python-system": "System Python (apt)",
    "base": "Base Ubuntu userland (apt)",
}


def classify(name: str) -> tuple[str, str]:
    if name in OWNED:
        return "flake", "the remote profile owns it: /nix/store package, apt copy is shadowed"
    for rule in RULES:
        if rule.matches(name):
            if rule.bucket == "base" and name not in baseline_names():
                raise RuntimeError(
                    f"unclassified: {name} matches no rule and is not in "
                    f"{BASELINE_FILE.name}; account for it in a rule or in the baseline"
                )
            return rule.bucket, rule.reason
    raise RuntimeError(f"unclassified: {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="file with one package per line (default: stdin)")
    parser.add_argument(
        "--table",
        choices=("summary", "all", "both"),
        default="both",
        help="which tables to print",
    )
    args = parser.parse_args()

    raw = open(args.input).read() if args.input else sys.stdin.read()
    packages = sorted({line.strip() for line in raw.splitlines() if line.strip()})

    rows: list[tuple[str, str, str]] = []
    # A name can be marked manual and still be absent from apt (apt keeps the
    # mark after a removal), so the two sets are reported side by side.
    owned_present = [name for name in OWNED if name in packages]
    owned_absent = [name for name in OWNED if name not in packages]
    try:
        for name in packages:
            bucket, reason = classify(name)
            rows.append((name, bucket, reason))
    except RuntimeError as error:
        print(f"FAIL: {error}")
        return 2

    counts: dict[str, int] = {}
    for _, bucket, _ in rows:
        counts[bucket] = counts.get(bucket, 0) + 1

    if args.table in ("summary", "both"):
        print("| Bucket | Packages | Reason |")
        print("| --- | --- | --- |")
        for bucket in sorted(counts, key=lambda b: (-counts[b], b)):
            reasons = {reason for _, b, reason in rows if b == bucket}
            reason = reasons.pop() if len(reasons) == 1 else "see the per-package table"
            print(f"| {BUCKET_TITLES[bucket]} | {counts[bucket]} | {reason} |")
        print(f"| **Total** | **{len(rows)}** | |")
        print()

    if args.table in ("all", "both"):
        print("| Package | Bucket | Reason |")
        print("| --- | --- | --- |")
        for name, bucket, reason in rows:
            print(f"| `{name}` | {bucket} | {reason} |")
        print()

    print(f"manual packages: {len(rows)}")
    print(f"flake-owned names in the manual set: {counts.get('flake', 0)} of {len(OWNED)}")
    if owned_absent:
        print(f"owned names apt does not mark manual: {' '.join(owned_absent)}")
    print(f"stay on the host: {len(rows) - counts.get('flake', 0)}")
    if counts.get("flake", 0) != len(owned_present):
        print("FAIL: a declared-owned name in the input was classified elsewhere")
        return 1
    print("OK: every package is accounted for")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

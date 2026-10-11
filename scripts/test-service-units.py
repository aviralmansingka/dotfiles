#!/usr/bin/env python3
"""Systemd unit and launchd plist checks (CI surface X10c/X10d).

Dual-mode pattern (PR #293 rule):
  default : a missing tool prints SKIP with a message and does not fail.
  STRICT=1: a missing tool FAILs. Use this mode in CI.

Checks:
  systemd: unit parse, explicit interpreter in ExecStart (the 203/EXEC
  class, #142), repo-path references, timer -> service references, and
  `systemd-analyze verify` when the binary exists.
  launchd: plist parse (stdlib plistlib), required keys, and repo-path
  references. Host-path existence stays host-side.

Offline, deterministic (file lists come from git ls-files), stdlib only.
"""

import os
import plistlib
import re
import shlex
import shutil
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STRICT = os.environ.get("STRICT") == "1"

PASS = 0
FAIL = 0
SKIP = 0
TOTAL_START = time.perf_counter()

INTERPRETERS = {
    "python3", "python", "bash", "sh", "zsh", "dash", "env",
    "node", "perl", "ruby",
}

REPO_REF_SYSTEMD = re.compile(r"%h/dotfiles/([A-Za-z0-9_./-]*)")
REPO_REF_LAUNCHD = re.compile(r"(?:\$HOME|~)/dotfiles/([A-Za-z0-9_./-]*)")


def emit(status, name, file, reason, ms):
    global PASS, FAIL, SKIP
    print(f"{status} {name} {file} | {reason} ({ms:.0f} ms)")
    if status == "PASS":
        PASS += 1
    elif status == "FAIL":
        FAIL += 1
    else:
        SKIP += 1


def git_files(*dirs):
    try:
        out = subprocess.run(
            ["git", "-C", REPO, "ls-files", "--", *dirs],
            capture_output=True, text=True, check=True,
        )
        files = sorted(out.stdout.split())
        if files:
            return files
    except Exception:
        pass
    files = []
    for d in dirs:
        for root, _dirs, fs in os.walk(os.path.join(REPO, d)):
            files.extend(
                os.path.relpath(os.path.join(root, f), REPO) for f in fs
            )
    return sorted(files)


# ---------------------------------------------------------------- systemd


def parse_systemd(text):
    """Parse a unit file into {section: [(key, value), ...]}."""
    sections = {}
    cur = None
    buf = ""
    for raw in text.splitlines():
        line = raw
        if buf:
            line = buf + " " + line.lstrip()
        if line.rstrip().endswith("\\"):
            buf = line.rstrip()[:-1].rstrip() + " "
            continue
        buf = ""
        line = line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("[") and line.endswith("]"):
            cur = line[1:-1]
            sections.setdefault(cur, [])
            continue
        if cur is not None and "=" in line:
            key, value = line.split("=", 1)
            sections[cur].append((key.strip(), value.strip()))
    return sections


def execstart_parts(sections):
    for key, value in sections.get("Service", []):
        if key == "ExecStart":
            line = value.lstrip("+-!@")
            try:
                return shlex.split(line)
            except ValueError:
                return line.split()
    return None


def exec_token_class(parts):
    """Classify the ExecStart first token.

    Returns (kind, token): kind is 'interpreter', 'repo-script',
    'host-only', or 'missing'.
    """
    if not parts:
        return "missing", ""
    tok = parts[0]
    base = os.path.basename(tok.rstrip("/"))
    if base in INTERPRETERS:
        return "interpreter", tok
    if tok.startswith("%h/dotfiles/"):
        return "repo-script", tok
    return "host-only", tok


def service_section_values(sections):
    for _key, value in sections.get("Service", []):
        yield value


def check_systemd_unit(rel, service_names):
    path = os.path.join(REPO, rel)
    t0 = time.perf_counter()
    try:
        text = open(path, encoding="utf-8").read()
    except OSError as exc:
        emit("FAIL", "sysd-parse", rel, f"cannot read: {exc}", 0)
        return None
    try:
        sections = parse_systemd(text)
    except Exception as exc:  # pragma: no cover - parser is total
        emit("FAIL", "sysd-parse", rel, f"parse error: {exc}", 0)
        return None

    # Parse check: expected sections and keys exist.
    problems = []
    if "Unit" not in sections:
        problems.append("no [Unit] section")
    elif not any(k == "Description" for k, _ in sections["Unit"]):
        problems.append("no Description in [Unit]")
    if rel.endswith(".service"):
        if "Service" not in sections:
            problems.append("no [Service] section")
        elif not any(k == "ExecStart" for k, _ in sections["Service"]):
            problems.append("no ExecStart in [Service]")
    elif rel.endswith(".timer"):
        if "Timer" not in sections:
            problems.append("no [Timer] section")
    if problems:
        emit("FAIL", "sysd-parse", rel, "; ".join(problems),
             (time.perf_counter() - t0) * 1000)
    else:
        emit("PASS", "sysd-parse", rel, "sections and keys parse",
             (time.perf_counter() - t0) * 1000)

    # Explicit-interpreter rule (203/EXEC class, #142).
    if rel.endswith(".service"):
        t0 = time.perf_counter()
        parts = execstart_parts(sections)
        kind, tok = exec_token_class(parts)
        if kind == "missing":
            emit("FAIL", "sysd-execstart", rel, "no parsable ExecStart",
                 (time.perf_counter() - t0) * 1000)
        elif kind == "interpreter":
            emit("PASS", "sysd-execstart", rel,
                 f"explicit interpreter: {tok}",
                 (time.perf_counter() - t0) * 1000)
        elif tok.endswith(".py"):
            emit("FAIL", "sysd-execstart", rel,
                 f"bare python script path ({tok}); use an explicit "
                 "interpreter, 203/EXEC class (#142)",
                 (time.perf_counter() - t0) * 1000)
        elif kind == "repo-script":
            emit("FAIL", "sysd-execstart", rel,
                 f"bare repo script path ({tok}); use an explicit "
                 "interpreter, 203/EXEC class (#142)",
                 (time.perf_counter() - t0) * 1000)
        else:
            emit("SKIP", "sysd-execstart", rel,
                 f"host-only path ({tok}); verify the exec bit on the host",
                 (time.perf_counter() - t0) * 1000)

    # Timer -> service reference.
    if rel.endswith(".timer"):
        t0 = time.perf_counter()
        target = None
        for key, value in sections.get("Timer", []):
            if key == "Unit":
                target = value
        if target is None:
            target = os.path.basename(rel)[: -len(".timer")] + ".service"
        if "Timer" not in sections:
            emit("FAIL", "sysd-timer-target", rel, "no [Timer] section",
                 (time.perf_counter() - t0) * 1000)
        elif os.path.basename(target) in service_names:
            emit("PASS", "sysd-timer-target", rel,
                 f"Unit={target} is a tracked service",
                 (time.perf_counter() - t0) * 1000)
        else:
            emit("FAIL", "sysd-timer-target", rel,
                 f"Unit={target} has no tracked .service file",
                 (time.perf_counter() - t0) * 1000)

    # Repo-path references must exist in the repo.
    t0 = time.perf_counter()
    missing = []
    for value in service_section_values(sections):
        for m in REPO_REF_SYSTEMD.finditer(value):
            rest = m.group(1)
            if rest and not os.path.exists(os.path.join(REPO, rest)):
                missing.append(f"%h/dotfiles/{rest}")
    if missing:
        emit("FAIL", "sysd-repo-paths", rel,
             "repo paths do not exist: " + ", ".join(missing),
             (time.perf_counter() - t0) * 1000)
    else:
        emit("PASS", "sysd-repo-paths", rel,
             "no missing repo-relative paths",
             (time.perf_counter() - t0) * 1000)

    return sections


def check_verify(units, parsed):
    """Run `systemd-analyze verify` per unit (dual mode)."""
    t0 = time.perf_counter()
    tool = shutil.which("systemd-analyze")
    if tool is None:
        if STRICT:
            emit("FAIL", "sysd-verify", "systemd/**",
                 "systemd-analyze not found (STRICT=1)",
                 (time.perf_counter() - t0) * 1000)
        else:
            emit("SKIP", "sysd-verify", "systemd/**",
                 "systemd-analyze not found; python parse ran instead",
                 (time.perf_counter() - t0) * 1000)
        return
    for rel in units:
        t0 = time.perf_counter()
        proc = subprocess.run(
            [tool, "verify", os.path.join(REPO, rel)],
            capture_output=True, text=True,
        )
        ms = (time.perf_counter() - t0) * 1000
        if proc.returncode == 0:
            emit("PASS", "sysd-verify", rel, "systemd-analyze verify clean", ms)
            continue
        lines = [ln for ln in (proc.stdout + proc.stderr).splitlines() if ln.strip()]
        host_only = False
        if rel.endswith(".service") and rel in parsed:
            kind, _tok = exec_token_class(execstart_parts(parsed[rel]))
            host_only = kind == "host-only"
        if host_only and lines and all("is not executable" in ln for ln in lines):
            emit("SKIP", "sysd-verify", rel,
                 "host-only ExecStart path missing on this host; "
                 "verify on the target host",
                 ms)
        else:
            reason = lines[0] if lines else f"exit code {proc.returncode}"
            emit("FAIL", "sysd-verify", rel, reason, ms)


# ---------------------------------------------------------------- launchd


def plist_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, list):
        for item in obj:
            yield from plist_strings(item)
    elif isinstance(obj, dict):
        for item in obj.values():
            yield from plist_strings(item)


def check_launchd_plist(rel):
    path = os.path.join(REPO, rel)
    t0 = time.perf_counter()
    try:
        with open(path, "rb") as fh:
            data = plistlib.load(fh)
    except Exception as exc:
        emit("FAIL", "launchd-parse", rel, f"plistlib cannot parse: {exc}",
             (time.perf_counter() - t0) * 1000)
        return
    if not isinstance(data, dict):
        emit("FAIL", "launchd-parse", rel, "top level is not a dict",
             (time.perf_counter() - t0) * 1000)
        return
    emit("PASS", "launchd-parse", rel, "plistlib parses the plist",
         (time.perf_counter() - t0) * 1000)

    # Required keys.
    t0 = time.perf_counter()
    problems = []
    label = data.get("Label")
    if not isinstance(label, str) or not label:
        problems.append("no Label string")
    if not (isinstance(data.get("ProgramArguments"), list) and data["ProgramArguments"]
            or isinstance(data.get("Program"), str) and data["Program"]):
        problems.append("no ProgramArguments array or Program string")
    if isinstance(label, str) and label != os.path.basename(rel)[: -len(".plist")]:
        problems.append(f"Label {label!r} does not match the file name")
    if problems:
        emit("FAIL", "launchd-keys", rel, "; ".join(problems),
             (time.perf_counter() - t0) * 1000)
    else:
        emit("PASS", "launchd-keys", rel,
             "Label and ProgramArguments present, Label matches file name",
             (time.perf_counter() - t0) * 1000)

    # Repo-path references must exist in the repo (a plist once pointed
    # into a deleted worktree for ~2 months).
    t0 = time.perf_counter()
    missing = []
    for s in plist_strings(data):
        for m in REPO_REF_LAUNCHD.finditer(s):
            rest = m.group(1)
            if rest and not os.path.exists(os.path.join(REPO, rest)):
                missing.append(f"~/dotfiles/{rest}")
    if missing:
        emit("FAIL", "launchd-repo-paths", rel,
             "repo paths do not exist: " + ", ".join(missing),
             (time.perf_counter() - t0) * 1000)
    else:
        emit("PASS", "launchd-repo-paths", rel,
             "no missing repo-relative paths (host-only paths stay host-side)",
             (time.perf_counter() - t0) * 1000)


def main():
    print(f"== systemd + launchd checks (STRICT={int(STRICT)}) ==")
    units = git_files("systemd")
    plists = git_files("launchd")
    services = [u for u in units if u.endswith(".service")]
    service_names = {os.path.basename(u) for u in services}

    parsed = {}
    for rel in units:
        sections = check_systemd_unit(rel, service_names)
        if sections is not None:
            parsed[rel] = sections
    check_verify(units, parsed)
    for rel in plists:
        if rel.endswith(".plist"):
            check_launchd_plist(rel)

    total_ms = (time.perf_counter() - TOTAL_START) * 1000
    print(f"== service units: {PASS} pass, {FAIL} fail, {SKIP} skip "
          f"(total {total_ms:.0f} ms) ==")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# Paths: ops/modal-devbox/** devbox/** nvim/.config/nvim/lua/plugins/mason.lua scripts/test-modal-devbox.py
"""modal-devbox suite — offline parity and hygiene gates for the Modal devbox.

Offline and deterministic: no network, no Modal account, no `modal` binary,
no $HOME mutation. Reads ops/modal-devbox/devbox.py as source text and AST
(it never imports the module), and checks it against the Packer provisioning
pipeline and the research-verified Modal API surface:

  M1  apt parity — the Modal apt set is a superset of the Packer set
      (install_system_packages.sh), with extras exactly
      {openssh-server, ca-certificates}.
  M2  stow parity — every stowed package exists in the pinned dotfiles tree
      (git ls-tree of DOTFILES_REF; repo dirs as fallback without git); the
      core set is always stowed; git is stowed late (after all HTTPS clones).
  M3  layer discipline — every run_commands layer carries a Phase comment;
      phase comments and run_commands calls pair 1:1.
  M4  GPU allowlist — exactly the researched set; no B200/B300.
  M5  secret hygiene — no token/key literals in devbox.py, entrypoint.sh,
      the runbook, or the wrapper.
  M6  entrypoint structure — bash -n clean; links nvim-share, nvim-state,
      nvim-bob (nvim installs + used marker), cache, repos, vault
      (obsidian.nvim), zsh_history into /persist; repoints the nvim shim to
      bob's proxy; execs sshd with password auth off.
  M7  dotfiles pin — DOTFILES_REF is a full 40-hex SHA on an HTTPS GitHub URL.
  M8  runbook accuracy — README mentions the real commands (`devbox ssh`,
      `modal run ops/modal-devbox/devbox.py`, `modal container stop`,
      `--gpu`); no removed-CLI commands (modal proxy/attach/sandbox,
      interactive_snooze) in shipped files. The research report is exempt —
      it documents their removal.
  M9  wrapper structure — bash -n clean; the subcommands ssh/start/status/
      stop exist; ::main/::status/::stop refs, the nohup backgrounded
      launcher, MODAL_DEVBOX_PY fallback, the CONNECT-line contract, and
      the cached-CONNECT fast path (try_cached_ssh) all present.
  M10 mason tools — MASON_TOOLS covers every ensure_installed entry in
      nvim/.config/nvim/lua/plugins/mason.lua plus clangd/codelldb from the
      LazyVim lang extras.

Run `--selftest` to prove the checks fail on mutated copies (apt extras, GPU
allowlist, late-git order, injected token) in a mktemp sandbox; the real
worktree is never touched.
"""

import ast
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEVBOX = "ops/modal-devbox/devbox.py"
ENTRYPOINT = "ops/modal-devbox/entrypoint.sh"
RUNBOOK = "ops/modal-devbox/README.md"
WRAPPER = "devbox/.local/bin/devbox"
PACKER_APT_SCRIPT = "ops/packer/scripts/install_system_packages.sh"

TUPLE_NAMES = ("PACKER_APT", "MODAL_APT_EXTRAS", "STOW_PACKAGES", "STOW_PACKAGES_LATE", "GPU_ALLOWLIST", "MASON_TOOLS")
STRING_NAMES = ("DOTFILES_REPO", "DOTFILES_REF")

EXPECTED_GPU = ("", "T4", "L4", "A10", "L40S", "A100-40GB", "A100-80GB", "H100", "H200")
EXPECTED_EXTRAS = {"openssh-server", "ca-certificates"}
CORE_STOW = {"zsh", "tmux", "nvim", "starship", "git"}

SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"ghp_[A-Za-z0-9]{30,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"),
)

BANNED_CLI = ("modal proxy", "modal attach", "modal sandbox", "interactive_snooze", "modal interactive")
REQUIRED_RUNBOOK = (
    "devbox ssh",
    "modal run ops/modal-devbox/devbox.py",
    "modal container stop",
    "--gpu",
    "--idle-timeout",
)


# ---------------------------------------------------------------- helpers

def _fail(msg):
    return [str(msg)]


def _extract_module_literals(source):
    """Map module-level tuple/string constant names to their values."""
    tree = ast.parse(source)
    out = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        value = node.value
        if isinstance(value, ast.Tuple):
            elts = []
            for elt in value.elts:
                if not isinstance(elt, ast.Constant) or not isinstance(elt.value, str):
                    return None  # non-literal: refuse to guess
                elts.append(elt.value)
            out[target.id] = tuple(elts)
        elif isinstance(value, ast.Constant) and isinstance(value.value, str):
            out[target.id] = value.value
    return out


def _count_run_commands(source):
    tree = ast.parse(source)
    calls = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "run_commands":
                calls += 1
    return calls


def _packer_apt_list(script_text):
    """Packages from the Packer apt-get install -y list (with continuations)."""
    joined = script_text.replace("\\\n", " ")
    for line in joined.splitlines():
        line = line.strip()
        if "apt-get install -y" not in line:
            continue
        tokens = shlex.split(line)
        idx = tokens.index("-y")
        return [t for t in tokens[idx + 1:] if re.fullmatch(r"[a-z0-9.+-]+", t)]
    return []


# ---------------------------------------------------------------- checks

def check_apt_parity(root, literals, _source):
    errors = []
    modal_apt = set(literals.get("PACKER_APT", ())) | set(literals.get("MODAL_APT_EXTRAS", ()))
    packer_script = (root / PACKER_APT_SCRIPT).read_text()
    packer_apt = set(_packer_apt_list(packer_script))
    if not packer_apt:
        errors.append("could not parse any apt packages from the Packer script")
    missing = packer_apt - modal_apt
    if missing:
        errors.append(f"Packer packages missing from the Modal image: {sorted(missing)}")
    extras = modal_apt - packer_apt
    if extras != EXPECTED_EXTRAS:
        errors.append(f"apt extras must be exactly {sorted(EXPECTED_EXTRAS)}, found: {sorted(extras)}")
    return errors


def _pinned_tree_dirs(root, ref):
    """Top-level entries of the pinned dotfiles tree; None without git (selftest)."""
    try:
        proc = subprocess.run(["git", "-C", str(root), "ls-tree", "--name-only", ref],
                              capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return {name.strip("/") for name in proc.stdout.splitlines()
            if name and not name.startswith(".")}


def check_stow_parity(root, literals, _source):
    errors = []
    early = literals.get("STOW_PACKAGES", ())
    late = literals.get("STOW_PACKAGES_LATE", ())
    overlap = set(early) & set(late)
    if overlap:
        errors.append(f"packages stowed both early and late: {sorted(overlap)}")
    # Membership is checked against the pinned tree the image clones — not
    # the worktree, which may drift ahead of or behind the pin.
    pinned = _pinned_tree_dirs(root, literals.get("DOTFILES_REF", ""))
    available = pinned if pinned is not None else \
        {d.name for d in root.iterdir() if d.is_dir()}
    for name in early + late:
        if name not in available:
            where = "pinned dotfiles tree" if pinned is not None else "sandbox dirs"
            errors.append(f"stowed package {name!r} is not in the {where}")
    if not CORE_STOW <= set(early) | set(late):
        errors.append(f"core stow set {sorted(CORE_STOW)} must always be stowed")
    if "git" not in late or "git" in early:
        errors.append("git must be stowed late (cleanup.sh order): url.insteadOf rewrites HTTPS to SSH")
    return errors


def check_layer_discipline(_root, _literals, source):
    errors = []
    layers = _count_run_commands(source)
    comments = re.findall(r"^# --- Phase \d", source, re.MULTILINE)
    if layers != len(comments):
        errors.append(f"{layers} run_commands layers but {len(comments)} Phase comments — pair them 1:1")
    if layers < 5:
        errors.append(f"expected at least the 5 Packer-phase layers, found {layers}")
    return errors


def check_gpu_allowlist(_root, literals, _source):
    errors = []
    gpu = literals.get("GPU_ALLOWLIST")
    if gpu != EXPECTED_GPU:
        errors.append(f"GPU_ALLOWLIST must be exactly {EXPECTED_GPU}, found {gpu}")
    return errors


def check_secret_hygiene(root, _literals, _source):
    errors = []
    for rel in (DEVBOX, ENTRYPOINT, RUNBOOK, WRAPPER):
        text = (root / rel).read_text()
        for pattern in SECRET_PATTERNS:
            hit = pattern.search(text)
            if hit:
                errors.append(f"{rel}: secret-like literal {hit.group(0)[:12]}...")
                break
    return errors


def check_entrypoint(root, _literals, _source):
    errors = []
    path = root / ENTRYPOINT
    text = path.read_text()
    if shutil.which("bash"):
        proc = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            errors.append(f"bash -n failed: {proc.stderr.strip()}")
    else:
        print("    SKIP bash -n (no bash on PATH)")
    for needle in ("nvim-share", "nvim-state", "nvim-bob", "nvim-bin/nvim", "cache", "repos", "vault", "zsh_history"):
        if needle not in text:
            errors.append(f"entrypoint must link {needle!r} into /persist")
    if "exec /usr/sbin/sshd" not in text:
        errors.append("entrypoint must exec sshd in the foreground")
    if "PasswordAuthentication=no" not in text:
        errors.append("entrypoint must disable sshd password auth")
    return errors


def check_dotfiles_pin(_root, literals, _source):
    errors = []
    ref = literals.get("DOTFILES_REF", "")
    repo = literals.get("DOTFILES_REPO", "")
    if not re.fullmatch(r"[0-9a-f]{40}", ref):
        errors.append(f"DOTFILES_REF must be a full 40-hex SHA, found {ref!r}")
    if not repo.startswith("https://github.com/"):
        errors.append(f"DOTFILES_REPO must be an HTTPS GitHub URL, found {repo!r}")
    return errors


def check_runbook_accuracy(root, _literals, _source):
    errors = []
    readme = (root / RUNBOOK).read_text()
    for needle in REQUIRED_RUNBOOK:
        if needle not in readme:
            errors.append(f"runbook must mention {needle!r}")
    for rel in (DEVBOX, ENTRYPOINT, RUNBOOK, WRAPPER):
        text = (root / rel).read_text()
        for banned in BANNED_CLI:
            if banned in text:
                errors.append(f"{rel}: references removed CLI {banned!r}")
                break
    return errors


def check_wrapper(root, _literals, _source):
    errors = []
    path = root / WRAPPER
    text = path.read_text()
    if shutil.which("bash"):
        proc = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            errors.append(f"bash -n failed: {proc.stderr.strip()}")
    for needle in ("devbox ssh", "devbox start", "devbox status", "devbox stop",
                   "::main", "::status", "::stop", "nohup", "MODAL_DEVBOX_PY",
                   "ops/modal-devbox/devbox.py", "^CONNECT ", "accept-new",
                   "try_cached_ssh", "ConnectTimeout", "ControlMaster", "$CACHE"):
        if needle not in text:
            errors.append(f"wrapper must reference {needle!r}")
    return errors


def check_mason_tools(root, literals, _source):
    errors = []
    declared = set(literals.get("MASON_TOOLS", ()))
    mason_lua = (root / "nvim/.config/nvim/lua/plugins/mason.lua").read_text()
    block = mason_lua.split("ensure_installed", 1)[1].split("}", 1)[0]
    wanted = set(re.findall(r'"([a-z0-9-]+)"', block))
    missing = wanted - declared
    if missing:
        errors.append(f"mason.lua tools missing from MASON_TOOLS: {sorted(missing)}")
    for extra in ("clangd", "codelldb"):
        if extra not in declared:
            errors.append(f"MASON_TOOLS must include {extra!r} (LazyVim lang extra)")
    return errors


CHECKS = (
    ("M1 apt parity", check_apt_parity),
    ("M2 stow parity", check_stow_parity),
    ("M3 layer discipline", check_layer_discipline),
    ("M4 GPU allowlist", check_gpu_allowlist),
    ("M5 secret hygiene", check_secret_hygiene),
    ("M6 entrypoint structure", check_entrypoint),
    ("M7 dotfiles pin", check_dotfiles_pin),
    ("M8 runbook accuracy", check_runbook_accuracy),
    ("M9 wrapper structure", check_wrapper),
    ("M10 mason tools", check_mason_tools),
)


def run_checks(root, quiet=False):
    source = (root / DEVBOX).read_text()
    literals = _extract_module_literals(source)
    failures = 0
    if literals is None or not set(TUPLE_NAMES + STRING_NAMES) <= set(literals):
        print("FAIL module literals: devbox.py must keep literal PACKER_APT, MODAL_APT_EXTRAS, "
              "STOW_PACKAGES, STOW_PACKAGES_LATE, GPU_ALLOWLIST, DOTFILES_REPO, DOTFILES_REF")
        return 1
    for name, fn in CHECKS:
        started = time.perf_counter()
        try:
            errors = fn(root, literals, source)
        except Exception as exc:  # noqa: BLE001 — surface any check error as FAIL
            errors = _fail(exc)
        took = (time.perf_counter() - started) * 1000
        if errors:
            failures += 1
            print(f"FAIL {name} ({took:.1f} ms)")
            for error in errors:
                print(f"     {error}")
        elif not quiet:
            print(f"PASS {name} ({took:.1f} ms)")
    return failures


def selftest():
    """Mutated sandbox copies must fail the exact checks that guard them."""
    root = Path(tempfile.mkdtemp(prefix="modal-devbox-selftest-"))
    failures = 0
    try:
        cases = {
            "clean": lambda: None,
            "apt-extra": lambda: _mutate(root, 'MODAL_APT_EXTRAS = ("openssh-server", "ca-certificates")',
                                         'MODAL_APT_EXTRAS = ("openssh-server", "ca-certificates", "sl")'),
            "gpu-b200": lambda: _mutate(root, '"H100", "H200")', '"H100", "H200", "B200")'),
            "git-early": lambda: _mutate(root, '"agents", "pi", "herdr",',
                                         '"agents", "pi", "herdr", "git",'),
            "wrapper-no-nohup": lambda: _mutate_wrapper(root, "nohup modal", "nohupx modal"),
            "wrapper-no-cache": lambda: _mutate_wrapper(root, "try_cached_ssh", "try_cached_sshx"),
            "mason-missing": lambda: _mutate(root, '"starpls", "buildifier", "clang-format", "clangd", "codelldb",',
                                           '"starpls", "buildifier", "clang-format",'),
            "token-leak": lambda: _mutate(root, "MMDFLUX_VERSION = ",
                                          f'FAKE = "ghp_{"A" * 36}"  # MMDFLUX_VERSION = '),
        }
        expected_fail = {"clean": 0, "apt-extra": {"M1"}, "gpu-b200": {"M4"},
                         "git-early": {"M2"}, "token-leak": {"M5"},
                         "wrapper-no-nohup": {"M9"}, "wrapper-no-cache": {"M9"},
                         "mason-missing": {"M10"}}
        for label, mutate in cases.items():
            _make_sandbox(root)
            mutate()
            out = _capture(lambda: run_checks(root))
            failed = {line.split()[1].split()[0] for line in out.splitlines()
                      if line.startswith("FAIL")}
            want = expected_fail[label]
            if label == "clean" and failed:
                print(f"FAIL selftest clean copy must pass, got failures: {sorted(failed)}")
                failures += 1
            elif label != "clean" and not want <= failed:
                print(f"FAIL selftest {label}: expected {sorted(want)} to fail, got {sorted(failed)}")
                print(out)
                failures += 1
            else:
                print(f"PASS selftest {label} (failures: {sorted(failed) or 'none'})")
    finally:
        shutil.rmtree(root, ignore_errors=True)
    return failures


def _make_sandbox(root):
    for rel in (DEVBOX, ENTRYPOINT, RUNBOOK, WRAPPER, PACKER_APT_SCRIPT,
                "nvim/.config/nvim/lua/plugins/mason.lua"):
        dest = root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / rel, dest)
    # M2 checks the pinned dotfiles tree: materialize the real repo's
    # top-level dirs (the sandbox has no git objects) plus every stow name
    # the copied devbox.py mentions (empty dirs are enough).
    literals = _extract_module_literals((root / DEVBOX).read_text())
    names = set(literals.get("STOW_PACKAGES", ())) | set(literals.get("STOW_PACKAGES_LATE", ()))
    names |= {d.name for d in REPO.iterdir() if d.is_dir() and not d.name.startswith(".")}
    for name in names:
        (root / name).mkdir(exist_ok=True)


def _mutate(root, old, new):
    path = root / DEVBOX
    text = path.read_text()
    assert old in text, f"mutation anchor not found: {old!r}"
    path.write_text(text.replace(old, new, 1))


def _mutate_wrapper(root, old, new):
    path = root / WRAPPER
    text = path.read_text()
    assert old in text, f"wrapper mutation anchor not found: {old!r}"
    path.write_text(text.replace(old, new))


def _capture(fn):
    import io
    from contextlib import redirect_stdout
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        fn()
    return buffer.getvalue()


def main():
    if "--selftest" in sys.argv:
        return 1 if selftest() else 0
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        return 0
    return 1 if run_checks(REPO) else 0


if __name__ == "__main__":
    sys.exit(main())

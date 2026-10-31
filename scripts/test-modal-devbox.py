#!/usr/bin/env python3
# Paths: ops/modal-devbox/** ops/packer/scripts/install_system_packages.sh devbox/** nvim/.config/nvim/lua/plugins/mason.lua scripts/test-modal-devbox.py scripts/modal-secrets-sync
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
  M6  entrypoint structure — bash -n clean; links cache, repos, vault
      (obsidian.nvim) and zsh_history into /persist, keeps nvim/mason/bob
      off the volume (M17 guards that); repoints the nvim shim to bob's
      proxy; execs sshd with password auth off.
  M7  dotfiles pin — DOTFILES_REF is a full 40-hex SHA on an HTTPS GitHub URL.
  M8  runbook accuracy — README mentions the real commands (`devbox ssh`,
      `modal run ops/modal-devbox/devbox.py`, `modal container stop`,
      `--gpu`); no removed-CLI commands (modal proxy/attach/sandbox,
      interactive_snooze) in shipped files. The research report is exempt —
      it documents their removal.
  M9  wrapper structure — bash -n clean; the contract strings that couple
      it to devbox.py (::main/::status/::stop/::snapshot refs, the
      CONNECT-line format, MODAL_DEVBOX_PY). Behavior is proven by M16,
      not by grepping names.
  M10 mason tools — MASON_TOOLS covers every ensure_installed entry in
      nvim/.config/nvim/lua/plugins/mason.lua plus clangd/codelldb from the
      LazyVim lang extras.
  M11 manifest schema — secrets-manifest.json is valid JSON covering the
      planned inventory exactly; required keys per MODE; sources/targets
      are relative paths under $HOME; unique names; no value-looking
      strings (SECRET_PATTERNS).
  M12 sync-script structure — scripts/modal-secrets-sync is executable and
      bash -n clean; --dry-run/--only/--aws/--force, umask 077, mktemp dir
      with a cleanup trap, --from-dotenv; never cats/echoes temp secret
      files; no token literals.
  M13 materialization wiring — entrypoint.sh defines the materialize_env /
      materialize_file helpers (0600, base64 -d, guarded zshenv include) and
      the marker line; devbox.py splices manifest-generated calls over the
      marker, probes workspace secrets (objects.list) so a fresh workspace
      boots, mounts them via from_name, and appends the ephemeral
      DEVBOX_SSH_PUBLIC_KEY from_dict secret LAST (later entries win
      clashes).
  M14 CUDA variant — CUDA_BASE_IMAGE is a pinned nvidia/cuda 13.x -devel
      ubuntu24.04 tag (not -cudnn: that layer makes cold GPUs hydrate too
      slowly to reach a tunnel); both variants go through one _build_image
      call site; the CUDA image exports CUDA_HOME/PATH/LD_LIBRARY_PATH
      instead of symlinking nvcc (a symlink breaks nvcc's argv[0]-relative
      header lookup, losing <cuda_runtime.h>).
  M15 CUDA runbook — the runbook documents the GPU workflow end to end:
      --gpu, nvcc --version, cuda-compile-db, clangd --check, and the
      explicit `devbox stop` rule for GPU boxes.
  M16 wrapper behavior — EXECUTES devbox/.local/bin/devbox against stubbed
      modal/ssh CLIs (in a throwaway tree) and asserts usage, unknown
      subcommand, cold start via ::main with a cached CONNECT line, warm
      reuse without a restart, --new bypassing the cache with flags
      forwarded, and stop clearing the cache; an env-shebang modal CLI must
      resolve to the interpreter it names, with no silent `modal run`
      fallback.
  M17 entrypoint behavior — EXECUTES entrypoint.sh with DEVBOX_PERSIST and
      DEVBOX_SKIP_SSHD pointed at a throwaway tree and asserts the /persist
      semantics: every documented $HOME dir becomes a symlink into the
      volume, the first boot seeds the image copy onto the volume, an
      existing volume copy wins over the image copy, and a second run is
      idempotent; with stow on PATH a second tree also proves pi's
      auth.json never lands on the volume and ~/.pi/agent stays a real
      container-local directory.
  M18 region wiring — REGION_ALLOWLIST offers both multipliers and Mumbai
      (ap-south), Sandbox.create forwards region=region or None, an unknown
      region fails fast with the allowed list, and the wrapper + runbook
      document the flag.
  M19 resources and status — devbox.py extracts and CALLS _describe_resources
      with full and empty tag sets (a behavior-preserving rename passes), hard
      caps use Modal's (request, limit) tuple form, status renders the summary,
      and the runbook documents the -limit flags and the status line.
  M20 pi tooling — the image installs the pi agent at a pinned version on
      Node >= 22, and the entrypoint exports FIREWORKS_API_KEY from pi's
      auth.json.
  M21 stow repoint — the entrypoint restows from the writable checkout, and
      its package lists cannot drift from devbox.py's.
  M22 snapshot secret scrub — the scrub-path builder is extracted and CALLED
      against the real manifest, and snapshot scrubs those paths before it
      freezes the filesystem.

Run `--selftest` to prove the checks fail on mutated copies (apt extras, GPU
allowlist, late-git order, injected token) in a mktemp sandbox; the real
worktree is never touched.
"""

import ast
import base64
import json
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
MANIFEST = "ops/modal-devbox/secrets-manifest.json"
SYNC_SCRIPT = "scripts/modal-secrets-sync"
RUNBOOK = "ops/modal-devbox/README.md"
WRAPPER = "devbox/.local/bin/devbox"
PACKER_APT_SCRIPT = "ops/packer/scripts/install_system_packages.sh"

TUPLE_NAMES = ("PACKER_APT", "MODAL_APT_EXTRAS", "STOW_PACKAGES", "STOW_PACKAGES_LATE", "STOW_IGNORE", "GPU_ALLOWLIST", "MASON_TOOLS", "REGION_ALLOWLIST")
STRING_NAMES = ("DOTFILES_REPO", "DOTFILES_REF", "CUDA_BASE_IMAGE", "PI_VERSION")

EXPECTED_GPU = ("", "T4", "L4", "A10", "L40S", "A100-40GB", "A100-80GB", "H100", "H200")
EXPECTED_EXTRAS = {"openssh-server", "ca-certificates"}
CORE_STOW = {"zsh", "tmux", "nvim", "starship", "git"}
ALLOWED_MODES = {"dotenv", "file", "command"}
# The planned inventory (docs/modal-devbox.md, "Secrets and MCP tokens").
# Adding or removing a manifest entry means updating this set deliberately.
EXPECTED_SECRET_NAMES = {
    "devbox-env", "devbox-mcp-browserbase", "devbox-mcp-google",
    "devbox-telegram", "devbox-whatsapp", "devbox-stt-client",
    "devbox-pi-auth", "devbox-gh", "devbox-aws",
}

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
    comments = re.findall(r"^\s*# --- Phase \d", source, re.MULTILINE)
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
    for needle in ("nvim-bin/nvim", "cache", "repos", "vault", "zsh_history"):
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
    # Contract strings only: the couplings to devbox.py's entrypoints and the
    # CONNECT line format. Behavior is proven by M16, not by grepping names.
    for needle in ("::main", "::status", "::stop", "::snapshot", "^CONNECT ",
                   "MODAL_DEVBOX_PY", "ops/modal-devbox/devbox.py"):
        if needle not in text:
            errors.append(f"wrapper must reference {needle!r}")
    return errors


def _stub_env(root):
    """A PATH with stubbed modal/ssh/git-free CLIs for executing the wrapper."""
    stub_bin = root / ".stub-bin"
    stub_bin.mkdir(exist_ok=True)
    log = root / ".stub-calls.log"
    (stub_bin / "modal").write_text(
        "#!/usr/bin/env bash\n"
        f'echo "modal $*" >> "{log}"\n'
        'case "$*" in\n'
        '  *::main*) echo "CONNECT 127.0.0.1 2222";;\n'
        '  *::stop*) echo "terminated sb-stub";;\n'
        '  *::status*) echo "no devbox sandbox running";;\n'
        "esac\nexit 0\n"
    )
    (stub_bin / "ssh").write_text(
        "#!/usr/bin/env bash\n"
        f'echo "ssh $*" >> "{log}"\n'
        "exit 0\n"
    )
    # Stub interpreter for the plain-script status/stop path (DEVBOX_PY).
    (stub_bin / "modpy").write_text(
        "#!/usr/bin/env bash\n"
        f'echo "py $*" >> "{log}"\n'
        'case "$*" in\n'
        '  *" status") echo "no devbox sandbox running";;\n'
        '  *" stop") echo "terminated sb-stub";;\n'
        "esac\nexit 0\n"
    )
    for name in ("modal", "ssh", "modpy"):
        (stub_bin / name).chmod(0o755)
    return stub_bin, log


def check_wrapper_behavior(root, _literals, _source):
    """M16 — execute the wrapper against stubbed modal/ssh and assert behavior:
    usage, unknown subcommand, cached fast path, --new bypassing the cache,
    and `stop` clearing the cache. This replaces name-grepping with evidence.

    Runs in a throwaway mktemp tree: the harness writes stub CLIs, a state dir
    and a cache, so it must never touch the real worktree (a leftover cache
    would also make the cold-start assertion flap on the next run).
    """
    errors = []
    if not shutil.which("bash"):
        return errors  # macOS/Linux CI always has bash; skip quietly if not
    work = Path(tempfile.mkdtemp(prefix="modal-devbox-m16-"))
    try:
        for rel in (WRAPPER, DEVBOX):
            dest = work / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / rel, dest)
        stub_bin, log = _stub_env(work)
        state = work / ".state"
        wrapper = work / WRAPPER
        env = {"PATH": f"{stub_bin}:/usr/bin:/bin:/usr/sbin:/sbin",
               "HOME": str(work), "XDG_STATE_HOME": str(state),
               "MODAL_DEVBOX_PY": str(work / DEVBOX),
               "DEVBOX_PY": str(stub_bin / "modpy")}

        def run(*args):
            return subprocess.run(["bash", str(wrapper), *args], capture_output=True,
                                  text=True, timeout=60, cwd=work, env=env)

        def calls():
            return log.read_text() if log.exists() else ""

        def reset_log():
            log.write_text("")

        proc = run("--help")
        if proc.returncode != 0 or "devbox ssh" not in proc.stdout:
            errors.append(f"--help must print usage and exit 0 (rc={proc.returncode})")

        proc = run("bogus")
        if proc.returncode == 0 or "unknown subcommand" not in (proc.stderr + proc.stdout):
            errors.append("an unknown subcommand must fail with a clear message")

        cache = state / "modal-devbox/connect"
        reset_log()
        proc = run("ssh", "--", "true")
        if proc.returncode != 0:
            errors.append(f"a cold `devbox ssh` must succeed through the stub (rc={proc.returncode})\n{proc.stderr}")
        if "::main" not in calls():
            errors.append("a cold `devbox ssh` must start via devbox.py::main")
        if "ssh -o" not in calls() or not cache.exists():
            errors.append("a cold `devbox ssh` must cache the CONNECT line and attach")

        reset_log()
        run("ssh", "--", "true")
        if "::main" in calls():
            errors.append("a warm `devbox ssh` must reuse the cache, not restart the sandbox")
        if "ssh -o" not in calls():
            errors.append("a warm `devbox ssh` must still attach")

        reset_log()
        run("ssh", "--new", "--gpu", "T4", "--", "true")
        if "::main" not in calls():
            errors.append("start flags (--new) must bypass the cache and go through ::main")
        if "--gpu T4" not in calls():
            errors.append("start flags must be forwarded to ::main")

        reset_log()
        run("stop")
        if cache.exists():
            errors.append("`devbox stop` must clear the cached CONNECT line")
        if "py " not in calls():
            errors.append("`devbox stop` must use the plain-script path, not an ephemeral App")

        reset_log()
        run("status")
        if "py " not in calls() or "modal run" in calls():
            errors.append("`devbox status` must not launch a Modal App")

        # A pip-style modal CLI carries '#!/usr/bin/env <interpreter>': the
        # wrapper must resolve the named interpreter on PATH. Exec'ing env
        # itself cannot run the shebang-less devbox.py, and the wrapper used
        # to fall back to an ephemeral App without warning.
        interp = stub_bin / "devbox-modpy"
        interp.write_text(
            "#!/usr/bin/env bash\n"
            f'echo "interp $*" >> "{log}"\n'
            'case "$*" in *" status") echo "no devbox sandbox running";; esac\n'
            "exit 0\n"
        )
        interp.chmod(0o755)
        (stub_bin / "modal").write_text(
            "#!/usr/bin/env devbox-modpy\n"
            f'echo "modal $*" >> "{log}"\n'
            "exit 0\n"
        )
        env.pop("DEVBOX_PY")
        reset_log()
        proc = run("status")
        if proc.returncode != 0 or "interp " not in calls():
            errors.append("status must run devbox.py through the modal CLI shebang's interpreter")
        if "modal run" in calls():
            errors.append("an env-shebang modal CLI must not silently fall back to an ephemeral App")

        # A sibling launcher can be alive while its sandbox is already gone
        # (preempted, idle-reaped, OOM). Its last CONNECT line sits in the log,
        # and reusing it produced "Connection refused". The wrapper must probe
        # the tunnel and start fresh instead.
        state_dir = state / "modal-devbox"
        state_dir.mkdir(parents=True, exist_ok=True)
        sleeper = subprocess.Popen(["sleep", "60"])
        try:
            (state_dir / "launcher.pid").write_text(f"{sleeper.pid}\n")
            (state_dir / "start.log").write_text("CONNECT 127.0.0.1 1\n")
            if cache.exists():
                cache.unlink()
            reset_log()
            run("ssh", "--", "true")
            if "::main" not in calls():
                errors.append("a dead sibling CONNECT line must be discarded, not reused")
        finally:
            sleeper.terminate()
    finally:
        shutil.rmtree(work, ignore_errors=True)
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


def _not_relative_under_home(path):
    """True when path is absolute, ~-rooted, or escapes $HOME with .."""
    if not path:
        return False  # optional field
    if path.startswith("/") or path.startswith("~") or path.startswith("\\"):
        return True
    return ".." in path.split("/")


def check_manifest(root, _literals, _source):
    """M11 — manifest schema lint (names/sources/variable names, never values)."""
    errors = []
    raw = (root / MANIFEST).read_text()
    for pattern in SECRET_PATTERNS:
        hit = pattern.search(raw)
        if hit:
            errors.append(f"{MANIFEST}: value-like literal {hit.group(0)[:12]}... — values never enter the repo")
            break
    try:
        data = json.loads(raw)
    except ValueError as exc:
        return errors + [f"{MANIFEST}: invalid JSON: {exc}"]
    entries = data.get("secrets")
    if not isinstance(entries, list) or not entries:
        return errors + [f"{MANIFEST}: must carry a non-empty 'secrets' list"]
    names = []
    for i, entry in enumerate(entries):
        label = f"{MANIFEST} entry[{i}]"
        if not isinstance(entry, dict):
            errors.append(f"{label}: must be an object")
            continue
        for key in ("name", "mode"):
            if not entry.get(key):
                errors.append(f"{label}: missing required key {key!r}")
        name, mode = entry.get("name", ""), entry.get("mode", "")
        if mode not in ALLOWED_MODES:
            errors.append(f"{label}: mode {mode!r} not in {sorted(ALLOWED_MODES)}")
        if not re.fullmatch(r"devbox-[a-z0-9-]+", name):
            errors.append(f"{label}: secret name {name!r} must look like devbox-<slug>")
        names.append(name)
        if mode in ("dotenv", "file") and not entry.get("source"):
            errors.append(f"{label}: mode {mode!r} requires a source")
        for field in ("source", "target"):
            value = entry.get(field, "")
            if value and _not_relative_under_home(value):
                errors.append(f"{label}: {field} {value!r} must be a relative path under $HOME")
        if mode == "dotenv" and not (isinstance(entry.get("variables"), list) and entry.get("variables")):
            errors.append(f"{label}: dotenv entries need a non-empty variables list")
        if mode == "dotenv" and not entry.get("target"):
            errors.append(f"{label}: dotenv entries need a target (in-container env-file path)")
        if mode == "file":
            if not entry.get("variable"):
                errors.append(f"{label}: file entries need a variable (base64 payload name)")
            if not entry.get("target"):
                errors.append(f"{label}: file entries need a target")
        if mode == "command":
            if not entry.get("command"):
                errors.append(f"{label}: command entries need a command")
            if not (isinstance(entry.get("variables"), list) and entry.get("variables")):
                errors.append(f"{label}: command entries need a non-empty variables list")
        variables = list(entry.get("variables") or [])
        if entry.get("variable"):
            variables.append(entry["variable"])
        for var in variables:
            if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", var):
                errors.append(f"{label}: invalid variable name {var!r}")
        if "opt-in" in entry and not isinstance(entry["opt-in"], bool):
            errors.append(f"{label}: opt-in must be a boolean")
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        errors.append(f"{MANIFEST}: duplicate secret names: {dupes}")
    missing = EXPECTED_SECRET_NAMES - set(names)
    if missing:
        errors.append(f"{MANIFEST}: planned inventory incomplete — missing: {sorted(missing)}")
    extra = set(names) - EXPECTED_SECRET_NAMES
    if extra:
        errors.append(f"{MANIFEST}: entries outside the planned inventory: {sorted(extra)} "
                      "(update EXPECTED_SECRET_NAMES when extending the inventory)")
    return errors


def check_sync_script(root, _literals, _source):
    """M12 — sync-script structure: idempotent, temp-safe, value-silent."""
    errors = []
    path = root / SYNC_SCRIPT
    text = path.read_text()
    if not path.stat().st_mode & 0o111:
        errors.append(f"{SYNC_SCRIPT} must be executable")
    if shutil.which("bash"):
        proc = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            errors.append(f"bash -n failed: {proc.stderr.strip()}")
    else:
        print("    SKIP bash -n (no bash on PATH)")
    for needle in ("--dry-run", "--only", "--aws", "--force", "umask 077", "mktemp -d",
                   "trap", "rm -rf", "--from-json", "secrets-manifest.json"):
        if needle not in text:
            errors.append(f"sync script must reference {needle!r}")
    for pattern in SECRET_PATTERNS:
        hit = pattern.search(text)
        if hit:
            errors.append(f"{SYNC_SCRIPT}: secret-like literal {hit.group(0)[:12]}...")
            break
    if re.search(r'\bcat\s+"\$', text):
        errors.append("sync script must never cat/echo the temp dotenv files — values are a leak")
    return errors


def check_materialization(root, _literals, source):
    """M13 — entrypoint materialization wiring + sandbox secret ordering."""
    errors = []
    entry = (root / ENTRYPOINT).read_text()
    try:
        manifest = json.loads((root / MANIFEST).read_text())
    except ValueError:
        return []  # M11 already reports invalid JSON
    for needle in ("materialize_env()", "materialize_file()", 'chmod 600 "$path"',
                   "base64 -d", "#@devbox-materialize@#",
                   'source "$HOME/.config/devbox-env.sh"', 'grep -q "devbox-env.sh"'):
        if needle not in entry:
            errors.append(f"entrypoint must reference {needle!r} (secrets materialization)")
    if 'printf \'export %s=%q\\n\'' not in entry:
        errors.append("materialize_env must write export KEY=value lines")
    if '.replace("#@devbox-materialize@#"' not in source:
        errors.append("devbox.py must splice manifest-generated calls over the entrypoint marker")
    if 'materialize_file "$HOME/' not in source or 'materialize_env "$HOME/' not in source:
        errors.append("devbox.py generator must emit materialize_env and materialize_file calls")
    if any(not e.get("target") for e in manifest["secrets"]):
        errors.append("every manifest entry needs a target (the SSH key is per-launch, not synced)")
    for e in manifest["secrets"]:
        if e["mode"] == "file" and not e.get("variable"):
            errors.append(f"manifest entry {e.get('name')!r}: file mode needs a variable")
        if e["mode"] != "file" and not e.get("variables"):
            errors.append(f"manifest entry {e.get('name')!r}: env-file mode needs variables")
    if "modal.Secret.objects.list()" not in source:
        errors.append("devbox.py must probe existing workspace secrets (objects.list) so a fresh workspace boots")
    if "modal.Secret.from_name" not in source:
        errors.append("devbox.py must mount manifest secrets via modal.Secret.from_name")
    if '+ [modal.Secret.from_dict({"DEVBOX_SSH_PUBLIC_KEY"' not in source:
        errors.append("the ephemeral DEVBOX_SSH_PUBLIC_KEY from_dict secret must be appended AFTER the "
                      "manifest secrets — later entries win key clashes (research §8.4)")
    return errors


def check_cuda_variant(_root, literals, source):
    """M14 — CUDA base pin, one shared layer builder, no nvcc symlink trap."""
    errors = []
    base = literals.get("CUDA_BASE_IMAGE", "")
    if not re.fullmatch(r"nvidia/cuda:13\.\d+\.\d+[\w.-]*-devel-ubuntu24\.04", base):
        errors.append(f"CUDA_BASE_IMAGE must pin a CUDA 13.x -devel ubuntu24.04 tag, found {base!r}")
    if "cudnn" in base:
        errors.append("CUDA_BASE_IMAGE must not be the -cudnn variant: the extra layers make "
                      "cold GPU sandboxes hydrate too slowly to reach a tunnel")
    for variant in ("cpu_image", "cuda_image"):
        if not re.search(rf"^{variant} = _build_image\(", source, re.MULTILINE):
            errors.append(f"{variant} must be built through _build_image(...)")
    if not re.search(r"^def _build_image\(root_image", source, re.MULTILINE):
        errors.append("_build_image(root_image) must exist and take the base image as a parameter")
    cuda_env = re.search(r"\.env\(\s*\{(.*?)\}\s*\)", source, re.DOTALL)
    block = source.split("cuda_image = _build_image", 1)[-1]
    for var in ("CUDA_HOME", "PATH", "LD_LIBRARY_PATH"):
        if var not in block:
            errors.append(f"CUDA image must export {var} for non-interactive shells")
    if "/usr/local/cuda/bin" not in block:
        errors.append("CUDA PATH must include /usr/local/cuda/bin")
    if re.search(r"ln -sf\s+/usr/local/cuda/bin", source):
        errors.append("do not symlink nvcc into /usr/local/bin: nvcc resolves headers "
                      "relative to argv[0] and loses <cuda_runtime.h>")
    return errors


def check_cuda_runbook(root, _literals, _source):
    """M15 — the runbook documents the whole GPU/CUDA workflow."""
    errors = []
    readme = (root / RUNBOOK).read_text()
    for needle in ("--gpu", "nvcc --version", "cuda-compile-db", "clangd --check", "devbox stop"):
        if needle not in readme:
            errors.append(f"runbook must document {needle!r}")
    return errors


def check_entrypoint_behavior(root, _literals, _source):
    """M17 — execute entrypoint.sh in a throwaway tree and assert the /persist
    bootstrap semantics the design rests on: first boot seeds the volume from
    the image and symlinks $HOME into it, later boots let the volume win, and
    a second run is idempotent. No root paths, no sshd writes."""
    errors = []
    if not shutil.which("bash"):
        return errors
    work = Path(tempfile.mkdtemp(prefix="modal-devbox-m17-"))
    try:
        home = work / "home"
        persist = work / "persist"
        home.mkdir()
        persist.mkdir()
        # Image-baked content on first boot, plus a volume copy for .cache that
        # must beat the image's copy (volume-wins rule).
        (home / ".local/share/nvim").mkdir(parents=True)
        (home / ".local/share/nvim/from-image.txt").write_text("image")
        (home / ".cache").mkdir()
        (home / ".cache/stale.txt").write_text("image-copy")
        (persist / "cache").mkdir()
        (persist / "cache/from-volume.txt").write_text("volume")

        env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(home),
               "DEVBOX_PERSIST": str(persist), "DEVBOX_SKIP_SSHD": "1"}
        for attempt in (1, 2):
            proc = subprocess.run(["bash", str(root / ENTRYPOINT)], capture_output=True,
                                  text=True, timeout=60, env=env)
            if proc.returncode != 0:
                errors.append(f"entrypoint run {attempt} failed (rc={proc.returncode}): "
                              f"{proc.stderr.strip()[:200]}")
                break

        links = {
            ".cache": "cache",
            "repos": "repos",
            "vault": "vault",
        }
        for rel, target in links.items():
            path = home / rel
            if not path.is_symlink():
                errors.append(f"$HOME/{rel} must become a symlink into the volume")
            elif path.readlink() != persist / target:
                errors.append(f"$HOME/{rel} -> {path.readlink()} (expected {persist / target})")
        if not (home / ".zsh_history").is_symlink():
            errors.append("$HOME/.zsh_history must be linked into the volume")
        # Nvim's plugin tree, runtime and state must stay on the image's local
        # disk: on the FUSE volume every fresh container paid seconds on the
        # first start. Guard the regression, not just the current shape.
        for rel in (".local/share/nvim", ".local/state/nvim", ".local/share/bob"):
            if (home / rel).is_symlink():
                errors.append(f"$HOME/{rel} must NOT be on the volume (slow nvim start)")
        entrypoint_text = (root / ENTRYPOINT).read_text()
        if "seed_and_restow" not in entrypoint_text:
            errors.append("entrypoint must seed + restow the writable checkout")
        # The probe returns early when nvim is absent, so compare on the source.
        if "--headless +qa" not in entrypoint_text:
            errors.append("entrypoint must prewarm nvim so the first open is fast")
        # A writable dotfiles checkout is seeded into the volume on first boot.
        if "repos/dotfiles" not in entrypoint_text:
            errors.append("entrypoint must seed $HOME/repos/dotfiles for editing in-box")
        # First boot seeds image content onto the volume (checked on .cache,
        # the seeded dir that still lives there).
        if not (persist / "cache/from-volume.txt").exists():
            errors.append("the volume's existing cache contents must be kept")
        if (home / ".cache/stale.txt").exists():
            errors.append("the image copy must not shadow the volume's cache after linking")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    # Second tree, with stow: prove pi's auth value never lands on the volume
    # and ~/.pi/agent stays a real container-local directory. Without the
    # scrub and the pre-created dir, stow folds ~/.pi onto the volume
    # checkout and every pi runtime write — auth.json included — lands on
    # /persist.
    stow = shutil.which("stow")
    if not stow:
        print("    SKIP pi-auth placement probe (no stow on PATH)")
        return errors
    work = Path(tempfile.mkdtemp(prefix="modal-devbox-m17-stow-"))
    try:
        home, persist = work / "home", work / "persist"
        home.mkdir()
        persist.mkdir()
        clone = home / "dotfiles"
        pkg = clone / "pi"
        (pkg / ".pi/agent").mkdir(parents=True)
        (pkg / ".pi/agent/keybindings.json").write_text("{}\n")
        settings = '{"theme": "gruvbox"}\n'
        (pkg / ".pi/agent/settings.json").write_text(settings)
        shutil.copy2(root / "pi/.stow-local-ignore", pkg / ".stow-local-ignore")
        (clone / ".git").mkdir()
        entry_text = (root / ENTRYPOINT).read_text()
        names = set()
        for var in ("STOW_PACKAGES", "STOW_PACKAGES_LATE"):
            match = re.search(rf'^{var}="([^"]*)"', entry_text, re.MULTILINE)
            names.update(match.group(1).split())
        for name in names - {"pi"}:
            (clone / name).mkdir()
        # Image bake: stow folds ~/.pi onto the clone, and the spliced
        # materializer then writes auth.json through that fold.
        subprocess.run(["stow", "--dir", str(clone), "--target", str(home), "pi"],
                       check=True, capture_output=True, timeout=30)
        secret = '{"fireworks": {"key": "sk-test"}}'
        (home / ".pi/agent/auth.json").write_text(secret)
        env = {"PATH": f"{Path(stow).parent}:/usr/bin:/bin:/usr/sbin:/sbin",
               "HOME": str(home), "DEVBOX_PERSIST": str(persist),
               "DEVBOX_SKIP_SSHD": "1",
               "DEVBOX_PI_AUTH_JSON": base64.b64encode(secret.encode()).decode()}
        for attempt in (1, 2):
            proc = subprocess.run(["bash", str(root / ENTRYPOINT)], capture_output=True,
                                  text=True, timeout=60, env=env)
            if proc.returncode != 0:
                errors.append(f"stow-tree entrypoint run {attempt} failed (rc={proc.returncode}): "
                              f"{proc.stderr.strip()[:200]}")
                break
        if (persist / "repos/dotfiles/pi/.pi/agent/auth.json").exists():
            errors.append("pi's auth.json must never be seeded onto /persist")
        real_auth = home / ".pi/agent/auth.json"
        if real_auth.is_symlink() or not real_auth.is_file() or real_auth.read_text() != secret:
            errors.append("$HOME/.pi/agent/auth.json must be a real container-local file "
                          "holding the materialized secret")
        if (home / ".pi").is_symlink():
            errors.append("$HOME/.pi must be a real directory, not a fold onto the volume checkout")
        kb = home / ".pi/agent/keybindings.json"
        if not kb.is_symlink() or "repos/dotfiles" not in str(kb.resolve()):
            errors.append("pi package entries must link into the writable checkout")
        st = home / ".pi/agent/settings.json"
        if st.is_symlink() or not st.is_file() or st.read_text() != settings:
            errors.append("settings.json must stay a real file refreshed from the checkout")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return errors


def check_region_wiring(root, literals, source):
    """M18 — --region is offered, validated, forwarded, and documented.

    Broad regions (us/eu/ap) are 1.15x and narrow ones 1.75x, so the allowlist
    carries both, and ap-south (Mumbai) must stay for India-local work.
    """
    errors = []
    regions = literals.get("REGION_ALLOWLIST")
    if not regions:
        return ["REGION_ALLOWLIST must be a module-level literal tuple"]
    for required in ("", "ap-south", "ap", "us", "eu"):
        if required not in regions:
            errors.append(f"REGION_ALLOWLIST must offer {required!r}")
    if not re.search(r"^\s*region=region or None,", source, re.MULTILINE):
        errors.append("Sandbox.create must receive region=region or None")
    if "unknown region" not in source:
        errors.append("an unknown --region must fail fast with the allowed list")
    wrapper = (root / WRAPPER).read_text()
    if "--region" not in wrapper:
        errors.append("the wrapper usage must advertise --region")
    readme = (root / RUNBOOK).read_text()
    for needle in ("--region", "ap-south"):
        if needle not in readme:
            errors.append(f"runbook must document {needle!r}")
    return errors


def _extract_function(source, name, helpers=()):
    """Compile one top-level function (plus any helpers it calls) out of
    devbox.py so the suite can call it without importing the module, which
    imports modal."""
    tree = ast.parse(source)
    wanted = list(helpers) + [name]
    bodies = [node for node in tree.body
              if isinstance(node, ast.FunctionDef) and node.name in wanted]
    if not any(body.name == name for body in bodies):
        return None
    module = ast.Module(body=bodies, type_ignores=[])
    namespace = {}
    exec(compile(module, "<extracted>", "exec"), namespace)  # noqa: S102
    return namespace[name]


def check_resources_and_status(root, _literals, source):
    """M19 — resources are recorded, limits are enforced through the tuple form,
    and status renders them. The formatter is extracted and CALLED, so a rename
    that keeps behavior passes and a broken format fails."""
    errors = []
    describe = _extract_function(source, "_describe_resources", helpers=("_resource_cells",))
    if describe is None:
        return ["devbox.py must define _describe_resources(tags)"]
    full = describe({"cpu": "4/8", "memory": "8192/16384", "gpu": "T4", "region": "ap-south"})
    for needle in ("cpu=4/8", "mem=8192/16384MiB", "gpu=T4", "region=ap-south"):
        if needle not in full:
            errors.append(f"resource line must show {needle!r}, got {full!r}")
    bare = describe({})
    if bare.count("?") < 4:
        errors.append("missing tags must degrade to '?' rather than raise")
    pinned = describe({"cpu": "4", "memory": "8192", "gpu": "none",
                       "region": "ap-south", "placement": "ap-south/gcp"})
    if "placement=ap-south/gcp" not in pinned:
        errors.append(f"a recorded placement must be shown, got {pinned!r}")
    if "placement=" in bare:
        errors.append("no placement tag must not print an empty placement field")
    if "_placement(" not in source or "MODAL_REGION" not in source:
        errors.append("placement must be read from the container (MODAL_REGION), not guessed")
    for needle in ("(cpu, cpu_limit)", "(memory, memory_limit)"):
        if needle not in source:
            errors.append(f"hard caps must use Modal's (request, limit) tuple form: {needle}")
    if "_describe_resources(" not in source.split("def _status", 1)[-1]:
        errors.append("status must render the resource summary")
    readme = (root / RUNBOOK).read_text()
    for needle in ("--cpu-limit", "--memory-limit", "devbox status"):
        if needle not in readme:
            errors.append(f"runbook must document {needle!r}")
    return errors


def check_stow_repoint(root, literals, _source):
    """M21 — the writable checkout is the live stow source, and the entrypoint's
    package lists cannot drift from devbox.py's (the build stows from the image
    clone; the entrypoint re-stows from ~/repos/dotfiles so edits take effect)."""
    errors = []
    entry = (root / ENTRYPOINT).read_text()
    for var in ("STOW_IGNORE=", "STOW_PACKAGES=", "STOW_PACKAGES_LATE="):
        if var not in entry:
            errors.append(f"entrypoint must define {var[:-1]} for the restow")
    if "seed_and_restow" not in entry:
        errors.append("entrypoint must re-stow from the writable checkout")
    if "stow -D -d \"$HOME/dotfiles\"" not in entry:
        errors.append("entrypoint must unstow the image clone before restowing")
    # Compare the shell lists with the Python constants.
    def shell_list(name):
        match = re.search(rf'^{name}="([^"]*)"', entry, re.MULTILINE)
        return match.group(1).split() if match else []
    expected_early = list(literals.get("STOW_PACKAGES", ()))
    expected_late = list(literals.get("STOW_PACKAGES_LATE", ()))
    if shell_list("STOW_PACKAGES") != expected_early:
        errors.append(f"entrypoint STOW_PACKAGES must equal devbox.py's {expected_early}, "
                      f"found {shell_list('STOW_PACKAGES')}")
    if shell_list("STOW_PACKAGES_LATE") != expected_late:
        errors.append(f"entrypoint STOW_PACKAGES_LATE must equal {expected_late}")
    if shell_list("STOW_IGNORE") != list(literals.get("STOW_IGNORE", ())):
        errors.append("entrypoint STOW_IGNORE must equal devbox.py's STOW_IGNORE")
    return errors


def check_pi_tooling(root, literals, source):
    """M20 — the pi agent is installed, runnable, and keyed.

    pi 1.4 needs Node >= 22 (Ubuntu 24.04 ships 18 — the first install crashed
    with an ESM/compile-cache error before the NodeSource step was added), so
    the node version and the pin are both guarded here.
    """
    errors = []
    version = literals.get("PI_VERSION", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version or ""):
        errors.append(f"PI_VERSION must pin x.y.z, found {version!r}")
    if "@earendil-works/pi-coding-agent@" not in source or "PI_VERSION" not in source:
        errors.append("the image must install @earendil-works/pi-coding-agent at PI_VERSION")
    if "setup_22.x" not in source and "nodejs.org/dist" not in source:
        errors.append("pi needs Node >= 22: the image must install a modern Node explicitly")
    entry = (root / ENTRYPOINT).read_text()
    if "FIREWORKS_API_KEY" not in entry:
        errors.append("entrypoint must export FIREWORKS_API_KEY from pi's auth.json")
    if "auth.json" not in entry:
        errors.append("entrypoint must read pi's auth.json for that export")
    return errors


def check_snapshot_scrub(root, _literals, source):
    """M22 — `devbox snapshot` must never publish materialized secret values.

    The scrub-path builder is extracted and CALLED against the real manifest
    (a behavior-preserving rename passes), and snapshot must scrub those
    paths before it freezes the filesystem."""
    errors = []
    builder = _extract_function(source, "_secret_scrub_paths")
    if builder is None:
        return ["devbox.py must define _secret_scrub_paths(manifest)"]
    try:
        manifest = json.loads((root / MANIFEST).read_text())
    except ValueError:
        return [f"{MANIFEST}: invalid JSON; M11 reports it"]
    expected = [f"/root/{e['target']}" for e in manifest["secrets"] if e.get("target")]
    expected.append("/root/dotfiles/pi/.pi/agent/auth.json")
    got = builder(manifest)
    if got != expected:
        errors.append(f"scrub paths must cover every manifest target plus the image-clone "
                      f"auth.json, got: {got}")
    # Execute snapshot() with stubs and check the ORDER of effects, rather than
    # grepping for call strings (a behavior-preserving refactor must pass).
    ns = {}
    tree = ast.parse(source)
    wanted = [n for n in tree.body
              if isinstance(n, ast.FunctionDef)
              and n.name in ("snapshot", "_secret_scrub_paths", "_running_devboxes", "_pick_primary")]
    for node in wanted:
        node.decorator_list = []  # @app.local_entrypoint() cannot resolve here
    try:
        exec(compile(ast.Module(body=wanted, type_ignores=[]), "<extracted>", "exec"), ns)  # noqa: S102
    except Exception as exc:  # noqa: BLE001
        return [f"could not compile snapshot() with its helpers: {exc}"]
    if "snapshot" not in ns:
        return ["devbox.py must define snapshot()"]

    class _Proc:
        def __init__(self, code):
            self.code = code

        def wait(self):
            return self.code

    class _Image:
        def __init__(self, order):
            self.order = order

        def publish(self, name):
            self.order.append("publish")

    class _Sandbox:
        def __init__(self, order, scrub_rc):
            self.object_id = "sb-test"
            self.order = order
            self.scrub_rc = scrub_rc

        def exec(self, *args):
            self.order.append(("exec", args))
            return _Proc(self.scrub_rc)

        def snapshot_filesystem(self):
            self.order.append("snapshot")
            return _Image(self.order)

    class _App:
        def local_entrypoint(self):
            return lambda fn: fn

    def drive(scrub_rc):
        order = []
        sandbox = _Sandbox(order, scrub_rc)
        ns.update({"app": _App(), "sys": __import__("sys"), "modal": None,
                   "MANIFEST": manifest,
                   "_running_devboxes": lambda: [sandbox],
                   "_pick_primary": lambda running: running[0]})
        try:
            ns["snapshot"]("probe")
        except SystemExit:
            pass
        return order

    order = drive(0)
    kinds = [step if isinstance(step, str) else step[0] for step in order]
    if not kinds or kinds[0] != "exec" or kinds[1:2] != ["snapshot"]:
        errors.append(f"snapshot must scrub before freezing, order was {kinds}")
    if "publish" not in kinds or kinds.index("publish") < kinds.index("snapshot"):
        errors.append("snapshot must publish only after the freeze")
    scrubbed = [a for k, a in ((s[0], s[1]) for s in order if not isinstance(s, str))
                if k == "exec"]
    flat = " ".join(str(x) for a in scrubbed for x in a)
    if "/root/.env" not in flat or "auth.json" not in flat:
        errors.append("the scrub must cover materialized secrets (env files + auth.json)")
    # A failed scrub must abort before the freeze and the publish.
    aborted = [s if isinstance(s, str) else s[0] for s in drive(1)]
    if "snapshot" in aborted or "publish" in aborted:
        errors.append(f"a failed scrub must abort before snapshot/publish, got {aborted}")
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
    ("M11 manifest schema", check_manifest),
    ("M12 sync script", check_sync_script),
    ("M13 materialization", check_materialization),
    ("M14 CUDA variant", check_cuda_variant),
    ("M15 CUDA runbook", check_cuda_runbook),
    ("M16 wrapper behavior", check_wrapper_behavior),
    ("M17 entrypoint behavior", check_entrypoint_behavior),
    ("M18 region wiring", check_region_wiring),
    ("M19 resources and status", check_resources_and_status),
    ("M20 pi tooling", check_pi_tooling),
    ("M21 stow repoint", check_stow_repoint),
    ("M22 snapshot secret scrub", check_snapshot_scrub),
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
            "wrapper-no-nohup": lambda: _mutate_wrapper(root, "nohup modal run", "runbg modal run"),
            "wrapper-new-ignores-flags": lambda: _mutate_wrapper(
                root, 'if [ "${#start_args[@]}" -eq 0 ]; then', 'if true; then'),
            "mason-missing": lambda: _mutate(root, '"starpls", "buildifier", "clang-format", "clangd", "codelldb",',
                                           '"starpls", "buildifier", "clang-format",'),
            "token-leak": lambda: _mutate(root, "MMDFLUX_VERSION = ",
                                          f'FAKE = "ghp_{"A" * 36}"  # MMDFLUX_VERSION = '),
            "manifest-bad-mode": lambda: _mutate_file(root, MANIFEST, '"mode": "dotenv"', '"mode": "envfile"'),
            "manifest-leak": lambda: _mutate_file(root, MANIFEST, '"source": ".env"',
                                                   f'"source": "ghp_{"A" * 36}"'),
            "manifest-extra-name": lambda: _mutate_file(root, MANIFEST, '"name": "devbox-env"',
                                                          '"name": "devbox-totally-new"'),
            "sync-no-trap": lambda: _mutate_file(root, SYNC_SCRIPT, "trap 'rm -rf \"$WORK\"' EXIT",
                                                  '# trap removed'),
            "sync-cat-leak": lambda: _mutate_file(root, SYNC_SCRIPT, 'modal secret create "$name"',
                                                   'cat "$tmp" >&2; modal secret create "$name"'),
            "entrypoint-no-0600": lambda: _mutate_file(root, ENTRYPOINT, 'chmod 600 "$path"',
                                                        'chmod 644 "$path"', count=0),
            "secrets-ephemeral-first": lambda: _mutate(
                root,
                'secrets=[modal.Secret.from_name(n) for n in attached]\n'
                '        + [modal.Secret.from_dict({"DEVBOX_SSH_PUBLIC_KEY": pubkey})],',
                'secrets=[[modal.Secret.from_dict({"DEVBOX_SSH_PUBLIC_KEY": pubkey})]\n'
                '        + [modal.Secret.from_name(n) for n in attached]],'),
            "cuda-cudnn": lambda: _mutate(root, '"nvidia/cuda:13.0.0-devel-ubuntu24.04"',
                                          '"nvidia/cuda:13.0.0-cudnn-devel-ubuntu24.04"'),
            "entrypoint-image-wins": lambda: _mutate_file(
                root, ENTRYPOINT, 'rm -rf "$1"                          # volume wins over image-baked copy',
                ': # keep the image copy'),
            "region-no-india": lambda: _mutate(root, '"ap", "ap-south")', '"ap")'),
            "status-launches-app": lambda: _mutate_wrapper(
                root, 'if modpy="$(modal_python)" && "$modpy" "$PY" status; then', 'if false; then'),
            "sibling-dead-line-reused": lambda: _mutate_wrapper(
                root, '[ "$#" -eq 0 ] && tunnel_alive "$line"', '[ "$#" -eq 0 ]'),
            "pi-old-node": lambda: _mutate(root, 'setup_22.x', 'setup_16.x'),
            "snapshot-no-scrub": lambda: _mutate(
                root, '    scrub = sandbox.exec("rm", "-f", *_secret_scrub_paths(MANIFEST))',
                '    scrub = sandbox.exec("true")'),
            "snapshot-scrub-after-freeze": lambda: _mutate(
                root, '    scrub = sandbox.exec("rm", "-f", *_secret_scrub_paths(MANIFEST))\n'
                      '    if scrub.wait() != 0:\n'
                      '        sys.exit("could not scrub materialized secrets; refusing to snapshot")\n'
                      '    image = sandbox.snapshot_filesystem()',
                '    image = sandbox.snapshot_filesystem()\n'
                      '    scrub = sandbox.exec("rm", "-f", *_secret_scrub_paths(MANIFEST))\n'
                      '    if scrub.wait() != 0:\n'
                      '        sys.exit("could not scrub materialized secrets; refusing to snapshot")'),
            "status-drops-region": lambda: _mutate(
                root, '            tags.get("region", "?"),', '            "?",'),
            "cuda-nvcc-symlink": lambda: _mutate(
                root, '"LD_LIBRARY_PATH": "/usr/local/cuda/lib64",',
                '"LD_LIBRARY_PATH": "/usr/local/cuda/lib64",\n'
                '    },\n).add_local_file("x", "y").run_commands("ln -sf /usr/local/cuda/bin/* /usr/local/bin/"'
                ').env({'),
            "cuda-runbook": lambda: _mutate_file(root, RUNBOOK, "clangd --check", "clangd probe"),
            "wrapper-env-shebang": lambda: _mutate_wrapper(root, "*/env)", "*neverenv)"),
            "scrub-no-clone-auth": lambda: _mutate(
                root, 'paths.append("/root/dotfiles/pi/.pi/agent/auth.json")',
                'paths.append("/root/dotfiles/pi/.pi/agent/unused.json")'),
            "snapshot-no-scrub": lambda: _mutate(
                root, 'scrub = sandbox.exec("rm", "-f", *_secret_scrub_paths(MANIFEST))',
                'scrub = sandbox.exec("true")'),
            # Both scrubs are defense-in-depth (pre-seed of the image clone, and
            # the checkout after copying), so removing one alone cannot leak —
            # the mutation has to take both scrub lines to prove the guard.
            "entrypoint-auth-on-volume": lambda: (
                _mutate_file(root, ENTRYPOINT, 'rm -f "$HOME/dotfiles/pi/.pi/agent/auth.json"',
                             ': # pre-seed scrub removed'),
                _mutate_file(root, ENTRYPOINT, 'rm -f "$src/pi/.pi/agent/auth.json"',
                             ': # checkout scrub removed'),
                _mutate_file(root, ENTRYPOINT, '--ignore=auth.json', '')),
            "entrypoint-pi-fold": lambda: _mutate_file(
                root, ENTRYPOINT, 'mkdir -p "$HOME/.pi/agent"',
                ': # fold allowed'),
        }
        expected_fail = {"clean": 0, "apt-extra": {"M1"}, "gpu-b200": {"M4"},
                         "git-early": {"M2"}, "token-leak": {"M5"},
                         "wrapper-no-nohup": {"M16"}, "wrapper-new-ignores-flags": {"M16"},
                         "mason-missing": {"M10"}, "manifest-bad-mode": {"M11"},
                         "manifest-leak": {"M11"}, "manifest-extra-name": {"M11"},
                         "sync-no-trap": {"M12"}, "sync-cat-leak": {"M12"},
                         "entrypoint-no-0600": {"M13"}, "secrets-ephemeral-first": {"M13"},
                         "cuda-cudnn": {"M14"}, "cuda-nvcc-symlink": {"M14"},
                         "cuda-runbook": {"M15"},
                         "entrypoint-image-wins": {"M17"},
                         "region-no-india": {"M18"},
                         "status-drops-region": {"M19"},
                         "status-launches-app": {"M16"},
                         "sibling-dead-line-reused": {"M16"},
                         "snapshot-no-scrub": {"M22"},
                         "snapshot-scrub-after-freeze": {"M22"},
                         "pi-old-node": {"M20"},
                         "wrapper-env-shebang": {"M16"},
                         "scrub-no-clone-auth": {"M22"},
                         "snapshot-no-scrub": {"M22"},
                         "entrypoint-auth-on-volume": {"M17"},
                         "entrypoint-pi-fold": {"M17"}}
        for label, mutate in cases.items():
            _make_sandbox(root)
            try:
                mutate()
            except AssertionError as exc:
                # A stale mutation anchor must name the case, not abort silently
                # midway and leave the remaining cases unproven.
                print(f"FAIL selftest {label}: mutation could not be applied ({exc})")
                failures += 1
                continue
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
    for rel in (DEVBOX, ENTRYPOINT, MANIFEST, SYNC_SCRIPT, RUNBOOK, WRAPPER, PACKER_APT_SCRIPT,
                "nvim/.config/nvim/lua/plugins/mason.lua", "pi/.stow-local-ignore"):
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


def _mutate_file(root, rel, old, new, count=1):
    """count=1 replaces the first occurrence; count=0 replaces every occurrence."""
    path = root / rel
    text = path.read_text()
    assert old in text, f"mutation anchor not found in {rel}: {old!r}"
    path.write_text(text.replace(old, new) if count == 0 else text.replace(old, new, count))


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

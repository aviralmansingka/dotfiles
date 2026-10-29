"""devbox.py — SSH-able Modal Sandbox with the dotfiles devbox installed.

Mirrors the Packer provisioning pipeline (ops/packer/scripts/) on ubuntu:24.04,
with persistent state on a Volume v2 at /persist and SSH over an unencrypted
port-22 tunnel. Plan: docs/modal-devbox.md. Runbook: ops/modal-devbox/README.md.

Usage:
    modal run ops/modal-devbox/devbox.py                     # CPU devbox
    modal run ops/modal-devbox/devbox.py --gpu T4            # GPU devbox
    modal run ops/modal-devbox/devbox.py --timeout-hours 4   # longer lease

The launcher prints the ssh command once the tunnel is up. Ctrl+C (or the
lease expiring) tears the sandbox down; /persist survives both.
"""

import json
import os
import sys
import time
from pathlib import Path

import modal

app = modal.App("devbox")

# Secrets manifest: names, sources, variable names — never values. The sync
# script (scripts/modal-secrets-sync) is the only writer of the Modal
# Secrets it describes; devbox.py mounts every entry that exists in the
# workspace and splices the materialization calls into the entrypoint.
MANIFEST = json.loads((Path(__file__).resolve().parent / "secrets-manifest.json").read_text())

# Persistent state: repos, caches, nvim data, zsh history. Volume v2 has
# background commits (plus `sync /persist` from inside a session) and no
# file-count limit.
persist = modal.Volume.from_name("devbox-persist", create_if_missing=True, version=2)

# Pinned public dotfiles revision. Must exist on GitHub; bump deliberately —
# the parity suite checks the pin's shape, not its value.
DOTFILES_REPO = "https://github.com/aviralmansingka/dotfiles.git"
DOTFILES_REF = "aef53ff5221f8fcfc63d9136184a425113baa708"
REPO_ROOT = Path(__file__).resolve().parents[2]

# GPU choices the launcher accepts (B200/B300 stay excluded: the B300 needs
# CUDA 13.1+ in the container and both are priced for compute, not LSP work —
# see docs/modal-devbox.md for the price table).
GPU_ALLOWLIST = ("", "T4", "L4", "A10", "L40S", "A100-40GB", "A100-80GB", "H100", "H200")

# apt parity: ops/packer/scripts/install_system_packages.sh, plus exactly the
# Modal extras below (the parity suite enforces the extras set).
PACKER_APT = (
    "git", "curl", "wget", "zsh", "tmux", "stow",
    "gcc", "make", "build-essential",
    "golang-go", "python3", "python3-pip", "python3-venv", "nodejs", "npm",
    "fd-find", "ripgrep", "fzf", "tree", "luarocks", "unzip", "jq",
    "software-properties-common",
)
MODAL_APT_EXTRAS = ("openssh-server", "ca-certificates")

# Stow packages baked into the image (parity: install.sh stow set at the
# pinned ref, plus systemd — the Linux user units, stowed but never enabled).
# launchd/aerospace/ghostty files are inert on Linux. claude/ is absent from
# the pinned tree (removed from main) and stays out.
STOW_PACKAGES = (
    "zsh", "tmux", "nvim", "starship", "gh-dash", "tuicr",
    "agents", "pi", "herdr",
    "aerospace", "ghostty", "launchd", "systemd",
)
# git is stowed last (parity: cleanup.sh): its url.insteadOf rewrites HTTPS
# remotes to SSH, which would break the build-time HTTPS clones above.
STOW_PACKAGES_LATE = ("git",)

STOW_IGNORE = ("--ignore=node_modules", "--ignore=__pycache__")
MMDFLUX_VERSION = "v2.6.1"  # parity: install_cli_tools.sh pin

# Marker for devbox sandboxes: `devbox status`/`devbox stop` filter on it.
SANDBOX_TAGS = {"kind": "devbox"}

# Mason tools pre-installed at build: the central list from
# nvim/.config/nvim/lua/plugins/mason.lua plus clangd/codelldb (owned by the
# LazyVim lang extras, not the central list). The parity suite keeps this
# in sync with mason.lua; LSP tools install on demand only for types outside
# this list.
MASON_TOOLS = (
    "lua-language-server", "rust-analyzer", "stylua", "ruff", "basedpyright",
    "debugpy", "jdtls", "java-debug-adapter", "vscode-spring-boot-tools",
    "google-java-format", "groovy-language-server", "gradle-language-server",
    "starpls", "buildifier", "clang-format", "clangd", "codelldb",
    "gopls", "goimports", "gofumpt", "golangci-lint", "gomodifytags", "impl", "delve",
)

# Headless mason bootstrap, run as one line (Modal's image parser rejects
# multi-line commands). Waits for the registry refresh, installs every
# MASON_TOOLS entry that is missing (a +cmd MasonInstall races the refresh
# and resolves nothing), then drains: exit only after a >=60 s floor AND
# >=20 s with no install in flight (vim.wait pumps the event loop). A +qa
# that lands mid-install ships partial state; anything left uninstalled gets
# re-triggered on the first interactive open.
_MASON_WAIT_LUA = (
    'local mr = require("mason-registry") '
    'local t0 = vim.loop.now() local last = vim.loop.now() '
    'local tools = {' + ", ".join(f'"{t}"' for t in MASON_TOOLS) + '} '
    'mr:on("package:install:success", function() last = vim.loop.now() end) '
    'mr:on("package:install:failed", function() last = vim.loop.now() end) '
    'mr.refresh(function() '
    'for _, name in ipairs(tools) do '
    'local ok, p = pcall(mr.get_package, name) '
    'if ok and p and not p:is_installed() then '
    'pcall(function() p:install() end) last = vim.loop.now() end end end) '
    'vim.wait(900000, function() '
    'for _, p in ipairs(mr.get_all_packages()) do '
    'if p:is_installing() then last = vim.loop.now() end end '
    'return (vim.loop.now() - last) > 20000 and (vim.loop.now() - t0) > 60000 end, 1000)'
)

def _build_image(root_image: "modal.Image") -> "modal.Image":
    """Apply the five Packer-phase layers to a base image.

    Shared by the CPU and CUDA variants so both environments stay
    identical. Layer commands are unchanged strings, so each layer's
    cache key is stable across the refactor.
    """
    # --- Phase 1: apt system packages + zsh login shell (parity: install_system_packages.sh, cleanup.sh) ---
    base = (
        root_image
        .apt_install(*PACKER_APT, *MODAL_APT_EXTRAS)
        .env({"SHELL": "/bin/zsh"})
        # Packer's create_user.sh pre-created ~/.local/bin; the starship and
        # mmdflux installers need it to exist.
        .run_commands("mkdir -p /root/.local/bin", "chsh -s /bin/zsh root")
    )

    # --- Phase 2: CLI tools (parity: install_cli_tools.sh, plus gh + gh-dash) ---
    tools = base.run_commands(
        "curl -sS https://starship.rs/install.sh | sh -s -- -y -b $HOME/.local/bin",
        "curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh",
        'LAZYGIT_VERSION=$(curl -s https://api.github.com/repos/jesseduffield/lazygit/releases/latest | jq -r ".tag_name" | sed "s/^v//")'
        ' && curl -Lo /tmp/lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_Linux_x86_64.tar.gz"'
        " && tar xzf /tmp/lazygit.tar.gz -C /tmp lazygit"
        " && install /tmp/lazygit /usr/local/bin/lazygit",
        "curl -Lo /usr/local/bin/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64"
        " && chmod +x /usr/local/bin/yq",
        "KUBECTL_VERSION=$(curl -L -s https://dl.k8s.io/release/stable.txt)"
        " && curl -LO https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
        " && install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl",
        "git clone https://github.com/ahmetb/kubectx /opt/kubectx"
        " && ln -sf /opt/kubectx/kubectx /usr/local/bin/kubectx"
        " && ln -sf /opt/kubectx/kubens /usr/local/bin/kubens",
        'K9S_VERSION=$(curl -s https://api.github.com/repos/derailed/k9s/releases/latest | jq -r ".tag_name")'
        ' && curl -Lo /tmp/k9s.tar.gz "https://github.com/derailed/k9s/releases/download/${K9S_VERSION}/k9s_Linux_amd64.tar.gz"'
        " && tar xzf /tmp/k9s.tar.gz -C /tmp k9s"
        " && install /tmp/k9s /usr/local/bin/k9s",
        'curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip'
        " && unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/awscliv2.zip /tmp/aws",
        "curl -LsSf https://astral.sh/uv/install.sh | sh",
        "curl -sfL https://direnv.net/install.sh | bin_path=$HOME/.local/bin bash",
        "curl -fsSL https://claude.ai/install.sh | bash",
        "curl -fsSL https://opencode.ai/install | bash",
        f"curl -fsSL -o /tmp/mmdflux.tar.gz https://github.com/kevinswiber/mmdflux/releases/download/mmdflux-{MMDFLUX_VERSION}/mmdflux-{MMDFLUX_VERSION}-linux-x86_64.tar.gz"
        f" && tar xzf /tmp/mmdflux.tar.gz -C /tmp mmdflux"
        f" && install -m 0755 /tmp/mmdflux $HOME/.local/bin/mmdflux"
        " && rm -f /tmp/mmdflux.tar.gz /tmp/mmdflux",
        "npm install -g grok-mermaid",
        # gh via release tarball — the cli.github.com/apt repo 404s on Release
        # (verified 2026-10); same pinned-tarball pattern as lazygit/k9s above.
        'GH_VERSION=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | jq -r ".tag_name" | sed "s/^v//")'
        ' && curl -Lo /tmp/gh.tar.gz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz"'
        ' && tar xzf /tmp/gh.tar.gz -C /tmp'
        ' && install /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh'
        ' && rm -rf /tmp/gh.tar.gz /tmp/gh_${GH_VERSION}_linux_amd64',
        "gh extension install dlvhdr/gh-dash || echo 'WARN: gh-dash extension skipped'",
    )

    # --- Phase 3: Rust toolchain + bob + Neovim nightly (parity: install_rust.sh) ---
    rust = tools.run_commands(
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
        "$HOME/.cargo/bin/cargo install --locked eza bob-nvim",
        "$HOME/.cargo/bin/bob use nightly",
    )

    # --- Phase 4: dotfiles stow + terminfo + Lazy sync + Oh My Zsh (parity: deploy_dotfiles.sh + install_shell_plugins.sh) ---
    dotfiles = rust.run_commands(
        f"git clone {DOTFILES_REPO} /root/dotfiles && git -C /root/dotfiles checkout {DOTFILES_REF}",
        "rm -f /root/.zshenv /root/.zshrc /root/.bashrc /root/.bash_logout /root/.profile",
        "cd /root/dotfiles && stow --target=/root " + " ".join(STOW_IGNORE) + " " + " ".join(STOW_PACKAGES),
        "mkdir -p /root/.terminfo && tic -x -w /root/dotfiles/terminfo/xterm-ghostty.terminfo",
        # obsidian.nvim (stowed config) hardcodes ~/vault; it must exist at
        # build time for the headless run and at runtime (entrypoint links it
        # into /persist).
        "mkdir -p /root/vault",
        # Lazy sync via the real bob-installed binary (Packer pattern: the
        # ~/.local/bin shim is not guaranteed), then link it as the shim so
        # interactive PATH (~/.local/bin) always has nvim.
        "NVIM_BIN=$(find /root/.local/share/bob -type f -name nvim -path '*/bin/nvim' ! -path '*/nvim-bin/*' | head -1);"
        ' if [ -z "$NVIM_BIN" ]; then echo "no nvim under /root/.local/share/bob:"; ls -laR /root/.local/share/bob /root/.local/bin; exit 1; fi;'
        ' ln -sfn "$NVIM_BIN" /root/.local/bin/nvim;'
        # Two headless passes: pass 1 syncs plugins (user specs like mason.lua
        # and c.lua only register their ensure_installed lists on a startup that
        # sees them installed); pass 2 is a full startup whose mason config
        # installs everything, then waits until quiescent. The wait must be
        # race-proof: installs are triggered from mason's ASYNC registry-refresh
        # callback, which can fire after the luafile starts — so exit only after
        # a >=60 s floor AND >=20 s with no install in flight (vim.wait pumps
        # the event loop). A +qa that lands mid-install ships partial state, and
        # any package left uninstalled gets double-triggered on the first
        # interactive open (the "already installing" error). (Modal's image
        # parser rejects multi-line commands, hence the one-line luafile.)
        # Two headless passes: pass 1 syncs plugins (user specs like mason.lua
        # and c.lua only register their ensure_installed lists on a startup that
        # sees them installed); pass 2 runs the mason bootstrap luafile above.
        " echo '" + _MASON_WAIT_LUA + "' > /tmp/mason-wait.lua;"
        ' "$NVIM_BIN" --headless "+Lazy! sync" +qa;'
        ' "$NVIM_BIN" --headless "+luafile /tmp/mason-wait.lua" +qa',
        'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended',
        # OMZ wrote a template .zshrc: drop it and restore the stowed one.
        "rm -f /root/.zshrc && cd /root/dotfiles && stow --target=/root " + " ".join(STOW_IGNORE) + " zsh",
        "git clone https://github.com/zsh-users/zsh-autosuggestions /root/.oh-my-zsh/custom/plugins/zsh-autosuggestions",
        "git clone https://github.com/zsh-users/zsh-syntax-highlighting.git /root/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting",
        # Never ship build-session nvim state (shada etc.): it makes the first
        # interactive open throw a spurious mason "already installing" error
        # (verified empirically; a pristine state dir opens clean).
        "rm -rf /root/.local/state/nvim",
    )

    # --- Phase 5: git config last (parity: cleanup.sh — stow it after all HTTPS clones) ---
    image = dotfiles.run_commands(
        "cd /root/dotfiles && stow --target=/root " + " ".join(STOW_IGNORE) + " " + " ".join(STOW_PACKAGES_LATE),
    )
    # Ship the clangd compile-database generator (works on both variants; it
    # errors clearly when no CUDA toolkit is present).
    # --- Phase 5b: ship the CUDA compile-db helper (not a Packer phase)
    image = image.add_local_file(
        str(REPO_ROOT / "scripts/cuda-compile-db"),
        "/root/.local/bin/cuda-compile-db",
        copy=True,
    ).run_commands("chmod 0755 /root/.local/bin/cuda-compile-db")
    return image


# --- image variants ----------------------------------------------------------------
# CPU: parity with the devbox AMI and the homelab.
# CUDA: the NVIDIA devel base carries nvcc, the CUDA headers and libdevice, which
# full clangd CUDA LSP needs (docs/neovim-cuda-lsp.md). The host driver is
# 580.95.05+ / Driver API 13.0, and 12.x/13.x toolkits are host-compatible
# (research report §6), so 13.0 pins to the driver without over-shooting.
# Deliberately the plain -devel variant, not -cudnn-devel: cuDNN is not needed
# for compiling or LSP, and the cuDNN layer adds several GB that make a cold
# sandbox hydrate too slowly to reach a tunnel.
CUDA_BASE_IMAGE = "nvidia/cuda:13.0.0-devel-ubuntu24.04"

cpu_image = _build_image(modal.Image.from_registry("ubuntu:24.04", add_python="3.12"))
cuda_image = _build_image(modal.Image.from_registry(CUDA_BASE_IMAGE, add_python="3.12")).run_commands(
    # --- Phase 6: CUDA login environment (/etc/environment, then ENV)
    # sshd gives each login a PAM-built environment, NOT the container's ENV —
    # so the toolkit has to be exported where SSH sessions look: /etc/environment.
    # Do NOT symlink nvcc into /usr/local/bin: nvcc resolves its headers
    # relative to argv[0], so a symlink makes it lose <cuda_runtime.h>
    # (verified: clangd still passed, nvcc compilation failed).
    "printf 'CUDA_HOME=/usr/local/cuda\\n"
    "PATH=\"/usr/local/cuda/bin:/usr/local/cuda/nvvm/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\"\\n"
    "LD_LIBRARY_PATH=/usr/local/cuda/lib64\\n' > /etc/environment",
).env(
    {
        "CUDA_HOME": "/usr/local/cuda",
        "PATH": "/usr/local/cuda/bin:/usr/local/cuda/nvvm/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "LD_LIBRARY_PATH": "/usr/local/cuda/lib64",
    }
)



# --- launcher ----------------------------------------------------------------------

def _materialization_calls() -> str:
    """Bash calls spliced into the entrypoint over its marker line.

    Generated from the manifest (single source of truth): dotenv/command
    entries become env files at their target, file entries decode their
    base64 payload to the target path.
    """
    lines = []
    for entry in MANIFEST["secrets"]:
        target = entry.get("target", "")
        if not target:
            raise ValueError(f"manifest entry {entry.get('name')!r} has no target")
        if entry["mode"] == "file":
            lines.append(f'materialize_file "$HOME/{target}" {entry["variable"]}')
        else:  # dotenv | command: plain env-file targets
            lines.append(f'materialize_env "$HOME/{target}" ' + " ".join(entry["variables"]))
    return "\n".join(lines)


# entrypoint.sh ships per-launch (read into the Sandbox CMD), so manifest or
# entrypoint changes need no image rebuild — the splice happens every run.
ENTRYPOINT = (
    (Path(__file__).resolve().parent / "entrypoint.sh")
    .read_text()
    .replace("#@devbox-materialize@#", _materialization_calls())
)

DEFAULT_CPU = 4.0
DEFAULT_MEMORY_MB = 8192


def _default_pubkey() -> str:
    """First usable public key on this machine: id_ed25519, id_rsa, then any *.pub."""
    ssh_dir = Path.home() / ".ssh"
    for named in ("id_ed25519.pub", "id_rsa.pub"):
        candidate = ssh_dir / named
        if candidate.exists():
            return candidate.read_text().strip()
    pubs = sorted(ssh_dir.glob("*.pub"))
    return pubs[0].read_text().strip() if pubs else ""


def _running_devboxes():
    """All live devbox sandboxes (tagged, not yet finished)."""
    return [sb for sb in modal.Sandbox.list(tags=SANDBOX_TAGS) if sb.poll() is None]


def _attached_secret_names():
    """Manifest secret names that exist in the workspace (probed, never assumed).

    A fresh workspace without synced secrets still boots — probing misses
    just mean the sandbox starts with the per-launch key secret only.
    """
    try:
        present = {s.name for s in modal.Secret.objects.list()}
    except Exception as exc:  # noqa: BLE001 — never block a boot on the probe
        print(f"  warn           : could not probe workspace secrets ({exc}); starting without manifest secrets")
        return []
    return [e["name"] for e in MANIFEST["secrets"] if e["name"] in present]


def _tunnel(sb):
    """(host, port) of the sandbox's port-22 tunnel, or None.

    tunnels() blocks up to ~50 s and then raises SandboxTimeoutError; that is
    a normal "not ready yet" answer for a large image hydrating on a fresh
    worker, not a fatal error — callers poll and treat it as None.
    """
    try:
        tunnels = sb.tunnels()
    except Exception:  # noqa: BLE001 — SandboxTimeoutError and friends mean "not yet"
        return None
    tunnel = tunnels.get(22) if isinstance(tunnels, dict) else None
    return getattr(tunnel, "tcp_socket", None) if tunnel is not None else None


def _pick_primary(sandboxes):
    """The newest running sandbox. Object ids are monotonic ULIDs, so the
    maximum is the most recently created — deterministic even if duplicates
    exist (a race the wrapper's start lock is designed to prevent)."""
    return max(sandboxes, key=lambda sb: sb.object_id)


def _wait_for_tunnel(sandbox, attempts: int = 120, pause: float = 1.0):
    """Poll tunnels() until the port-22 TCP socket is up; return (host, port)
    or None when the sandbox exits first, or the bound is exhausted.

    Each poll may itself block ~50 s inside tunnels(), so the bound is on
    attempts, not wall time; a CUDA image can need several minutes on a cold
    worker before its tunnel exists.
    """
    for _ in range(attempts):
        socket_ = _tunnel(sandbox)
        if socket_:
            return socket_
        if sandbox.poll() is not None:
            return None
        time.sleep(pause)
    return None


@app.local_entrypoint()
def main(
    gpu: str = "",
    timeout_hours: float = 24.0,  # hard lifetime backstop; idle_timeout is the real control
    idle_timeout: int = 120,  # seconds after the last SSH disconnect before teardown
    ssh_key: str = "",
    cpu: float = DEFAULT_CPU,
    memory: int = DEFAULT_MEMORY_MB,
    new: bool = False,
):
    """Start (or adopt) the devbox Sandbox and print its ssh command.

    Unless --new is passed, a running devbox sandbox is adopted instead of
    creating a second one — resource flags apply only at creation. With
    idle_timeout (default 120 s) the sandbox tears itself down after the last
    SSH connection closes, so no meter runs while you are away; timeout_hours
    (default 24) is only the hard lifetime backstop. Ctrl+C stops the launcher
    AND terminates a sandbox it created (adopted sandboxes are left alone —
    their own launcher owns them). A detached ephemeral app gets reaped once
    it completes, so the launcher must stay alive holding the sandbox.
    """
    if gpu not in GPU_ALLOWLIST:
        sys.exit(f"unknown gpu {gpu!r}; allowed: {', '.join(GPU_ALLOWLIST)}")
    if not 0 < timeout_hours <= 24:
        sys.exit("timeout_hours must be within (0, 24]: Sandboxes cap at 24 h")
    if idle_timeout < 0:
        sys.exit("idle_timeout must be >= 0 seconds (0 disables idle teardown)")

    pubkey = ssh_key or os.environ.get("DEVBOX_SSH_PUBLIC_KEY", "") or _default_pubkey()
    if not pubkey:
        sys.exit(
            "no ssh public key found: pass --ssh-key, set DEVBOX_SSH_PUBLIC_KEY, "
            "or create ~/.ssh/id_ed25519.pub"
        )

    if not new:
        running = _running_devboxes()
        if running:
            # Adopt whatever is running even if its tunnel is not up yet: a
            # cold CUDA image hydrates for minutes before the tunnel exists,
            # and a second `devbox ssh` in that window used to create a
            # duplicate sandbox (double GPU billing). Wait for the existing
            # one; fall through to a fresh create only if it exits.
            candidate = _pick_primary(running)
            socket_ = _wait_for_tunnel(candidate)
            if socket_:
                host, port = socket_
                print()
                print(f"CONNECT {host} {port}")  # machine line for the devbox wrapper
                print(f"  adopted        : {candidate.object_id} (already running)")
                print(f"  connect        : ssh -o StrictHostKeyChecking=accept-new -p {port} root@{host}")
                print(f"  teardown       : modal container stop {candidate.object_id} -y")
                print()
                return

    attached = _attached_secret_names()
    # Secret ordering: later entries win key clashes, so the per-launch
    # ephemeral from_dict secret goes LAST: it always wins and the synced
    # secrets can never override the SSH key for this launch (research §8.4).
    sandbox = modal.Sandbox.create(
        "bash", "-c", ENTRYPOINT,
        app=app,
        image=cpu_image if not gpu else cuda_image,
        volumes={"/persist": persist},
        secrets=[modal.Secret.from_name(n) for n in attached]
        + [modal.Secret.from_dict({"DEVBOX_SSH_PUBLIC_KEY": pubkey})],
        gpu=gpu or None,
        cpu=cpu,
        memory=memory,
        timeout=int(timeout_hours * 3600),
        idle_timeout=idle_timeout or None,
        unencrypted_ports=[22],
        tags=SANDBOX_TAGS,
    )

    try:
        socket_ = _wait_for_tunnel(sandbox)
        if not socket_:
            sys.exit("port-22 tunnel never came up; check `modal container logs <id>`")
        host, port = socket_
        print()
        print(f"CONNECT {host} {port}")  # machine line for the devbox wrapper
        print(f"  image          : {'cuda ' + CUDA_BASE_IMAGE if gpu else 'ubuntu:24.04'}")
        print(f"  devbox sandbox : {sandbox.object_id}")
        print(f"  connect        : ssh -o StrictHostKeyChecking=accept-new -p {port} root@{host}")
        print(f"  secrets        : {', '.join(attached) or 'none'} + per-launch ssh key")
        print(f"  teardown       : modal container stop {sandbox.object_id} -y (or Ctrl+C in a foreground terminal)")
        print(f"  lease          : {timeout_hours:g} h hard cap; /persist survives teardown")
        print(f"  idle           : dies {idle_timeout or 'never'}{' s' if idle_timeout else ''} after the last SSH disconnect")
        print()
        sandbox.wait(raise_on_termination=False)
        print("devbox sandbox finished (lease expired or sshd exited)")
    except KeyboardInterrupt:
        print("\nterminating devbox sandbox ...")
        sandbox.terminate()
        print("terminated; /persist state kept")


@app.local_entrypoint()
def status():
    """List running devbox sandboxes with their ssh connection lines."""
    running = _running_devboxes()
    if not running:
        print("no devbox sandbox running")
        return
    for sb in running:
        socket_ = _tunnel(sb)
        if socket_:
            host, port = socket_
            print(f"CONNECT {host} {port}")
            print(f"  devbox sandbox : {sb.object_id}  ssh -o StrictHostKeyChecking=accept-new -p {port} root@{host}")
        else:
            print(f"  devbox sandbox : {sb.object_id}  (no tunnel on port 22)")


@app.local_entrypoint()
def stop():
    """Terminate every running devbox sandbox (final volume commit runs)."""
    running = _running_devboxes()
    if not running:
        print("no devbox sandbox running")
        return
    for sb in running:
        sb.terminate()
        print(f"terminated {sb.object_id}; /persist state kept")


@app.local_entrypoint()
def snapshot(name: str = "devbox-snap"):
    """Freeze the running devbox container filesystem into a named Image.

    Modal has no docker-commit for Sandbox containers, but a Filesystem
    Snapshot is the sanctioned equivalent: it captures the container's root
    filesystem as a reusable Image. Mounted Volumes are NOT included —
    /persist state already lives on the volume and needs no capture.

    Use this after installing something interactively that you want to keep
    without an image rebuild, then boot it with
    `modal.Image.from_name("<name>")`.
    """
    running = _running_devboxes()
    if not running:
        sys.exit("no devbox sandbox running: start one with `devbox ssh` first")
    sandbox = _pick_primary(running)
    print(f"snapshotting {sandbox.object_id} ...")
    image = sandbox.snapshot_filesystem()
    image.publish(name)
    print(f"published {name} (from {sandbox.object_id}); boot it with Image.from_name({name!r})")
    print("note: mounted volumes are not captured — /persist keeps its own state")

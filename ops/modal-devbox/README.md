# Modal devbox — runbook

An SSH-able Ubuntu 24.04 devbox on [Modal](https://modal.com), built from the
same provisioning pipeline as the AWS devbox (`ops/packer/scripts/`) but
running as an on-demand **Sandbox**: ephemeral container, persistent state on
a Volume v2, SSH over an unencrypted port-22 tunnel, GPU hosts one flag away.

Plan and research: `docs/modal-devbox.md` · Modal research report:
`ops/modal-devbox/research-modal-images.md`.

## Prerequisites

- The `modal` CLI installed (`uv tool install modal`) and authenticated
  (`modal setup`).
- An SSH key pair on this machine (`~/.ssh/id_ed25519.pub` or any `*.pub`);
  the launcher injects the public key per-launch as an ephemeral Secret.

## Start

One command (after `./install.sh` stows the `devbox` package, or from any
dotfiles checkout with `devbox/.local/bin` on `PATH`):

```sh
devbox ssh                  # connect; adopts a running sandbox or starts one
devbox ssh --gpu T4         # start with a GPU, then connect
devbox ssh -- 'htop'        # run a remote command instead of a shell
devbox status               # list running devbox sandboxes
devbox stop                 # terminate them (state on /persist is kept)
```

A running sandbox is adopted instead of doubled — resource flags apply only
at creation (`--new`, or `devbox stop` first, to change them).

The equivalent manual flow, from a dotfiles checkout (the wrapper does the
same with a backgrounded launcher holding the sandbox open):

```sh
modal run ops/modal-devbox/devbox.py                     # CPU devbox
modal run ops/modal-devbox/devbox.py --gpu T4            # GPU devbox
modal run ops/modal-devbox/devbox.py --timeout-hours 2   # shorter lease
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--gpu` | `""` (CPU) | `T4 L4 A10 L40S A100-40GB A100-80GB H100 H200` |
| `--timeout-hours` | 24 | Hard lifetime cap (backstop only — idle_timeout is the real control) |
| `--idle-timeout` | 120 | Seconds after the last SSH disconnect before teardown (0 = never) |
| `--new` | off | Force a fresh sandbox instead of adopting a running one |
| `--ssh-key` | first `*.pub` found | Public key to authorize |
| `--cpu` / `--memory` | 4 / 8192 | Container resources (MiB for memory) |

First run builds the image (~15–30 min: apt, CLI tools, Rust + bob + Neovim
nightly, dotfiles stow + Lazy sync, Oh My Zsh). Later runs start in seconds
from cached layers.

## Connect

The launcher prints the connection line once the tunnel is up:

```sh
ssh -o StrictHostKeyChecking=accept-new -p <port> root@<host>
```

- Host keys are fresh per sandbox — use `accept-new`, or pin them in
  `~/.ssh/config` per host and expect changes after teardown.
- Re-attaching with `devbox ssh` uses the cached tunnel line
  (`~/.local/state/modal-devbox/connect`) and connects in ~2–3 s; a stale
  cache self-heals via the status probe (`devbox stop` clears it).
- First nvim open downloads Mason LSP servers into the volume (one-time).
- `tmux new -s main` — the tmux server survives SSH disconnects for the
  whole lease; reconnect and `tmux attach`.
- Second door into the same container: `modal container list`, then
  `modal container exec <id> htop`.

## Teardown

- Always works: `modal container stop <id> -y` (the `-y` skips the prompt;
  find the id in the launcher line or `modal container list`).
- `Ctrl+C` works when the launcher runs in a foreground terminal; a
  backgrounded/nohup launcher may hang on SIGINT — use the container stop
  above instead.
- With `idle_timeout` (default 120 s) the sandbox tears itself down about
  2 min after the last SSH connection closes — the ssh master's
  `ControlPersist` window matches, so nothing lingers on the Mac either.
  **Caveat (observed 2026-10): on GPU nodes the idle timer does not reap
  the sandbox** — a relay-side connection can stay established on port 22
  and keep the box marked active. Run `devbox stop` when done with a GPU
  box; the hard `timeout_hours` cap is the backstop.
- The hard `timeout_hours` cap (default 24 h) only bounds a continuously
  connected session.
- `/persist` state survives every teardown path; the container filesystem
  does not.

## What persists (`/persist`, Volume v2)

| Path (in container) | Volume path | Contents |
| --- | --- | --- |
| `~/.local/share/nvim` | `nvim-share` | lazy.nvim plugins, Mason tools |
| `~/.local/state/nvim` | `nvim-state` | shada, undo |
| `~/.local/share/bob` | `nvim-bob` | Neovim installs + bob's `used` marker — `bob use <version>` survives sandbox death (the entrypoint repoints the `nvim` shim to bob's proxy) |
| `~/.cache` | `cache` | cargo, uv, pip caches |
| `~/repos` | `repos` | work checkouts |
| `~/vault` | `vault` | obsidian.nvim vault (empty at first boot; populate it to use Obsidian tooling) |
| `~/.zsh_history` | `zsh_history` | shell history |

Everything else is baked into the image and reset per sandbox. Volume v2
commits run in the background every few seconds plus on shutdown; run
`sync /persist` inside a session to flush on demand.

Mason tooling: the central list from `nvim/.config/nvim/lua/plugins/mason.lua`
(plus clangd/codelldb) is pre-installed at build time — first opens are clean,
no install prompts. Treesitter grammars compile on first use per filetype
(same confirmation prompt as the Mac). Anything outside the list installs on
demand and persists on the volume.

## Rebuilds

The image is code: change a layer in `devbox.py`, then the next
`modal run` rebuilds only that layer and everything after it (stable layers
first, dotfiles last — so config churn is cheap).

- Force a full rebuild: `MODAL_FORCE_BUILD=1 modal run ...`
- Debug rebuild without poisoning the cache: `MODAL_IGNORE_CACHE=1`
- After an image rebuild, nvim plugins on the volume may lag the new config:
  run `:Lazy! sync` once inside nvim.

## GPU

`--gpu T4` and friends; `nvidia-smi` works with zero setup (host driver),
toolkits come from the image. The CUDA-devel base image for full
`nvcc` + clangd CUDA LSP is the planned phase 4 work.

| GPU | ≈ $/hr | Notes |
| --- | --- | --- |
| T4 | $0.59 | cheapest interactive |
| L4 | $0.80 | good LSP-dev default |
| A10 / L40S | $1.10 / $1.95 | |
| A100-40 / -80 | $2.10 / $2.50 | |
| H100 / H200 | $3.95 / $4.54 | real compute only |

CPU default (4 cores / 8 GiB) ≈ $0.25/hr. Volume storage: $0.09/GiB-month,
first 1 TiB free. Preemption: GPU functions/Sandboxes are preemptible by
default and **cannot** be made nonpreemptible — a preempted sandbox loses
only the running tmux session; `/persist` keeps everything else.

## Capture (preview)

Freeze a running sandbox's filesystem into a reusable image (phase 4.5):

```python
snap = sandbox.snapshot_filesystem()   # inside the launcher / a helper script
snap.publish("devbox-snap")
```

There is no docker-commit for `@app.function` containers; Sandbox snapshots
are the only freeze path (see the research report, §2).

## Troubleshooting

- **No tunnel line after a while** — `modal container list`, then
  `modal container logs <id>`; the entrypoint logs sshd there.
- **A build layer times out** — split the offending `run_commands` layer, or
  port it to `Image.run_function(..., timeout=...)` (1 h default, raised).
- **`test-modal-devbox` apt parity fails** — the Packer apt list changed;
  update `PACKER_APT` in `devbox.py` to match, extras stay allowlisted.
- **`gh extension install` warning in build logs** — harmless; install it
  after `gh auth login` in-session.

## Parity and tests

`scripts/test-modal-devbox.py` (offline, no Modal account): apt parity against
`ops/packer/scripts/install_system_packages.sh` (superset + exact extras
`openssh-server`, `ca-certificates`), stow set vs repo packages, GPU
allowlist, secret hygiene, entrypoint structure, dotfiles pin shape, runbook
accuracy. `docs/ci-tests/modal-devbox.md` documents the suite.

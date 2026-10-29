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

## Secrets

The devbox gets the same credentials as the Mac via Modal Secrets — one per
source env file, plus gh and a couple of files. `scripts/modal-secrets-sync`
is the only writer:

```sh
scripts/modal-secrets-sync --dry-run   # print the plan (names only, no values)
scripts/modal-secrets-sync             # upload/overwrite every entry
scripts/modal-secrets-sync --aws       # ... including the opt-in devbox-aws
scripts/modal-secrets-sync --only devbox-gh   # a single entry
```

- The committed manifest (`ops/modal-devbox/secrets-manifest.json`) carries
  secret **names**, source paths, and variable **names** — never values.
  `scripts/test-modal-devbox.py` lints it (M11).
- MODE `dotenv` normalizes `export KEY=...` lines; MODE `file` ships the file
  base64-encoded in one variable; MODE `command` stores a command's stdout
  (e.g. `gh auth token` → `GH_TOKEN`).
- Missing sources are skipped with a warning (e.g. `devbox-ssh` on a machine
  without `~/.ssh/id_ed25519.pub` — the per-launch ephemeral key secret
  covers SSH anyway); a missing/unauthenticated `modal` CLI fails loudly.
- At boot, `entrypoint.sh` materializes the values back onto disk for
  config parity: `~/.env` and `~/.config/pi-*.env` (0600 — exactly what
  `mcp.json` shell refs like `!. ~/.env; echo "Bearer $OREILLY_TOKEN"`
  expect), `~/.pi/agent/auth.json` and `~/.aws/credentials` decoded at their
  manifest targets, and `GH_TOKEN`/`GITHUB_TOKEN` exported into every shell
  via a guarded include on the stowed `~/.zshenv`. All materialized files
  are container-local: secret values never touch `/persist`.
- The launcher mounts only manifest secrets that actually exist in the
  workspace (probed at launch), so a fresh workspace still boots; the
  per-launch ephemeral SSH-key secret is applied **last** and wins any
  clash with `devbox-ssh`.

**Rotation**: secret values are frozen into a container at its start — a
warm devbox keeps serving old values after a re-sync. Rotate = re-run
`scripts/modal-secrets-sync`, then `devbox stop` and start again.

**Security model**: Modal secret values are write-only (no read-back via
CLI, API, or dashboard), but any container running in the workspace can
read every secret from its environment. This is a **personal workspace
only** — never sync into a shared one.

## Rebuilds

The image is code: change a layer in `devbox.py`, then the next
`modal run` rebuilds only that layer and everything after it (stable layers
first, dotfiles last — so config churn is cheap).

- Force a full rebuild: `MODAL_FORCE_BUILD=1 modal run ...`
- Debug rebuild without poisoning the cache: `MODAL_IGNORE_CACHE=1`
- After an image rebuild, nvim plugins on the volume may lag the new config:
  run `:Lazy! sync` once inside nvim.

## GPU and CUDA

`--gpu T4` and friends select the GPU variant. There are two images, both
built from the same phase layers so the environment is identical:

| `--gpu` | Image | CUDA toolkit |
| --- | --- | --- |
| empty | `ubuntu:24.04` | none (driver API only, via the host) |
| any GPU | `nvidia/cuda:13.0.0-devel-ubuntu24.04` | `nvcc`, headers, libdevice |

`nvidia-smi` works on both with zero setup (host driver). On the GPU variant
`nvcc`, `cuda-compile-db`, `CUDA_HOME` and `LD_LIBRARY_PATH` are already set
for every shell, including non-interactive `ssh host 'cmd'`.

```sh
devbox ssh --gpu T4 --new        # GPU variant, then connect
devbox ssh --gpu T4 -- 'nvcc --version; nvidia-smi'
```

### Full CUDA LSP (compile database)

clangd needs `--cuda-path` and a compile database; `scripts/cuda-compile-db`
is baked into the image and writes `compile_commands.json` for every
`.cu`/`.cuh` under a directory:

```sh
cd ~/repos/cuda-project
cuda-compile-db . --arch sm_75            # or --arch sm_90 for H100
git checkout -- . 2>/dev/null || true     # compile_commands.json is generated
clangd --check=matmul.cu                  # expect "All checks completed, 0 errors"
```

Open the `.cu` file in nvim and CUDA-API hover/go-to-def/completion work —
this is the bar `docs/neovim-cuda-lsp.md` sets and the Mac cannot meet. The
regenerate step is needed when you add files or change arch.

| GPU | ≈ $/hr | Notes |
| --- | --- | --- |
| T4 | $0.59 | cheapest interactive; sm_75 |
| L4 | $0.80 | good LSP-dev default |
| A10 / L40S | $1.10 / $1.95 | |
| A100-40 / -80 | $2.10 / $2.50 | |
| H100 / H200 | $3.95 / $4.54 | real compute only; sm_90 |

CPU default (4 cores / 8 GiB) ≈ $0.25/hr. Volume storage: $0.09/GiB-month,
first 1 TiB free. Preemption: GPU functions/Sandboxes are preemptible by
default and **cannot** be made nonpreemptible — a preempted sandbox loses
only the running tmux session; `/persist` keeps everything else.

**Run `devbox stop` when you finish with a GPU box.** Idle teardown does
reap GPU sandboxes (measured 128 s after disconnect), but GPU capacity is
scarce and a stuck box is expensive; stopping explicitly is the habit.
The first GPU start after an image change can take several minutes while
the large image hydrates on a fresh worker.

## Capture (install once, keep forever)

Modal has no docker-commit for containers, but a **Filesystem Snapshot** is the
sanctioned equivalent: it freezes the running sandbox's root filesystem into a
reusable Image. Use it after installing something interactively that you want
to keep without an image rebuild.

```sh
devbox ssh -- 'apt-get install -y htop'   # install interactively
devbox snapshot devbox-snap               # freeze + publish a named image
devbox stop
```

Boot it again with `modal.Image.from_name("devbox-snap")` in a small app, or
reuse it in `devbox.py` by swapping the base image. Verified end to end: a file
written at `/opt/probe/tool.txt` inside a sandbox appeared in a brand-new
sandbox created from the published snapshot.

Limits that matter:

- **Mounted Volumes are not captured.** `/persist` already keeps its own state,
  so nothing there needs freezing — that is why the two mechanisms complement
  each other.
- Snapshots default to a 30-day TTL. Publish a name to keep it around, and
  delete stale ones (there is no list-snapshots API — track names yourself).
- The freeze is a filesystem copy, not a process copy: running programs and
tmux sessions do not survive into the restored sandbox.

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
accuracy, manifest lint, sync-script structure, and materialization wiring
(M1–M13). `docs/ci-tests/modal-devbox.md` documents the suite.

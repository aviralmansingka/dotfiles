# Modal devbox research — images, capture, volumes, SSH, GPU, runtime, secrets

Research date: 2026-10. All claims verified against current primary sources: `modal.com/docs` guide pages, `modal.com/docs/sdk/py/latest/*` SDK reference, `modal.com/docs/cli/latest/*` CLI reference, the Python SDK release notes (`modal.com/docs/sdk/py/releases`), and the `modal-labs/modal-client` GitHub repo (`main`). Anything not directly supported by a primary source is flagged **(inferred)**.

Headline findings up front:

- **Modal has NO `docker commit` for `@app.function` containers, but DOES have an equivalent for Sandboxes**: `Sandbox.snapshot_filesystem()` captures a running container's root filesystem into a reusable Modal `Image`. See §2.
- **`modal proxy ssh` / `modal proxy list` / `modal proxy close` no longer exist.** The current CLI reference lists no `modal proxy` command group, and `py/modal/cli/` in `modal-client@main` has no `ssh_proxy.py`. The sanctioned SSH story today is: run `sshd` in your image + `modal.forward(port=22, unencrypted=True)` inside the running function (or a Sandbox `unencrypted_ports=[22]` tunnel). See §5.
- **`interactive_snooze=` and the `modal interactive` CLI group are gone.** Keep-warm is now `scaledown_window` / `min_containers` / `buffer_containers` (+ `Function.update_autoscaler`). See §5.
- **`spot=` is gone from `@app.function`.** All functions are preemptible by default; opt out with `nonpreemptible=True` (3x CPU/memory price multiplier; not supported for GPU functions). See §6.
- Modal images are **linux/amd64 only** — good news for our linux-x86_64 `mmdflux` binary. See §6.

---

## 1. Image building

### 1.1 Constructors (current)

| API | Status | Notes |
|---|---|---|
| `modal.Image.debian_slim(python_version=None, force_build=False)` | current | Debian base, matches local Python minor version by default. [SDK Image](https://modal.com/docs/sdk/py/latest/Image) |
| `modal.Image.from_registry(tag, secret=None, add_python=...)` | current | Any public registry (Docker Hub, `nvcr.io`, ECR, `ghcr.io`); private via a `modal.Secret` (`REGISTRY_USERNAME`/`REGISTRY_PASSWORD`); `add_python="3.12"` installs a standalone Python if the image lacks one. [Existing images guide](https://modal.com/docs/guide/existing-images) |
| `modal.Image.from_dockerfile(path, add_python=..., ignore=...)` | **current — yes, Dockerfile support exists** | Modal implements its own subset of the Dockerfile spec. Unimplemented commands: `EXPOSE`, `HEALTHCHECK`, `LABEL`, `ONBUILD`, `STOPSIGNAL`, `VOLUME`. `USER` is ignored (containers always run as root, uid 0). `ADD` limited to single-URL fetches (no tar/multi-URL). `${VAR:-default}` interpolation defaults unsupported. `ENTRYPOINT` supported but the script must `exec` its args so the Modal runtime can start. [Existing images guide](https://modal.com/docs/guide/existing-images) |
| `modal.Image.micromamba(python_version=None)` | current | Conda-style base. [Images guide](https://modal.com/docs/guide/images) |
| `modal.Image.dockerfile_commands(*cmds, context_files={}, ...)` | current | Dockerfile directives as strings. [SDK Image](https://modal.com/docs/sdk/py/latest/Image) |

Layer methods, all current ([SDK Image reference](https://modal.com/docs/sdk/py/latest/Image), [Images guide](https://modal.com/docs/guide/images)):

- `.apt_install(*pkgs)` — Debian/Ubuntu apt packages.
- `.uv_pip_install(*pkgs)` — **recommended** pip layer (uses `uv`); `.pip_install(*pkgs, ...)` is the documented fallback. There are also `.uv_sync()`, `.poetry_install_from_file(...)`, `.pip_install_private_repos(...)` (GitHub/GitLab tokens via a Secret), and `.micromamba_install(...)`.
- `.run_commands(*commands, env=None, secrets=None, volumes=None, gpu=None, force_build=False)` — RUN-style layers; note it now accepts **`secrets=`** (injected as env during the build) and **`volumes=`** (attached during the build step), plus `gpu=` for GPU-needing build steps.
- `.run_function(raw_f, *, secrets=..., volumes=..., gpu=..., cpu=..., memory=..., timeout=60*60, cloud=..., region=..., force_build=False, args=(), kwargs={}, include_source=True)` — runs a Python builder function; "essentially equivalent to running a Modal Function and snapshotting the resulting filesystem as a new Image"; default build-step timeout **1 hour**.
- `.add_local_dir(local_path, remote_path, *, copy=False, ignore=[])` and `.add_local_file(...)` — see §4.
- `.add_local_python_source(*modules, copy=False, ignore=NON_PYTHON_FILES)`.
- `.env(dict)` — build/runtime env vars (strings only).
- `.workdir(path)` — WORKDIR equivalent.
- `.entrypoint(entrypoint_commands)` — ENTRYPOINT equivalent (must `exec` args).
- `.pipe(fn, *args)` — route an image through a builder function that returns a new image; handy for phase-structured builds.
- `.build(app)` / `.publish(name)` — imperative build & named-image publish (see §1.3).

Deprecated/removed (do not use): `Image.copy_local_dir`/`copy_local_file` (→ `add_local_dir`/`add_local_file`, v0.66.40+), `modal.Mount` and all `mount=`/`context_mount=` params (removed at v1.0.0), `@modal.build` (→ `Image.run_function` or a Volume), `modal.gpu.*` objects (→ strings), `.lookup()` (→ `.from_name()` + `.hydrate()`). [1.0 migration guide](https://modal.com/docs/guide/modal-1-0-migration)

### 1.2 Layer caching and ordering

- Images are **cached per layer (per Image method call)**. "Breaking the cache on a single layer will cause cascading rebuilds for all subsequent layers." Best practice: **define frequently-changing layers last** so earlier cached layers are reused. [Images guide: Image caching and rebuilds](https://modal.com/docs/guide/images)
- Cache keys come from the *definition* of each layer (package list, command strings, base image, env dict, etc.). If the definition is unchanged since the last run/deploy, the cached version is pulled. **(inferred from "Modal uses the definition of an Image to determine whether it needs to be rebuilt" — the exact hash inputs are not published.)**
- Interesting nuance documented for `force_build=True`: forcing rebuild of `pip_install`/`run_commands` layers "will rebuild, but the `apt_install` will not" — i.e. apt layers key more coarsely than command layers. [Images guide](https://modal.com/docs/guide/images)
- Force tools: `force_build=True` on any builder method (remove after use); `MODAL_FORCE_BUILD=1` (invalidates the cache for all dependent images too); `MODAL_IGNORE_CACHE=1` (rebuild from top without breaking the persistent cache — better for debugging). [Images guide](https://modal.com/docs/guide/images)
- Base-image churn is managed by the workspace-level **Image Builder Version** setting (releases every few months; you opt in when convenient; a bump triggers one slow rebuild). [Images guide](https://modal.com/docs/guide/images), [settings](https://modal.com/settings/image-builder-version)

For our Packer-phase layering, this maps directly: keep the apt layer (rarely changes) first, pinned tool installs next, and the dotfiles/OMZ clone layer last so config churn only rebuilds the tail.

### 1.3 How builds execute; logs; CLI

- Builder steps run on Modal's infrastructure atop the gVisor runtime; `run_function`/`run_commands` builder containers can even request GPUs. [Images guide](https://modal.com/docs/guide/images)
- Build timeout: `Image.run_function(..., timeout=...)` defaults to **60*60 = 1 hour** ("Maximum build-step runtime in seconds"). `run_commands` has no timeout parameter in the current SDK. **(inferred: the 1-hour default applies to the build-step mechanism generally, but only `run_function` documents/exposes `timeout`.)** [SDK Image: run_function](https://modal.com/docs/sdk/py/latest/Image)
- Build logs surface in two places: streamed to your terminal during `modal run`/`modal deploy`, and afterwards via **`modal image logs IMAGE_ID [--layers N | --all]`**. [CLI: modal image](https://modal.com/docs/cli/latest/image)
- Current `modal image` subcommands are only: `logs` and `names list` (list named image tags, `--prefix`, `--json`). There is **no `modal image ls` / `describe`** today. [CLI reference](https://modal.com/docs/cli/latest/image)
- Named images: build imperatively with `image.build(app)` then `image.publish("name")` (optionally `name:tag`, default `:latest`); reference later via `modal.Image.from_name("name")`. Referencing by name never triggers an implicit rebuild — good for a stable devbox base. Publishing a new version does NOT auto-update deployed apps; redeploy to propagate. [Named images guide](https://modal.com/docs/guide/named-images)
- Image deletion: `modal.experimental.image_delete(image_id)` deletes the final layer; it's the sanctioned way to clean up Sandbox Filesystem Snapshots (you must track IDs yourself; "there is currently no API to list all snapshots you have created"). [Release notes](https://modal.com/docs/sdk/py/releases), [Snapshots guide](https://modal.com/docs/guide/sandbox-snapshots)

### 1.4 Size limits, quotas, storage, CPU/GPU sharing

- **No documented per-image size limit** was found in the docs; the pricing page lists "Custom images: Unlimited" on Starter/Team/Enterprise. **(inferred: there is no published hard cap, but very large images slow cold-start work that touches many files — see below. Flagged as a gap.)** [Pricing](https://modal.com/pricing)
- Free/Starter plan: **$30/month free credits**, 100 concurrent containers + 10 GPU concurrency, 200 deployed apps, 1 TiB/month egress, 1-day log retention, region selection available. [Pricing](https://modal.com/pricing)
- Storage architecture: images are delivered by a FUSE file server backed by page cache → worker SSD → CDN → blob storage (files are lazily fetched on access), which is why container boot is ~1s even for large images. [Modal blog: Fast, lazy container loading](https://modal.com/blog/jono-containers-talk), [Cold start guide](https://modal.com/docs/guide/cold-start). The docs do not describe images as region-bound (volumes are explicitly "distributed by default"); **(inferred) images are served globally from Modal's CDN-backed storage, not pinned to a region.**
- One image for CPU and GPU functions: yes. The image is independent of resource requests; `gpu=` is a per-function parameter, and any number of functions (with and without `gpu=`) can share the same image definition. [GPU guide](https://modal.com/docs/guide/gpu), [Images guide](https://modal.com/docs/guide/images)

---

## 2. Capture — docker-commit-style freeze

**Yes — but only for Sandboxes, not for `@app.function` containers.**

- **`Sandbox.snapshot_filesystem(timeout=55, *, ttl=30*24*3600)`** captures a running Sandbox's root filesystem as a new Modal `Image`: "Filesystem Snapshots are copies of the Sandbox's root filesystem at a given point in time. These Snapshots are Images and can be used to create new Sandboxes." They're stored as a diff from the base image, so only modified files are persisted, and restoring uses the same fast cold-start infrastructure. Default TTL 30 days; pass `ttl=modal.NoExpiryTTL` to keep indefinitely. Publish it under a name with `image.publish("my-devbox")` for reuse. [Snapshots guide](https://modal.com/docs/guide/sandbox-snapshots), [SDK Sandbox](https://modal.com/docs/sdk/py/latest/Sandbox)
- **`Sandbox.snapshot_directory("/path")`** snapshots just one directory into an Image; a running Sandbox can `mount_image(path, snapshot)` / `unmount_image(path)` it later ("After unmounting, the underlying Sandbox filesystem at that path becomes visible again"). [Snapshots guide](https://modal.com/docs/guide/sandbox-snapshots), [Modal blog: Directory Snapshots](https://modal.com/blog/directory-snapshots-resumable-project-state-for-sandboxes)
- **Memory Snapshots** (`_experimental_enable_snapshot=True`, `_experimental_snapshot()` → `SandboxSnapshot`, restore via `Sandbox._experimental_from_snapshot`) clone the whole container including running processes — but: expire after 7 days, snapshotting terminates the Sandbox, **no GPUs**, no `region` pin, no VM runtime + volumes. Experimental. [Snapshots guide](https://modal.com/docs/guide/sandbox-snapshots)
- Important limits: a Filesystem Snapshot "only covers the Sandbox's root filesystem. Any mounted Volumes are not covered"; expired snapshots raise `NotFoundError`; there's no list-snapshots API — track IDs yourself (e.g. in a `modal.Dict`) and delete via the image-deletion API. [Snapshots guide](https://modal.com/docs/guide/sandbox-snapshots)
- **(inferred)** The docs only show snapshot Images being used to create Sandboxes / mounted into Sandboxes. Nothing documents using a `snapshot_filesystem()` image as a `@app.function` image, and nothing forbids it (it is just an Image). Treat Function-use of a snapshot image as unverified.

**For `@app.function` containers: there is NO capture mechanism — no `docker commit` equivalent.** Sanctioned alternatives when you've installed things interactively and want to keep them:

1. **Rebuild with new layers**: refine the commands you ran interactively and add them as `.run_commands(...)` / `.run_function(...)` layers (this is the documented purpose of `modal shell file.py` — "interactively refining build commands" — then codify them). [Developing & debugging guide](https://modal.com/docs/guide/developing-debugging)
2. **Put mutable state on a Volume** (persistent across containers, background commits, survives teardown). [Volumes guide](https://modal.com/docs/guide/volumes)
3. **Run the devbox as a Sandbox** and use `snapshot_filesystem()` / `snapshot_directory()` for true interactive-then-freeze capture, publishing the result as a named image. [Snapshots guide](https://modal.com/docs/guide/sandbox-snapshots)
4. **Directory snapshots + warm pools** for fast session resumption with per-project state. [Modal blog](https://modal.com/blog/directory-snapshots-resumable-project-state-for-sandboxes)

Note: the old `modal volume snapshot` CLI and volume snapshots are gone from the current CLI (see §3.1); "snapshot" in current docs means Sandbox snapshots.

---

## 3. Volumes / persistent state

### 3.1 API surface (current)

- Creation: `modal volume create NAME` (CLI) or `modal.Volume.from_name("name", create_if_missing=True)` / `modal.Volume.objects.create("name", version=None, allow_existing=False)` (SDK, v1.1.2+). **Volumes v2** (Beta) via `--version=2` / `version=2`. [Volumes guide](https://modal.com/docs/guide/volumes), [SDK Volume](https://modal.com/docs/sdk/py/latest/Volume), [CLI volume](https://modal.com/docs/cli/latest/volume)
- Mounting: `volumes={"/path": vol}` on `@app.function`/`@app.cls`/`Sandbox.create` (arbitrary absolute paths, not just `/mnt`; docs examples use `/root/foo`). `modal shell --volume NAME` mounts at `/mnt/{name}`. [SDK Volume](https://modal.com/docs/sdk/py/latest/Volume), [CLI shell](https://modal.com/docs/cli/latest/shell)
- Mount options per-container: `vol.with_mount_options(read_only=True, sub_path="/users/me")` — sub-path mounts a directory subset (created if missing; directories only). [Volumes guide](https://modal.com/docs/guide/volumes)
- **`commit()` / `reload()`**: writes must be committed to become visible outside the container; reload to see others' commits. **Background commits run every few seconds** while a function/sandbox executes, **plus a final commit on container shutdown** — so unattended code usually doesn't need explicit `.commit()`. Reload fails with "volume busy" if any files are open on the volume; during a reload the volume appears empty to the reloading container. [Volumes guide](https://modal.com/docs/guide/volumes), [SDK Volume](https://modal.com/docs/sdk/py/latest/Volume)
- **v2 only**: running `sync /mnt/volname` on the mountpoint flushes and persists everything — perfect inside `modal shell`/SSH where you can't call the Python `.commit()`. [Volumes guide: Volumes v2](https://modal.com/docs/guide/volumes)
- **One-writer rule**: v1 — avoid >5 concurrent commits, concurrent writes to the same file are last-write-wins, no distributed locking; v2 — hundreds of containers can write distinct files concurrently, but a single file should still have a single writer at a time. [Volumes guide](https://modal.com/docs/guide/volumes)
- `VolumeSnapshot` as a volume feature is gone: the current `modal volume` CLI has only `cp, create, dashboard, delete, get, list, ls, put, rename, rm` — **no `snapshot` subcommand**. The `modal.SandboxSnapshot` class today is for Sandbox *memory* snapshots (§2). [CLI volume](https://modal.com/docs/cli/latest/volume), [SDK releases](https://modal.com/docs/sdk/py/releases)
- Python-side file ops without mounting: `vol.listdir/iterdir/read_file/remove_file/copy_files/batch_upload().put_file/put_directory`, `modal volume put|get|cp` in the CLI. [SDK Volume](https://modal.com/docs/sdk/py/latest/Volume), [CLI volume](https://modal.com/docs/cli/latest/volume)

### 3.2 Performance, limits, pricing, region

- Designed for write-once/read-many; target up to **2.5 GB/s** bandwidth (not guaranteed). Best under **<50,000 files** on v1 (attach/reload latency scales linearly with file count); v1 hard limit **500,000 inodes**. v2 Beta: no file-count limit (≤262,144 files per directory, ≤1 TiB per file), faster commits/reloads, better random-write performance, hard links, HIPAA-compliant deletion; slower directory traversal (demand-loaded tree). [Volumes guide](https://modal.com/docs/guide/volumes)
- Pricing: **$0.09/GiB-month**, billed by daily snapshot of total storage; the first **1 TiB/month is free**; deleting data may still bill for up to 4 days. [Pricing](https://modal.com/pricing), [Volumes guide](https://modal.com/docs/guide/volumes)
- Volumes are "distributed by default" across Modal's multi-cloud fleet — no replica/region management; the docs' region-selection page only pins *containers* (`region=`) and input routing (`routing_region=`), not volumes. **(inferred: there is no documented volume region pin; cross-region volume use is implicit in the distributed design. Gap.)** [Volumes guide](https://modal.com/docs/guide/volumes), [Region selection](https://modal.com/docs/guide/region-selection)
- Export/backup: `modal volume get VOL / local-dir` (recursive download; `-` for stdout), `modal volume put` for restore, `modal volume cp` within a volume, `vol.batch_upload()`/`read_file` from Python. [CLI volume](https://modal.com/docs/cli/latest/volume), [SDK Volume](https://modal.com/docs/sdk/py/latest/Volume)
- `df`/`shutil.disk_usage` return placeholders (not a block device); check size in the dashboard or `du` on the mount. [Volumes guide](https://modal.com/docs/guide/volumes)

### 3.3 Mount shadowing and the $HOME pattern

- **(inferred)** A volume mounted at a path **shadows** image-baked content at that path: it's a mount over the directory, so `/root/repos` from the image is hidden while the volume is mounted there. The docs state the inverse operation for mounted Images explicitly — "After unmounting [a mounted Image], the underlying Sandbox filesystem at that path becomes visible again" ([Snapshots guide](https://modal.com/docs/guide/sandbox-snapshots)) — and volume mounts behave the same way **(inferred)**; nothing in the current docs spells this out for volumes. Practical rule: never mount a volume over a path where the image has content you need, unless the volume already contains that content.
- Recommended devbox pattern: **mount at `/persist` and symlink `$HOME` directories into it**, rather than mounting over `/root` itself (which would hide image-baked `/root` content like mounted dotfiles on every boot). On first boot, move the image-baked dirs (`~/.config`, `~/.local`, `~/.cache`, `~/.oh-my-zsh`, …) into the volume and replace with symlinks; afterwards they live on the volume and survive container recycling. This also avoids the reload-makes-volume-appear-empty and busy-reload failure modes ever touching `$HOME` mid-session. **(inferred recommendation; consistent with the docs' mount semantics and the one-writer/single-container devbox model.)**
- Keep file counts in mind: nvim plugin trees + LazyVim + cargo + node caches can reach tens of thousands of files — squarely v2 territory.

### 3.4 Volume + image build interplay

- **Yes — build steps can read from and write to volumes.** `Image.run_commands(volumes={"/mnt/x": vol})` ("Modal volumes to attach during the build step") and `Image.run_function(..., volumes={...})` ("Any kwargs accepted by @app.function (Volumes, Secrets, ...) can be supplied here"). [SDK Image](https://modal.com/docs/sdk/py/latest/Image), [Images guide](https://modal.com/docs/guide/images)
- This is the documented pattern for pre-populating caches/weights on a volume from a build-style function; background commits apply during execution (writes persist without explicit `.commit()`; call `vol.commit()` anyway for determinism). [Volumes guide](https://modal.com/docs/guide/volumes)

---

## 4. Local files into image — `add_local_dir`

- Signature: `add_local_dir(local_path, remote_path, *, copy=False, ignore=[])`. **Default `copy=False` mounts the files into the container at startup rather than baking an image layer** — redeploying after edits is fast, but no later build steps can use them. `copy=True` bakes a layer (Dockerfile `COPY`-like) and is required if subsequent build steps consume the files. [Images guide](https://modal.com/docs/guide/images), [SDK Image](https://modal.com/docs/sdk/py/latest/Image)
- `ignore=` takes dockerignore-style pattern strings, `FilePatternMatcher(...)` (invert with `~`, load from a file with `FilePatternMatcher.from_file(path)`), or a `Callable[[Path], bool]` predicate. [SDK Image](https://modal.com/docs/sdk/py/latest/Image)
- With `copy=False` the directory is snapshotted/uploaded at deploy/run time (not build time); with `copy=True` it's snapshotted at build time and any change re-invalidates that layer and everything after it. [Images guide](https://modal.com/docs/guide/images)
- **For a dotfiles repo, build-time `git clone` is the better default** when the repo is public (ours is): it keeps the image self-contained, avoids uploading from every machine, and lets the frequently-changing dotfiles layer sit last for cheap rebuilds. `add_local_dir` (either mode) makes sense for private/local-only files or fast iteration. The docs themselves use `run_commands(f"git clone {repo}")` inside an `Image.pipe(...)` builder as the canonical example. [SDK Image](https://modal.com/docs/sdk/py/latest/Image) For a *private* repo, use `run_commands(..., secrets=[modal.Secret.from_name("github-read-private")])` or `pip_install_private_repos` with a `GITHUB_TOKEN` secret — and beware that anything a secret-using command writes (e.g. a token embedded in `.git/config` remote URLs) gets baked into the image layer. [SDK Image](https://modal.com/docs/sdk/py/latest/Image)

---

## 5. SSH / interactive

### 5.1 `modal proxy ssh` — gone

The current CLI reference (https://modal.com/docs/cli/latest) lists **no `modal proxy`, no `modal attach`, no `modal interactive` command groups**, and `modal-client@main` has no `py/modal/cli/ssh_proxy.py` or `interactive.py`. Commands `modal proxy ssh|list|close`, `modal attach`, `modal interactive snooze` are **not part of the current CLI**. When exactly they were removed is not documented in the release notes — flagged as a gap; the practical takeaway is that no current Modal CLI version (1.x) supports them.

### 5.2 The current SSH story: `modal.forward` + sshd (you manage sshd)

Documented in the SDK `modal.forward` reference and the Tunnels guide:

```python
# inside a running @app.function
subprocess.Popen(["/usr/sbin/sshd", "-D", "-e"])
with modal.forward(port=22, unencrypted=True) as tunnel:
    hostname, port = tunnel.tcp_socket
    print(f"ssh -p {port} root@{hostname}")
    time.sleep(3600)  # keep alive
```

- `modal.forward(port, unencrypted=False, h2_enabled=False)` exposes a container port publicly; `unencrypted=True` also gives a raw TCP socket on a random port — "This can be used to SSH into a container". The tunnel runs on Modal's relay network, near-direct latency. [SDK forward](https://modal.com/docs/sdk/py/latest/forward), [Tunnels guide](https://modal.com/docs/guide/tunnels)
- **What must exist in the image: sshd itself** (`apt_install("openssh-server")`) — Modal does not manage SSH for you. Auth is whatever you configure in sshd: root password or `authorized_keys`. A current community reference implementation (Aug 2026) does exactly this: install openssh-server, start sshd, open an unencrypted tunnel on port 22, print `ssh -p {port} root@{hostname}`, and keeps the container alive; it mounts volumes and links them into `/root`. [Community gist: SSH into Modal](https://gist.github.com/idhantgulati/e1affeb54c3e29d10e3f07c80c4705d8) (secondary source)
- Security caveat: unencrypted TCP tunnels get a random *port* (not a guessable URL) and tunnels are public on the Internet — anyone who discovers host:port can reach your sshd. Use SSH public-key auth, not passwords. [Tunnels guide: Security](https://modal.com/docs/guide/tunnels)
- Sandbox alternative: `Sandbox.create(..., unencrypted_ports=[22])` then `sb.tunnels()` to get the `tcp_socket` — same effect without calling `modal.forward`. [Sandbox networking](https://modal.com/docs/guide/sandbox-networking)

### 5.3 `modal shell` vs attaching to a running container

- **`modal shell file.py::my_function`** starts a **fresh container** from the function's spec (same image, secrets, volumes): "does not attach a shell to a running Container of the Function, but instead creates a fresh instance of the underlying Image." Flags: `--cmd`, `--image`, `--add-python`, `--volume`, `--add-local`, `--secret`, `--cpu`, `--memory`, `--gpu` (e.g. `any`, `a10g`, `a100:4`), `--cloud`, `--region`, `--runtime gvisor|vm`, `--pty/--no-pty`. [CLI shell](https://modal.com/docs/cli/latest/shell), [Developing & debugging](https://modal.com/docs/guide/developing-debugging)
- **`modal shell <container-id>`** attaches a "Debug Shell" to a **running container** (get IDs via `modal container list`). Debug shells come with preinstalled tools (vim, nano, ps, strace, curl, py-spy, …), let you install packages with apt, and "terminate immediately once your Container has finished running." [Developing & debugging](https://modal.com/docs/guide/developing-debugging)
- **`modal container exec <container-id> COMMAND...`** runs a one-shot command in a running container (PTY by default, `--no-pty` to disable). [CLI container](https://modal.com/docs/cli/latest/container)
- Other container commands: `modal container list|logs [-f, --since, --tail, ...]|stop [--graceful] [-y]`. [CLI container](https://modal.com/docs/cli/latest/container)
- The old `modal attach` is gone (not in the CLI reference).

### 5.4 Keeping the container warm; what terminates it

- **`interactive_snooze=True` and `modal interactive snooze` no longer exist.** Keep-warm knobs today are `@app.function(..., scaledown_window=..., min_containers=..., buffer_containers=...)`, changeable at runtime without redeploying via `Function.update_autoscaler(...)`. [Scale guide](https://modal.com/docs/guide/scale), [1.0 migration guide](https://modal.com/docs/guide/modal-1-0-migration)
- What terminates a Function container:
  - **Input timeout**: default **300 s**; configurable **1 s – 24 h**; measures execution time only; separate `startup_timeout=` since v1.1.4. A timed-out input raises `FunctionTimeoutError` (after retries). [Timeouts guide](https://modal.com/docs/guide/timeouts)
  - **Scaledown**: idle containers shut down after `scaledown_window` (default **60 s**, configurable **2 s – 20 min**); the autoscaler may scale down earlier if substantially overprovisioned. [Cold start guide](https://modal.com/docs/guide/cold-start), [Scale guide](https://modal.com/docs/guide/scale)
  - **Preemption** (all functions are preemptible by default; opt out with `nonpreemptible=True`, 3x CPU/memory price, **not supported for GPU functions**). [Preemption guide](https://modal.com/docs/guide/preemption)
  - Manual: `modal container stop` (SIGINT; `--graceful` finishes current inputs). [CLI container](https://modal.com/docs/cli/latest/container)
- **Devbox keep-warm model**: while an *input is executing* the container cannot be scaled down — so a devbox function that holds its input open (sleep loop) with `timeout=24*60*60` stays alive up to 24 h per invocation, independent of `scaledown_window` **(inferred from the timeout/scaledown semantics: scaledown applies to *idle* containers with no running inputs)**. For >24 h sessions: re-invoke, or run the devbox as a Sandbox and use Filesystem Snapshots ("If you need a Sandbox to run for more than 24 hours, we recommend using Filesystem Snapshots to preserve its state"). Sandboxes also have an `idle_timeout=` (v1.1.4+). [Timeouts](https://modal.com/docs/guide/timeouts), [Sandboxes guide](https://modal.com/docs/guide/sandboxes), [Release notes](https://modal.com/docs/sdk/py/releases)

### 5.5 Multi-session attach (the core devbox requirement)

- **Two SSH sessions into the same running container: yes** — both connect through the same tunnel (host:port → port 22 of *that* container), landing as two sessions in one sshd inside one container. A `tmux` server started there persists across SSH disconnects as long as the container lives. **(inferred — follows from tunnel semantics (one tunnel per container port) and normal sshd behavior; not explicitly documented.)** The community SSH implementation is built around exactly this (tmux/long-lived dev session over the tunnel). [Community gist](https://gist.github.com/idhantgulati/e1affeb54c3e29d10e3f07c80c4705d8)
- **ssh + `modal shell <container-id>` in the same container: yes** — the debug shell execs into the running container (the same one your SSH tunnel points at), though it terminates when the container's input finishes. [Developing & debugging](https://modal.com/docs/guide/developing-debugging)
- `modal shell file.py::fn` does **not** join the running devbox — it makes a new container. [Developing & debugging](https://modal.com/docs/guide/developing-debugging)

---

## 6. GPU

### 6.1 GPU spec strings and count

Current accepted `gpu=` values: `T4`, `L4`, `A10`, `L40S`, `A100`, `A100-40GB`, `A100-80GB`, `RTX-PRO-6000`, `H100`/`H100!`, `H200`, `B200`/`B200+`, `B300`. Strings are case-insensitive. Count via suffix `:n` (e.g. `gpu="H100:8"`); B300/B200/H200/H100/A100/L4/T4/L40S support up to 8 GPUs, A10 up to 4; >2 GPUs usually means longer wait times; GPUs are always on the same physical machine. `gpu=` also accepts a **list for fallbacks** (ordering respected). [GPU guide](https://modal.com/docs/guide/gpu)

- `H100!` disables Modal's automatic H100→H200 upgrade (upgrade is free — billed as H100). `A100` may be auto-upgraded to A100-80GB at A100-40GB price. `B200+` allows B200 or B300 placement, billed as B200. `B300` requires **CUDA 13.1+** in the container. [GPU guide](https://modal.com/docs/guide/gpu)
- **`spot=` no longer exists**: the current `@app.function` signature has no `spot` parameter — instead `nonpreemptible=False` exists (see §5.4). There is no documented discounted/spot GPU price tier on the pricing page today. [SDK App.function](https://modal.com/docs/sdk/py/latest/App), [Pricing](https://modal.com/pricing)

### 6.2 On-demand list prices (per modal.com/pricing, per-second; hourly = ×3600, **computed**)

| GPU | $/sec | ≈ $/hr |
|---|---|---|
| T4 | $0.000164 | ~$0.59 |
| L4 | $0.000222 | ~$0.80 |
| A10 | $0.000306 | ~$1.10 |
| L40S | $0.000542 | ~$1.95 |
| A100-40GB | $0.000583 | ~$2.10 |
| A100-80GB | $0.000694 | ~$2.50 |
| RTX PRO 6000 | $0.000842 | ~$3.03 |
| H100 (SXM5) | $0.001097 | ~$3.95 |
| H200 (SXM) | $0.001261 | ~$4.54 |
| B200 | $0.001736 | ~$6.25 |
| B300 | $0.001972 | ~$7.10 |

CPU: $0.0000131/core/sec (~$0.047/core-hr); memory: $0.00000222/GiB/sec (~$0.008/GiB-hr); container-region pinning multiplies base prices 1.15–1.75x; nonpreemptible multiplies CPU+memory 3x. [Pricing](https://modal.com/pricing), [Region selection](https://modal.com/docs/guide/region-selection), [Preemption](https://modal.com/docs/guide/preemption)

### 6.3 CUDA in the container

- **Host provides the driver stack; the container provides the toolkit.** Modal GPU machines ship the NVIDIA Accelerated Graphics Driver for Linux-x86_64 (currently version 580.95.05) and CUDA Driver API 13.0; `libcuda.so`, `libnvidia-ml.so`, and **`nvidia-smi` work in any GPU-attached container with zero setup**. The CUDA Toolkit (`libcudart.so`, `nvcc`, `cuobjdump`, profilers) is **not** installed by default. [CUDA guide](https://modal.com/docs/guide/cuda)
- Compatibility rule: choose a container CUDA version **no greater than** the host driver's; "older versions in the `12.*` and `13.*` series are guaranteed to be compatible with the host machine's driver, but older major versions (`11.*`, `10.*`) may not be." So for a devbox that must run on everything from T4 to B200/B300, a `12.x`/`13.x` toolkit image is the safe pick, and only B300 forces ≥13.1. [CUDA guide](https://modal.com/docs/guide/cuda)
- For a **full CUDA devbox (nvcc + clangd CUDA LSP)** the docs recommend pulling an officially-supported CUDA image, e.g. `modal.Image.from_registry("nvidia/cuda:13.0.0-cudnn-devel-ubuntu24.04")` (the guide points at the `nvidia/cuda:*-devel-*` Docker Hub tags), then chaining Modal layer methods on top. `*-devel-*` variants carry nvcc + headers; `*-runtime-*` do not. [CUDA guide](https://modal.com/docs/guide/cuda)
- Simple torch-style workloads can skip the toolkit image entirely: `pip_install("torch")` works because PyPI `nvidia-*` wheels carry the runtime pieces the host doesn't. [CUDA guide](https://modal.com/docs/guide/cuda)
- Image-build steps can request GPUs (`run_commands(gpu="A100-40GB")`, `run_function(gpu=...)`) for compile-against-device steps. [Images guide](https://modal.com/docs/guide/images)

### 6.4 Architecture

- External registry images must be built for **`linux/amd64`**. [Existing images guide](https://modal.com/docs/guide/existing-images) Modal's fleet (including all GPU hosts) is x86-64; there is no arm64/aarch64 option documented anywhere in the current docs. **(inferred: no arch pin parameter exists because there is only one arch — amd64.)** Our `mmdflux` linux-x86_64 build runs natively; nothing to pin.

---

## 7. Runtime environment

- **User: root (uid 0), always.** The Dockerfile `USER` instruction is ignored; use in-process privilege dropping if needed. [Existing images guide: USER](https://modal.com/docs/guide/existing-images)
- **`$HOME` is `/root`** — docs consistently treat `/root` as the container home (automounted Python source lands in `/root`; debug-shell examples `ls /root`). **(inferred from doc examples; no page states `$HOME`'s value explicitly.)** [SDK Image: add_local_python_source](https://modal.com/docs/sdk/py/latest/Image), [Developing & debugging](https://modal.com/docs/guide/developing-debugging)
- **Reserved `MODAL_*` env vars** (cannot be overridden): every container — `MODAL_CLOUD_PROVIDER` (aws/gcp/oci), `MODAL_IMAGE_ID`, `MODAL_REGION` (container region, e.g. `us-east`/`uk`/`us`/`eu`), `MODAL_TASK_ID` (container ID); functions — `MODAL_ENVIRONMENT`, `MODAL_IS_REMOTE=1`, `MODAL_IDENTITY_TOKEN` (OIDC); sandboxes — `MODAL_SANDBOX_ID`. [Environment variables guide](https://modal.com/docs/guide/environment_variables)
- **Outbound internet**: open by default, both during builds (apt/pip/curl/git in `run_commands` all work) and at runtime for functions; `block_network=True` is the opt-out on `@app.function` and Sandboxes; Sandboxes default to "outbound connections to any public IP address" with opt-in allowlists (`outbound_cidr_allowlist`, `outbound_domain_allowlist`). [SDK App.function](https://modal.com/docs/sdk/py/latest/App), [Images guide](https://modal.com/docs/guide/images), [Sandbox networking](https://modal.com/docs/guide/sandbox-networking)
- **GitHub token at runtime**: `@app.function(secrets=[modal.Secret.from_name("github-token")])` — values appear as env vars (e.g. `GITHUB_TOKEN`). Multiple secrets inject in order; later ones overwrite clashing keys. [Secrets guide](https://modal.com/docs/guide/secrets)
- **Secrets during image build**: yes — `run_commands(secrets=[...])`, `run_function(secrets=[...])`, `from_registry(secret=...)`, and `pip_install_private_repos` (GITHUB_TOKEN/GITLAB_TOKEN). Caveat: whatever a build command writes to disk is baked into the image — never let a token land in a file inside the layer. [SDK Image](https://modal.com/docs/sdk/py/latest/Image)
- **Personal-workspace quotas (Starter plan)**: $30/mo included compute; **100 concurrent containers, 10 concurrent GPUs**; 200 deployed apps; custom images unlimited; 5 deployed crons; 1-day log retention; region selection available. Team: $250/mo, 5000 containers, 50 GPUs, 1000 apps. Hard per-function cap of 4,000 concurrent containers. [Pricing](https://modal.com/pricing), [Scale guide: Scaling Limits](https://modal.com/docs/guide/scale)
- **Cold start for a multi-GB image + volumes**: container boot itself is ~1s; what you pay at cold start is (a) global-scope/`@modal.enter()` initialization and (b) lazy FUSE fetches of image files as they're first touched — image *size* alone doesn't dominate. Volume attach latency scales with the volume's file count (v1; v2 demand-loads the tree, but traversal can be slower). Set `startup_timeout=` (v1.1.4+) if first-boot init (e.g. LazyVim sync, cargo builds) is slow. [Cold start guide](https://modal.com/docs/guide/cold-start), [Volumes guide](https://modal.com/docs/guide/volumes), [Timeouts guide](https://modal.com/docs/guide/timeouts)
- **Region selection**: `region=` on functions/sandboxes (multiplies usage price 1.15–1.75x; multiple regions = smallest applicable multiplier; broader is better for scheduling); `routing_region=` (`us-east`, `us-west`, `eu-west`, `ap-south`) for input routing, settable only at first deployment; >2 MiB inputs/outputs still upload via `us-east` object storage. [Region selection](https://modal.com/docs/guide/region-selection)

---

## 8. Modal Secrets — secret management

### 8.1 CLI today

```
modal secret list                                    # names + timestamps (--json available)
modal secret create NAME KEY=VALUE [KEY=VALUE ...]   # or KEY=$ENVVAR expansion from the environment
modal secret create NAME --from-dotenv ~/.env        # load from a .env file
modal secret create NAME --from-json file.json       # load from a JSON file
modal secret create NAME ... --force                 # overwrite if the name already exists
modal secret delete NAME [--allow-missing] [-y]
```

- `--from-dotenv PATH` and `--from-json PATH` were added in v1.1.x; `--force` ("Overwrite the secret if it already exists") is the idempotency switch. [CLI secret reference](https://modal.com/docs/cli/latest/secret), [Release notes](https://modal.com/docs/sdk/py/releases)
- **Idempotency for the sync script**: without `--force`, creating an existing name is an error (that's what the flag is for); with `--force` it overwrites. The audit-log schema confirms `secret.create` covers both "created or its values were overwritten (via `modal secret create` or the dashboard)". So the sync script is: `modal secret create <name> --from-dotenv <file> --force` per env file, plus `modal secret delete <gone-name> --allow-missing -y` for cleanup. [Audit logs guide](https://modal.com/docs/guide/audit-logs)
- Env-var style creation (CI-friendly): `modal secret create my-db PGUSER=me PGPASSWORD=$PGPASSWORD`. [Secrets guide](https://modal.com/docs/guide/secrets)
- Python side: `modal.Secret.from_dict({...})` (ephemeral, sent per-run), `Secret.from_dotenv()` (needs python-dotenv), `Secret.from_name(...)`, and the imperative `Secret.objects.*` namespace (v1.1.2+). [Secrets guide](https://modal.com/docs/guide/secrets), [SDK releases](https://modal.com/docs/sdk/py/releases)

### 8.2 "Typed" secrets

There is no typed-secret API class in the current SDK — a Secret is an env-var dictionary. The closest things Modal offers: **dashboard templates** ("templates ... for everything from Postgres and MongoDB to Weights & Biases and Hugging Face" that pre-structure key names) and **integration-created secrets** (e.g. the AWS integration generating a Secret with `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`, or GCP/GitHub via OIDC). For our use case (raw env files, gh token, MCP tokens), plain env secrets are the right type — one Modal Secret per source env file. [Secrets guide](https://modal.com/docs/guide/secrets), [Existing images guide](https://modal.com/docs/guide/existing-images)

### 8.3 Security model — who can read values back

- **There is no way to read secret values back** through the CLI or API: `modal secret list` shows names and timestamps only; resolving a secret (`secret.get` audit event) "returns only the Secret's ID and metadata — values are not returned"; dashboard edits record key *names*, "values are never recorded". The dashboard likewise does not display existing values — you can only replace them. **(inferred for the dashboard display behavior; the audit-log doc's explicit "values are not returned" is the documented anchor.)** [Audit logs guide](https://modal.com/docs/guide/audit-logs), [Secrets guide](https://modal.com/docs/guide/secrets)
- **Plain-text caveat, stated plainly**: secrets are injected as *environment variables* into containers. Anyone who can (a) run a function/Sandbox in the workspace, or (b) create/update a function that mounts the secret, can trivially read the plaintext (`print(os.environ)`). In a personal workspace that's just you — but any leaked workspace token or over-broad RBAC seat turns secrets into readable data. Also, `~/.env`-style values end up in `ps e` output and core dumps inside containers. For untrusted code, use Sandbox Outbound Policies instead (below) so keys never enter the container env.
- **Audit logging** exists but is **Enterprise-plan only** (Starter/Team: "Audit logs — Not included"). Events include `secret.create`, `secret.get`, `secret.update`, `secret.delete` (names only, never values). [Pricing compare table](https://modal.com/pricing), [Audit logs guide](https://modal.com/docs/guide/audit-logs)
- **Workspace scoping**: Secrets live in a workspace *Environment* (`-e/--env` flag, `MODAL_ENVIRONMENT`, default environment otherwise) — the same scoping model as Volumes/Dicts/Queues. [Secrets guide](https://modal.com/docs/guide/secrets), [Environments guide](https://modal.com/docs/guide/environments)

### 8.4 Using secrets: runtime vs build; rotation on warm containers

- Runtime: `@app.function(secrets=[modal.Secret.from_name("devbox-github")])` → env vars in the container. Multiple secrets OK; later entries win key clashes. [Secrets guide](https://modal.com/docs/guide/secrets)
- Build time: `run_commands(secrets=[...])`, `run_function(secrets=[...])`, `from_registry(secret=...)`, `pip_install_private_repos(...)` (GitHub/GitLab). [SDK Image](https://modal.com/docs/sdk/py/latest/Image)
- **Rotation and warm containers**: secret values are materialized into the container environment when the container starts. A warm devbox container therefore keeps serving the *old* values after you `modal secret create ... --force`; the rotated values land on the next cold start. **(inferred — the injection mechanism is documented as env-var injection at container setup; no doc describes live re-injection, and the Outbound-Policy doc explicitly says a running Sandbox does not pick up updated secret values, which strongly implies the same for functions.)** Practical rule for the devbox: after rotating, `modal container stop <id>` (or just let the 24 h input lapse) and re-run; the fresh container picks up new values. For *deployed* apps, redeploy after rotation to be safe. [Sandbox secret injection guide](https://modal.com/docs/guide/sandbox-secret-injection)

### 8.5 Limits, grouping, file-based secrets

- Per key-value pair: **key ≤ 16,384 chars** (letters/digits/underscore, no leading digit), **value ≤ 32,768 chars**. Bigger payloads → put the data on a Volume and read it at runtime. No documented per-secret or workspace-wide count/total-size cap; pricing lists "Secrets: Unlimited" on every plan. [Secrets guide: Limits](https://modal.com/docs/guide/secrets), [Pricing](https://modal.com/pricing)
- Grouping: docs encourage "separating Secrets into smaller reusable units" and injecting several per function. One Modal Secret per source env file (`~/.env`, `~/.config/pi-*.env`, gh token, MCP tokens) maps 1:1 onto the sync script and keeps rotation blast radius small. [Secrets guide](https://modal.com/docs/guide/secrets)
- **File-based (non-env) secrets: not supported for functions.** A Modal Secret is always KEY=VALUE env pairs. Options for shipping a JSON auth file verbatim: (a) base64 it into a value (fits under 32 KiB) and decode at container start; (b) store the file on the persist Volume (but mind who can mount that volume); (c) for *untrusted* code in Sandboxes, the beta **Outbound Policy** (`with_header_replacement(domain, headers, secret=...)` on `Sandbox.create`) injects auth headers into outbound HTTPS outside the container so "the secret never appears in the Sandbox's environment" — up to 25 header values, exact/`*.`/`*` domain matching, `$KEY` templating against a named Secret, HTTPS/443 only, replaceable at runtime on a running Sandbox. [Secrets guide](https://modal.com/docs/guide/secrets), [Sandbox secret injection guide](https://modal.com/docs/guide/sandbox-secret-injection)

---

## Confidence and gaps

High confidence (directly documented): all Image constructors/layer methods and their parameters; per-layer caching and ordering rules; `modal image logs` / `names list` as the only image subcommands; Sandbox `snapshot_filesystem`/`snapshot_directory`/`mount_image` semantics and TTLs; Volume commit/reload/background commits/one-writer rules, v2 `sync`, CLI subcommands, pricing, inode limits; `modal shell` fresh-vs-running-container semantics; `modal container exec/list/stop`; `modal.forward(port=22, unencrypted=True)` SSH pattern; timeout/scaledown/preemption semantics; GPU strings, counts, upgrades, per-second prices; CUDA host-driver (580.95.05 / Driver API 13.0) vs container-toolkit split and 12.x/13.x compatibility guidance; amd64-only images; reserved `MODAL_*` env vars; secrets CLI, limits, audit-log behavior, Outbound Policies.

Ambiguous / inferred (flagged inline, repeated here):

1. **`modal proxy ssh` / `modal attach` / `modal interactive` removal timing** — verified gone from the current CLI reference and repo, but no release note documents when they were removed.
2. **`$HOME` == `/root`** — consistent across doc examples, never stated explicitly.
3. **Volume mount shadowing image content** — follows from mount semantics and the documented `unmount_image` behavior for mounted Images; not stated verbatim for volumes.
4. **Multi-SSH-sessions-same-container (tmux persistence)** — follows from tunnel/sshd semantics and the community implementation; not explicitly documented.
5. **Warm-container secret rotation behavior for functions** — inferred from injection mechanics + the Sandbox Outbound Policy doc; not explicitly documented for functions.
6. **No published per-image size limit** — absence of documentation, not a documented "no limit".
7. **Volume region pinning** — no documented option; volumes are "distributed by default".
8. **Image region-binding** — no docs describe images as region-bound; inferred global/CDN-backed.
9. **Spot/discounted GPU tier** — gone with `spot=`; no documented replacement discount.
10. **`run_commands` build-step timeout** — not documented (only `run_function`'s 1 h default).
11. **Using a `snapshot_filesystem()` image as a `@app.function` image** — snapshots are documented for Sandbox creation; Function use is unverified.
12. **Dashboard secret-value display** — write-only behavior inferred from audit-log doc; not stated on a dashboard page.

Suggested next steps to close gaps: `modal shell` into a running devbox container to empirically confirm $HOME, mount shadowing, and two-parallel-SSH; file a Modal support/Slack question about image size limits and snapshot-image-on-function; watch [docs/guide/sandbox-snapshots](https://modal.com/docs/guide/sandbox-snapshots) for Function-use of snapshot images.

---

## Sketch — `devbox.py` (current API, October 2026)

```python
"""devbox.py — Modal devbox mirroring the Packer phases.

Layers (ordered stable-first so the per-layer cache survives churn):
  1. apt system packages          (rarely changes)
  2. CLI tools (rust/bob/node/uv/gh/kubectl/k9s/aws/yq)
  3. nvim nightly via bob + LazyVim bootstrap
  4. dotfiles clone + stow + OMZ + plugins   (changes most -> last)

Persistent state: /persist (Volume v2), with $HOME dirs symlinked in.
Interactive: sshd + modal.forward(port=22, unencrypted=True); tmux inside.
GPU: parameterized (--gpu H100 / L40S / A100-80GB / T4 / "" for CPU).

Usage:
  modal run ops/modal-devbox/devbox.py                 # CPU devbox
  modal run ops/modal-devbox/devbox.py --gpu H100      # GPU devbox
  # prints:  ssh -p <port> root@<host>
"""

import subprocess
import time

import modal

app = modal.App("devbox")

persist = modal.Volume.from_name(
    "devbox-persist", create_if_missing=True, version=2  # v2: no file-count limit, `sync` works
)

DOTFILES_REPO = "https://github.com/<you>/dotfiles.git"  # public repo -> no token needed at build

# --- phase 1: apt system packages -------------------------------------------------
base = (
    modal.Image.from_registry("ubuntu:24.04", add_python="3.12")
    .apt_install(
        "build-essential", "ca-certificates", "curl", "git", "git-lfs", "unzip", "zsh", "stow",
        "tmux", "openssh-server", "fzf", "ripgrep", "yq", "direnv", "lazygit",
    )
    .env({"SHELL": "/bin/zsh"})
)

# --- phase 2: CLI tools (pin versions to keep this layer cache-stable) -------------
tools = base.run_commands(
    # rustup + cargo tools
    "curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal",
    "bash -lc 'cargo install --locked eza bob-nvim'",
    # node 22 + uv
    "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs",
    "curl -LsSf https://astral.sh/uv/install.sh | sh",
    # gh, kubectl, k9s, awscli v2 (apt/snap or pinned tarballs -- pin tags!)
    "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg"
    " -o /usr/share/keyrings/githubcli-archive-keyring.gpg",
    "echo 'deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg]"
    " https://cli.github.com/apt stable main' > /etc/apt/sources.list.d/github-cli.list",
    "apt-get update && apt-get install -y gh",
)

# --- phase 3: nvim nightly via bob + LazyVim (or our repo's nvim config, phase 4) --
nvim = tools.run_commands(
    "bash -lc 'bob install nightly && bob use nightly'",
)

# --- phase 4: dotfiles + OMZ + plugins (most volatile -> last layer) ---------------
devbox_image = nvim.run_commands(
    f"git clone --depth 1 {DOTFILES_REPO} /root/repos/dotfiles",
    "cd /root/repos/dotfiles && stow --target=/root zsh tmux nvim git",  # our stow packages
    # Oh My Zsh + plugins (or however the repo bootstraps them)
    'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended',
    "git clone --depth 1 https://github.com/zsh-users/zsh-autosuggestions"
    " /root/.oh-my-zsh/custom/plugins/zsh-autosuggestions",
    "git clone --depth 1 https://github.com/zsh-users/zsh-syntax-highlighting"
    " /root/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting",
)

# --- runtime helpers ---------------------------------------------------------------

HOME_DIRS = [".config", ".local/share", ".local/state", ".cache", ".oh-my-zsh", ".tmux"]

def _link_home_dirs() -> None:
    """First boot: move image-baked $HOME dirs onto /persist, then symlink.
    Later boots: symlinks already point into the volume; image copies are shadowed."""
    import os
    for d in HOME_DIRS:
        home_path = os.path.expanduser(f"~/{d}")
        persist_path = f"/persist/{d}"
        if os.path.islink(home_path):
            continue
        if not os.path.exists(persist_path) and os.path.exists(home_path):
            os.makedirs(os.path.dirname(persist_path), exist_ok=True)
            os.rename(home_path, persist_path)  # seed the volume with image defaults
        os.makedirs(os.path.dirname(home_path), exist_ok=True)
        os.symlink(persist_path, home_path)

# --- the devbox function -----------------------------------------------------------

@app.function(
    image=devbox_image,
    volumes={"/persist": persist},
    secrets=[modal.Secret.from_name("devbox-github")],  # GITHUB_TOKEN etc. at runtime
    timeout=24 * 60 * 60,        # one input may hold the container for up to 24h
    scaledown_window=1200,       # idle containers linger up to 20 min (max) between inputs
    cpu=4,
    memory=8192,
    # gpu= is set dynamically below from the --gpu flag
)
def devbox() -> None:
    _link_home_dirs()

    # sshd: we manage it (Modal no longer ships `modal proxy ssh`).
    subprocess.run("ssh-keygen -A", shell=True, check=True)          # host keys
    subprocess.run("mkdir -p /run/sshd", shell=True, check=True)
    # auth: your public key, delivered via the secret (not baked into the image)
    import os
    authorized = os.environ["DEVBOX_SSH_PUBLIC_KEY"]
    os.makedirs("/root/.ssh", exist_ok=True)
    with open("/root/.ssh/authorized_keys", "a") as f:
        f.write(authorized + "\n")
    subprocess.Popen(["/usr/sbin/sshd", "-D", "-e"])

    # public TCP tunnel -> ssh from your laptop
    with modal.forward(port=22, unencrypted=True) as tunnel:
        host, port = tunnel.tcp_socket
        print(f"\n  ssh -p {port} root@{host}\n")
        print("  tmux new -s main   # starts the persistent session")
        try:
            while True:                # hold the input (and the container) open
                time.sleep(60 * 60)
                persist.commit()       # belt-and-braces; background commits also run
        except KeyboardInterrupt:
            persist.commit()           # final explicit commit on teardown

@app.local_entrypoint()
def main(gpu: str = ""):
    # dynamic per-run resource override: gpu="" -> plain CPU container
    fn = devbox.with_options(gpu=gpu or None)
    fn.remote()
```

Notes on the sketch:

- `with_options(gpu=...)` is the documented dynamic-configuration path for per-invocation resources ([Dynamic configuration guide](https://modal.com/docs/guide/dynamic-function-config)); alternatively model the devbox as a `@modal.cls` with `gpu: str = modal.parameter(...)`.
- The dotfiles repo is public, so the build-time `git clone` needs no secret. The runtime gh/MCP tokens ride `modal.Secret.from_name("devbox-github")` (created by the sync script below).
- `_link_home_dirs` implements the `/persist` + symlink pattern from §3.3 — the volume never shadows image content because it mounts at `/persist`, not `/root`.
- Variant worth considering later: run the devbox as a `modal.Sandbox` instead of a function — you gain `snapshot_filesystem()` capture (§2), `unencrypted_ports=[22]` tunnels, and `pty=True` exec, at the cost of the Sandbox's 24 h lifetime guidance (chain via snapshots).

### End-user CLI workflow

```bash
# 0. one-time (and after rotations) — idempotent secret sync
modal secret create devbox-github --from-dotenv ~/.config/pi-github.env --force
modal secret create devbox-mcp    --from-dotenv ~/.config/pi-mcp.env    --force
# (values ≤ 32 KiB each; --force overwrites; --allow-missing on delete makes cleanup idempotent)

# 1. first build + start (image builds here; watch layers stream by)
uv run modal run ops/modal-devbox/devbox.py                 # or: --gpu H100
#    -> prints: ssh -p 34567 root@r3.modal.host

# 2. ssh in; tmux session persists across disconnects while the container lives
ssh -p 34567 root@r3.modal.host
tmux new -s main

# 3. second door into the SAME container (debug shell: vim/strace/py-spy preinstalled)
modal container list                       # grab container id (also = MODAL_TASK_ID inside)
modal shell ta-XXXXXXXX                    # or: modal container exec ta-XXXXXXXX 'htop'

# 4. persist state
#    - anything under /persist-backed symlinks (~/.config, ~/.local, ...) auto-persists
#      via background commits (every few seconds + final commit on shutdown)
#    - manual flush from inside an ssh/shell session (Volume v2):
sync /persist
#    - or from the host: modal volume ls devbox-persist ; modal volume get devbox-persist / backup/

# 5. warm-keep
#    - the running input holds the container for up to 24h (timeout=24h); re-run devbox.py to renew
#    - between inputs, scaledown_window=1200 keeps an idle container around up to 20 min
#    - after secret rotation: modal container stop ta-XXXXXXXX   (next cold start reads new values)

# 6. teardown
modal container stop ta-XXXXXXXX -y        # stops the devbox container (final volume commit runs)
modal app stop devbox                      # if you ever deployed it
# state stays on the devbox-persist volume; next `modal run` restores $HOME via symlinks
```

Additional operational notes:

- Build logs after the fact: `modal image logs <image-id> [--all]`; named image list: `modal image names list`. [CLI image](https://modal.com/docs/cli/latest/image)
- Force a rebuild: `MODAL_FORCE_BUILD=1 modal run ...` (invalidates dependents) or `MODAL_IGNORE_CACHE=1` (debug-only, non-destructive). [Images guide](https://modal.com/docs/guide/images)
- Publish the built devbox image under a stable name to decouple rebuilds from runs: `image.build(app); image.publish("devbox:2026-10")` in a small build script, then `modal.Image.from_name("devbox")` in `devbox.py`. [Named images guide](https://modal.com/docs/guide/named-images)

---

## Source list (kept)

Primary (modal.com docs / pricing / SDK+CLI reference / release notes):

- https://modal.com/docs/guide/images — image methods, caching, force-build, builder version
- https://modal.com/docs/guide/existing-images — from_registry/from_dockerfile, USER/ENTRYPOINT/ADD caveats, amd64 requirement
- https://modal.com/docs/sdk/py/latest/Image — full Image API incl. run_commands(secrets=, volumes=), run_function timeout, add_local_dir, pipe, publish, from_name
- https://modal.com/docs/guide/modal-1-0-migration — deprecations/removals (copy_local_dir, Mount, @modal.build, gpu objects, autoscaler renames)
- https://modal.com/docs/guide/named-images — build/publish/from_name semantics
- https://modal.com/docs/cli/latest — CLI index proving absence of proxy/attach/interactive
- https://modal.com/docs/cli/latest/image — modal image logs / names list
- https://modal.com/docs/cli/latest/shell — modal shell flags, REF vs container-id
- https://modal.com/docs/cli/latest/container — container exec/list/logs/stop
- https://modal.com/docs/cli/latest/volume — full volume CLI (no snapshot subcommand)
- https://modal.com/docs/cli/latest/secret — secret create --from-dotenv/--from-json/--force, delete --allow-missing
- https://modal.com/docs/guide/volumes — v1/v2 semantics, commits/reloads, one-writer, limits, pricing, sub_path
- https://modal.com/docs/sdk/py/latest/Volume — Volume API (commit, reload, batch_upload, objects.*)
- https://modal.com/docs/guide/sandbox-snapshots — snapshot_filesystem/directory, TTLs, limitations
- https://modal.com/blog/directory-snapshots-resumable-project-state-for-sandboxes — directory snapshot patterns (Modal blog, semi-primary)
- https://modal.com/docs/guide/developing-debugging — debug shells, modal shell semantics, container exec
- https://modal.com/docs/guide/tunnels — modal.forward, unencrypted TCP, security
- https://modal.com/docs/sdk/py/latest/forward — documented SSH-over-forward example
- https://modal.com/docs/guide/cold-start — boot time, scaledown_window, min/buffer containers
- https://modal.com/docs/guide/scale — autoscaler params, limits, update_autoscaler
- https://modal.com/docs/guide/timeouts — input timeout defaults/range, startup_timeout
- https://modal.com/docs/guide/preemption — default preemption, nonpreemptible (3x, no GPU)
- https://modal.com/docs/guide/gpu — GPU strings, counts, upgrades, fallbacks
- https://modal.com/docs/guide/cuda — host driver 580.95.05 / Driver API 13.0, toolkit guidance, nvidia/cuda:*-devel-*
- https://modal.com/docs/guide/resources — cpu/memory/disk defaults and limits
- https://modal.com/docs/guide/region-selection — region=/routing_region=, price multipliers
- https://modal.com/docs/guide/environment_variables — MODAL_* variables
- https://modal.com/docs/guide/secrets — limits, ordering, from_dict/from_dotenv
- https://modal.com/docs/guide/audit-logs — secret events; "values are not returned/never recorded"; Enterprise-only
- https://modal.com/docs/guide/sandbox-networking — outbound defaults, block_network, unencrypted_ports, tunnels
- https://modal.com/docs/guide/sandbox-secret-injection — Outbound Policies (beta), running-sandbox rotation caveat
- https://modal.com/docs/guide/sandboxes — 24h guidance, snapshots for longer sessions
- https://modal.com/pricing — plans, quotas, per-second GPU/CPU/memory prices, volume $/GiB-mo
- https://modal.com/docs/sdk/py/releases — Python SDK changelog (--from-dotenv/--from-json, objects namespace, pty, idle_timeout, startup_timeout)
- https://modal.com/docs/guide/dynamic-function-config — with_options dynamic resources
- https://modal.com/blog/jono-containers-talk — lazy FUSE image loading architecture (Modal blog, semi-primary)
- https://github.com/modal-labs/modal-client (tree `py/modal/cli/`) — ground truth on CLI command set

Secondary (kept, clearly marked):

- https://gist.github.com/idhantgulati/e1affeb54c3e29d10e3f07c8099705d8 — community SSH-into-Modal implementation (Aug 2026); corroborates sshd+forward pattern, volume-into-/root linking, tmux-style persistent session

Dropped: web forum threads about docker amd64/arm64 (generic Docker content, not Modal), releasebot.io mirror of Modal changelog (duplicate of primary), misc SEO/AI-infra listicles (no primary value).

# Nix fleet: two profiles, one flake

This document is the profile model. It says which profile owns which host, what
each ownership layer owns, and how a deploy runs. The MacBook reproduction
definition stays in the mission's `overview.md` scope table until the mission
lands; this file carries the same model for the repository.

## The model

One flake. Exactly two profiles. No third profile, and no profile per host.

| Profile | Hosts | Built with | Purpose |
| --- | --- | --- | --- |
| `remote` | homelab, devbox | Home Manager (`homeConfigurations.remote`) | One shared user environment for both Ubuntu hosts |
| `macbook` | every MacBook the owner has | nix-darwin plus Home Manager (`darwinConfigurations.macbook`) | One system and user environment that reproduces the live Mac |

The two hosts of the `remote` profile share the profile output. A small per-host
module carries only the differences a live inventory proves. Nothing else about
a host is declared per host.

The `macbook` profile is not per machine either. A second MacBook gets the same
profile; a real difference becomes a per-host module entry, with the evidence
recorded in the scope table.

## Why the MacBook profile is nix-darwin, not plain Home Manager

A Home Manager profile on macOS can install packages, but it cannot own the
system layer. Two things need that layer:

1. **Fonts.** A font package in `home.packages` lands in the Nix store and macOS
   does not see it: CoreText reads font directories, not the Nix store. A
   symlink into `~/Library/Fonts` works only while the link survives.
   nix-darwin's `fonts.packages` owns this properly. It builds
   `/Library/Fonts/Nix Fonts` and installs real files there with
   `rsync --copy-links`, so every application sees the fonts and a rebuild
   replaces them.
2. **System settings.** `launchd` agents, the login window, software update,
   the SMB client, and per-user defaults belong to a system configuration.
   nix-darwin's `system.defaults` writes those domains through
   `launchctl asuser` for user preferences and `/Library/Preferences/...` for
   system preferences.

So the MacBook profile is `darwinConfigurations.macbook`: nix-darwin for the
system layer, Home Manager for the user layer, and Homebrew for the applications
that only exist as casks.

## Ownership split

Five owners keep state. Each owns one layer. No layer takes work from another.

| Layer | Owner | Owns | Never owns |
| --- | --- | --- | --- |
| Linux system | apt | Kernel, drivers, firmware, Docker, k3s, libvirt/qemu, system daemons, display stack | User CLI tools, user services |
| Files | stow | The configuration files in this repo, into `$HOME` | Package installs, services |
| Linux user packages | Nix (Home Manager) | CLI tools, language runtimes, systemd user units | Kernel-coupled packages, secrets |
| Mac system | nix-darwin | `system.defaults`, `fonts.packages`, launchd agents, macOS system settings | Application bundles, secrets |
| Mac applications | Homebrew | Applications, casks | Fonts, CLI formulae once Nix takes them (C02 decision) |

Consequences that shape every step:

- A package tied to the kernel, the driver, or the boot chain stays with apt.
  The Nix store must not provide a second kernel module tree.
- `stow` keeps the files. Nix keeps the packages. A Nix profile does not write
  dotfiles: it installs the binary, and `install.sh` runs it.
- `install.sh` does two things and no more: it bootstraps Nix when Nix is
  absent, and it runs `stow` for the repository's file packages. Every other
  install is a flake module, a Homebrew cask, or an apt package.
- A user service travels with its unit file. On Linux that is a systemd user
  unit from the `remote` profile; on the Mac it is a launchd agent from the
  `macbook` profile.
- `stow` itself comes from the Nix profile, so the topology is: bootstrap Nix,
  deploy the profile, then stow with the binary the profile provides.
- Fonts are a system concern, so they belong to nix-darwin on the Mac and to
  apt (or nothing) on the Linux hosts. They never come from Homebrew.

The per-area owner table from the audit (`audit-areas.md`, S01) is the evidence
for this split. Every audit area has exactly one owner: the `remote` profile, a
per-host step, or apt.

## What `install.sh` does

`install.sh` is a bootstrap script, not an installer. It has two roles:

| Role | Action | Why it is here |
| --- | --- | --- |
| 1. Bootstrap | Install Nix when `nix` is absent | Nothing else can install anything before Nix exists |
| 2. Stow | Run `stow` for the file packages | Files are not a package; `stow` only links them |

Everything else is owned by the flake or by Homebrew:

| Install | Owner | Example |
| --- | --- | --- |
| User CLI tools and runtimes | Nix (`home.packages`) | `herdr`, `rustup`, `bob`, `gh-dash`, npm globals |
| Pi extension dependencies | Nix, built by the same derivation | `npm ci` for the Pi plugins |
| Herdr plugins, Oh My Zsh, zsh plugins | Nix, as managed inputs | plugin trees and their versions |
| terminal-browser render settings | Nix, as a config file | `render.fps = 30` |
| User services | Nix (`systemd.user.services`, `launchd.agents`) | the eight units (S05, `nix/services`), the four agents |
| Fonts | nix-darwin (`fonts.packages`) | every font now installed by a Homebrew cask |
| macOS system settings | nix-darwin (`system.defaults`) | dock, Finder, trackpad, keyboard, login window |
| Applications and casks | Homebrew, from a documented `brew bundle` step | Ghostty, app casks |
| Kernel, drivers, Docker, k3s, libvirt | apt | the system layer from the audit |

Rules that follow:

1. `install.sh` contains no `brew bundle`, `curl | sh` installer, `npm install
   -g`, `cargo install`, `git clone`, or `herdr plugin install` once the flake
   lands. A reviewer can check that by reading the script.
2. `brew bundle` stays a separate documented command. A person runs it for
   casks and applications; `install.sh` does not.
3. A new tool arrives as a flake change, not as a new line in `install.sh`.
4. A deployed host is reproducible from the flake plus `stow`. The bootstrap is
   the only step that needs the network before Nix exists.

### The capture budget (learned the hard way)

`scripts/capture-macos-defaults.py` writes a curated set of domains by default:
the ones that define system behaviour (dock, finder, screencapture, keyboard and
trackpad, hot corners, menubar, universal access, and so on). `--all` still
captures every domain, but only for documentation.

The reason is a hard limit, not taste. nix-darwin inlines `system.defaults` into
the activation script, and Nix passes that script in the **builder's
environment**. macOS caps a process environment at `ARG_MAX` (1 MB). A
full capture produced a 1,256,749-byte activation script and 1,261,350 bytes of
environment, so every switch died at once with:

```
error: executing '/nix/store/…-bash-5.3p20/bin/bash': Undefined error: 0
```

`Undefined error: 0` is `E2BIG` surfacing badly. The curated capture emits about
37 KB of Nix and 228 KB of environment, and the system builds in seconds. The
script now refuses to emit a module above 200 KB and explains why.

## How macOS settings become Nix

The capture script turns the live Mac into a module, in one pass:

```sh
python3 scripts/capture-macos-defaults.py
# -> ~/.local/state/nix-fleet/macos-defaults-<date>/
#      domains/*.plist      redacted raw capture
#      nix/system-defaults.nix   a system.defaults module
```

The generated module uses `system.defaults.CustomUserPreferences` for each
captured user domain and `system.defaults.CustomSystemPreferences` for the
system domains. System attribute names are full plist paths
(`/Library/Preferences/com.apple.loginwindow`), because nix-darwin passes the
name straight to `defaults write` in a root activation; a bare domain would
land in root's user domain. That is the documented nix-darwin escape hatch for any domain
that has no typed option, so a captured setting has an owner on the first run
instead of waiting for a hand-written mapping.

The boundary, stated plainly:

| Value kind | In the Nix module? | Why |
| --- | --- | --- |
| bool, int, float, string, list, dict | yes | nix-darwin's preference value type |
| binary data (tokens, blobs) | no, and redacted in the capture | no plist-binary type in the option, and it is a secret |
| date and time values | no; recorded as a skipped key | the option type has no date |
| `-currentHost` preferences | yes, under the absolute `/Users/<owner>/Library/Preferences/ByHost/<domain>` path | nix-darwin writes its own `controlcenter` option the same way; an absolute path is used because a root activation would expand a tilde to root's home, and the per-machine UUID in the plist file name is not reproduced |
| credential-shaped keys | no; key path recorded in `redactions.txt` | secrets stay out of the store |

`scripts/capture-macos-defaults.py --nix-out <path>` writes the module
somewhere else. The default stays outside every repository, and a repository
path is refused unless `--allow-repo` is passed.

## Targets

The flake owns the target table (`fleet.targets`) and `scripts/nix-deploy` reads
it, so a new host is one entry and nothing else. `just targets` prints it.

| Target | Platform | Constructor | Attribute |
| --- | --- | --- | --- |
| `homelab` | x86_64-linux | Home Manager | `homeConfigurations.remote` |
| `devbox` | x86_64-linux | Home Manager | `homeConfigurations.remote-devbox` |
| `probe` | x86_64-linux | Home Manager | `homeConfigurations.remote-probe` |
| `mac` | aarch64-darwin | nix-darwin | `darwinConfigurations.macbook` |

An entry may name `managedUser` when the ssh login user is not the user the
profile manages: the devbox is dialled as `root` while its profile manages
`aviral`, so the deploy stages into that user's cache and switches through its
login shell.

### The target defaults to local

```sh
just deploy remote            # this machine
just deploy macbook           # this machine, the Mac profile
just deploy remote homelab    # another host, over ssh
just deploy remote devbox
just targets                  # what exists
```

`local` resolves by hostname against each entry's `localNames` (so `srv717581`
means the devbox), and falls back to the platform when no entry claims the
hostname. A typo stops before any work and prints the known targets.

## The deploy command

```sh
just deploy <profile> <target>
```

The flake lives at the repository root (`flake.nix`), with its module tree under
`nix/` and the in-repo `rataflow` crate as a locked path input. The flake sits at
the root because Nix refuses a path input that leaves the flake directory, and
the crate has to be part of the flake's own tree to be built by it.

| Path | Contents |
| --- | --- |
| `flake.nix`, `flake.lock` | inputs and the two profile outputs |
| `nix/lib/fleet.nix` | profile constructors, target-to-system map |
| `nix/modules/shared` | code every profile imports |
| `nix/modules/remote`, `nix/modules/remote/<host>.nix` | the shared Linux profile and its per-host deltas |
| `nix/modules/macbook` | nix-darwin system layer, Home Manager user layer |
| `nix/pkgs/rataflow-view.nix` | the crate as a package |
| `nix/darwin/system-defaults.nix` | generated; **not committed** (machine-private), regenerated by the deploy |

| Part | Meaning |
| --- | --- |
| `<profile>` | `remote` or `macbook` |
| `<target>` | the host to change: `homelab`, `devbox`, `mac`, or a name the flake maps to one of them |

The command works on the target itself and from another machine. A remote deploy
goes over SSH to a host the flake already knows. A local deploy needs no SSH.

Deploy rules (the contract S03 implements):

1. A deploy builds the profile for the target's system, then switches it.
   `remote` switches with `home-manager switch`; `macbook` switches with
   `darwin-rebuild switch`, which runs the system activation.
2. A failed build changes nothing. A failed switch leaves the previous
   generation active.
3. Rollback is one generation step back; the step that first switches a host
   records the exact command in its own artifact.
4. A deploy never touches apt packages, `stow` links, or Homebrew. Those keep
   their own entry points.
5. The MacBook switch needs `sudo` for the system activation. It is the only
   profile that does.

## MacBook scope

The definition of "reproduce the live MacBook" is a table, not prose: one row
per category, one capture command per row, and a status per row (`owned`,
Homebrew, or accepted gap). Until the mission lands that table lives in
`6_missions/dotfiles/nix-fleet/overview.md`; this repo keeps the capture script:

```sh
python3 scripts/capture-macos-defaults.py                 # capture plus Nix module
python3 scripts/capture-macos-defaults.py --dry-run       # list domains only
python3 scripts/capture-macos-defaults.py --out DIR --nix-out DIR/system-defaults.nix
```

## Secrets

No secret enters the repo or the Nix store. Name the file, never the value:

| Path | Rule |
| --- | --- |
| `~/.env` | name and mode only |
| `~/.ssh/id_*` | name only; `~/.ssh/config` contributes host names |
| `~/.config/pi-*.env` | name only |
| cloud-init `user-data.txt` | record path, mode, and hash |
| `tailscale.state`, `/etc/sudoers.d/*` | per-host; never copied |

A capture script must redact by key name before its output leaves the machine.
`scripts/capture-macos-defaults.py` follows that rule, and its Nix output is
built only from redacted values.

### The inventory and the 1Password target

`scripts/audit-secrets.py` answers the owner's question: which credentials exist
on this Mac, where do they live, and what should happen to each one?

```sh
python3 scripts/audit-secrets.py
# -> ~/.local/state/nix-fleet/secrets-audit-<date>/secrets-inventory.md
# -> .../secrets-inventory.json
```

What it records: file paths, modes, ages, key names, key counts, SSH key types
and fingerprints, launchd environment variable names, and a count of
credential-shaped shell history lines. What it never records: a value.

Duplicate detection uses a per-run HMAC fingerprint. Two files that hold the
same value share a digest inside one run, so the report can say "this value
appears in three places". The salt stays in memory, so a fingerprint cannot be
looked up later.

The report gives each asset one action:

| Action | Meaning |
| --- | --- |
| `move to 1Password` | the value belongs in a vault item, not in a file |
| `consolidate` | the same value appears in several places; keep one item |
| `chmod 600 then 1Password` | the file is also readable by group or other |
| `keep` | SSH key material, public halves, host lists, and configuration |

The target model:

| Credential | Home | Reference from a host |
| --- | --- | --- |
| API keys, tokens, bot tokens, webhooks | 1Password item per service | `op run --env-file=.env.1p` or `op inject -i template` |
| SSH private keys | stay in `~/.ssh`, never copied | agent or file; passphrase in 1Password |
| Keychain items | login keychain | macOS reads them; the audit lists them for manual review |
| gcloud application default credentials | 1Password, then `gcloud auth application-default login` | no file in the repo |

A repo may hold a template (`*.env.example`) with names and no values. A working
file (`*.env`) stays outside the repo.

Two things stay manual on purpose, because they need the owner at the keyboard:
`security dump-keychain` (asks for the keychain password) and `op item list`
(needs the account password and MFA). The audit records their state and prints
the exact commands instead of running them.

## The three uv venvs (S05 decision)

The daemons' third-party Python dependencies live in `uv`-built venvs under
`~/.local/share/<name>/.venv`, not in the system interpreter (PEP 668-managed)
and not as Nix Python packages. One method covers all three:

| Venv | Contents | Rebuild |
| --- | --- | --- |
| `~/.local/share/pi-stt/.venv` | faster-whisper, ctranslate2, onnxruntime, NVIDIA CUDA wheels (compiled `requirements.txt` next to it) | `uv venv --python 3.13 .venv && uv pip install -r requirements.txt` |
| `~/.local/share/pi-telegram/.venv` | telethon | `uv venv --python 3.13 .venv && uv pip install telethon` |
| `~/.local/share/pi-telegram-voice/.venv` | same stack as pi-stt | same as pi-stt |
| `~/.local/share/pi-whatsapp/.venv` | cryptography (added in S05 when the system pip install that used to satisfy it disappeared) | `uv venv --python 3.13 .venv && uv pip install cryptography` |

Why not Nix: `pi-stt` pins NVIDIA wheel libraries that must match the host's
apt-owned NVIDIA driver; building that stack inside Nix would duplicate the GPU
runtime and fight the driver. Why not pip: PEP 668. `uv` itself is owned by the
profile (`home.packages`), so the tool that builds the venvs is Nix-managed;
the venvs are host state, like the 1Password items.

## Fences

1. Ubuntu stays on the homelab and the devbox. Nix is not NixOS.
2. No secret, token, or SSH material in the repo or the Nix store.
3. `ops/packer` and the devbox AMI stay as they are.

## Where the evidence lives

| Question | File |
| --- | --- |
| Which area belongs to which owner? | mission `audit-areas.md`, S01 table |
| What does the MacBook scope cover? | mission `overview.md` scope table |
| What does a step change and prove? | mission `artifacts/<attempt>/step-NN.md` |
| How does a deploy roll back? | the homelab switch artifact (S04) |

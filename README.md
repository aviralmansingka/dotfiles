# Dotfiles

Development environment configuration for macOS and AWS devbox (Ubuntu), managed with [GNU Stow](https://www.gnu.org/software/stow/).

- **ghostty** - GPU-accelerated terminal emulator
- **zsh** - Shell with Oh My Zsh, Powerlevel10k, and plugins
- **tmux** - Terminal multiplexer with Catppuccin theme and TPM
- **neovim** - LazyVim distribution with AI coding assistance
- **aerospace** - Tiling window manager for macOS
- **starship** - Cross-shell prompt
- **herdr** - Agent-aware terminal multiplexer used by Neovim Sidekick
- **gh-dash** - GitHub dashboard with Herdr pull-request worktree integration
- **omarchy** - User theme overrides for Omarchy/Hyprland

## Setup

### Option A: macOS (local)

```sh
git clone https://github.com/aviralmansingka/dotfiles ${HOME}/dotfiles
cd ${HOME}/dotfiles/
./install.sh
```

The script installs dependencies via Homebrew, deploys configurations with `stow`, sets up shell plugins, and installs Neovim via `bob`.

For manual installation:

```sh
brew bundle
gh extension install dlvhdr/gh-dash
stow nvim tmux zsh ghostty git starship gh-dash tuicr agents pi herdr launchd
```

On Linux (systemd) systems, deploy the user services with:

```sh
stow systemd
```

On Omarchy systems, deploy the user Omarchy theme overrides with:

```sh
stow omarchy
```

For a minimal setup without agent tooling, omit `agents` and `pi`.

### Option B: AWS Devbox

A fully provisioned Ubuntu 24.04 EC2 instance with all tools pre-installed. AMIs are built with Packer and the instance is managed with Terraform.

**Prerequisites:** AWS credentials configured, Terraform installed, an SSH key pair.

```sh
cd ops/devbox
terraform init
terraform apply \
  -var="devbox_enabled=true" \
  -var="ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"
```

Then SSH in:

```sh
ssh aviralmansingka@$(terraform -chdir=ops/devbox output -raw devbox_public_ip)
```

The devbox comes with: zsh + Oh My Zsh, tmux + TPM, Neovim via bob, Rust toolchain, Go, Node.js, Python, kubectl, k9s, lazygit, Claude Code, and all dotfiles stowed.

To tear down:

```sh
terraform -chdir=ops/devbox destroy \
  -var="devbox_enabled=true" \
  -var="ssh_public_key=$(cat ~/.ssh/id_ed25519.pub)"
```

## Stow Packages

| Package      | Description                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| `aerospace`  | AeroSpace tiling window manager                                             |
| `agents`     | Shared agent skills                                                         |
| `blinksh`    | Blink Shell (iOS terminal) config                                           |
| `claude`     | Claude AI context files                                                     |
| `code`       | Code snippets (Golang, Lua)                                                 |
| `ghostty`    | Ghostty terminal emulator                                                   |
| `gh-dash`    | GitHub dashboard config and PR worktree launcher                            |
| `herdr`      | Agent workspaces, notifications, and sound configuration                    |
| `git`        | Git configuration                                                           |
| `kube`       | Kubernetes configuration                                                    |
| `launchd`    | macOS user LaunchAgents (vault and dotfiles auto-sync)                      |
| `neovide`    | Neovide (Neovim GUI) config                                                 |
| `nvim`       | Neovim with LazyVim                                                         |
| `omarchy`    | User Omarchy theme overrides                                                |
| `starship`   | Starship prompt                                                             |
| `systemd`    | User systemd units (vault/dotfiles auto-sync, Pi/WhatsApp/Telegram bridges, flight check-in reminders) |
| `pi`         | Pi agent config, packages, themes, and messaging daemons                    |
| `terminfo`   | Custom terminfo entries                                                     |
| `tmux`       | Tmux configuration                                                          |
| `tmuxinator` | Tmuxinator session templates                                                |
| `tuicr`      | Terminal pull-request review configuration                                  |
| `zsh`        | Zsh shell configuration                                                     |

## gh-dash PR worktrees

The stowed gh-dash config resolves `owner/repo` to `/Users/aviral/:repo`. In the pull-request view, press `O` to
check out the selected PR as `pr/<number>` in a Herdr worktree, focus it, and start tuicr in the new worktree.
Pressing `O` again focuses the existing workflow-owned worktree; a conflicting local branch is left untouched.

## Herdr server handoff

When replacing a Herdr server from a Codex tool subprocess, run:

```sh
herdr-clean-handoff
```

This performs a live handoff, preserving the repository workspace, exact worktree pane, and resumed Codex session.
It removes Codex's inherited `NO_COLOR` only from the replacement Herdr server; the invoking process and its other
subprocesses keep their existing environment.

## Git auto-sync services

The shared implementation is `scripts/auto-git-sync`. It fetches and merges the remote branch before committing local edits, then asks Pi to resolve Git conflict files if a merge or stash apply leaves conflicts.

Manage Linux user services:

```sh
systemctl --user daemon-reload
systemctl --user enable --now vault-auto-sync.service dotfiles-auto-sync.service
systemctl --user status vault-auto-sync.service dotfiles-auto-sync.service
```

Manage macOS user agents:

```sh
stow launchd
launchctl bootstrap "gui/$UID" ~/Library/LaunchAgents/com.aviral.vault-auto-sync.plist
launchctl bootstrap "gui/$UID" ~/Library/LaunchAgents/com.aviral.dotfiles-auto-sync.plist
launchctl print "gui/$UID/com.aviral.vault-auto-sync"
launchctl print "gui/$UID/com.aviral.dotfiles-auto-sync"
```

## Pi agent

Pi config and shared skills are deployed with:

```sh
stow pi agents
```

The shared `vault` skill supports explicit project and knowledge-base lookup, note summaries, project overviews, and
Wayfinder overviews. It preserves the vault's Project → Theme → Feature → Task ontology without installing an
execution workflow. Neovim's `<leader>vf` picker remains a read-only navigation surface for active vault work.

The checked-in Pi config intentionally excludes `auth.json`, sessions, caches, and runtime state. MCP credentials should be provided out of band.

Install/update Pi packages and the local web-fetch dependencies:

```sh
cd ~/.pi/agent/npm && npm install
cd ~/.pi/agent/extensions/web-fetch && npm ci --ignore-scripts
```

Pi surfaces No Mistakes runs in the shared activity widget without replacing the attached TUI. See the
[interactive-subagents status documentation](pi/.pi/agent/extensions/interactive-subagents/README.md#status-widget--configuration)
for display, scoping, and fallback behavior.

In Herdr-backed TUI sessions, an active Pi UI prompt reports the agent as blocked until the prompt closes, so
Sidekick shows that Pi is waiting for user input.

For Pi over WhatsApp, copy `~/.config/pi-whatsapp.env.example` to `~/.config/pi-whatsapp.env`, fill in the allowed chat IDs, then enable the user services:

```sh
systemctl --user daemon-reload
systemctl --user enable --now whatsapp-bridge.service pi-whatsapp.service
```

For Pi over Telegram, create a bot with `@BotFather`, copy `~/.config/pi-telegram.env.example` to `~/.config/pi-telegram.env`, fill in the bot token and allowed chat IDs, and set `PI_TELEGRAM_PREFIX=` if you want normal prefixless chat. Telegram replies default to `openai-codex/gpt-5.6-luna:high` via `PI_TELEGRAM_MODEL`, with `PI_FAST_MODE=1` selecting the priority service tier; `PI_TELEGRAM_TYPING_INTERVAL_SECONDS` controls the typing indicator refresh while Pi is generating. Photos/screenshots and image documents are downloaded and passed to Pi as image attachments; captions follow the existing prefix rules, while bare images are accepted. `PI_TELEGRAM_MAX_IMAGE_BYTES` (default 10 MiB) caps the accepted size. Then enable the user service:

```sh
systemctl --user daemon-reload
systemctl --user enable --now pi-telegram.service
```

The `flight-checkin-reminders.timer` user unit (every 12h) scans Gmail for upcoming flight check-in windows via Pi and sends Telegram reminders. It runs `%h/vault/scripts/flight-checkin-reminders.py` through an explicit `/usr/bin/python3` because the vault checkout does not guarantee the executable bit; direct execution fails with `status=203/EXEC`. Enable it with `systemctl --user enable --now flight-checkin-reminders.timer`.

Retired reminder timers, kept out of the tracked units on purpose:

- `honeymoon-message-drafts.timer` — built for the July 2026 honeymoon message plan; the trip is over, so the live unit was retired (see the disable/remove commands in the PR that tracked these notes).
- `aug18-trip-flight-reminder.timer` — its script self-disables after its 2026-08-18 cutoff; remove the live unit after that date.

## Infrastructure

AMIs and cloud infrastructure are managed in `ops/`:

- **Packer** (`ops/packer/`) - Builds Ubuntu 24.04 devbox AMIs with full development toolchain
- **Terraform** (`ops/terraform/`) - Manages shared AWS infrastructure (IAM, DNS, GitHub OIDC)
- **Devbox** (`ops/devbox/`) - Manages the devbox EC2 instance

CI/CD workflows automatically build AMIs and apply infrastructure changes on push to `main`.

## LICENSE

Copyright (c) 2012-2022 Scott Chacon and others

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

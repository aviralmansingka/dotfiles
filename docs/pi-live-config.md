# Pi live configuration

`~/.pi/agent` is the runtime, not a second dotfiles checkout. Deploy extensions
from one checkout (normally `~/dotfiles`); do not restow from a review worktree.
Node 20+ and Git are enough for the scripts below. Stow is needed for deployment.

## Settings: shared base, local preferences

Pi **1.1.0 has no user-local settings overlay**. Its installed `docs/settings.md`,
`docs/cli.md`, and `docs/configuration.md` describe agent-directory
`settings.json` plus trusted project `.pi/settings.json`. `--local` means
*project*, and `PI_CODING_AGENT_DIR` relocates the whole agent directory, not an
overlay. A project override would not apply to every invocation.

- `pi/.pi/agent/settings.json`: versioned shared packages and extensions only.
- `~/.pi/agent/settings.local.json`: un-stowed host preferences/overrides.
- `~/.pi/agent/settings.json`: materialized, real runtime file; Pi may update it.

`pi/.stow-local-ignore` excludes the base from Stow. Run from the deployed checkout:

```sh
# Before Stow, create real .pi/agent directories and capture existing preferences.
./scripts/pi-settings-sync
stow pi agents
./scripts/pi-extensions-drift-check
```

On first run, sync captures live settings that differ from the base. This keeps
`lastChangelogVersion`, provider/model/thinking defaults, `enabledModels`,
`defaultTools`, theme, TUI, transport, and `hideThinkingBlock` local. On this host,
`-builtin:mcp` also stays local: it disables Pi's built-in MCP in favor of the
installed adapter. The base retains main's two explicitly enabled extensions.

Later runs use the saved local file. Edit it directly, then sync. After changing
settings inside Pi or running `pi install/remove/config`, **capture before the
next sync** so those changes are not reset:

```sh
./scripts/pi-settings-sync --capture
```

Stop Pi writers while syncing; restart or `/reload` afterward. Existing files
are backed up as `settings*.json.backup-<time>-<pid>` (mode 0600). Replacement is
atomic and replaces a settings symlink itself, never its repository target.
An already folded `.pi` or `agent` directory is rejected: first preserve its
contents in a real directory instead of writing through it. Backups are local;
remove old ones yourself after checking them.

Resource arrays (`extensions`, `packages`, `skills`, `prompts`, `themes`) combine
base first, local last, with duplicate values removed. Capture stores only local
resource additions, not a frozen copy of the shared list. Use Pi's `-path`
exclusions to disable a shared extension locally; removing a shared package
requires changing the base. Other keys replace the base at the **top level**;
there is deliberately no custom recursive merge. `--capture` treats the current
live file as authoritative for local preferences, including deletions. It is not
a three-way merge: after changing the shared base, do an ordinary sync first,
not a capture of an old runtime resource list.

Both scripts accept `--agent-dir PATH` (default `$PI_CODING_AGENT_DIR` or
`~/.pi/agent`). Settings sync's `--repo PATH` defaults to its own checkout;
the drift check defaults to **`~/dotfiles`**, because that is the deployed target.
To review a worktree without deploying it, use an isolated temporary agent dir.

## Extension drift check

```sh
./scripts/pi-extensions-drift-check --repo "$HOME/dotfiles"
```

Quiet exit 0 means clean; exit 1 prints drift or an operational error. The checker
uses `git ls-files`, not generated `node_modules`, and checks every tracked
extension path (except Stow-ignored `.gitignore`). A correct folded directory
symlink covers its descendants. Relative and absolute links to the same target
are equivalent; usual links look like
`../../../dotfiles/pi/.pi/agent/extensions/run-command`.

It reports missing paths, broken/wrong symlinks, real files or directories
shadowing repository paths, and unrecognized local entries. Even a currently
complete real extension directory is reported: it can hide new files on the next
pull, as happened when `run-command/render.ts` was absent. This deliberately
flags Stow's unfolded extension directories too; prefer folded extension links.
A real **container** `extensions/` is fine.

Example from the current host (both directories presently have linked children):

```text
Pi extension/config drift (/home/avirus/dotfiles -> /home/avirus/.pi/agent):
  MISSING: extensions/lesson.test.mjs
  MISSING: extensions/md-log.test.mjs
  REAL directory: extensions/no-mistakes-pane
  MISSING: extensions/nvim-open.test.mjs
  MISSING: extensions/quiz-result.test.mjs
  REAL directory: extensions/user-input
```

The script does not repair anything. Inspect differences and preserve local
contents **outside `extensions/`** before replacing a shadowing entry with the
correct symlink; otherwise Pi may load the backup as another extension. Do not
use `stow --adopt`: that imports mutable runtime files into the repository.

### Deliberate local ownership

The checker only validates deployment targets **inside extensions**. Its
agent-root inventory allows tracked root entries plus the following runtime
entries; allowlisting never hides a broken root symlink:

| Entries | Why local / outside extension checks |
| --- | --- |
| `auth.json`, `models.json`, `models-store.json`, `trust.json` | Credentials, host model catalog, project trust |
| `settings*` | Generated settings, override, backups and transient writes |
| `mcp.json`, `mcp-*.json` | Server config/adapter config, auth/cache/onboarding state |
| `npm/`, `node_modules/`, `git/` | Pi package-manager state and installed dependencies |
| `install/`, `bin/` | Managed Pi releases and downloaded helper executables |
| `sessions/`, `logs/`, `pi-crash.log` | Session history and diagnostics |
| `themes/`, `skills/` | Theme/skill resources, not extensions (some are stowed) |
| `scheduled-whatsapp/`, `pi-whatsapp-state.json`, `pi-telegram-state.json` | Local messaging jobs and cursors; scheduled directory reserved, not currently present |
| `tirupati-*-watch.json` | Existing personal reminder state |
| `.gitignore` | Pi-generated runtime ignore files |

Inventory found **no local-only extensions**. Unknown extension basenames fail
closed. If you deliberately install one outside the repository, record why in
this table/runbook and pass `--allow-local NAME` (repeatable). That option cannot
exempt a repository-owned extension or a broken symlink. No blanket `.ts` or
directory exemption exists.

## Runtime files: templates, not commits

MCP configuration and Pi's npm manifest/lockfile are **fully local-owned**:

- `mcp.json.example` retains the reusable server definitions without credentials;
  adjust host paths and supply its external environment file yourself.
- `npm/package.json.example` seeds the adapter dependency. `npm install` generates
  the local lockfile; a 3,400-line runtime lockfile is not a useful template.
- Live `mcp-adapter.json` (adapter) and `mcp.json` (built-in Pi MCP) are different
  files. This host uses the adapter and disables `builtin:mcp`; do not enable
  both against the same servers unintentionally.

There is no runtime-to-Git sync script. Ignoring and untracking these mutable,
host-specific files avoids accidental endpoint/credential commits and npm churn.
Both Git and Stow ignore them, even when old copies remain in a checkout.
The web-fetch extension's own package/lockfile stays tracked: it is source-owned,
not Pi's runtime package-manager state.

### One-time migration of old live links

**Before updating a deployed checkout that still owns these files**, preserve
live symlink contents as real files. Do this with Pi/package-manager writers
stopped. These commands change only the live entries, never their old targets:

```sh
for file in "$HOME/.pi/agent/mcp.json" "$HOME/.pi/agent/mcp-adapter.json" \
            "$HOME/.pi/agent/npm/package.json" "$HOME/.pi/agent/npm/package-lock.json"; do
  if [ -L "$file" ]; then
    tmp=$(mktemp "${file}.local.XXXXXX") || exit 1
    if cp -L "$file" "$tmp"; then
      chmod 600 "$tmp"
      mv -f "$tmp" "$file"
    else
      rm -f "$tmp"
      echo "Cannot preserve $file; recover its target before updating" >&2
      exit 1
    fi
  fi
done
```

Then update your deployed checkout normally, resolve any old tracked runtime
copies using your preserved live files, run settings sync, and restow. Ignoring
files does not itself detach old symlinks or remove existing tracked changes.
Do not stash/adopt runtime drift as the normal sync workflow.

Fresh setup (never overwrite existing live config):

```sh
mkdir -p ~/.pi/agent/npm
[ -e ~/.pi/agent/mcp-adapter.json ] || cp pi/.pi/agent/mcp.json.example ~/.pi/agent/mcp-adapter.json
[ -e ~/.pi/agent/npm/package.json ] || cp pi/.pi/agent/npm/package.json.example ~/.pi/agent/npm/package.json
(cd ~/.pi/agent/npm && npm install)
```

The former root `professor_feedback.md` contains real product/teaching requests,
not machine config. Its snapshot is preserved in [professor-feedback.md](professor-feedback.md).
The old scratch filename is ignored; promoting feedback into product behavior is
separate work. Migration does not modify or delete another checkout's notes.

## Checks

```sh
./scripts/pi-settings-sync --help
./scripts/pi-extensions-drift-check --help
node scripts/test-pi-live-config.mjs  # isolated settings/drift/Stow fixtures
./scripts/pi-extensions-drift-check
timeout 120 pi -p "Reply with just OK"
```

# repo-config CI tests

## Purpose

`scripts/test-repo-config.py` guards the repository configuration
files. Each check reproduces a failure that already occurred. The suite
runs offline, never changes `$HOME`, and never uses the network.

## What the suite covers

- **X7 Skill frontmatter.** Every tracked `agents/.agents/skills/**/SKILL.md`
  parses as YAML. The fields `name` and `description` are not empty. An
  unquoted colon made the nvimr skill invisible to agents (#203).
- **X8 install.sh and stow.** Every `stow` line names a top-level
  directory that exists (#197). Every stow-shaped directory has a stow
  line or an entry in the `STOW_GAP_ALLOWLIST` constant (#197, #201).
  No `rm -f` line removes binaries that nothing installs (#117).
  Optional steps keep their `command -v` guards and `|| true` (#199).
- **X8b gh-dash shape.** `gh-dash/.config/gh-dash/config.yml` parses as
  YAML. The keybindings live in the `prs` scope. A universal binding
  crashes gh-dash on `PrNumber` (#199). Keys stay unique and template
  fields exist. Every command word names a repository helper or a
  Brewfile pin, and the tuicr binding stays on key `C`.
- **X12 markdownlint.** `AV001` wraps at 80 columns and matches the nvim
  wrap guide (#238). When the `markdownlint-cli2` binary exists, the
  suite fixes a fixture: every line shows at most 80 visible columns,
  and long link destinations stay untouched. Without the binary, the
  suite prints SKIP and passes.
- **X13 config invariants.** `pi/.pi/agent/settings.json` holds valid
  JSON, sets `markdown.codeBlockIndent` to `""` (#166), and lists only
  extensions that exist on disk. The Claude settings hold valid JSON
  and name no removed profiles and no `/home/<user>` paths (#8, #9).
  The herdr config parses as TOML and keeps only vendored keys
  (#156-#158). Every `dependencies.json` pin is in the Brewfile (#212).

## How to run

Run `./scripts/test-repo-config.py`. The suite prints one PASS, FAIL,
or SKIP line per finding; every FAIL names the file and the reason. It
exits non-zero when any check fails. It needs `git`, Python 3.11 or
newer (`tomllib`), and PyYAML or ruby for YAML. It never pip-installs.

## Runtime and SLA

Reruns give the same result. One run takes less than one second; the
budget is 30 seconds. The suite removes every temporary directory.

## Coverage result

Checked: the files listed above, plus the Brewfile and the three
`.stow-local-ignore` files. Out of scope, with the reason:

- Workflow YAML. The workflow-lint lane owns it (X9).
- nvim Lua, lock files, and Lazy config: the nvim smoke lane (X11).
- pi keybindings, themes, and extension `package.json`: the extension
  loader smoke (A3). `mcp.json.example` is a host template.
- App-owned configs with no proven drift class: starship, neovide,
  tuicr, hunk, lazygit, k9s skins, tmuxinator, stylua. The herdr
  config is the exception (#156-#158).
- `package-lock.json`. Its tool manages it. (`skills-lock.json` was
  removed with the B22 skills-store fix; the repo-parity suite owns
  the returning-lockfile contract.) Markdown bodies and `.lavish`
  artifacts are not configuration.

## Known gaps

Four stow-shaped directories have no `stow` line in `install.sh`:
`claude/`, `kube/`, `tmuxinator/`, and `neovide/`. CLAUDE.md stows
`kube` and `tmuxinator` manually, and a plan document stows `claude`;
README lists neither. The suite records the four in
`STOW_GAP_ALLOWLIST` and fails when a new directory joins.

Dry-run evidence for the claude decision: a simulated `stow claude`
against an empty home plans one symlink and exits 0. Against a home
with a real `~/.claude/settings.json` file, it conflicts and exits 1.
On such a machine, `set -e` aborts `install.sh`. The captain must
decide: stow these four packages, keep them manual, or delete them.

Two more gaps stay open. The gh-dash `C` binding overrides a gh-dash
default key on purpose, so the suite does not compare keys against the
full default set. The herdr allow-list is vendored; the binary checks
the full schema on the host only.

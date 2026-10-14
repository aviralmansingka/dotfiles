# repo-parity CI tests

## Purpose

`scripts/test-repo-parity.py` guards the skills store and the user
docs. Each check reproduces a failure class that already occurred. The
suite runs offline and never changes `$HOME`.

## Overview

Two drift findings started this suite. The docs said 15 stow
packages, but `install.sh` stowed about 13 (PR #11, prs-02). A Claude
hook ran a script that did not exist (ses-A; the claude package itself
was later removed in the Claude Code uninstall). This audit found two
more items of the same class. The Known gaps section records all
four items.

## What the suite covers

- **P1 skills store parity.** Every tracked skill dir under
  `agents/.agents/skills/` keeps `name` equal to its dir name. The
  Claude Code exposure layers (the `.claude/skills` project farm, the
  `claude/.claude/skills` stowed farm, and `skills-lock.json`) were
  removed together with the claude stow package when Claude Code was
  uninstalled from every host (B22: the captain's skill audit had
  already deleted the mattpocock bundle the farm pointed at). The
  lockfile must not return, tracked or on disk; vendor skills into
  `agents/.agents/skills/` instead.

(The P2 claude hook-resolution check was removed together with the
claude stow package in the Claude Code uninstall; the P3 notion-cli
behavior matrix was removed with `pi/bin/notion-cli` in the dead-code
cleanup.)
- **P4 docs accuracy.** For `README.md`, `AGENTS.md`, and
  the tracked top-level `docs/*.md`: the README stow table lists every
  top-level dir except 5 exempted non-package dirs. A claim of the
  form "N stow packages" must equal the table count, and every
  `stow <pkg>` mention, repo-anchored path, and link target resolves.
- **P5 negative sandbox.** A synthetic passing skills sandbox and
  the real README pass first. The suite then applies 7 mutations
  (2 skills-store, 5 docs) and proves that the matching check catches
  each one.

## How to run

Run `./scripts/test-repo-parity.py`. Every FAIL names the file and the
reason. The suite exits non-zero when any check fails. It needs `git`
and Python 3.11 or newer, and installs nothing. (Backticked
f-string syntax in the companion repo-config suite needs 3.12+; the
CI runners provide it.)

## Runtime and SLA

The run takes less than 1 second. The SLA is 30 seconds.

## Coverage result

Checked: the `.claude/skills/` and `claude/.claude/skills/` symlink
farms; the 11 tracked skill dirs; the settings files
`claude/.claude/settings.json` and `.claude/settings.local.json`;
the core docs and the tracked top-level `docs/*.md`.
Out of scope: `docs/adr/`, `docs/agents/`, `docs/contracts/`,
`docs/evidence/`, and `docs/superpowers/` are dated historical
records. `docs/ci-tests/` and the untracked new docs are work in a
shared tree. `BACKLOG.md`, `BUGS.md`, and `CONTEXT.md` are notes.
The sibling suite `scripts/test-repo-config.py` owns the Brewfile,
the dependency pins, `install.sh`, and the `/home/<user>` scan.

## Known gaps

- A returning external skills fetch tool stays out of scope: the
  suite only proves that whatever lands in the tree satisfies the
  parity contract above (tracked, resolvable, name==dirname).

Resolved with the B22 fix: the lockfile, the fetch tool reference,
and the 8 dangling symlinks are gone; the hook `herdr-agent-state.sh`
was removed from the settings (the script never existed on any
audited host); and the `stow ssh` doc drift was corrected (this repo
never shipped an ssh package - the SSH config is host-side and needs
nothing from the repo).
- `AGENTS.md` and a `tmux/.tmux.conf` comment both claim `prefix+o`.
  The plugin that owns the binding is machine-installed, so the tree
  cannot show which claim holds.

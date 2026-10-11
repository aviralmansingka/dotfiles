# repo-parity CI tests

## Purpose

`scripts/test-repo-parity.py` guards the skills store (the
`.claude/skills` symlink farm and, if it ever returns, the skills
lockfile), the Claude hook references, and the user docs.
Each check reproduces a failure class that already occurred. The
suite runs offline and never changes `$HOME`.

## Overview

Two drift findings started this suite. The docs said 15 stow
packages, but `install.sh` stowed about 13 (PR #11, prs-02). A Claude
hook ran a script that did not exist (ses-A). This audit found two
more items of the same class. The Known gaps section records all
four items.

## What the suite covers

- **P1 skills store parity.** Every tracked skill symlink
  (`.claude/skills/<name>` project-level and
  `claude/.claude/skills/<name>` stowed) points at the documented
  relative target and resolves to a tracked, in-tree skill dir under
  `agents/.agents/skills/` - no dangling entries anywhere. Every
  tracked skill dir keeps `name` equal to its dir name.
  `skills-lock.json` was removed with the dangling mattpocock-bundle
  symlinks (B22: the captain's skill audit deleted the bundle, the
  fetch tool was referenced nowhere, and the 8 symlinks resolved
  nowhere - repo, host, or tool). If a lockfile ever returns it must
  carry full lock<->symlink<->target parity with zero dangling or
  untracked targets, and an untracked leftover on disk fails too.
- **P2 Claude hooks resolve.** Every hook command in the tracked
  `.claude/settings*.json` files that names a script path resolves
  to a tracked file or to an `EXTERNAL_HOOK_ALLOWLIST` entry. A
  `$HOME/...` reference resolves through the `claude` stow package.
  No config holds an absolute `/Users/<user>` path.

(The P3 notion-cli behavior matrix was removed together with
`pi/bin/notion-cli` in the dead-code cleanup.)
- **P4 docs accuracy.** For `README.md`, `CLAUDE.md`, `AGENTS.md`, and
  the tracked top-level `docs/*.md`: the README stow table lists every
  top-level dir except 5 exempted non-package dirs. A claim of the
  form "N stow packages" must equal the table count, and every
  `stow <pkg>` mention, repo-anchored path, and link target resolves.
- **P5 negative sandbox.** A synthetic passing lockfile sandbox, the
  real settings, and the real README pass first. The suite then
  applies 16 mutations (8 skills-store, 3 hooks, 5 docs) and proves
  that the matching check catches each one.

## How to run

Run `./scripts/test-repo-parity.py`. Every FAIL names the file and the
reason. The suite exits non-zero when any check fails. It needs `git`
and Python 3.11 or newer, and installs nothing.

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

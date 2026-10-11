# repo-parity CI tests

## Purpose

`scripts/test-repo-parity.py` guards the skills lockfile, the Claude
hook references, the `notion-cli` error paths, and the user docs.
Each check reproduces a failure class that already occurred. The
suite runs offline and never changes `$HOME`.

## Overview

Two drift findings started this suite. The docs said 15 stow
packages, but `install.sh` stowed about 13 (PR #11, prs-02). A Claude
hook ran a script that did not exist (ses-A). This audit found two
more items of the same class. The Known gaps section records all
four items.

## What the suite covers

- **P1 skills-lock parity.** `skills-lock.json` parses, sets version
  1, and gives every entry a source, a sourceType, a skill path, and
  a 64-character hash. Every locked skill has a tracked symlink with
  the documented target and a lock entry. Every tracked skill dir
  keeps `name` equal to its dir name, and no dir is also locked.
- **P2 Claude hooks resolve.** Every hook command in the tracked
  `.claude/settings*.json` files that names a script path resolves
  to a tracked file or to an `EXTERNAL_HOOK_ALLOWLIST` entry. A
  `$HOME/...` reference resolves through the `claude` stow package.
  No config holds an absolute `/Users/<user>` path.
- **P3 notion-cli behavior.** `pi/bin/notion-cli` answers 10 offline
  subtests: `--help`, argparse errors, a missing token, a bad id, a
  bad `--body`, and a dead local proxy port that stubs the network
  boundary. Every error path prints one clean message, and no path
  prints a traceback. No subtest makes a real call.
- **P4 docs accuracy.** For `README.md`, `CLAUDE.md`, `AGENTS.md`, and
  the tracked top-level `docs/*.md`: the README stow table lists every
  top-level dir except 5 exempted non-package dirs. A claim of the
  form "N stow packages" must equal the table count, and every
  `stow <pkg>` mention, repo-anchored path, and link target resolves.
- **P5 negative sandbox.** Sandbox copies of the real lockfile, the
  real settings, and the real README pass first. The suite then
  applies 13 mutations (5 lock, 3 hooks, 5 docs) and proves that the
  matching check catches each one.

## How to run

Run `./scripts/test-repo-parity.py`. Every FAIL names the file and the
reason. The suite exits non-zero when any check fails. It needs `git`
and Python 3.11 or newer, and installs nothing.

## Runtime and SLA

The run takes less than 1 second. The SLA is 30 seconds.

## Coverage result

Checked: `skills-lock.json`; the 8 `.claude/skills/` symlinks; the 11
tracked skill dirs; the settings files `claude/.claude/settings.json`
and `.claude/settings.local.json` (no hooks); the core docs and the
15 tracked top-level `docs/*.md`; `pi/bin/notion-cli`.
Out of scope: `docs/adr/`, `docs/agents/`, `docs/contracts/`,
`docs/evidence/`, and `docs/superpowers/` are dated historical
records. `docs/ci-tests/` and the untracked new docs are work in a
shared tree. `BACKLOG.md`, `BUGS.md`, and `CONTEXT.md` are notes.
The sibling suite `scripts/test-repo-config.py` owns the Brewfile,
the dependency pins, `install.sh`, and the `/home/<user>` scan.

## Known gaps

- The lockfile's fetch tool stays external. The suite cannot prove
  that the 8 fetched dirs exist on a host.
- The hook `herdr-agent-state.sh` stays allowlisted and dangling. The
  captain must track the script or remove the hook.
- The `stow ssh` doc drift stays allowlisted. The captain must fix
  the docs or add the package.
- `AGENTS.md` and a `tmux/.tmux.conf` comment both claim `prefix+o`.
  The plugin that owns the binding is machine-installed, so the tree
  cannot show which claim holds.
- The suite tests `notion-cli` error paths only. It never calls
  the Notion API.

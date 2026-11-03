Remove the `fix-code` instrument from the professor skill and remove the `remote` extension from this dotfiles repo. Work only in this worktree. Do not touch unrelated uses of the word "remote" (git remotes, cleanup.ts, devbox infra, README terraform).

## Scope A — delete the remote extension (files, wiring, docs)

1. Delete `pi/.pi/agent/extensions/remote.ts`.
2. Delete `pi/.pi/agent/extensions/remote.test.mjs`.
3. Delete `docs/ci-tests/remote.md`.
4. `pi/.pi/agent/settings.json`: remove the single line `"+extensions/remote.ts",` from the `extensions` array. Keep valid JSON and all other entries.
5. `AGENTS.md`: delete the whole section `## Remote subagents on devbox` (starts at that heading, ends before `## Homelab STT and the RTX 3060`). Do not leave a stray blank line or orphan prose.
6. `docs/ci-tests/README.md`: delete the table row `| Remote subagent | remote.test.mjs | ... | 0.3 s |` from the per-component coverage table. Leave the rest of the table intact.
7. Confirm nothing else references `extensions/remote.ts`, `/remote`, `remote.test.mjs`, or `docs/ci-tests/remote.md`. Check at minimum `pi/.pi/agent/settings.json`, `pi/.pi/agent/agents/`, `pi/.pi/agent/extensions/interactive-subagents/agents/`, `install.sh`, `scripts/`, `.github/workflows/`, and `docs/`. The `/remote` slash command must no longer be registered anywhere.

## Scope B — remove fix-code from the professor skill

File: `agents/.agents/skills/professor/SKILL.md` (this is the stow source; do not edit `~/.agents`). Six edit sites:

1. Teach loop step 4 (`**Verify.**`): change "one of the four interaction types below — `quiz`, `explain`, run-command, or fix-code" to "one of the three interaction types below — `quiz`, `explain`, or run-command".
2. `## Interaction types` intro: change "Four assessment instruments serve different jobs." to "Three assessment instruments serve different jobs." Change "Reserve run-command and fix-code for the **Teach loop proper**" to "Reserve run-command for the **Teach loop proper**". Change "Teach mixes all four assessment instruments per node." to "Teach mixes all three assessment instruments per node."
3. Delete the whole `### fix-code` section (the heading through the "Command-based verifies are not self-sufficient" paragraph). PRESERVE that paragraph's pedagogy: move a reworded version under `### run-command`, changed to start "**Command-based verifies are not self-sufficient.** run-command proves the hands, not the head." and keep the rest of the sentence about following with quiz or explain and the netfilter example. Place it at the end of the run-command section.
4. `### Instrument routing`: delete the bullet `- **fix-code** is still a skill convention ...` and keep only the bullet naming quiz, explain, run-command as extension tools.
5. `## Judgment calls`: delete the bullet `- **fix-code follow-up style** — ...`. Keep the Failed run-command bullet.
6. Re-read the whole file for any remaining `fix-code` mention and remove it. Also check the `### rubric`-like duplicate copies: search the repo for `fix-code` and clean every hit. Expected remaining hits: zero.

Do not renumber or restructure anything else. Do not change the completion gate or quiz/explain/lesson protocol.

## Verify before committing

- `grep -rn "fix-code\|fix_code\|fixcode" .` excluding `.git` returns nothing.
- `grep -rn "extensions/remote.ts\|remote.test.mjs\|ci-tests/remote.md" .` excluding `.git` returns nothing.
- `node -e 'JSON.parse(require("fs").readFileSync("pi/.pi/agent/settings.json","utf8"))'` succeeds.
- `bash scripts/nm-test.sh` passes.
- `bash scripts/nm-lint.sh` passes.
- Check that deleting `remote.test.mjs` does not remove the last test of a shared helper: `grep -rn "fake-herdr\|herdrArgs" pi/.pi/agent/extensions/*.test.mjs`.

If a gate fails for a reason you can fix within this scope, fix it. If a gate fails for an unrelated pre-existing reason, report it and do not expand scope.

Commit once on this branch with message: `Remove fix-code instrument and remote subagent extension`. Then report: files deleted, files edited, gate results, and any leftover hit you intentionally kept.

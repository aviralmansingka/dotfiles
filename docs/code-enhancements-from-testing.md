# Code enhancements from the testing work

Living list. Source: the 34 mining reports (all 261 PRs + 88 session dirs +
wiring audit) and the 29 implementation agents (waves 2–3 + Neovim wave).
Status legend:

- **[fixed-in-tree]** — fixed in this working tree, uncommitted; review and commit.
- **[needs-decision]** — captain decision required before any code changes.
- **[ready-to-file]** — no owner; file an issue as-is.
- **[done]** — completed on this branch.

## A. Landed fixes to review and commit

1. **python.ts kill escalation was dead code** — the `killed` flag made
   `kill("SIGKILL")` early-return after `kill("SIGTERM")`, so a signal-trapping
   child held the run for its full timeout. SIGKILL is now exempt, the child
   spawns detached, and kills go to the process group. Verified 30 s → 6 s.
   `pi/.pi/agent/extensions/python.ts` (dom-python).
2. **7 of 8 systemd units invoked scripts bare (203/EXEC class)** — explicit
   interpreters added (`/usr/bin/python3`, `/bin/bash`). `systemd/**` (dom-ops).
3. **`strip_bot_mention` failed on mention-only messages** — a bare group
   mention sent the literal mention string to pi as the prompt.
   `pi/bin/pi-telegram-daemon.py` (dom-telegram).
4. **`pi-telegram.env.example` was missing 18 daemon-read env keys** —
   commented defaults block added; parity test guards drift.
   `pi/.config/pi-telegram.env.example` (dom-telegram).
5. **`markdown.codeBlockIndent: ""` was silently lost from pi settings.json**
   (#166, dropped by a live-config sync commit) — restored and guarded
   (dom-repo-config).
6. **Stale Atlas-era `rm -f` blocks removed from install.sh** — `rm -f` on
   directories fails and would abort install under `set -e` (dom-repo-config).
7. **`tuicr_review` attached to the wrong PR's session (#289, still live in
   main)** — new pure `resolveTargetSession()` in `tuicr-core.mjs`; explicit
   slug > pr suffix > revset; a miss with other sessions active errors
   (fail-closed), never any-active (dom-tuicr).
8. **tuicr watcher launch-timeout lie** — the watcher now starts unresolved
   and resolves via the explicit target until its deadline; ambiguity/give-up
   paths reachable and tested (dom-tuicr).
9. **md-log probe entries could append into the teaching journal** —
   non-`.md` journals now get a sibling `<journal>-probes.md`
   (`pi/.pi/agent/extensions/md-log.ts`, dom-journal).
10. **nvim-open.sh "no herdr → try tmux" branch was dead code** — `herdr_json`
    always exited 0 (`|| true`); the guard now tests the response text
    (dom-subagents).
11. **treesitter.lua `ensure_installed` carried tsx/typescript twice** —
    lazy.nvim table-merge followed by `vim.list_extend`; dedup tripwire added
    (nvim-ui-shape).
12. **java.lua Path monkey-patch stacked wrappers on every `:Lazy reload`** —
    `rawget` marker guard added (nvim-plugin-configs).
13. **octo.lua `toggle_viewed` wrap doubled on every `config()` re-run** — one
    keypress jumped two files; `_toggle_viewed_chained` flag added (nvim-octo).
14. **sidekick ask/edit completion races (three bugs)** — duplicate-reply
    downgrade of completed entries; EOF `result=nil` crash (now fail-closed);
    errless-failure notify crash. All guards flagged in-source (nvim-ask).
15. **view_focus silently dropped input on closed terminals** — WARN notify
    added; round-trip proven (nvim-send).
16. **notion-cli crashed with tracebacks on network/JSON errors** — clean
    one-line exits (dom-repo-parity).
17. **tmux `update-environment` lacked `TERM`** — added; the detached-session
    restore contract (#21) now holds (`tmux/.tmux.conf`, dom-terminal).
18. **zsh layer fixes** — `.zshenv` leaked exit 1 on explicit source and
    duplicated PATH entries (`typeset -U path PATH` + if-form); `.zshrc` had
    three unguarded tool evals (stderr spam on tool-less hosts) —
    `command -v` guards added (`zsh/.zshenv`, `zsh/.zshrc`, dom-zsh).

## B. Decisions needed from the captain

19. **Four stow-shaped dirs are never stowed by install.sh** — `claude/`,
    `kube/`, `tmuxinator/`, `neovide/`; docs disagree. Dry-run evidence:
    `stow -n claude` exits 1 on conflict with a real
    `~/.claude/settings.json` (likely why it was never stowed). Options:
    stow with `.stow-local-ignore`, keep manual + fix docs, or delete.
    Guarded both ways by `STOW_GAP_ALLOWLIST`.
20. **Merge-order coordination with open PR #294** — it ships its own tests
    for the pane-lifecycle seams (withTabLaunchLock, liveness,
    closeTabForPane, registry). After it merges, extend the subagents suite
    to its uncovered seams.
21. **`ops/terraform/iam.tf` grants AdministratorAccess to the human admin IAM
    group** — owner's call; CI-role checks pass (dom-ops).
22. **Three repo-parity drift findings** — (1) claude settings runs an
    untracked, absent hook (`$HOME/.claude/hooks/herdr-agent-state.sh`);
    (2) `docs/OSC52*.md` instruct `stow ssh` — no `ssh` package exists;
    (3) all 8 locked skills' `.claude/skills/<name>` symlinks dangle in-tree
    (external fetch tool unreferenced). Allowlisted in
    `scripts/test-repo-parity.py` (dom-repo-parity).
23. **zsh `.zshrc` TERM export has no `$TMUX` guard** — it overrides
    `tmux-256color` inside panes (value is the safe #21 one; flagged by
    dom-terminal, asserted as-is by dom-zsh). Decide guard-vs-current.
24. **neovide `neovim-bin` absolute `/Users/...` path + git
    `credential.helper=osxkeychain`** — portability/per-host decisions; no
    safe minimal fix existed (dom-config-lint; `PORTABILITY_GAPS` pins the
    exact strings).

## C. Code enhancements ready to file as issues

25. **Consolidate heredoc/bash-command classification** — `python.ts` guard
    and the renderer heredoc scanner parse the same syntax independently
    (proven drift class: #242, `786c2d3`). One pure module, both consumers.
26. **Centralize jiti/typebox test resolution** — one shared helper + single
    `JITI_PATH`/`NODE_PATH` contract (deferred while agents edited tests).
27. **Audit every `execFileSync`/`spawnSync` site for stdio leaks** — the #291
    class is systemic; dom-nm covered its files, the repo-wide sweep is this
    issue.
28. **Harden the shared keep-open slot composition** — make
    `Symbol.for("pi-subagents/keep-open-count")` symmetric and idempotent by
    construction in both `no-mistakes-pane.ts` and `tuicr.ts` (#286 class).
29. **Migrate remaining string-split eval tests to the whole-load path** —
    index.ts is now whole-loadable; the list/baseline renderer blocks still
    source-split (post-#294).
30. **Agent profile naming a nonexistent tool passes silently** — passes
    through `--tools` with no `-e`; fail fast at spawn (dom-subagents).
31. **createSurface leaks a tab when `tab create` answers without a pane id**
    — no close target exists; decide recovery or document (dom-subagents).
32. **Two pinned octo quirks** — `html_to_markdown` collapses decoded
    `&lt;…&gt;`; `one_line_preview` returns raw body for newline-only bodies
    (nvim-octo).
33. **`dap_eval_hover` manual-focus branch is dead code with a latent
    self-close bug** — would self-close instantly if ever wired to a keymap
    (nvim-dap; spec pins the branch).
34. **pollForExit liveness/timeout hardening** — [in progress, agent
    `subagent-liveness`]. #294 (now merged) fixed the seen-then-gone case,
    but two observed live failure classes remain: (1) pi that NEVER
    appeared (silent spawn death — liveness requires a prior sighting, so
    the watcher waits forever past the startup shell); (2) pi alive but
    wedged (no sentinel, no deadline — pollForExit is an unbounded loop).
    Spec being implemented: hard deadline (`PI_SUBAGENT_MAX_WAIT_MS`),
    no-sighting grace (`PI_SUBAGENT_STARTUP_GRACE_MS`), read-failure
    threshold with pane-existence probe, one shared death-completion helper
    (harvest → notify → clean close), a module watchdog enforcing deadlines,
    reason-carrying `subagent_result` steers, orchestrate.ts/no-mistakes
    alignment, and a dedicated `subagent-liveness.test.mjs` suite. The
    captain flags this as a deal breaker for autonomous work — both failure
    classes were observed live this session (bare-zsh delegate panes; the
    wedged step pi polling a deleted repo).

35. **Stray nvim package-root files get stowed into `$HOME`** — [ready-to-file]
    `tool-call-rendering-prototypes.md` and markdownlint files sit at the
    nvim package root, so `stow nvim` deploys them into `$HOME` root.
    Flagged by dom-install.

36. **`herdr integration install pi` is unguarded in install.sh** —
    [ready-to-file]
    Unlike every other optional step it has no `command -v` guard; on hosts
    without herdr it aborts under `set -e`. Flagged by dom-install.

## D. Test/process enhancements (not product code)

35. **Quarantine mechanism for known-failing tests** — "fails on baseline"
    was normalized across sessions and masked regressions. [ready-to-file]
36. **Mermaid corpus as an institutionalized pre-merge local gate** — the v1
    lesson: unit tests pass while the architecture is wrong. [ready-to-file;
    corpus stays manual, skip paths hardened by dom-mermaid]
37. Completed on this branch (for the record): per-suite timeouts (every CI
    test wrapped in `timeout 120`); loader smoke + glob discovery + path
    gating incl. dynamic `# Paths:`/`// Paths:` header harvest with
    declared-beats-strip docs rule (meta-ci, verified with 20 synthetic
    gate-match diffs); dead verifier/fixture orphans deleted (29 files).

## E. Agent status

All landed green with `/simple` docs in `docs/ci-tests/` (29 docs):

- dom-python 2.35 s · dom-ops 0.65 s · dom-mermaid 0.44 s · dom-telegram
  1.1 s · dom-repo-config 0.20 s · dom-tuicr 1.7 s · dom-run-command 1.22 s ·
  dom-journal 3.1 s · dom-user-input 0.48 s · dom-nm 9.4 s · dom-subagents
  1.1 s · dom-nvim 0.26 s (12 specs) · meta-ci (CI architecture + loader
  smoke + self-check; serial ~33 s, parallel ~2–3 min).
- Wave 3: dom-zsh 0.42 s · dom-terminal 0.36 s (also restored a gutted
  ghostty config caught by its own suite, killed ~140 leaked tmux servers) ·
  dom-config-lint 0.06 s · dom-install 48 checks · dom-nm-install 1.1 s ·
  dom-repo-parity 0.37 s.
- Neovim wave (9/9): nvim-octo 0.06 s · nvim-dap 0.02 s · nvim-markdown
  0.08 s · nvim-plugin-configs 0.03 s · nvim-ui-shape 0.02 s · nvim-picker
  0.02 s · nvim-ask 0.08 s · nvim-workspaces 0.07 s · nvim-send 0.09 s.
- dom-renderer — DONE (third attempt, report-first) — domain ~2.5 s;
  usage.test.mjs rewritten against the real module (usage.ts 0→99.6 %
  stmts — the old test never imported it); renderer extended to 97.2 %
  stmts / 90.4 % branch with heredoc variants, powershell backfill, theme
  re-sync, degradation contracts, and the 18-family width sweep; no source
  bugs. Wave 2 COMPLETE (14/14).

Pending: audit-run (final runtime pass + CI failure history); meta-ci
holding for the final integration ping.

## F. Housekeeping and host-side

- Clean untracked `.coverage` / `coverage/` artifacts before committing.
- `docs/ci-tests/repo-config.md` lists starship/neovide/lazygit/k9s/
  tmuxinator as unowned — stale now that config-lint owns them; update at
  integration.
- Host-side (runbook): LaunchAgent plist pointed into a deleted worktree for
  ~2 months; reminders service PATH targeted an old nvm `pi`; stale `gh`
  2.63.2 broke no-mistakes push steps. Repo-side shape checks live in
  dom-ops/dom-repo-parity.
- Incident record: a temp-dir collision in the install-smoke harness once
  seeded a conflict file through a stowed symlink and truncated
  `ghostty/.config/ghostty/config`; dom-terminal's suite caught it and
  restored the config from HEAD. The harness now refuses to seed through
  symlinks, and both the terminal and install suites guard the file. This is
  the symlink-write hazard class for fake-`$HOME` harnesses — keep it in
  mind for future stow tests.

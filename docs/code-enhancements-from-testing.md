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
22. **Three repo-parity drift findings** — [done] (1) the hook entry was
    removed from `claude/.claude/settings.json` (the script never existed
    on any audited host); (2) the `stow ssh` mentions were corrected - this
    repo never shipped an ssh package, and the SSH config is host-side
    (`~/.ssh/config`) needing nothing from the repo; (3) the 8 dangling
    `.claude/skills/<name>` symlinks and the orphaned `skills-lock.json`
    were removed - the captain's skill audit (commit 64a4a94) deleted the
    mattpocock bundle, the fetch tool is referenced nowhere, and the
    symlinks resolved nowhere (repo, host, or tool). All three allowlist
    entries dropped; P1 rewritten as a skills-store check (dangling farm
    entries fail, a returning lockfile must carry full
    lock<->symlink<->target parity) (dom-repo-parity).
23. **zsh `.zshrc` TERM export has no `$TMUX` guard** — [done] The export
    is now `[[ -z "$TMUX" ]] && export TERM=xterm-256color`: outside tmux
    the safe #21 value is pinned, inside panes tmux's `tmux-256color`
    survives. `term-rc` pins both directions plus a selftest mutation for
    an unguarded export (dom-zsh).
24. **neovide `neovim-bin` absolute `/Users/...` path + git
    `credential.helper=osxkeychain`** — [done] `neovim-bin` is unset:
    neovide never expands `~` or env vars in config paths, and unset it
    resolves `nvim` from PATH (`~/.local/bin/nvim`, a bob symlink, is on
    PATH via `.zshenv` for every zsh). The git config drops `osxkeychain`
    (macOS-only, and Homebrew/Apple git already default to it in the
    system gitconfig) for a documented local-only pattern in
    `~/.gitconfig`, and the no-op `[editor] tool` key is gone. All
    `PORTABILITY_GAPS` entries removed; C9/C14 selftests pin the
    recurrences (dom-config-lint).

25. **no-mistakes binary drifted far past the repo pin** — DONE by
    rel-nm-pin. Mechanism: the setup wizard's self-managed symlink install
    (the pinned installer never ran on this host) plus two explicit
    `no-mistakes update` events (one agent-driven, 2026-10-08). Pin moved
    to v1.84.0 with official checksums; a pin-drift tripwire now fails on
    pin-vs-installed mismatch; axi argv verified unchanged via full help
    diff (the earlier `--step` note overstated the delta — it was already
    required in v1.41.2). OPERATIONAL: adopting the owned installer on
    this host requires deleting the wizard symlink first, then running
    `scripts/install-no-mistakes`.
    ~~The installed binary is v1.84.0 while `scripts/install-no-mistakes`
    pins v1.41.2, and the axi CLI contract has drifted with it (e.g.
    `axi logs` now requires `--step`). Observed live: a launch from the
    captain's tab never registered a run (daemon log untouched for hours)
    and fell back to direct driving, splitting delegate panes into the
    captain's tab. Decide: move the pin forward to the current version and
    re-verify the extension's axi argv against it, and determine why the
    update-check disable did not prevent the drift (manual update vs
    `NO_MISTAKES_NO_UPDATE_CHECK=1` failing). Related: C34's liveness
    hardening covers the wedged-watcher half of the incident.

## C. Code enhancements ready to file as issues

25. **Consolidate heredoc/bash-command classification** — `python.ts` guard
    and the renderer heredoc scanner parse the same syntax independently
    (proven drift class: #242, `786c2d3`). One pure module, both consumers.
26. **Centralize jiti/typebox test resolution** — one shared helper + single
    `JITI_PATH`/`NODE_PATH` contract (deferred while agents edited tests).
27. **Audit every `execFileSync`/`spawnSync` site for stdio leaks** — the #291
    class is systemic; dom-nm covered its files, the repo-wide sweep is this
    issue.
28. ~~Harden the shared keep-open slot composition~~ — FIXED (C28): both
    publishers now go through one shared `keep-open-slot.mjs` (keyed
    per-owner entries in a null-prototype holder, single summing reader),
    making the composition symmetric and idempotent by construction;
    cross-load-order tests live in both suites.
29. ~~Migrate remaining string-split eval tests to the whole-load path~~ —
    FIXED (C29): all four source-split eval blocks in
    interactive-subagents.test.mjs (list renderer, baseline renderer,
    applySandboxToParts, tab-close decision) now drive the whole-loaded
    module's real functions/hooks; zero `evalModule` slices remain.
30. ~~Agent profile naming a nonexistent tool passes silently~~ — FIXED
    (C30): the subagent tool's spawn gate refuses a profile naming a tool
    no source provides (built-ins, registry, runtime-registered,
    conventional map, or child extension discovery) with a clear error
    naming the tool and the profile, before any surface is created.
31. ~~createSurface leaks a tab when `tab create` answers without a pane
    id~~ — FIXED (C31): the missing-pane-id path closes the tab the
    response names (best-effort) before rethrowing the parse failure;
    regression-tested against a pane-less fake-herdr response.
32. ~~Two pinned octo quirks~~ — FIXED by rel-nvim-fixes (see A19).
33. ~~`dap_eval_hover` manual-focus branch~~ — FIXED by rel-nvim-fixes
    (deleted; see A20).
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

35. **Stray nvim package-root files get stowed into `$HOME`** — [done]
    `tool-call-rendering-prototypes.md` moved to `docs/` (a design doc,
    not config). The markdownlint pair stays at the package root on
    purpose: `~/.markdownlint-cli2.yaml` is the default config
    markdownlint-cli2 picks up for every project, nvim's conform/markdown
    wiring passes that exact path, and the custom rule dir sits next to
    it. A new `pkgshape` phase in the install smoke fails on any other
    root entry (C35 class).
36. **`herdr integration install pi` is unguarded in install.sh** — [done]
    All herdr-dependent steps (pi/codex integrations, Herdr Flash, the
    annotate reviewer) now sit behind one `command -v herdr` guard with a
    skip message. The install smoke asserts the guard statically and
    dynamically (C36).

36. **`herdr integration install pi` is unguarded in install.sh** —
    [ready-to-file]
    Unlike every other optional step it has no `command -v` guard; on hosts
    without herdr it aborts under `set -e`. Flagged by dom-install.

## D. Test/process enhancements (not product code)

35. **Quarantine mechanism for known-failing tests** — CLOSED AS DORMANT.
    "Fails on baseline" was normalized across sessions and masked
    regressions; the triage rule ("fails on the pre-change baseline ⇒ not
    your regression ⇒ quarantine, never ignore") is documented in
    `docs/ci-tests/ci-meta.md`. The full tree is green — zero known-failing
    tests exist to quarantine — so no mechanism ships. Revisit the moment a
    red suite ever persists on main: a quarantine list file + runner skip
    support is the designed shape.
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

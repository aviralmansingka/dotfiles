# child-stdio lint

## Purpose

This lint guards one rule: a captured child process must not put its
stderr on the agent terminal. Issue #291 showed the failure — the
`agent_not_found` JSON from `herdr` splattered over the orchestrator panes.

## Overview

Node gives `execFileSync` and `execSync` a dangerous default: the call
captures stdout, and without an explicit `stdio`, Node sends the child
stderr to the parent stderr — the agent TTY. One CLI error becomes pane
splatter. The fix shape is `stdio: ["pipe", "pipe", "pipe"]` (or a deliberate
`ignore`) plus null-on-failure at the call site. Python has the same
class: `subprocess` calls that capture stdout but leave `stderr=None`
inherit the parent stderr.

The lint is structural, like `bash -n`: it checks the call shape only
and never claims to prove behavior. The repo bans behavior assertions
made by source greps; it does not ban structural lints.

## What the check covers

- Scope: every tracked `.ts`, `.mjs`, and `.py` file under
  `pi/.pi/agent/extensions` and `pi/bin` (`git ls-files`), plus
  extensionless Python scripts in `pi/bin` by shebang.
- Flagged: `execFileSync`/`execSync` with no `stdio`; Python
  `subprocess` that captures stdout with no `stderr=`; `os.popen`.
- Exempt, with proof from the real runtimes: `spawnSync`/`spawn` default
  to `stdio: "pipe"` (stderr lands in `result.stderr`); async `execFile`
  and `exec` deliver stderr through the callback, never the TTY. The
  domain suites pin that those sites handle the error they receive.
- `INTENTIONAL_INHERIT` in the script pins each allowlisted site with a
  reason. A stale entry fails the lint, so the list cannot rot.

## How to run

```sh
python3 scripts/test-child-stdio.py
```

The entry self-wires into `nm-test.sh`, `nm-lint.sh` (py_compile), and CI
through its `# Paths:` header. It needs `git` and `python3` only.

## Runtime and SLA

The run takes about 0.05 s over 84 files and 44 captured call sites.
It is offline and deterministic: no network, no `$HOME` writes, no sleeps.

## Coverage result

The audit found every call site in scope. Files outside the liveness
set hold no unguarded captured call — the #291 fix wave guarded them.

| File | Sites | Class |
|------|-------|-------|
| cleanup · focus-buffer · tool-call-renderer-public | 1 each | guarded, explicit stdio |
| nvim-open.ts | 6 + 1 seam | guarded; seam forwards caller stdio |
| mermaid.ts · python.ts | 1 spawn each | guarded, pipe×3 |
| image-drop · run-command · tuicr · tuicr-core | async execFile | stderr captured in the error |
| no-mistakes gate · pane · bridge · report | 3 + 4 + 1 + 2 `pi.exec` | guarded, async, or pi API seam |
| run-command `r` flow · tuicr pane · nm shim · `exec` wrappers | 6 | intentional passthrough |
| telegram + whatsapp daemons · notion-cli · pi-stt-*.py | 2 each / 0 | pipes, capture_output, or no child |

## Known gaps

- The subagent surfaces' stdio pass landed: every captured `execFileSync`
  in `subagents/herdr.ts` (10 sites) and `subagents/tmux.ts` (9 sites)
  now carries `stdio: ["pipe", "pipe", "pipe"]`, the two `allow_all`
  entries were deleted, and the lint enforces both files (0 unguarded).
  `subagents/index.ts` and `orchestrate.ts` have no direct child calls;
  `no-mistakes-pane.ts` was already guarded.
- Shell wrappers in `pi/bin` use `exec`, not a captured child; the lint
  does not scan `.sh` files. It also cannot see a stdio built at runtime
  from a variable — no such site exists in scope today.

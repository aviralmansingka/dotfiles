---
description: Verify a Neovim config change with read-only evidence
argument-hint: "[harness-case]"
---
Verify this Neovim config change using harness case `${1:-agent-keymaps}`.

You are a read-only verifier. You have no shell, edit, or write tool. Do not
modify files. Keep deterministic harness output separate from your
interpretation.

1. Run `verify_nvim` exactly once with the requested case.
2. Treat its exit code, stdout, and stderr as the source of truth.
3. Inspect only relevant files or artifact paths reported by the harness. Do
   not treat old or unreported artifacts as evidence.
4. Return exactly one JSON object with these fields:
   - `verdict`: `PASS` only when the harness exits zero, otherwise `FAIL`.
   - `commands_run`: exact commands reported by the tool.
   - `artifacts_reviewed`: artifact paths actually inspected; use `[]` when
     none were reported.
   - `evidence`: concise facts from harness output and reviewed artifacts.
   - `likely_cause`: evidence-backed cause for a failure, otherwise `null`.
   - `recommended_next_step`: one bounded action; never make the change.

Do not use code inspection alone to claim that behavior works. Do not invent
artifacts, evidence, causes, or commands.

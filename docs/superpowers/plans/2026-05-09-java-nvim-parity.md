---
title: Neovim Java Parity Implementation Plan
date: 2026-05-09
spec: docs/superpowers/specs/2026-05-09-java-nvim-parity-design.md
status: in-progress
---

# Java Parity — Implementation Plan

Each task ends with a commit. Files touched are bounded; tasks are
ordered so failures land before dependents.

## Task 1 — neotest-java plugin spec + adapter wiring

**Edits:** `nvim/.config/nvim/lua/plugins/java.lua`

- Keep the existing `{ import = "lazyvim.plugins.extras.lang.java" }`
  entry.
- Add `{ "rcasia/neotest-java", ft = "java" }`.
- Add a `nvim-neotest/neotest` opts override registering
  `["neotest-java"] = {}` (defaults are sane per spec; no jvm_args /
  custom junit_jar in this round).

**Verify (manual):** none yet — Lazy needs to install the plugin.
Verification happens in Task 6.

**Commit:** `feat(nvim): add neotest-java adapter`

## Task 2 — jdtls inlay hints + code lens settings

**Edits:** `nvim/.config/nvim/lua/plugins/jdtls.lua`

- In the `opts.settings.java` deep-merge, add (alongside `import`,
  `configuration`, `completion`):
  - Both `inlayhints` and `inlayHints` (lowercase + camelCase):
    `parameterNames.enabled = "all"`.
  - `referencesCodeLens.enabled = true`.
  - Both `implementationCodeLens` and `implementationsCodeLens`:
    `enabled = true`.

**Verify (manual):** none yet — needs an LSP restart and a real Java
buffer. Step 10 (Task 6) confirms which casing JDT LS honored.

**Commit:** `feat(nvim): enable jdtls inlay hints and code lens`

## Task 3 — Java buffer keymap rewire (neotest parity)

**Edits:** `nvim/.config/nvim/lua/plugins/jdtls.lua`

In the `init` autocmd's LspAttach callback for `client.name == "jdtls"`:

- Replace `<leader>tg` mapping (was `jdtls.pick_test`) with
  `require("neotest").run.run()` — desc `"Java: Run nearest test (neotest)"`.
- Add `<leader>jp` → `require("jdtls").pick_test()` —
  desc `"Java: Pick test goal (jdtls)"`.
- Add `<leader>tT` → walk up from buffer for first hit among
  `build.gradle`, `build.gradle.kts`, `settings.gradle`,
  `settings.gradle.kts`, `pom.xml`, `MODULE.bazel`, `WORKSPACE`,
  `WORKSPACE.bazel`; fall back to buffer dir; call
  `require("neotest").run.run(root)` — desc `"Java: Run all tests in
  project (neotest)"`.
- `<leader>jc`, `<leader>jr` unchanged.

Use the same `vim.fs.find` pattern as `python.lua`'s `<leader>tT`
implementation for consistency.

**Verify (manual):** `:lua print(vim.fn.maparg("<leader>jp", "n"))` from
a Java buffer after restart shows the expected callback.

**Commit:** `feat(nvim): rewire java buffer keymaps for neotest parity`

## Task 4 — DAP virtual-eval parity for Java

**Edits:** `nvim/.config/nvim/lua/plugins/dap.lua`

- `AUTO_TRIGGER_FILETYPES` (around line 323): add `java = true`.
- `STRINGIFY` table (around line 93–103): add
  `java = function(expr) return expr end` (identity — Java DAP
  evaluator returns `toString()` already).

**Verify (manual):** read the file post-edit; both tables show java.

**Commit:** `feat(nvim): add java to dap idle-eval and stringify`

## Task 5 — Format-on-save for Java

**Edits:** `nvim/.config/nvim/lua/plugins/conform.lua`

- In `format_on_save`, extend the filetype check from
  `ft == "markdown" or ft == "python"` to also include `ft == "java"`.

`formatters_by_ft.java = { "google-java-format" }` already present —
no change.

**Verify (manual):** read the file post-edit; java triggers the format
table.

**Commit:** `feat(nvim): enable format-on-save for java`

## Task 6 — End-to-end smoke test on a real Gradle project

**Action:** dispatch `neovim-debugger` agent.

Project to use: ask user at task time (the user has Java repos but I
don't know specific paths from context). If none specified, fall back to
opening a fresh `gradle init` java-application in `/tmp` for a minimum
sanity check, but flag this as inferior verification per skill rules
("synthetic /tmp tests hide path / classpath / cache issues").

Verification recipes (the agent runs these via the live socket):

1. Open a `*.java` test file in the project.
2. `vim.lsp.get_clients({ bufnr = 0 })` — names should include `jdtls`.
3. `vim.lsp.inlay_hint.is_enabled({ bufnr = 0 })` — expect `true`.
4. After CursorHold, `vim.lsp.codelens.get(0)` count — expect `> 0` on
   a class file with public methods (references lens).
5. `vim.fn.maparg("<leader>tg", "n")` — expect a neotest call, not
   pick_test.
6. `:lua require("neotest").run.run()` then check `:Neotest summary`
   buffer — expect tree population (or "Neotest is currently scanning"
   message → wait + retry).
7. `vim.diagnostic.get(0)` — expect 0 on a clean buffer.
8. Idle 3s on an expression in a Java buffer with a paused DAP session
   — expect the eval hover to fire.

If any step fails, **stop**, diagnose, fix the spec/plan inline, and
retry — don't paper over.

**No commit** — verification only.

## Task 7 — Reload running nvim sessions

**Action:** dispatch `neovim-debugger` agent.

For every live nvim session:
- `:Lazy reload nvim-jdtls` (jdtls.lua)
- `:Lazy reload conform.nvim` (conform.lua)
- `:Lazy reload nvim-dap` (dap.lua)
- `:Lazy reload neotest` and `:Lazy reload neotest-java` (java.lua /
  new plugin)
- For sessions with a Java buffer attached, also `:LspRestart` so the
  new jdtls settings take effect.

Agent reports per-session pass/fail.

**No commit** — runtime side-effect only.

## Out of scope (per spec)

Maven verification, Bazel-Java neotest, jdtls codelens click-to-run,
Spring continuous test mode.

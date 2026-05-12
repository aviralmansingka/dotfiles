---
title: Neovim Java Parity (neotest, DAP eval, inlay/code lens, format-on-save)
date: 2026-05-09
status: design
---

# Neovim Java Parity

## Goal

Bring Java's editing experience to feature parity with Go and Python in this
config. The Java baseline (jdtls + spring-boot + bazel-bsp + DAP via
`lazyvim.plugins.extras.lang.java`) is already in place — see
`2026-05-08-nvim-java-setup-design.md`. This spec covers only the *parity
delta*: what Go/Python users get that Java users do not.

## Non-goals

- Bazel-Java neotest support. `sluongng/neotest-bazel` is hackathon-grade
  and the user's Java work is Gradle-first. Bazel-Java tests continue to
  run via jdtls (BSP) or the bazel CLI; revisit if the user picks up a
  Bazel-Java project.
- Replacing jdtls's `pick_test` interactive picker. We move it to
  `<leader>jp` so it stays available, but neotest becomes the primary path.
- Maven support in this round. User answered Gradle only. Adapter handles
  both, so Maven projects will still work — we just don't verify it.
- A custom neotest adapter that calls jdtls's `_java.test.*` LSP commands.
  rcasia/neotest-java already covers this for Maven/Gradle.

## Parity gap (current Go/Python vs Java)

| Concern | Go | Python | Java | Action |
|---|---|---|---|---|
| neotest adapter | neotest-golang | neotest-python | **none** | Add rcasia/neotest-java |
| `<leader>tg` runs neotest nearest | yes | (LazyVim default `<leader>tt`) | `jdtls.pick_test` (different) | Flip to neotest; move pick_test to `<leader>jp` |
| `<leader>tT` runs all in project root | go.mod | pyproject.toml | none | Add: gradle/maven/bazel root |
| DAP idle-eval auto-trigger | yes | yes | **no** | Add `java` to `AUTO_TRIGGER_FILETYPES` |
| Format-on-save | (manual) | yes | (manual) | Extend conform format-on-save to `java` |
| Inlay hints | gopls default | basedpyright default | **off** | Enable jdtls inlay hints (parameter names) |
| Code lens (run/debug/refs) | gopls default | n/a | **off** | Enable jdtls references + implementations code lens |

Items not addressed (already at parity): LSP attach, semantic tokens,
diagnostics, completion, `<leader>jr`/`<leader>gr`/`<leader>pr` LSP restart,
debug keymaps, snippets.

## Architecture

Three files edited; no new files.

- `nvim/.config/nvim/lua/plugins/java.lua` (edit)
  - Add `nvim-neotest/neotest-java` plugin spec.
  - Add a `nvim-neotest/neotest` opts override that registers the adapter.
  - Move the existing jdtls keymaps from `jdtls.lua` here, *or* keep them
    in `jdtls.lua` and only add the new ones (`<leader>tg`, `<leader>tT`,
    `<leader>jp`) here. **Choice: keep all java-buffer keymaps in
    `jdtls.lua` for cohesion** — `java.lua` stays a thin import + neotest
    wiring file, mirroring `python.lua` / `go.lua`'s shape.
- `nvim/.config/nvim/lua/plugins/jdtls.lua` (edit)
  - Add inlay hints + code lens settings to `opts.settings.java`.
  - Rewire `LspAttach` keymaps:
    - `<leader>tg` → `neotest.run.run()` (was `jdtls.pick_test`).
    - `<leader>tT` → `neotest.run.run(<gradle/maven/bazel root>)`.
    - `<leader>jp` → `jdtls.pick_test()` (kept available, new home).
    - `<leader>jc`, `<leader>jr` unchanged.
- `nvim/.config/nvim/lua/plugins/conform.lua` (edit)
  - Extend `format_on_save` to fire on `java` filetype.
- `nvim/.config/nvim/lua/plugins/dap.lua` (edit)
  - Add `java = true` to `AUTO_TRIGGER_FILETYPES`.
  - Add a `java` entry to `STRINGIFY` (identity — Java's `Object.toString`
    is what the JDI evaluator returns; no wrapping needed).
- `nvim/.config/nvim/lua/plugins/mason.lua` (edit)
  - No change. neotest-java has no Mason-installed binary; it locates a
    bundled junit runner JAR or auto-downloads it on first run.

## neotest-java wiring

Plugin: `rcasia/neotest-java`, v0.37.1 (April 2026).
Dependencies: `nvim-neotest/neotest`, `mfussenegger/nvim-jdtls`,
`mfussenegger/nvim-dap`, `nvim-treesitter/nvim-treesitter` with the `java`
parser. All already present in this config.

```lua
-- java.lua
return {
  { import = "lazyvim.plugins.extras.lang.java" },

  { "rcasia/neotest-java", ft = "java" },

  {
    "nvim-neotest/neotest",
    optional = true,
    opts = {
      adapters = {
        ["neotest-java"] = {
          -- Defaults are sane: junit_jar = nil (auto-download),
          -- jvm_args = {}, incremental_build = true,
          -- test_classname_patterns = {"^.*Tests?$", "^.*IT$", "^.*Spec$"}.
          -- Override only if a project needs JVM flags or a pinned
          -- junit version.
        },
      },
    },
  },
}
```

Loading both `neotest-java` and (already-loaded) `neotest-python`/
`neotest-golang` into the same neotest config is supported; neotest dispatches
per buffer filetype. No conflicts.

## Keymap layout

Java buffer keymaps after the change (mirrors Go's shape):

| Keymap | Action | Same as |
|---|---|---|
| `<leader>tg` | Run nearest test (neotest) | Go: `<leader>tg` |
| `<leader>tT` | Run all tests in project root | Go: `<leader>tT`, Python: `<leader>tT` |
| `<leader>jp` | jdtls pick_test (interactive picker) | new (was `<leader>tg`) |
| `<leader>jc` | `:JdtCompile` | unchanged |
| `<leader>jr` | `:JdtRestart` | unchanged |
| `<leader>tt`, `<leader>tr`, etc. | LazyVim test/core defaults | unchanged |

`<leader>tT` root resolution: walk up from buffer for the first hit among
`build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`,
`pom.xml`, `MODULE.bazel`, `WORKSPACE`, `WORKSPACE.bazel`. Fall back to
buffer dir if none found. (Bazel markers included so the keymap is useful
even where neotest-java itself can't run — neotest will just emit "no
tests found" rather than crash.)

## DAP virtual-eval parity

`dap.lua` already auto-triggers an eval hover after 2s of cursor stillness
on filetypes in `AUTO_TRIGGER_FILETYPES = { python = true, go = true }`.
Add `java = true`.

`STRINGIFY` table picks per-language wrappers for `<localleader>y` (yank
stringified form). Add `java = function(expr) return expr end` — Java's
DAP evaluator returns `toString()` output for objects, which is already
the human-readable form, so identity is correct.

No other DAP changes. The main `<localleader>b/c/s/d/a/q` keys, `<leader>dt`
(toggle UI), `<leader>dl` (logs) all work for Java sessions unchanged.

## Inlay hints + code lens (jdtls settings)

Add to `jdtls.lua`'s `opts.settings.java` deep-merge:

```lua
-- JDT LS wiki uses lowercase `inlayhints`; modern VS Code extension uses
-- camelCase `inlayHints`. Set BOTH; jdtls silently ignores keys it doesn't
-- recognize. Verify at step 10 which one the installed jdtls honors.
inlayhints = {
  parameterNames = { enabled = "all" },
},
inlayHints = {
  parameterNames = { enabled = "all" },
},
referencesCodeLens = { enabled = true },
-- Same casing-drift pattern: wiki uses singular `implementationCodeLens`,
-- newer extensions use plural `implementationsCodeLens`.
implementationCodeLens = { enabled = true },
implementationsCodeLens = { enabled = true },
```

LazyVim 11+ enables the editor-side toggle (`vim.lsp.inlay_hint.enable()`)
when any attached server reports inlay hint capability. If hints don't
render after enabling on the server side, we'll add an explicit
`vim.lsp.inlay_hint.enable(true, { bufnr = args.buf })` to the `LspAttach`
callback as a fallback (verify before assuming it's needed).

Code lens display requires `vim.lsp.codelens.refresh()` to be called.
LazyVim's lang.java extra already wires this via `vim.lsp.codelens.refresh()`
on `BufEnter`/`CursorHold` for jdtls buffers. Verify in step 10; if not
already wired, add an autocmd in `jdtls.lua`'s `init`:

```lua
vim.api.nvim_create_autocmd({ "BufEnter", "CursorHold", "InsertLeave" }, {
  pattern = "*.java",
  callback = function() pcall(vim.lsp.codelens.refresh) end,
})
```

## Format-on-save

`conform.lua` `format_on_save` currently fires only for `markdown` and
`python`. Add `java`:

```lua
format_on_save = function(bufnr)
  local ft = vim.bo[bufnr].filetype
  if ft == "markdown" or ft == "python" or ft == "java" then
    return { timeout_ms = 2000, lsp_fallback = false }
  end
  return nil
end,
```

`google-java-format` is already in Mason ensure_installed and conform's
`formatters_by_ft.java`. No other config change.

## Manual setup steps

None required beyond the existing `2026-05-08-nvim-java-setup-design.md`
manual steps. neotest-java auto-downloads its junit-platform-console
launcher JAR on first run if not provided. `google-java-format` already
installed via Mason.

## Stale workspace cache

Unchanged from prior spec. `~/.cache/nvim/jdtls/<project_name>/` cache wipe
+ `:JdtRestart` after build.gradle dep changes. Note that neotest-java
maintains its own incremental-build state under the project's
`build/`/`target/` dirs; if test discovery goes stale after dep changes,
also `./gradlew clean` (Gradle) before retrying.

## Failure modes

- **neotest-java junit JAR auto-download fails (offline)** → first
  `<leader>tg` errors. User can pin `junit_jar = "/path/to/junit.jar"` in
  neotest opts. Document, do not auto-resolve.
- **Inlay hints don't render despite jdtls accepting the setting** →
  vim.lsp.inlay_hint.enable() not called for buffer. Mitigate via the
  fallback autocmd above (verify first; only add if needed).
- **`<leader>tg` on a Bazel-Java buffer** → neotest-java doesn't know
  the project; emits "no tests" or fails to discover. Documented; user
  uses `:JdtCompile` + jdtls's run/debug code lens or the bazel CLI.
- **DAP idle eval fires inside a Spring Boot template (`.html`/`.yml`)** →
  filetype guard restricts to `java` only. yaml/properties buffers are
  unaffected.

## Verification recipes (step 10)

Open a real Gradle-Java project (the user has `~/code/spring-petclinic`
or equivalent — confirm path at execute time). Dispatch the
`neovim-debugger` agent:

1. `vim.lsp.get_clients({ bufnr = 0 })` → expect `jdtls`, `spring-boot` (if
   Spring), `copilot`.
2. `require("neotest").run.run()` on a buffer with a `*Test` class — expect
   discovery to populate the summary view (`:Neotest summary`).
3. `vim.diagnostic.get(0)` count after a clean buffer load — expect 0 for
   a non-erroring file.
4. `vim.lsp.codelens.get(0)` after CursorHold — expect references / run-test
   lenses on test classes.
5. `vim.lsp.inlay_hint.is_enabled({ bufnr = 0 })` — expect `true` after
   LspAttach.
6. Set a breakpoint, start a DAP session, idle 2s on an expression in a
   Java buffer — expect the eval hover to fire (parity with Go/Python).

## Out of scope (possible follow-ups)

- Maven verification (Gradle-only this round per user scope).
- Bazel-Java neotest adapter integration when sluongng/neotest-bazel
  matures.
- Spring Boot live-reload integration with neotest (continuous test mode).
- jdtls test code-lens click-to-run via `vim.lsp.codelens.run()` keybinding.

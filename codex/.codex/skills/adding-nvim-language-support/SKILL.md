---
name: adding-nvim-language-support
description: Use when the user wants to add support for a new language (or build system) to their LazyVim-based Neovim. Walks the full setup: research current ecosystem, brainstorm scope, propose approach, implement, verify on a real project, document, and reload running sessions. Targets feature parity with VSCode/Cursor/IntelliJ. Bazel-aware.
---

# Adding Neovim Language Support

End-to-end process for adding a language (or build system) to a LazyVim-based Neovim config with feature parity to modern IDEs (VSCode, Cursor, IntelliJ). Bazel integration is treated as first-class because the user's repos are Bazel-first.

**Announce at start:** "I'm using the adding-nvim-language-support skill to set up <language> support."

## When this skill applies

Use when the user says any of:
- "add support for <language>" / "set up <language> in nvim"
- "I want LSP / completion / debug / tests for <language>"
- "make my editor work with <language>"
- "add Bazel BUILD/MODULE.bazel support" (Starlark and friends)
- "add Gradle / build.gradle / Maven build file support"

## Hard rules

- **Research at invoke time, not from memory.** Mason package names, lspconfig schema names, plugin maintainership, and best-practice patterns shift quickly. Always verify before recommending. Memory of "groovyls is the Groovy LSP" can be wrong by next quarter.
- **Survey the user's existing config first.** They run LazyVim; assume `lazyvim.plugins.extras.lang.<X>` exists for many languages, and prefer enabling the extra over hand-rolling. But verify the extra is current and serves their needs.
- **Verify empirically on a real project before claiming success.** Open one of their actual projects, check `:LspInfo`, query `workspace/symbol` for a known framework class, count diagnostics, trigger completion at sane positions. Synthetic `/tmp` tests hide path / classpath / cache issues.
- **Bazel integration is part of the deliverable**, not a follow-up, when the user has Bazel projects. Each language has its own Bazel bridge (BSP, gopackagesdriver, compile_commands.json, rules_<lang> conventions).
- **Auto-reload running sessions** when nvim config changes (see the user's `Reload nvim after config changes` memory). Don't ask first.
- **Stop and ask** for any of: Bazel target run/debug configuration (out of scope unless requested), version-manager integration (sdkman/jenv/mise — explicit `runtimes` array is preferred), AI / Cursor-style features (assume Sidekick or Copilot already covers).

---

## Process

You MUST create a TaskCreate task for each item below and complete them in order.

### 1. Brainstorm scope with the user

Use the `superpowers:brainstorming` skill — but with a language-setup-specific question set:

- **Use case** — real app dev (LSP + DAP + tests + format + lint) vs. read-only navigation vs. light scripting. Determines depth.
- **Build system** — Bazel-first / Gradle / Maven / Cargo / npm-pnpm-yarn / Go modules / pip+pyproject / direct invocation. Bazel changes the LSP wiring substantially for most languages.
- **Frameworks** — Spring Boot, React, Django, Tokio, etc. Some have dedicated LSPs (Spring Boot Tools, Tailwind LSP, Astro LSP); some need extra bundle JARs in the parent LSP.
- **Test runner preference** — neotest adapter (run-from-buffer) vs LSP `_java.test.*` style commands vs DAP-driven test debug.
- **Debug priority** — DAP setup is non-trivial for some languages (Python, JVM); skip if user only needs LSP.

Default order if user is non-specific: ask use case first; then build system; then frameworks; then debug/test ambitions.

### 2. Survey their current config

Read these files (skip if absent — note the absence):
- `nvim/.config/nvim/lazyvim.json` → which `extras` are enabled
- `nvim/.config/nvim/lua/plugins/mason.lua` → `ensure_installed` shape
- `nvim/.config/nvim/lua/plugins/lsp.lua` → custom LSP overrides; the pattern for adding a server
- `nvim/.config/nvim/lua/plugins/conform.lua` → formatter wiring shape
- `nvim/.config/nvim/lua/plugins/dap.lua` → DAP keymap/UI conventions
- `nvim/.config/nvim/lua/plugins/blink-cmp.lua` (or `nvim-cmp.lua`) → completion sources, snippet engine
- `nvim/.config/nvim/luasnippets/` → existing snippet packs

Record: which LazyVim lang extras are already enabled, the user's plugin spec idiom (function-`opts` vs table-`opts`, `keys = {}` vs LspAttach autocmd), JDK / runtime paths if visible, formatter list.

### 3. Research the language ecosystem

This is where research happens. **Don't pull from training-data memory.** Use WebSearch / WebFetch / `gh` / Mason registry to verify everything below for the chosen language. Sources of truth:

- **LazyVim extras list:** `https://www.lazyvim.org/extras` and `github.com/LazyVim/LazyVim/tree/main/lua/lazyvim/plugins/extras/lang`. Confirm whether a `lang.<X>` extra exists; if so, read its source — it tells you the canonical LSP / formatter / DAP / test / treesitter wiring.
- **Mason registry:** `github.com/mason-org/mason-registry/tree/main/packages` — actual package names (often differ from upstream tool names; e.g. `vscode-spring-boot-tools` not `spring-boot-tools`, `vscode-js-debug` not `js-debug-adapter` in some forks). Verify the package exists; record the install path layout if non-standard.
- **lspconfig schemas:** `github.com/neovim/nvim-lspconfig/tree/master/lsp` — confirm a schema exists for the LSP under the expected name; if not, plan a `vim.lsp.start` autocmd OR a `require("lspconfig.configs").<name>` registration.
- **conform.nvim formatter list:** `github.com/stevearc/conform.nvim/blob/master/doc/formatters.md` — formatter names and any special config.
- **nvim-lint linter list:** `github.com/mfussenegger/nvim-lint/blob/master/doc/nvim-lint.txt` — for languages where the LSP doesn't provide diagnostics (some).
- **nvim-dap adapters:** `github.com/mfussenegger/nvim-dap-<lang>` repositories or the language's DAP wrapper.
- **neotest adapters:** `github.com/nvim-neotest/neotest` README → list of community adapters per language.
- **Treesitter parsers:** `github.com/nvim-treesitter/nvim-treesitter#supported-languages` — confirm a parser exists.

Output a compact summary in this shape (compose dynamically per language):

```
LSP:        <lspconfig name>  (Mason: <pkg>; covered by lazyvim.plugins.extras.lang.<X>: yes/no)
Formatter:  <conform name>    (Mason: <pkg>)
Linter:     <name>            (LSP-provided: yes/no; nvim-lint: yes/no)
DAP:        <adapter name>    (Mason: <pkg>; needs jdtls/lldb/codelldb specifics: ...)
Tests:      <neotest adapter / LSP commands / framework CLI>
Snippets:   friendly-snippets (<lang> pack present?) + custom luasnippets/<ft>.lua candidates
Treesitter: <parser>          (auto via lazyvim.plugins.extras.lang.<X>: yes/no)
Community:  <key plugins>     (e.g. rust-tools, typescript-tools, jdtls, java-debug-adapter)
```

### 4. Bazel integration research (when user uses Bazel)

For each language, identify the Bazel bridge. Common patterns (verify each at invoke time — these change):

- **Java/Kotlin/Scala (JVM):** **bazel-bsp** (`github.com/JetBrains/bazel-bsp`). Generates `.bsp/` directory; jdtls/metals consume via Build Server Protocol. Per-repo install via `coursier launch`. Set `settings.java.import.bsp.enabled = "auto"` on jdtls. Without `.bsp/`, jdtls falls back to Maven/Gradle and won't resolve Bazel-built deps. Emit a `vim.notify` warning when a `MODULE.bazel`/`WORKSPACE` is detected without `.bsp/`.
- **Python:** **rules_python** + Bazel doesn't natively help LSPs. Pyright reads `pyrightconfig.json` — point its `extraPaths` at Bazel's `bazel-bin/<pkg>` dirs OR run `pip install` via a `requirements.txt` from `compile_pip_requirements`. Some teams use **bazel-pytype** or stub generation. Honest answer: Python + Bazel + LSP is the weakest combo; recommend `pip install -e .` of bazel-built packages for completion and accept that runtime Bazel is separate.
- **Go:** **gopls + gopackagesdriver=bazelgopackagesdriver**. Set env `GOPACKAGESDRIVER=$(bazel info workspace)/tools/gopackagesdriver.sh` (or the equivalent rules_go convention). Lets gopls treat Bazel BUILD as the source of truth for package boundaries.
- **Rust:** **rust-analyzer + cargo-bazel + check.overrideCommand**. rust-analyzer's `check.overrideCommand` can run `bazel build` and parse cargo-style messages via cargo-bazel's bridge. Or use **rules_rust**'s rust-project.json generator.
- **TypeScript/JavaScript:** **rules_ts** + tsserver works mostly by reading `tsconfig.json`s under each `ts_project` target. **bazel-compile-commands-extractor** doesn't apply. Real win: use `bazel build` for runtime; LSP consumes tsconfigs.
- **C/C++:** **clangd + bazel-compile-commands-extractor** (`github.com/hedronvision/bazel-compile-commands-extractor`). Run `bazel run @hedron_compile_commands//:refresh_all` to regenerate `compile_commands.json`. clangd reads it natively.
- **Starlark itself (BUILD/MODULE.bazel/.bzl):** **starpls** LSP + **buildifier** formatter (Mason: `starpls`, `buildifier`). starpls is Bazel-team-maintained and DOES understand `rules_<lang>` symbols.

For any language without an established Bazel bridge: be honest with the user — recommend running Bazel for builds/tests at the CLI and accepting LSP-via-tsconfig/pyrightconfig/etc. as best-effort.

### 5. Modern IDE feature parity checklist

After research, run through this checklist with the user. Mark each as **default-on** (covered by LazyVim extra or stock LSP), **opt-in** (extra config required), or **out of scope** (skip for this round). Don't ask one-by-one; present as a multi-select.

**Code intelligence (LSP-driven):**
- Completion + auto-import (default-on if LSP supports it)
- Hover, signature help (default-on)
- Goto definition / references / implementation / type definition (default-on)
- Rename, code actions / quick fixes (default-on)
- Document symbols, workspace symbols (default-on)
- Inlay hints, semantic tokens (LSP-dependent; opt-in via `vim.lsp.inlay_hint.enable()` + LSP config)
- Code lens (LSP-dependent; e.g. jdtls run/debug lenses)
- Document highlight / multi-cursor at symbol (default via `:lua vim.lsp.buf.document_highlight()` autocmds)

**Diagnostics:**
- LSP diagnostics (default-on)
- Linter integration (opt-in via nvim-lint where the LSP doesn't lint; e.g. clippy via `cargo clippy`, eslint, ruff in lint mode)

**Formatting:**
- Format-on-save via conform (opt-in; configure `formatters_by_ft.<ft>`)
- Organize imports (LSP code action OR formatter; varies)

**Refactoring:**
- LazyVim's `<leader>cr*` defaults handle generic LSP rename / extract for some langs
- Language-specific refactors (e.g. jdtls `extract_method`, ts.organizeImports) — extend LspAttach with bindings

**Debug:**
- DAP adapter (Mason-installed where possible)
- Breakpoints / watches / step / call stack (default once adapter wired)
- Run / debug main / test from buffer (language-specific; document what the LSP/extra provides vs. what we add)

**Tests:**
- neotest adapter for in-buffer test discovery & per-test debug (opt-in; one adapter plugin per language)
- LSP-provided test commands (e.g. jdtls `test_class`, `test_nearest_method`) — already wired by some extras

**Snippets:**
- friendly-snippets for the language (auto via existing blink-cmp config)
- Custom `luasnippets/<ft>.lua` for framework boilerplate where the LSP doesn't model dynamically-added APIs (e.g. Gradle `implementation`/`testImplementation`, Spring Boot `@Component`/`@RestController` patterns, React function-component templates)

**Build / run / tasks:**
- Run a build / a target / a test from a keymap — varies; could be a `:terminal` runner (toggleterm), a custom `:Make`, or LSP `executeCommand`
- For Bazel projects, keymaps to `bazel build //path/to:target` / `bazel test //...`

**Build files (don't forget):**
- Gradle: `groovyls` for non-Gradle .groovy, `gradle_ls` (Microsoft's vscode-gradle-language-server) for Gradle projects. Scope groovyls's root_dir to skip Gradle projects so they don't both attach.
- Bazel: `starpls` LSP + `buildifier` formatter
- CMake, Dockerfile, Terraform, YAML/JSON/TOML, Nix — research per-build-system Mason packages at invoke time

**Frontend (if applicable):**
- Tailwind LSP for CSS class completion
- ESLint LSP for JS/TS lint diagnostics
- Prettier via conform for format

### 6. Propose 2-3 approaches

Always give the user a choice of approach. Typical options:

- **A. Enable LazyVim extra + targeted overrides** (recommended for languages with a `lang.<X>` extra). Fast, conventional, future updates land cleanly.
- **B. Hand-rolled plugin spec** for languages without a LazyVim extra OR when user wants atypical wiring.
- **C. Minimal LSP-only via lspconfig** when user wants navigation but not debug/test/format.

For each, note: complexity, what gets enabled, what stays manual.

Recommend the simplest path that covers their scope. Don't over-engineer.

### 7. Write the spec

Use the brainstorming skill's spec template. Save to `docs/superpowers/specs/YYYY-MM-DD-<lang>-nvim-setup-design.md`. Cover:
- Goal + non-goals
- Architecture (which files to create/modify)
- LSP wiring (Mason packages, lspconfig schema overrides, vim.lsp.start when needed)
- Bazel integration (per the research above)
- Build file LSPs (if applicable)
- Snippets
- Format/lint/DAP/tests
- Keymaps (LazyVim defaults documented + additions)
- Manual setup steps user must perform (per-repo bazel-bsp install, JDK install, etc.)
- Failure modes (stale workspace caches, missing markers, classpath resolution drift)
- Out of scope / follow-ups

Self-review for placeholders, contradictions, scope. Get user approval before writing the plan.

### 8. Write the implementation plan

Use the `superpowers:writing-plans` skill. Tasks should be bite-sized:

- **Task 1: Mason — install <packages>** with sync wait verification (don't trust `:Mason` UI in headless tests; use `mason-registry.get_package(name):install()` + poll-until-installed pattern shown in the prior Java setup).
- **Task 2: Enable LazyVim extra (or scaffold plugin spec)** — verify with `pcall(require, "<lsp-module>")` and a buffer-open smoke test.
- **Task 3..N: One task per concern** — root detection, settings, on_attach keymaps, build server (Bazel) setup, format wiring, etc. Each task ends with a commit.
- **Task N: End-to-end smoke test** — open the user's actual project, verify LSP attaches, query `workspace/symbol` for a framework class (e.g. `Document` for Spring Data Mongo, `Component` for React, `tokio::main` for Rust async), count diagnostics, trigger completion.

### 9. Execute

Use `superpowers:executing-plans` (inline, with checkpoints) OR `superpowers:subagent-driven-development` (parallel-friendly). For nvim plugin work, inline is usually right because tasks build on each other and verification is interactive.

Discoveries-during-execution are normal. When reality differs from spec, **fix the spec/plan inline** before continuing — don't let the docs drift. Document the discovery in the commit message so the user can audit later.

### 10. Verify on a real project

Open a project of theirs that uses the language. **Don't rely on synthetic `/tmp` projects** — they hide path, cache, and classpath issues.

Recipes (run via headless nvim or `--remote-send` to a live session):

```lua
-- LSP attached?
vim.lsp.get_clients({ bufnr = 0 })

-- Workspace symbol query for a known framework class
vim.lsp.buf_request_sync(0, "workspace/symbol", { query = "<KnownClass>" }, 8000)

-- Diagnostics count
#vim.diagnostic.get(0)

-- Completion at a meaningful position (insert mode, after partial identifier)
vim.lsp.buf_request_sync(0, "textDocument/completion",
  vim.lsp.util.make_position_params(0, "utf-16"), 5000)

-- Classpath / project paths (jdtls-style introspection)
vim.lsp.buf_request_sync(0, "workspace/executeCommand", {
  command = "<lang.specific.command>",  -- e.g. java.project.getClasspaths
  arguments = { vim.uri_from_bufnr(0), ... },
}, 10000)
```

If diagnostics show "X cannot be resolved" for symbols that the build tool clearly resolves (e.g. `./gradlew dependencies` lists them), the LSP's project import is stale. **Wipe the workspace cache and restart the LSP**:

```sh
rm -rf ~/.cache/nvim/<lsp-name>/<project>
```

Then `:LspRestart` (or jdtls-specific `:JdtRestart`).

Document any cache-staleness recipe in the spec under "Stale Workspace Cache" so future sessions remember.

### 11. Document and reload

After all tasks pass:

- Spec/plan are committed.
- Run `:Lazy reload <plugin>` in every running nvim session that has a relevant buffer open. See the user's reload memory for plugin-name mapping. Don't ask first.
- For LSP changes: a buffer attached to the *old* config keeps the old behavior until `:LspRestart`. Mention this when the change matters (e.g. new LSP server added, classpath change).
- Hand off via `superpowers:finishing-a-development-branch`: tests-pass check (= verification recipes) → present 4 options (merge / PR / keep / discard).

---

## Anti-patterns

| Pattern | Reality |
|---|---|
| "I'll just enable the LazyVim extra and we're done" | Mason package may not be installed; classpath may not resolve; community plugin may need `init_options.bundles` extension; verify before claiming. |
| "Mason install on first launch will Just Work" | Async; first-launch nvim may not have packages installed yet. Use the polling install pattern in headless verification. |
| "I'll write a custom lspconfig server entry" | Newer lspconfig uses `vim.lsp.config()` and many setups go through mason-lspconfig auto-setup; a stray manual entry may not fire. Test attachment empirically. |
| "DAP works because the adapter is registered" | Adapter registered ≠ debug session works. Need a real launch config (`main` class discovery, port forwarding, source maps, etc.). Test by setting a breakpoint and running. |
| "Synthetic `/tmp` test passes, ship it" | Real projects expose path resolution (macOS Homebrew JDK at `libexec/openjdk.jdk/Contents/Home`, not the brew prefix), cache staleness, build-tool toolchain version mismatches. Always verify on the user's actual project. |
| "Just override LazyVim's keymaps with mine" | LazyVim already binds `<leader>cx*`/`co`/`tt`/`tr` etc. Conflicts cause silent shadowing or surprise. Document defaults; extend with new keys; don't redefine. |
| "Run gradle/bazel from a CLI to verify it works" | gradle CLI succeeds while jdtls's cached classpath is stale. CLI success ≠ LSP success. Verify the LSP independently. |
| "Snippet completion will surface dynamic API" | LSPs only model statically-declared API. Dynamic configurations (Gradle `implementation`, Spring `@Bean` autowiring) need snippets, not LSP. |
| "Add a library = LSP sees it instantly" | Most LSPs cache project state. After adding a dep, the cache is stale — `:LspRestart` may not be enough; cache wipe is sometimes required. |

## Common gotchas to surface proactively

- **macOS Homebrew JDK paths**: `/opt/homebrew/opt/openjdk@<v>` is the brew prefix and has `bin/java` but lacks `lib/jrt-fs.jar`. The actual `JAVA_HOME` is at `<prefix>/libexec/openjdk.jdk/Contents/Home`. Pointing jdtls's `runtimes[].path` at the prefix produces "java.lang.Object cannot be resolved". Set `default = true` on the runtime entry so jdtls falls back when the project requests a JDK we don't have.
- **Mason package vs. lspconfig server name**: e.g., Mason `vscode-spring-boot-tools` ↔ lspconfig schema may not exist (no auto-mapping; needs custom registration or `vim.lsp.start`). Check both before assuming.
- **Bundle extensions for cross-LSP communication**: Spring Boot LSP needs Spring's JDT extensions in jdtls's `init_options.bundles`. Without them, the LSP attaches but returns 0 completions. Use the language's plugin (e.g., `JavaHello/spring-boot.nvim`) which calls `require("spring_boot").java_extensions()` to get the JAR list — append to the bundles array.
- **Filetype name surprises**: `.gradle` → `groovy`, `.properties` → `jproperties` (NOT `properties`), `BUILD`/`*.bzl`/`MODULE.bazel` → `bzl`, `Dockerfile.*` → `dockerfile`. Verify with `vim.filetype.match({ filename = "..." })`.
- **LazyVim extra hooks**: the `lang.java` extra exposes `opts.full_cmd`, `opts.jdtls.cmd_extender` (in some versions) — check the extra's source to find the right hook before guessing. `opts.cmd_extender` is NOT read by every extra.
- **Auto-trigger vs manual completion**: blink-cmp's default preset auto-triggers in insert mode after typing identifier characters. Users who report "no completion" are often in normal mode or inside a string literal.
- **Two LSPs attached to the same buffer**: not a problem on its own — they coexist by name. But scoring overlaps: if LSP A returns 1000 generic items and LSP B returns 5 framework-specific items, the user sees A's noise. Tune `score_offset` per source in blink-cmp if needed.

## Sub-skill references

- `superpowers:brainstorming` — use for the initial scope conversation
- `superpowers:writing-plans` — use to author the implementation plan
- `superpowers:executing-plans` or `superpowers:subagent-driven-development` — for execution
- `superpowers:verification-before-completion` — before claiming done
- `superpowers:finishing-a-development-branch` — for the merge/PR handoff

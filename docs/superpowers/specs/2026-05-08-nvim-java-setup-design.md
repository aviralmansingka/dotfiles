---
title: Neovim Java Setup
date: 2026-05-08
status: design
---

# Neovim Java Setup

## Goal

Add a full-featured Java development setup to the LazyVim-based Neovim
configuration. Target use cases: real application development with build,
run, debug, and test workflows. Primary project shape: Spring Boot, Bazel
monorepos (with Gradle as a fallback build), Lombok in use.

## Non-goals

- Bazel-specific run configurations (e.g., `bazel run //foo:bar` from nvim).
  Out of scope for this spec; revisit if the BSP-derived `Run/Debug` flow
  proves insufficient.
- Auto-install of `bazel-bsp` per workspace. Manual + a clear notification
  is the chosen path.
- Integration with `sdkman`/`jenv`/`mise` for JDK switching. Use an explicit
  `runtimes` array.

## Architecture

Three new files, two edits:

- `lua/plugins/java.lua` (new) — imports the LazyVim Java extra (`lazyvim
  .plugins.extras.lang.java`) via plugin spec form, so the override lives
  next to the enable.
- `lua/plugins/jdtls.lua` (new) — load-bearing jdtls config: bundles, BSP
  wiring, Lombok agent, root detection, workspace dir, runtimes,
  `on_attach` (DAP, test, refactor keymaps).
- `lua/plugins/spring-boot.lua` (new) — small file adding
  `vscode-spring-boot-tools` as a sibling LSP via lspconfig, same pattern as the
  existing `lua_ls`/`copilot` config in `lsp.lua`.
- `lua/plugins/mason.lua` (edit) — append `jdtls`, `java-debug-adapter`,
  `java-test`, `vscode-spring-boot-tools`, `google-java-format` to
  `ensure_installed`.
- `lua/plugins/conform.lua` (edit) — add `java = { "google-java-format" }`
  to formatters.

DAP integration is automatic: `nvim-jdtls` registers a `java` adapter with
`nvim-dap` when the `java-debug-adapter` bundle is present. The existing
`dap.lua` keymaps (`<localleader>b/c/s/d/a/q`) work for Java sessions
unchanged, including dapui open/close listeners.

## Bazel-BSP Wiring

`jdtls` does not natively understand Bazel. The bridge is `bazel-bsp`,
which generates a `.bsp/` directory that jdtls discovers via the Build
Server Protocol.

### Per-workspace bootstrap (manual, one-time per repo)

```sh
cd ~/code/some-bazel-repo
coursier launch org.jetbrains.bsp:bazel-bsp:<version> -M \
  org.jetbrains.bsp.bazel.install.Install
```

This produces `.bsp/bazelbsp.json` describing how jdtls should launch the
build server. Not automated by nvim — it is per-repo state, like
`node_modules`. The `<version>` is intentionally not pinned in this spec:
each repo selects a `bazel-bsp` version compatible with its Bazel
version, decided at install time.

### Root detection (jdtls.lua)

```lua
root_markers = {
  "MODULE.bazel",
  "WORKSPACE",
  "WORKSPACE.bazel",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  ".git",
}
```

Order matters: Bazel markers first so a Bazel monorepo containing a stray
`pom.xml` still selects the BSP path.

### jdtls settings (BSP enable)

```lua
settings = {
  java = {
    import = {
      bsp = { enabled = "auto" },
      gradle = { enabled = true },
      maven = { enabled = true },
    },
  },
}
```

`bsp.enabled = "auto"` means jdtls picks BSP when `.bsp/` exists at the
project root, otherwise falls back to Gradle/Maven import. This gives
"Bazel-first, Gradle still works" without writing detection logic.

### Workspace dir per project

`vim.fn.stdpath("cache") .. "/jdtls/" .. project_name`, where
`project_name` is the basename of the resolved root. Required by jdtls;
without it, switching projects corrupts state.

### Missing-`.bsp/` notification

If `MODULE.bazel`/`WORKSPACE`/`WORKSPACE.bazel` exists at root but `.bsp/`
does not, emit a `vim.notify` with the exact `coursier launch ...Install`
command. This is the largest gotcha for the Bazel path; the notification
earns the small startup-check.

## Lombok

Lombok must be a `-javaagent` on the jdtls JVM command line; otherwise
`@Data`/`@Builder`-generated members appear unresolved.

**No configuration required.** Mason's `jdtls` package already bundles
`lombok.jar` at `~/.local/share/nvim/mason/share/jdtls/lombok.jar`, and
the Mason-installed jdtls launcher includes it as a `-javaagent` by
default. Updating jdtls via Mason updates the bundled Lombok along with
it.

If a project needs a specific Lombok version independent of Mason's
bundled one, override `opts.full_cmd` in `jdtls.lua` to wrap the default
and append an additional `--jvm-arg=-javaagent:<path>`. Out of scope for
this spec.

## Spring Boot Tools

Separate LSP server (separate process from jdtls) handling
`application.properties`/`application.yml` autocomplete, `@Bean` graph
navigation, Spring code lenses.

**Discovery during execution:** Spring Boot LSP requires Spring-specific
JDT extension JARs to be loaded by jdtls so the two language servers
can communicate. A direct `lspconfig` entry is not sufficient — the
LSP fails to initialize without the extensions. The standard solution
is the `JavaHello/spring-boot.nvim` plugin, which loads the Mason
`vscode-spring-boot-tools` install, registers the JDT extensions with
jdtls, and wires the LSP client.

- Mason package: `vscode-spring-boot-tools` (provides the language
  server JAR and JDT extensions).
- Plugin: `JavaHello/spring-boot.nvim`, lazy-loaded on `java`, `yaml`,
  `jproperties` filetypes; declares `nvim-jdtls` and `nvim-lspconfig` as
  dependencies. Default opts are sufficient — the plugin auto-detects the
  Mason install path.
- Three LSPs end up attached to a Spring Boot Java buffer: `jdtls`,
  `spring-boot`, and (existing) `copilot`. They coexist without conflict.

## JDK Management

Two distinct JDKs are in play.

### JDK that runs jdtls itself

jdtls 1.31+ requires Java 21+. Pin it explicitly in `jdtls.lua`:

```lua
local JDTLS_JDK = "/opt/homebrew/opt/openjdk@25"
-- prepended to PATH and set as JAVA_HOME for the jdtls subprocess
```

Independent of any project's JDK. `openjdk@25` via brew is the assumed
install (any JDK 21+ works; this spec uses 25 because that's what's
installed on the target machine).

### JDKs available to compile projects

jdtls reads the project's target JDK from the build file
(`sourceCompatibility` for Gradle, `<source>` for Maven, toolchain rule
for Bazel). Configure available runtimes so jdtls can resolve them:

```lua
settings.java.configuration.runtimes = {
  { name = "JavaSE-25", path = "/opt/homebrew/opt/openjdk@25" },
}
```

Currently only JDK 25 is in the list (matches what's installed). Add
more entries as more JDKs are installed (e.g., `JavaSE-17`,
`JavaSE-21`). No version-manager auto-detection.

## Code Completion (Snippets)

Snippet completion arrives through three paths, all of which are already
wired in `blink-cmp.lua` (`"snippets"` source, `friendly-snippets` +
`LuaSnip` dependencies). No new plugins are needed.

- **`friendly-snippets` Java pack** — keyword-style snippets like `psvm`,
  `sout`, `fori`. Loaded via `luasnip.loaders.from_vscode.lazy_load()`.
- **jdtls code templates** — returned as LSP `CompletionItem` with
  `kind = Snippet`. Always available when jdtls is attached.
- **jdtls postfix + arg-guess completions** (opt-in, set in `jdtls.lua`):

  ```lua
  settings.java.completion = {
    postfix = { enabled = true },     -- myVar.sout → System.out.println(myVar)
    guessMethodArguments = true,       -- fills argument placeholders with type-appropriate guesses
  }
  ```

  `postfix.enabled` exposes Eclipse JDT's postfix templates as completion
  items: `.sout`, `.var`, `.if`, `.fori`, `.cast`, etc. — applied to the
  expression preceding the dot.

## DAP Integration

LazyVim's `lang.java` extra already calls `setup_dap` and
`setup_dap_main_class_configs` in its own `LspAttach` autocmd when the
`java-debug-adapter` Mason package is present. No additional wiring
needed in `jdtls.lua`. Existing `dap.lua` keymaps and dapui listeners
apply to Java sessions unchanged.

## Java Keymaps (LazyVim defaults + additions)

LazyVim's `lang.java` extra registers the following on jdtls attach:

| Keymap | Action |
|---|---|
| `<leader>cxv` / `<leader>cxc` | Extract variable / constant (normal + visual) |
| `<leader>cxm` | Extract method (visual) |
| `<leader>cgs` / `<leader>cgS` | Goto super / subjects |
| `<leader>co` | Organize imports |
| `<leader>tt` | Run all tests |
| `<leader>tr` | Run nearest test |

`jdtls.lua` adds three more via its own `LspAttach` autocmd:

| Keymap | Action |
|---|---|
| `<leader>tg` | Pick test goal (`require("jdtls").pick_test()`) |
| `<leader>jc` | Compile (`:JdtCompile`) |
| `<leader>jr` | Restart jdtls (`:JdtRestart`) |

Standard LSP keymaps (`<leader>ca`, `gd`, `gr`, etc.) work unchanged.

## Formatting

`conform.lua` adds:

```lua
formatters_by_ft.java = { "google-java-format" }
```

`google-java-format` added to Mason `ensure_installed`. jdtls's built-in
formatter is not used — `google-java-format` is the de-facto standard and
keeps formatting consistent with team setups.

## Manual Setup Steps (Documented for the User)

1. `brew install openjdk@21` (and `openjdk@17` if needed).
2. `brew install coursier/formulas/coursier` (for bazel-bsp install).
3. For each Bazel repo: run the
   `coursier launch org.jetbrains.bsp:bazel-bsp:<v> -M ...Install`
   command at the repo root.
4. Lombok jar downloads automatically on first nvim launch into a Java
   buffer.
5. Mason installs `jdtls`, `java-debug-adapter`, `java-test`,
   `vscode-spring-boot-tools`, `google-java-format` on first launch.

## Failure Modes

- **Bazel repo without `.bsp/`** → notification with exact install command;
  jdtls starts with empty classpath until installed.
- **Lombok download fails (offline)** → notification on startup; jdtls
  still starts but Lombok-generated members will show as unresolved.
- **JDK 21 not installed** → jdtls fails to start; surfaced via standard
  LSP error notification.
- **Spring Boot LSP attaches to non-Spring project** → harmless; the LSP
  itself decides whether to do work based on detected dependencies.

## Out of Scope (Possible Follow-ups)

- Bazel target-specific run/debug configurations (`bazel run //foo:bar`).
- Auto-install of `bazel-bsp` per workspace.
- Auto-detection of `sdkman`/`jenv`/`mise`-managed JDKs.
- Custom Spring Boot dashboard UI inside nvim.

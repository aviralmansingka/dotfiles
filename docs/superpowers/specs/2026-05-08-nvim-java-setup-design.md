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

- Pin a Lombok jar at `~/.local/share/nvim/lombok/lombok.jar`.
- A bootstrap function in `jdtls.lua` downloads it via `curl` on first
  startup if absent. One-time, ~2 MB.
- Append `--jvm-arg=-javaagent:<path>` to the `cmd` jdtls launch args via
  `nvim-jdtls`.

Reason for not using Mason: Lombok is not a Mason package, and the
`jdtls` Mason registry does not bundle it. A small download function is
simpler than carrying a custom Mason source.

## Spring Boot Tools

Separate LSP server (separate process from jdtls) handling
`application.properties`/`application.yml` autocomplete, `@Bean` graph
navigation, Spring code lenses.

- Mason package: `vscode-spring-boot-tools`.
- Wired in `lua/plugins/spring-boot.lua` as
  `opts.servers.spring_boot_ls = {}` extending lspconfig, same pattern as
  the `lua_ls` and `copilot` blocks in `lsp.lua`.
- `filetypes = { "java", "yaml", "properties" }`.
- Runs alongside jdtls on `.java` buffers; both attach without conflict
  (different `name` and capabilities).

## JDK Management

Two distinct JDKs are in play.

### JDK that runs jdtls itself

jdtls 1.31+ requires Java 21+. Pin it explicitly in `jdtls.lua`:

```lua
local JDTLS_JDK = "/opt/homebrew/opt/openjdk@21"
-- prepended to PATH and set as JAVA_HOME for the jdtls subprocess
```

Independent of any project's JDK. `temurin@21` via brew is the assumed
install.

### JDKs available to compile projects

jdtls reads the project's target JDK from the build file
(`sourceCompatibility` for Gradle, `<source>` for Maven, toolchain rule
for Bazel). Configure available runtimes so jdtls can resolve them:

```lua
settings.java.configuration.runtimes = {
  { name = "JavaSE-17", path = "/opt/homebrew/opt/openjdk@17" },
  { name = "JavaSE-21", path = "/opt/homebrew/opt/openjdk@21" },
}
```

Add more entries as more JDKs are installed. No version-manager auto-detection.

## DAP Integration

In jdtls `on_attach`:

```lua
require("jdtls").setup_dap({ hotcodereplace = "auto" })
require("jdtls.dap").setup_dap_main_class_configs()
```

`setup_dap_main_class_configs()` discovers `main()` classes from the
BSP-resolved classpath (or Gradle/Maven for non-Bazel projects), so
`dap.continue()` shows them in a picker. Existing `dap.lua` keymaps and
dapui listeners apply unchanged.

## Test Runner

The `java-test` bundle exposes three jdtls commands. Bound buffer-locally
in the jdtls `on_attach`:

| Keymap | Action |
|---|---|
| `<leader>tn` | Test nearest method (`require("jdtls").test_nearest_method()`) |
| `<leader>tc` | Test class (`require("jdtls").test_class()`) |
| `<leader>tg` | Pick test goal — debug/run nearest, etc. (`require("jdtls").pick_test()`) |

Tests run as DAP sessions; breakpoints in test code work as in app code.

## Java-Specific Keymaps

Buffer-local, set in jdtls `on_attach`:

| Keymap | Action |
|---|---|
| `<leader>co` | Organize imports |
| `<leader>crv` | Extract variable |
| `<leader>crc` | Extract constant |
| `<leader>crm` | Extract method (normal + visual variants) |
| `<leader>jc` | Compile (`:JdtCompile`) |
| `<leader>jr` | Restart jdtls (`:JdtRestart`) |

LazyVim defaults (`<leader>ca`, `gd`, `gr`, etc.) work via standard LSP and
are not overridden.

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

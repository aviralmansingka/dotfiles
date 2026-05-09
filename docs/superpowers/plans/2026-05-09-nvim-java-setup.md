# Neovim Java Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-featured Java setup to LazyVim with Spring Boot, Lombok, Gradle, and Bazel-first monorepo support.

**Architecture:** Layer overrides on top of LazyVim's `lang.java` extra. New `jdtls.lua` carries the load-bearing config (BSP, Lombok agent, root detection, runtimes, on_attach keymaps). Sibling `spring-boot.lua` adds the Spring Boot Tools LSP. `conform.lua` and `mason.lua` get small edits.

**Tech Stack:** Neovim, LazyVim, `nvim-jdtls`, Eclipse `jdtls`, `bazel-bsp` (per-repo install), `nvim-dap` + `java-debug-adapter`, `java-test`, `spring-boot-tools`, `google-java-format`, Lombok.

**Note on testing.** Neovim plugin config is verified by launching nvim and observing behavior; there is no unit-test harness for "does jdtls receive the right args." Each task's verification step shows the exact `:command` to run and the expected output. Treat these as acceptance tests.

**Spec:** `docs/superpowers/specs/2026-05-08-nvim-java-setup-design.md`

---

## Task 1: Mason — install Java tooling

Adds the five Mason packages (jdtls, java-debug-adapter, java-test, spring-boot-tools, google-java-format) so subsequent tasks have something to attach to.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/mason.lua`

- [ ] **Step 1: Verify current state**

Run: `nvim --headless -c 'lua vim.print(require("mason-registry").get_installed_package_names())' -c 'qa' 2>&1 | head -5`
Expected: a list that does NOT contain `jdtls`, `java-debug-adapter`, `java-test`, `spring-boot-tools`, `google-java-format`.

- [ ] **Step 2: Add packages to ensure_installed**

Modify `nvim/.config/nvim/lua/plugins/mason.lua`:

```lua
-- add any tools you want to have installed below
return {
  "mason-org/mason.nvim",
  opts = {
    ensure_installed = {
      "copilot-language-server",
      "lua-language-server",
      "rust-analyzer",
      "stylua",
      "ruff",
      "pyright",
      "jdtls",
      "java-debug-adapter",
      "java-test",
      "vscode-spring-boot-tools",
      "google-java-format",
    },
  },
}
```

- [ ] **Step 3: Verify Mason installs the new packages**

Open nvim. Run `:Mason`. Confirm the five new packages show as installed (green checkmark). If any show as failed, run `:MasonInstall <name>` manually and report the error.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/mason.lua
git commit -m "Add Java tooling to Mason ensure_installed"
```

---

## Task 2: Enable LazyVim Java extra and create the override scaffold

Imports the LazyVim Java extra (which brings `nvim-jdtls`, default keymaps, default jdtls config) and creates an empty `jdtls.lua` override file we'll fill in subsequent tasks.

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/java.lua`
- Create: `nvim/.config/nvim/lua/plugins/jdtls.lua`

- [ ] **Step 1: Verify the extra is not yet enabled**

Run: `cat /Users/aviral/dotfiles/nvim/.config/nvim/lazyvim.json | grep java`
Expected: no output (the extra is not in `extras`).

- [ ] **Step 2: Create java.lua importing the LazyVim extra**

Create `nvim/.config/nvim/lua/plugins/java.lua`:

```lua
-- Imports LazyVim's lang.java extra. Overrides live in jdtls.lua.
return {
  { import = "lazyvim.plugins.extras.lang.java" },
}
```

- [ ] **Step 3: Create jdtls.lua skeleton (no-op override)**

Create `nvim/.config/nvim/lua/plugins/jdtls.lua`:

```lua
-- Overrides LazyVim's lang.java extra. Filled in by subsequent tasks:
-- root markers, JDK runtimes, Lombok agent, BSP, on_attach keymaps.
return {
  "mfussenegger/nvim-jdtls",
  opts = function(_, opts)
    return opts
  end,
}
```

- [ ] **Step 4: Verify nvim launches and the extra loads**

Run: `nvim --headless -c 'lua print(pcall(require, "jdtls"))' -c 'qa' 2>&1`
Expected: `true` (the `jdtls` Lua module is now available, meaning the extra installed `nvim-jdtls`).

- [ ] **Step 5: Verify jdtls auto-attaches to a Java buffer**

Create a throwaway Java file: `mkdir -p /tmp/javatest && echo 'class Foo {}' > /tmp/javatest/Foo.java`

Open it: `nvim /tmp/javatest/Foo.java` then run `:LspInfo` after waiting ~10s.
Expected: `jdtls` listed as attached (it may print errors about classpath — that's fine for now, we'll fix root detection in Task 3).
Quit: `:qa!`.

- [ ] **Step 6: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/java.lua nvim/.config/nvim/lua/plugins/jdtls.lua
git commit -m "Enable LazyVim Java extra with jdtls override scaffold"
```

---

## Task 3: jdtls root detection, workspace dir, JDK runtimes

Overrides the extra's defaults so jdtls picks Bazel markers first, places its workspace cache per-project, and knows about multiple JDKs.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/jdtls.lua`

- [ ] **Step 1: Replace jdtls.lua with the full override**

Replace `nvim/.config/nvim/lua/plugins/jdtls.lua` with:

```lua
local JDTLS_JDK = "/opt/homebrew/opt/openjdk@21"

return {
  "mfussenegger/nvim-jdtls",
  opts = function(_, opts)
    opts.root_dir = require("jdtls.setup").find_root({
      "MODULE.bazel",
      "WORKSPACE",
      "WORKSPACE.bazel",
      "build.gradle",
      "build.gradle.kts",
      "pom.xml",
      ".git",
    })

    opts.project_name = function(root_dir)
      return vim.fn.fnamemodify(root_dir, ":p:h:t")
    end

    opts.jdtls_config_dir = function(project_name)
      return vim.fn.stdpath("cache") .. "/jdtls/" .. project_name .. "/config"
    end

    opts.jdtls_workspace_dir = function(project_name)
      return vim.fn.stdpath("cache") .. "/jdtls/" .. project_name .. "/workspace"
    end

    opts.settings = vim.tbl_deep_extend("force", opts.settings or {}, {
      java = {
        configuration = {
          runtimes = {
            { name = "JavaSE-17", path = "/opt/homebrew/opt/openjdk@17" },
            { name = "JavaSE-21", path = "/opt/homebrew/opt/openjdk@21" },
          },
        },
        completion = {
          postfix = { enabled = true },
          guessMethodArguments = true,
        },
      },
    })

    opts.cmd_env = vim.tbl_deep_extend("force", opts.cmd_env or {}, {
      JAVA_HOME = JDTLS_JDK,
      PATH = JDTLS_JDK .. "/bin:" .. vim.env.PATH,
    })

    return opts
  end,
}
```

- [ ] **Step 2: Verify JDK 21 is installed**

Run: `ls /opt/homebrew/opt/openjdk@21/bin/java`
Expected: file exists. If not: `brew install openjdk@21` and re-run.

- [ ] **Step 3: Verify workspace dir is per-project**

Open the throwaway Java file: `nvim /tmp/javatest/Foo.java` and wait ~10s. Run `:lua print(vim.fn.stdpath("cache") .. "/jdtls/javatest/workspace")` then check on disk:

Run: `ls ~/.cache/nvim/jdtls/javatest/workspace 2>&1 | head -3`
Expected: directory exists with jdtls workspace files inside.
Quit nvim with `:qa!`.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/jdtls.lua
git commit -m "Configure jdtls root detection, workspace dirs, JDK runtimes"
```

---

## Task 4: Verify Mason-bundled Lombok is wired

**Discovery during execution:** Mason's `jdtls` package bundles its own `lombok.jar` at `~/.local/share/nvim/mason/share/jdtls/lombok.jar`, and the launcher already includes it as a `-javaagent`. No custom download or javaagent injection needed. This task verifies the bundled jar is in place and reaching jdtls.

**Files:** none (verification only)

- [x] **Step 1: Verify Mason's bundled lombok jar exists**

Run: `ls -la ~/.local/share/nvim/mason/share/jdtls/lombok.jar`
Expected: file (or symlink) exists, points to the Mason jdtls package.

- [x] **Step 2: Verify the javaagent reaches jdtls launch cmd**

Run from a test project root:
```sh
cd /tmp/javatest && nvim --headless Foo.java -c 'lua vim.defer_fn(function() local clients = vim.lsp.get_clients({ name = "jdtls" }); for _,c in ipairs(clients) do for _,arg in ipairs(c.config.cmd) do if string.find(arg, "javaagent") then print(arg) end end end vim.cmd("qa!") end, 12000)' 2>&1 | grep javaagent
```
Expected: at least one line like `--jvm-arg=-javaagent:/Users/aviral/.local/share/nvim/mason/share/jdtls/lombok.jar`.

- [x] **Step 3: No commit needed for this task** — no code changes. Spec/plan already updated to document the discovery.

---

## Task 5: BSP settings and missing-`.bsp/` notification

Enables `bsp.enabled = "auto"` so jdtls picks BSP when `.bsp/` exists, and notifies the user with the install command if a Bazel repo lacks `.bsp/`.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/jdtls.lua`

- [ ] **Step 1: Add BSP settings and bootstrap notification**

In `nvim/.config/nvim/lua/plugins/jdtls.lua`, find the `opts.settings` block and replace it with:

```lua
    opts.settings = vim.tbl_deep_extend("force", opts.settings or {}, {
      java = {
        import = {
          bsp = { enabled = "auto" },
          gradle = { enabled = true },
          maven = { enabled = true },
        },
        configuration = {
          runtimes = {
            { name = "JavaSE-17", path = "/opt/homebrew/opt/openjdk@17" },
            { name = "JavaSE-21", path = "/opt/homebrew/opt/openjdk@21" },
          },
        },
        completion = {
          postfix = { enabled = true },
          guessMethodArguments = true,
        },
      },
    })
```

Then, near the top of `jdtls.lua` (above the `return {` block), add:

```lua
local function check_bazel_bsp(root_dir)
  if not root_dir then
    return
  end
  local bazel_markers = { "MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel" }
  local has_bazel = false
  for _, marker in ipairs(bazel_markers) do
    if vim.fn.filereadable(root_dir .. "/" .. marker) == 1 then
      has_bazel = true
      break
    end
  end
  if not has_bazel then
    return
  end
  if vim.fn.isdirectory(root_dir .. "/.bsp") == 1 then
    return
  end
  vim.notify(
    "Bazel repo at " .. root_dir .. " has no .bsp/. Install bazel-bsp:\n"
      .. "  cd " .. root_dir .. "\n"
      .. "  coursier launch org.jetbrains.bsp:bazel-bsp:<version> -M org.jetbrains.bsp.bazel.install.Install",
    vim.log.levels.WARN
  )
end
```

Inside the `opts = function(_, opts)` body, after `opts.root_dir = ...`, add:

```lua
    check_bazel_bsp(opts.root_dir)
```

- [ ] **Step 2: Verify the notification fires for a Bazel repo without .bsp/**

Create a fake Bazel repo:
```bash
mkdir -p /tmp/bazeltest && touch /tmp/bazeltest/MODULE.bazel
echo 'class Bar {}' > /tmp/bazeltest/Bar.java
```

Open: `nvim /tmp/bazeltest/Bar.java` and wait ~5s. Run `:messages`.
Expected: a warning containing "Bazel repo at /tmp/bazeltest has no .bsp/" and the install command.
Quit with `:qa!`.

- [ ] **Step 3: Verify no notification for a Bazel repo WITH .bsp/**

Run: `mkdir -p /tmp/bazeltest/.bsp && touch /tmp/bazeltest/.bsp/bazelbsp.json`

Open: `nvim /tmp/bazeltest/Bar.java`. Run `:messages`.
Expected: no warning about bazel-bsp.
Quit with `:qa!`.
Cleanup: `rm -rf /tmp/bazeltest`.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/jdtls.lua
git commit -m "Enable BSP auto-detect and warn when bazel-bsp is missing"
```

---

## Task 6: jdtls on_attach — DAP, test runner, refactor keymaps

Sets up the `java` DAP adapter, discovers main classes from the classpath, and binds buffer-local keymaps for tests, refactors, organize-imports, compile, and restart.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/jdtls.lua`

- [ ] **Step 1: Add the on_attach with all keymaps**

In `nvim/.config/nvim/lua/plugins/jdtls.lua`, inside the `opts = function(_, opts)` body (just before `return opts`), add:

```lua
    local previous_on_attach = opts.on_attach
    opts.on_attach = function(client, bufnr)
      if previous_on_attach then
        previous_on_attach(client, bufnr)
      end

      local jdtls = require("jdtls")
      local jdtls_dap = require("jdtls.dap")

      jdtls.setup_dap({ hotcodereplace = "auto" })
      jdtls_dap.setup_dap_main_class_configs()

      local map = function(lhs, rhs, desc)
        vim.keymap.set("n", lhs, rhs, { buffer = bufnr, desc = desc })
      end
      local vmap = function(lhs, rhs, desc)
        vim.keymap.set("v", lhs, rhs, { buffer = bufnr, desc = desc })
      end

      -- Tests
      map("<leader>tn", function() jdtls.test_nearest_method() end, "Java: Test nearest method")
      map("<leader>tc", function() jdtls.test_class() end, "Java: Test class")
      map("<leader>tg", function() jdtls.pick_test() end, "Java: Pick test goal")

      -- Refactors
      map("<leader>co", function() jdtls.organize_imports() end, "Java: Organize imports")
      map("<leader>crv", function() jdtls.extract_variable() end, "Java: Extract variable")
      map("<leader>crc", function() jdtls.extract_constant() end, "Java: Extract constant")
      map("<leader>crm", function() jdtls.extract_method() end, "Java: Extract method")
      vmap("<leader>crv", function() jdtls.extract_variable(true) end, "Java: Extract variable (visual)")
      vmap("<leader>crc", function() jdtls.extract_constant(true) end, "Java: Extract constant (visual)")
      vmap("<leader>crm", function() jdtls.extract_method(true) end, "Java: Extract method (visual)")

      -- Project
      map("<leader>jc", "<cmd>JdtCompile<cr>", "Java: Compile")
      map("<leader>jr", "<cmd>JdtRestart<cr>", "Java: Restart jdtls")
    end
```

- [ ] **Step 2: Verify the keymaps register on a Java buffer**

Open: `nvim /tmp/javatest/Foo.java` and wait ~10s for jdtls to attach. Run:
`:lua vim.print(vim.tbl_filter(function(m) return m.desc and m.desc:match("Java:") end, vim.api.nvim_buf_get_keymap(0, "n")))`
Expected: a list of mappings with descriptions starting `Java:` (organize imports, extract, tests, compile, restart).
Quit with `:qa!`.

- [ ] **Step 3: Verify the DAP `java` adapter is registered**

Open: `nvim /tmp/javatest/Foo.java` and wait ~10s. Run:
`:lua print(require("dap").adapters.java ~= nil)`
Expected: `true`.
Quit with `:qa!`.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/jdtls.lua
git commit -m "Wire jdtls on_attach with DAP, test runner, refactor keymaps"
```

---

## Task 7: Spring Boot Tools sibling LSP

Adds `spring_boot_ls` to the lspconfig server list so it attaches alongside jdtls on Java/yaml/properties buffers in Spring projects.

**Files:**
- Create: `nvim/.config/nvim/lua/plugins/spring-boot.lua`

- [ ] **Step 1: Verify Spring Boot Tools is installed via Mason**

Run: `ls ~/.local/share/nvim/mason/packages/vscode-spring-boot-tools 2>&1 | head -3`
Expected: directory exists (installed in Task 1).

- [ ] **Step 2: Create spring-boot.lua**

Create `nvim/.config/nvim/lua/plugins/spring-boot.lua`:

```lua
return {
  "neovim/nvim-lspconfig",
  opts = function(_, opts)
    opts.servers = opts.servers or {}
    opts.servers.spring_boot_ls = {
      filetypes = { "java", "yaml", "properties" },
    }
    return opts
  end,
}
```

- [ ] **Step 3: Verify the LSP attaches in a Spring project**

Create a fake Spring project:
```bash
mkdir -p /tmp/springtest/src/main/resources
cat > /tmp/springtest/build.gradle <<'EOF'
plugins { id 'org.springframework.boot' version '3.2.0' }
EOF
echo 'server.port=8080' > /tmp/springtest/src/main/resources/application.properties
```

Open: `nvim /tmp/springtest/src/main/resources/application.properties` and wait ~10s. Run `:LspInfo`.
Expected: `spring_boot_ls` is listed (it may say "started" even if it doesn't attach to non-Spring properties — that's fine).
Quit with `:qa!`.
Cleanup: `rm -rf /tmp/springtest`.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/spring-boot.lua
git commit -m "Add Spring Boot Tools as sibling LSP"
```

---

## Task 8: conform — google-java-format for Java buffers

Wires `google-java-format` into conform so `:lua require('conform').format()` (or LazyVim's `<leader>cf`) formats Java buffers consistently.

**Files:**
- Modify: `nvim/.config/nvim/lua/plugins/conform.lua`

- [ ] **Step 1: Read the current conform.lua**

Run: `cat /Users/aviral/dotfiles/nvim/.config/nvim/lua/plugins/conform.lua`
Note the current `formatters_by_ft` shape (you'll add the `java` key inside it).

- [ ] **Step 2: Add Java to formatters_by_ft**

Edit `nvim/.config/nvim/lua/plugins/conform.lua` and add `java = { "google-java-format" }` to the `formatters_by_ft` table. The exact location depends on the existing structure — add it next to other entries like `python` or `lua`.

If the existing file looks like:
```lua
return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      lua = { "stylua" },
      python = { "ruff_format" },
    },
  },
}
```

Change to:
```lua
return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      lua = { "stylua" },
      python = { "ruff_format" },
      java = { "google-java-format" },
    },
  },
}
```

- [ ] **Step 3: Verify formatting works on a Java buffer**

Create a poorly-formatted file: `echo 'class Foo{public static void main(String[]a){System.out.println("hi");}}' > /tmp/javatest/Bad.java`

Open: `nvim /tmp/javatest/Bad.java`, run `:lua require('conform').format({ async = false })`, then `:write`.

Expected: file is reformatted with proper indentation and line breaks.
Verify: `cat /tmp/javatest/Bad.java` shows multi-line formatted output.
Quit with `:qa!`.

- [ ] **Step 4: Commit**

```bash
git add nvim/.config/nvim/lua/plugins/conform.lua
git commit -m "Format Java buffers with google-java-format"
```

---

## Task 9: End-to-end smoke test

Final acceptance check: open a real Bazel-like project with .bsp/, verify jdtls + spring + dap + tests + format all coexist without errors.

**Files:** none (verification only)

- [ ] **Step 1: Set up a synthetic project with all features**

```bash
rm -rf /tmp/javasmoke
mkdir -p /tmp/javasmoke/.bsp /tmp/javasmoke/src/main/java
touch /tmp/javasmoke/MODULE.bazel
echo '{"name":"bazel-bsp","argv":["echo"],"version":"0.0","bspVersion":"2.1.0","languages":["java"]}' > /tmp/javasmoke/.bsp/bazelbsp.json
cat > /tmp/javasmoke/src/main/java/Foo.java <<'EOF'
import lombok.Data;
@Data
public class Foo {
  private String name;
}
EOF
```

- [ ] **Step 2: Open and verify clean attach**

Open: `nvim /tmp/javasmoke/src/main/java/Foo.java` and wait 15s.

Run `:LspInfo`.
Expected: `jdtls` attached. `spring_boot_ls` may or may not attach depending on filetype detection — that's fine.

Run `:messages`.
Expected: NO warning about missing `.bsp/`. (May see Lombok download warning if not yet downloaded — re-running is fine.)

- [ ] **Step 3: Verify keymaps and DAP**

In the same session, run:
```
:lua print(require("dap").adapters.java ~= nil)
```
Expected: `true`.

Try `<leader>co` (organize imports). Expected: no error (file may be unchanged since there are no imports to organize).

Quit with `:qa!`.

- [ ] **Step 4: Final commit (no-op or amend chain summary)**

```bash
cd /Users/aviral/dotfiles && git log --oneline -10
```
Expected: one commit per Task 1-8 visible in `git log`. No further commit needed for Task 9.

- [ ] **Step 5: Cleanup**

```bash
rm -rf /tmp/javatest /tmp/javasmoke
```

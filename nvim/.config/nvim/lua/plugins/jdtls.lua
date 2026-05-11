local JDTLS_JDK = "/opt/homebrew/opt/openjdk@25"

local bsp_warned = {}

local function check_bazel_bsp(root_dir)
  if not root_dir or bsp_warned[root_dir] then
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
  bsp_warned[root_dir] = true
  vim.notify(
    "Bazel repo at "
      .. root_dir
      .. " has no .bsp/. Install bazel-bsp:\n"
      .. "  cd "
      .. root_dir
      .. "\n"
      .. "  coursier launch org.jetbrains.bsp:bazel-bsp:<version> -M org.jetbrains.bsp.bazel.install.Install",
    vim.log.levels.WARN
  )
end

return {
  "mfussenegger/nvim-jdtls",
  opts = function(_, opts)
    opts.root_dir = function(fname)
      local root = require("jdtls.setup").find_root({
        "MODULE.bazel",
        "WORKSPACE",
        "WORKSPACE.bazel",
        "build.gradle",
        "build.gradle.kts",
        "pom.xml",
        ".git",
      }, fname)
      check_bazel_bsp(root)
      return root
    end

    opts.project_name = function(root_dir)
      return root_dir and vim.fs.basename(root_dir)
    end

    opts.jdtls_config_dir = function(project_name)
      return vim.fn.stdpath("cache") .. "/jdtls/" .. project_name .. "/config"
    end

    opts.jdtls_workspace_dir = function(project_name)
      return vim.fn.stdpath("cache") .. "/jdtls/" .. project_name .. "/workspace"
    end

    opts.settings = vim.tbl_deep_extend("force", opts.settings or {}, {
      java = {
        import = {
          bsp = { enabled = "auto" },
          gradle = { enabled = true },
          maven = { enabled = true },
        },
        configuration = {
          runtimes = {
            {
              name = "JavaSE-25",
              path = "/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home",
              default = true,
            },
          },
        },
        completion = {
          postfix = { enabled = true },
          guessMethodArguments = true,
        },
        -- Inlay hints + code lens. JDT LS docs disagree on casing across
        -- versions (wiki: lowercase `inlayhints`, singular `implementationCodeLens`;
        -- VS Code extension: camelCase `inlayHints`, plural `implementationsCodeLens`).
        -- We send both forms; jdtls silently ignores keys it doesn't recognize.
        inlayhints = {
          parameterNames = { enabled = "all" },
        },
        inlayHints = {
          parameterNames = { enabled = "all" },
        },
        referencesCodeLens = { enabled = true },
        implementationCodeLens = { enabled = true },
        implementationsCodeLens = { enabled = true },
      },
    })

    opts.cmd_env = vim.tbl_deep_extend("force", opts.cmd_env or {}, {
      JAVA_HOME = JDTLS_JDK,
      PATH = JDTLS_JDK .. "/bin:" .. vim.env.PATH,
    })

    -- java-debug-adapter bundle for non-test DAP debug. The java-test bundles
    -- (com.microsoft.java.test.*) are intentionally NOT loaded: we use neotest
    -- + neotest-java's JUnit Console runner as the sole Java test path. Keeping
    -- jdtls unaware of test methods avoids LazyVim's lang.java extra wiring
    -- jdtls.test_class / jdtls.test_nearest_method onto <leader>tt/tr/tT.
    -- Spring Boot's JDT extensions are still appended below for the
    -- spring-boot.nvim classpath listener.
    local mason_share = vim.fn.expand("$MASON/share")
    local bundles = vim.fn.glob(
      mason_share .. "/java-debug-adapter/com.microsoft.java.debug.plugin-*jar",
      false,
      true
    )
    local ok, spring_boot = pcall(require, "spring_boot")
    if ok and spring_boot.java_extensions then
      vim.list_extend(bundles, spring_boot.java_extensions() or {})
    end
    opts.jdtls = opts.jdtls or {}
    opts.jdtls.init_options = vim.tbl_deep_extend("force", opts.jdtls.init_options or {}, {
      bundles = bundles,
    })

    return opts
  end,
  init = function()
    -- Augroup with `clear = true` so :Lazy reload nvim-jdtls replaces the
    -- prior autocmd cleanly. Without this, reloads stack duplicate
    -- LspAttach callbacks and the oldest registration's keymaps win,
    -- masking newly-edited keymap bindings until a full nvim restart.
    local jdtls_attach = vim.api.nvim_create_augroup("jdtls_lspattach_keymaps", { clear = true })
    vim.api.nvim_create_autocmd("LspAttach", {
      group = jdtls_attach,
      callback = function(args)
        local client = vim.lsp.get_client_by_id(args.data.client_id)
        if not (client and client.name == "jdtls") then
          return
        end
        -- Defer the keymap binding past the synchronous LspAttach handler
        -- chain. LazyVim's lang.java extra registers an UNGROUPED LspAttach
        -- (lang/java.lua:~194) that binds <leader>tT to jdtls.dap.test_class
        -- after our augroup runs, clobbering ours via buffer-local
        -- last-write-wins. vim.schedule queues us on the next event-loop
        -- tick — guaranteed after every sync handler in this LspAttach.
        vim.schedule(function()
          if not vim.api.nvim_buf_is_valid(args.buf) then
            return
          end
          -- Tear down LazyVim lang.java's buffer-local jdtls test maps so
          -- neotest is the only Java test path. lang.java's ungrouped
          -- LspAttach (lang/java.lua:~194) binds these to jdtls.test_class /
          -- jdtls.test_nearest_method / jdtls.dap.test_class. We unmap here
          -- (after the deferred schedule lets that autocmd run first) and
          -- re-set tg/tT below to neotest equivalents. tt/tr fall through to
          -- LazyVim test/core's global neotest mappings.
          for _, lhs in ipairs({ "<leader>tt", "<leader>tr", "<leader>tT" }) do
            pcall(vim.keymap.del, "n", lhs, { buffer = args.buf })
          end
          local map = function(lhs, rhs, desc)
            vim.keymap.set("n", lhs, rhs, { buffer = args.buf, desc = desc })
          end
          map("<leader>tg", function()
            require("neotest").run.run()
          end, "Java: Run nearest test (neotest)")
          -- <leader>tT: run-all-in-project. Walks up for the first
          -- gradle/maven/bazel marker, falls back to buffer dir, hands the
          -- root to neotest. Bazel markers included so the keymap is harmless
          -- on Bazel-Java buffers (neotest reports "no tests" rather than
          -- crash; Bazel-Java tests run via bazel CLI).
          map("<leader>tT", function()
            local buf = vim.api.nvim_buf_get_name(0)
            local from = (buf ~= "" and vim.fn.fnamemodify(buf, ":p:h")) or vim.uv.cwd()
            local root = vim.fs.root(from, {
              "build.gradle",
              "build.gradle.kts",
              "settings.gradle",
              "settings.gradle.kts",
              "pom.xml",
              "MODULE.bazel",
              "WORKSPACE",
              "WORKSPACE.bazel",
            }) or from
            require("neotest").run.run(root)
          end, "Java: Run all tests in project (neotest)")
          map("<leader>jc", "<cmd>JdtCompile<cr>", "Java: Compile")
          map("<leader>jr", "<cmd>JdtRestart<cr>", "Java: Restart jdtls")
        end)
      end,
    })
  end,
}

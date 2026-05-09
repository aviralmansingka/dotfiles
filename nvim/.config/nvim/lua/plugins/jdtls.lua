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
      },
    })

    opts.cmd_env = vim.tbl_deep_extend("force", opts.cmd_env or {}, {
      JAVA_HOME = JDTLS_JDK,
      PATH = JDTLS_JDK .. "/bin:" .. vim.env.PATH,
    })

    -- LazyVim globs every jar under $MASON/share/java-test/, but jacocoagent
    -- and the test-runner fat jar aren't OSGi bundles, so jdtls logs
    -- "Failed to load extension bundles" for them. Filter to only OSGi bundles.
    local mason_share = vim.fn.expand("$MASON/share")
    local bundles = vim.fn.glob(
      mason_share .. "/java-debug-adapter/com.microsoft.java.debug.plugin-*jar",
      false,
      true
    )
    for _, jar in ipairs(vim.fn.glob(mason_share .. "/java-test/*.jar", false, true)) do
      local name = vim.fs.basename(jar)
      if not (name:match("jacocoagent") or name:match("%-jar%-with%-dependencies%.jar$")) then
        table.insert(bundles, jar)
      end
    end
    opts.jdtls = opts.jdtls or {}
    opts.jdtls.init_options = vim.tbl_deep_extend("force", opts.jdtls.init_options or {}, {
      bundles = bundles,
    })

    return opts
  end,
  init = function()
    vim.api.nvim_create_autocmd("LspAttach", {
      callback = function(args)
        local client = vim.lsp.get_client_by_id(args.data.client_id)
        if not (client and client.name == "jdtls") then
          return
        end
        local map = function(lhs, rhs, desc)
          vim.keymap.set("n", lhs, rhs, { buffer = args.buf, desc = desc })
        end
        map("<leader>tg", function()
          require("jdtls").pick_test()
        end, "Java: Pick test goal")
        map("<leader>jc", "<cmd>JdtCompile<cr>", "Java: Compile")
        map("<leader>jr", "<cmd>JdtRestart<cr>", "Java: Restart jdtls")
      end,
    })
  end,
}

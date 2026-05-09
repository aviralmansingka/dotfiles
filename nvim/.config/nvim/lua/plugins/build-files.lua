local GROOVY_JAR = vim.fn.stdpath("data")
  .. "/mason/packages/groovy-language-server/build/libs/groovy-language-server-all.jar"
local JDK = "/opt/homebrew/opt/openjdk@25/bin/java"

return {
  "neovim/nvim-lspconfig",
  opts = function(_, opts)
    opts.servers = opts.servers or {}

    if vim.fn.filereadable(GROOVY_JAR) == 1 then
      opts.servers.groovyls = {
        cmd = { JDK, "-jar", GROOVY_JAR },
        filetypes = { "groovy" },
        root_markers = { "build.gradle", "settings.gradle", "Jenkinsfile", ".git" },
      }
    end

    opts.servers.starpls = {
      filetypes = { "bzl" },
      root_markers = { "MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel", ".git" },
    }

    return opts
  end,
}

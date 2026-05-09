local GROOVY_JAR = vim.fn.stdpath("data")
  .. "/mason/packages/groovy-language-server/build/libs/groovy-language-server-all.jar"
local JDK = "/opt/homebrew/opt/openjdk@25/bin/java"

return {
  "neovim/nvim-lspconfig",
  opts = function(_, opts)
    opts.servers = opts.servers or {}

    -- gradle_ls (Microsoft's vscode-gradle LSP) handles Gradle projects.
    -- Mason installs the gradle-language-server binary into PATH; the
    -- lspconfig schema's default cmd = { 'gradle-language-server' } finds it.
    opts.servers.gradle_ls = {
      init_options = {
        settings = {
          gradleWrapperEnabled = true,
        },
      },
    }

    -- groovyls handles plain .groovy / Jenkinsfile contexts. Skip Gradle
    -- projects so gradle_ls owns those buffers without overlap.
    if vim.fn.filereadable(GROOVY_JAR) == 1 then
      local util = require("lspconfig.util")
      opts.servers.groovyls = {
        cmd = { JDK, "-jar", GROOVY_JAR },
        filetypes = { "groovy" },
        root_dir = function(fname)
          if
            util.root_pattern(
              "settings.gradle",
              "settings.gradle.kts",
              "build.gradle",
              "build.gradle.kts"
            )(fname)
          then
            return nil
          end
          return util.root_pattern("Jenkinsfile", ".git")(fname)
        end,
      }
    end

    opts.servers.starpls = {
      filetypes = { "bzl" },
      root_markers = { "MODULE.bazel", "WORKSPACE", "WORKSPACE.bazel", ".git" },
    }

    return opts
  end,
}

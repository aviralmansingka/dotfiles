-- Overrides LazyVim's lang.java extra. Filled in by subsequent tasks:
-- root markers, JDK runtimes, Lombok agent, BSP, on_attach keymaps.
return {
  "mfussenegger/nvim-jdtls",
  opts = function(_, opts)
    return opts
  end,
}

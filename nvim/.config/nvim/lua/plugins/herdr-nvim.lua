return {
  -- herdr-nvim (ChmaraX/herdr-nvim): the nvim half of the Herdr sidebar.
  -- The sidebar's headless daemon loads this config, so the :Herdr
  -- commands and <leader>a annotation maps are live inside the sidebar
  -- (comments/references sent back to the agent with file:line context).
  -- The Herdr-side plugin and its keybindings (prefix+t toggle, prefix+o
  -- picker) live in herdr/.config/herdr/config.toml.
  {
    "ChmaraX/herdr-nvim",
    opts = {},
  },
}

return {
  "norcalli/nvim-colorizer.lua",
  event = "BufReadPre",
  opts = {
    filetypes = {
      "*",
      lua = { rgb_fn = true },
      css = { rgb_fn = true },
      html = { names = false },
      "!lazy",
    },
    user_default_options = {
      RGB = true,
      RRGGBB = true,
      names = true,
      RRGGBBAA = true,
      AARRGGBB = false,
      rgb_fn = false,
      hsl_fn = false,
      css = false,
      css_fn = false,
      mode = "background",
      tailwind = false,
      sass = { enable = false },
      virtualtext = "■",
      always_update = false,
    },
  },
  config = function(_, opts)
    require("colorizer").setup(opts)
  end,
}


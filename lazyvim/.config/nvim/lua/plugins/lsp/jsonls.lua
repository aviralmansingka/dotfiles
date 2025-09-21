-- JSON Language Server Configuration
return {
  -- on_new_config = function(new_config)
  --   new_config.settings.json.schemas = new_config.settings.json.schemas or {}
  --   vim.list_extend(new_config.settings.json.schemas, require("schemastore").json.schemas())
  -- end,
  settings = {
    json = {
      format = {
        enable = true,
      },
      validate = { enable = true },
      -- Uncomment and install nvim-schemastore for enhanced JSON schema support:
      -- schemas = require("schemastore").json.schemas(),
    },
  },
}
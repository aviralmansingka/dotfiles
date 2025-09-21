-- YAML Language Server Configuration
return {
  settings = {
    yaml = {
      -- YAML formatting settings
      format = {
        enable = true,
        singleQuote = false,
        bracketSpacing = true,
      },
      -- Validation settings
      validate = true,
      completion = true,
      hover = true,
      -- Schema settings
      schemaStore = {
        -- Enable built-in schemaStore support
        enable = false,
        -- Avoid TypeError: Cannot read properties of undefined (reading 'length')
        url = "",
      },
      schemas = {
        -- Common schema associations
        kubernetes = { "*.k8s.yaml", "*.k8s.yml", "**/k8s/**/*.yaml", "**/k8s/**/*.yml" },
        ["https://json.schemastore.org/github-workflow.json"] = ".github/workflows/*.{yml,yaml}",
        ["https://json.schemastore.org/github-action.json"] = ".github/action.{yml,yaml}",
        ["https://json.schemastore.org/docker-compose.json"] = "docker-compose*.{yml,yaml}",
        ["https://json.schemastore.org/kustomization.json"] = "kustomization.{yml,yaml}",
        ["https://json.schemastore.org/ansible-playbook.json"] = "*.ansible.{yml,yaml}",
      },
      -- Customization for different file types
      customTags = {
        "!vault",
        "!encrypted/pkcs1-oaep",
        "!reference sequence",
        "!include",
      },
    },
  },
}
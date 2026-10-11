-- lua/config/indent.lua: per-filetype indent stance (CI row X11).
--
-- The real autocmd file is dofile'd inside the headless instance; the
-- FileType event drives the real callback. Reload idempotency pins the
-- augroup contract (Lazy init clobber class).

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

local function load_indent()
  return dofile(root .. "/lua/config/indent.lua")
end

-- nvim reports one row per pattern; count distinct autocmd ids instead.
local function autocmd_count()
  local ids = {}
  for _, au in ipairs(vim.api.nvim_get_autocmds({ group = "IndentStance" })) do
    ids[au.id] = true
  end
  return vim.tbl_count(ids)
end

H.run("indent_spec", function()
  load_indent()
  H.eq(autocmd_count(), 1, "loading indent.lua registers exactly one FileType autocmd")

  local function stance_for(filetype)
    local buf = vim.api.nvim_create_buf(false, true)
    -- start from the opposite of the expected stance so the flip is proof
    vim.bo[buf].expandtab = true
    vim.bo[buf].shiftwidth = 8
    vim.bo[buf].tabstop = 8
    vim.bo[buf].filetype = filetype -- fires the real FileType autocmd
    return {
      expandtab = vim.bo[buf].expandtab,
      shiftwidth = vim.bo[buf].shiftwidth,
      tabstop = vim.bo[buf].tabstop,
    }
  end

  H.eq(stance_for("python"), { expandtab = true, shiftwidth = 4, tabstop = 4 }, "python: PEP 8 four spaces")
  H.eq(stance_for("go"), { expandtab = false, shiftwidth = 4, tabstop = 4 }, "go: gofmt literal tabs")
  H.eq(stance_for("c"), { expandtab = true, shiftwidth = 2, tabstop = 2 }, "c: LLVM two spaces")
  H.eq(stance_for("cpp"), { expandtab = true, shiftwidth = 2, tabstop = 2 }, "cpp: LLVM two spaces")
  H.eq(stance_for("rust"), { expandtab = true, shiftwidth = 4, tabstop = 4 }, "rust: rustfmt four spaces")
  H.eq(stance_for("lua"), { expandtab = true, shiftwidth = 2, tabstop = 2 }, "lua: StyLua two spaces")

  -- unlisted filetypes keep whatever the buffer already had
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].expandtab = false
  vim.bo[buf].shiftwidth = 6
  vim.bo[buf].tabstop = 6
  vim.bo[buf].filetype = "text"
  H.eq({ vim.bo[buf].expandtab, vim.bo[buf].shiftwidth, vim.bo[buf].tabstop }, { false, 6, 6 },
    "unlisted filetypes are untouched")

  -- ── reload idempotency: re-source must not duplicate autocmds ──────────
  load_indent()
  H.eq(autocmd_count(), 1, "re-sourcing indent.lua keeps a single FileType autocmd (clear=true augroup)")
  local patterns = {}
  for _, au in ipairs(vim.api.nvim_get_autocmds({ group = "IndentStance" })) do
    patterns[au.pattern] = true
  end
  H.eq(vim.tbl_count(patterns), 8, "the autocmd covers exactly the eight configured filetypes")
  for _, ft in ipairs({ "c", "cpp", "objc", "objcpp", "python", "go", "rust", "lua" }) do
    H.truthy(patterns[ft], "pattern list includes " .. ft)
  end

  -- re-firing the event does not stack effects
  local b2 = vim.api.nvim_create_buf(false, true)
  vim.bo[b2].filetype = "python"
  vim.api.nvim_exec_autocmds("FileType", { buffer = b2 })
  vim.api.nvim_exec_autocmds("FileType", { buffer = b2 })
  H.eq({ vim.bo[b2].shiftwidth, vim.bo[b2].tabstop, vim.bo[b2].expandtab }, { 4, 4, true },
    "firing FileType twice yields the same stance")
end)

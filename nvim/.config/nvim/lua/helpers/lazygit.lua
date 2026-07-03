local M = {}

local uv = vim.uv or vim.loop

local function is_dir(path)
  if not path or path == "" then
    return false
  end
  local stat = uv.fs_stat(path)
  return stat and stat.type == "directory"
end

local function normalize(path)
  return vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
end

local function is_local_path(path)
  return path and path ~= "" and not path:match("^[%w+.-]+://")
end

local function buffer_dir(bufnr)
  local name = vim.api.nvim_buf_get_name(bufnr or 0)
  if not is_local_path(name) then
    return nil
  end

  local dir = normalize(vim.fn.fnamemodify(name, ":h"))
  return is_dir(dir) and dir or nil
end

function M.cwd_for_buffer(bufnr)
  local start = buffer_dir(bufnr)
  if not start then
    local cwd = uv.cwd() or vim.fn.getcwd()
    start = is_dir(cwd) and normalize(cwd) or nil
  end

  if not start then
    return nil
  end

  local root = Snacks and Snacks.git and Snacks.git.get_root and Snacks.git.get_root(start) or nil
  if is_dir(root) then
    return normalize(root)
  end

  return start
end

function M.open()
  local cwd = M.cwd_for_buffer(0)
  if cwd then
    Snacks.lazygit({ cwd = cwd })
  else
    Snacks.lazygit()
  end
end

return M

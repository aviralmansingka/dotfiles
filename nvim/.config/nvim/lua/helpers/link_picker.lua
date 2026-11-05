-- Link picker: insert a Markdown link to a vault note, Notion page, or Drive file.
-- Stage 1 picks the source, stage 2 fuzzy-searches that source, and confirm
-- inserts a titled link with a source glyph at the cursor.
local M = {}

local GLYPHS = {
  vault = "󰺿",
  notion = "",
  drive = "󰊶",
}

local VAULT = vim.fn.expand("~/vault")
local DRIVE_CREDENTIALS = vim.env.LINK_PICKER_GOOGLE_CREDENTIALS
  or vim.fn.expand("~/.google_workspace_mcp/credentials")
local NOTION_TOKEN_FILE = vim.env.NOTION_TOKEN_FILE or vim.fn.expand("~/.config/notion-token")

local drive_token -- { value = string, expires = unix seconds }

local function run_json(cmd, cb)
  vim.system(cmd, { text = true }, function(obj)
    local data, err
    if obj.code ~= 0 then
      err = (obj.stderr or ""):gsub("%s+$", "")
    else
      local ok
      ok, data = pcall(vim.json.decode, obj.stdout or "")
      if not ok then
        data, err = nil, "Bad JSON from " .. cmd[1]
      end
    end
    vim.schedule(function()
      cb(data, err)
    end)
  end)
end

local function drive_credentials()
  local files = vim.fn.glob(DRIVE_CREDENTIALS .. "/*.json", false, true)
  for _, file in ipairs(files) do
    local ok, cred = pcall(vim.json.decode, table.concat(vim.fn.readfile(file), "\n"))
    if ok and type(cred) == "table" and cred.refresh_token and cred.client_id and cred.client_secret then
      return cred
    end
  end
end

local function fetch_drive_files(token, cb)
  run_json({
    "curl",
    "-s",
    "-G",
    "https://www.googleapis.com/drive/v3/files",
    "-H",
    "Authorization: Bearer " .. token,
    "--data-urlencode",
    "q=trashed=false",
    "--data-urlencode",
    "orderBy=modifiedTime desc",
    "--data-urlencode",
    "pageSize=100",
    "--data-urlencode",
    "fields=files(id,name,webViewLink,mimeType)",
  }, function(data, err)
    if not data or not data.files then
      return cb(nil, err or "Drive search failed")
    end
    local items = {}
    for _, file in ipairs(data.files) do
      items[#items + 1] = {
        text = file.name,
        title = file.name,
        url = file.webViewLink or ("https://drive.google.com/file/d/" .. file.id .. "/view"),
      }
    end
    cb(items)
  end)
end

local function fetch_drive(cb)
  local cred = drive_credentials()
  if not cred then
    return cb(nil, "No Google credentials found")
  end
  if drive_token and drive_token.expires > os.time() + 30 then
    return fetch_drive_files(drive_token.value, cb)
  end

  run_json({
    "curl",
    "-s",
    "-X",
    "POST",
    cred.token_uri or "https://oauth2.googleapis.com/token",
    "-d",
    "client_id=" .. cred.client_id,
    "-d",
    "client_secret=" .. cred.client_secret,
    "-d",
    "refresh_token=" .. cred.refresh_token,
    "-d",
    "grant_type=refresh_token",
  }, function(data, err)
    if not data or not data.access_token then
      return cb(nil, err or "Google token refresh failed")
    end
    drive_token = { value = data.access_token, expires = os.time() + (data.expires_in or 3600) }
    fetch_drive_files(drive_token.value, cb)
  end)
end

local function notion_title(item)
  if item.object == "database" and item.title and item.title[1] then
    return item.title[1].plain_text
  end
  for _, prop in pairs(item.properties or {}) do
    if prop.type == "title" and prop.title and prop.title[1] then
      return prop.title[1].plain_text
    end
  end
end

local function notion_token()
  local env = vim.env.NOTION_TOKEN
  if env and env ~= "" then
    return env
  end
  if vim.fn.filereadable(NOTION_TOKEN_FILE) == 1 then
    local line = vim.fn.readfile(NOTION_TOKEN_FILE)[1]
    if line and line ~= "" then
      return vim.trim(line)
    end
  end
end

local function fetch_notion(cb)
  local token = notion_token()
  if not token then
    return cb(nil, "Set NOTION_TOKEN or write " .. NOTION_TOKEN_FILE)
  end

  run_json({
    "curl",
    "-s",
    "-X",
    "POST",
    "https://api.notion.com/v1/search",
    "-H",
    "Authorization: Bearer " .. token,
    "-H",
    "Notion-Version: 2022-06-28",
    "-H",
    "Content-Type: application/json",
    "-d",
    vim.json.encode({ page_size = 100 }),
  }, function(data, err)
    if not data or not data.results then
      return cb(nil, err or "Notion search failed")
    end
    local items = {}
    for _, result in ipairs(data.results) do
      local title = notion_title(result)
      if title and result.url then
        items[#items + 1] = { text = title, title = title, url = result.url }
      end
    end
    cb(items)
  end)
end

local function vault_items()
  local files = vim.fn.glob(VAULT .. "/**/*.md", false, true)
  local counts, entries = {}, {}
  for _, file in ipairs(files) do
    if not file:find("/%.") then
      local name = vim.fn.fnamemodify(file, ":t:r")
      counts[name] = (counts[name] or 0) + 1
      entries[#entries + 1] = { file = file, name = name }
    end
  end

  local items = {}
  for _, entry in ipairs(entries) do
    -- Ambiguous basenames need the vault-relative path to resolve.
    local target = entry.name
    if counts[entry.name] > 1 then
      target = entry.file:sub(#VAULT + 2):gsub("%.md$", "")
    end
    items[#items + 1] = { text = entry.name, title = entry.name, target = target }
  end
  table.sort(items, function(a, b)
    return a.title:lower() < b.title:lower()
  end)
  return items
end

function M.insert(kind, item)
  local text
  if kind == "vault" then
    local title = item.title:gsub("|", "\\|")
    if item.target == title then
      text = "[[" .. title .. "]]"
    else
      text = ("[[%s|%s]]"):format(item.target, title)
    end
  else
    text = ("[%s](%s)"):format(item.title:gsub("%]", "\\]"), item.url)
  end

  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  vim.api.nvim_buf_set_text(0, row - 1, col, row - 1, col, { text })
  vim.api.nvim_win_set_cursor(0, { row, col + #text })
end

function M.pick(kind)
  local function done(items, err)
    if err then
      vim.notify("Link picker: " .. err, vim.log.levels.WARN)
      return
    end
    if not items or #items == 0 then
      vim.notify("Link picker: no " .. kind .. " results", vim.log.levels.INFO)
      return
    end

    Snacks.picker.pick({
      source = "link-picker-" .. kind,
      items = items,
      title = GLYPHS[kind] .. " " .. kind .. " links",
      format = "text",
      confirm = function(picker, item)
        picker:close()
        M.insert(kind, item)
      end,
    })
  end

  if kind == "vault" then
    done(vault_items())
  elseif kind == "notion" then
    fetch_notion(done)
  elseif kind == "drive" then
    fetch_drive(done)
  else
    done(nil, "unknown source " .. tostring(kind))
  end
end

function M.open()
  local sources = {
    { label = "Google Drive", kind = "drive" },
    { label = "Notion", kind = "notion" },
    { label = "Vault", kind = "vault" },
  }

  vim.ui.select(sources, {
    prompt = "Link source",
    format_item = function(source)
      return GLYPHS[source.kind] .. " " .. source.label
    end,
  }, function(source)
    if source then
      M.pick(source.kind)
    end
  end)
end

return M

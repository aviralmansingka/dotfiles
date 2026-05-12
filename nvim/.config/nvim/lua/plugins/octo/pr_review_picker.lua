local M = {}

local JSON_FIELDS = "number,title,url,repository,state,author,updatedAt,closedAt"
local LIMIT = "100"
local RECENT_DAYS = 7

local function iso_days_ago(n)
  return os.date("!%Y-%m-%d", os.time() - n * 86400)
end

---@param flags string[]  -- extra `gh search prs` flags describing the query
---@param cb fun(prs: table[])
local function gh_search(flags, cb)
  local cmd = { "gh", "search", "prs" }
  for _, f in ipairs(flags) do table.insert(cmd, f) end
  table.insert(cmd, "--json")
  table.insert(cmd, JSON_FIELDS)
  table.insert(cmd, "--limit")
  table.insert(cmd, LIMIT)
  vim.system(cmd, { text = true }, function(out)
    if out.code ~= 0 then
      vim.schedule(function()
        vim.notify("pr_review_picker: gh search failed (" .. table.concat(flags, " ") ..
          "): " .. (out.stderr or ""), vim.log.levels.ERROR)
      end)
      return cb({})
    end
    local ok, parsed = pcall(vim.json.decode, out.stdout)
    cb(ok and parsed or {})
  end)
end

---@param pr table
---@param reason string
---@return table
local function to_item(pr, reason)
  local repo = pr.repository and pr.repository.nameWithOwner or "?"
  local author = pr.author and pr.author.login or ""
  return {
    number = pr.number,
    title = pr.title or "",
    url = pr.url,
    repo = repo,
    state = (pr.state or ""):lower(),
    author = author,
    closed_at = pr.closedAt,
    updated_at = pr.updatedAt,
    reason = reason,
    text = string.format("%s#%d %s @%s", repo, pr.number, pr.title or "", author),
  }
end

local REASON_LABEL = {
  ["review"]          = "review-requested",
  ["assigned"]        = "assigned (open)",
  ["assigned-merged"] = "assigned (merged)",
}

local function preview_lines(item)
  local lines = {
    string.format("%s#%d  %s", item.repo, item.number, item.state),
    item.title,
    "",
    "reason:    " .. (REASON_LABEL[item.reason] or item.reason),
    "author:    @" .. (item.author ~= "" and item.author or "?"),
    "updated:   " .. (item.updated_at or "?"),
  }
  if item.closed_at then
    table.insert(lines, "closed:    " .. item.closed_at)
  end
  table.insert(lines, "url:       " .. (item.url or "?"))
  return lines
end

local function show(items)
  local Snacks = require("snacks")
  Snacks.picker.pick({
    title = string.format("PRs: to review + assigned (incl. merged <%dd)", RECENT_DAYS),
    items = items,
    preview = function(ctx)
      vim.api.nvim_buf_set_lines(ctx.buf, 0, -1, false, preview_lines(ctx.item))
      return true
    end,
    format = function(item)
      local ret = {}
      local icon, hl
      if item.reason == "review" then
        icon, hl = "🔎 ", "DiagnosticWarn"
      elseif item.reason == "assigned-merged" then
        icon, hl = "⬇ ", "Comment"
      else
        icon, hl = "● ", "DiagnosticOk"
      end
      ret[#ret + 1] = { icon, hl }
      ret[#ret + 1] = { string.format("%s#%d", item.repo, item.number), "Identifier" }
      ret[#ret + 1] = { "  " .. item.title, "Normal" }
      if item.author ~= "" then
        ret[#ret + 1] = { "  @" .. item.author, "Comment" }
      end
      if item.reason == "assigned-merged" and item.closed_at then
        ret[#ret + 1] = { "  [merged " .. item.closed_at:sub(1, 10) .. "]", "Comment" }
      end
      return ret
    end,
    confirm = function(picker, item)
      picker:close()
      if not item then return end
      vim.cmd(string.format("Octo pr edit %d %s", item.number, item.repo))
    end,
    win = {
      input = {
        keys = {
          ["<C-b>"] = { "open_browser", mode = { "n", "i" } },
        },
      },
    },
    actions = {
      open_browser = function(_, item)
        if item and item.url then
          require("octo.navigation").open_in_browser_raw(item.url)
        end
      end,
    },
  })
end

function M.open()
  local since = iso_days_ago(RECENT_DAYS)
  local queries = {
    { reason = "review",          flags = { "--review-requested=@me", "--state=open" } },
    { reason = "assigned",        flags = { "--assignee=@me", "--state=open" } },
    { reason = "assigned-merged", flags = { "--assignee=@me", "--merged", "--merged-at=>=" .. since } },
  }

  local items, seen = {}, {}
  local pending = #queries

  local function done()
    pending = pending - 1
    if pending > 0 then return end
    vim.schedule(function()
      if #items == 0 then
        vim.notify("pr_review_picker: nothing to show", vim.log.levels.INFO)
        return
      end
      show(items)
    end)
  end

  for _, q in ipairs(queries) do
    gh_search(q.flags, function(prs)
      for _, pr in ipairs(prs or {}) do
        if pr.url and not seen[pr.url] then
          seen[pr.url] = true
          table.insert(items, to_item(pr, q.reason))
        end
      end
      done()
    end)
  end
end

return M

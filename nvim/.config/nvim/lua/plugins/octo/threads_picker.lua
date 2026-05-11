local M = {}

---@param body string
---@return string
local function one_line_preview(body)
  if not body or body == "" then return "" end
  local first = body:match("[^\r\n]+") or body
  if #first > 80 then first = first:sub(1, 77) .. "..." end
  return first
end

---@param thread table  -- a ReviewThread node from the GraphQL response
---@return integer
local function thread_line(thread)
  return thread.line or thread.originalLine or thread.startLine or thread.originalStartLine or 1
end

---@param thread table
---@return string
local function thread_author(thread)
  local first = thread.comments and thread.comments.nodes and thread.comments.nodes[1]
  if first and first.author and first.author.login then return first.author.login end
  return ""
end

---@param thread table
---@return string
local function thread_preview(thread)
  local first = thread.comments and thread.comments.nodes and thread.comments.nodes[1]
  if not first then return "" end
  return one_line_preview(first.body)
end

---Build the item list shown by the picker.
---@param threads table[]
---@param show_resolved boolean
---@return table[]
local function build_items(threads, show_resolved)
  local items = {}
  for _, t in ipairs(threads) do
    if show_resolved or not t.isResolved then
      local line = thread_line(t)
      local author = thread_author(t)
      local preview = thread_preview(t)
      table.insert(items, {
        thread_id = t.id,
        path = t.path,
        line = line,
        resolved = t.isResolved,
        outdated = t.isOutdated,
        author = author,
        preview = preview,
        text = string.format("%s:%d @%s %s", t.path or "", line, author, preview),
      })
    end
  end
  return items
end

---@param pr_url string  -- e.g. https://github.com/owner/name/pull/42
---@param thread_id string
---@return string
local function thread_browser_url(pr_url, thread_id)
  -- GitHub anchors threads via #discussion_r<commentId>; we have a thread node id (base64)
  -- which doesn't map directly. Fall back to opening the PR Files tab; user can scroll.
  return pr_url .. "/files"
end

---Resolve a thread via the GitHub GraphQL API.
---@param thread_id string
---@param on_done fun()
local function resolve_thread(thread_id, on_done)
  local gh = require("octo.gh")
  local mutations = require("octo.gh.mutations")
  local mutation = string.format(mutations.resolve_review_thread, thread_id)
  gh.api.graphql({
    query = mutation,
    opts = {
      cb = gh.create_callback({
        success = function(_)
          vim.notify("thread resolved", vim.log.levels.INFO)
          on_done()
        end,
      }),
    },
  })
end

---Render the Snacks picker for the given threads.
---@param threads table[]
---@param pr table  -- pull-request object with .repo and .url
local function render_picker(threads, pr)
  local Snacks = require("snacks")
  local show_resolved = false

  local function reopen()
    M._render(threads, pr, show_resolved)
  end

  M._render = function(threads_, pr_, show_resolved_)
    local items = build_items(threads_, show_resolved_)
    if #items == 0 then
      vim.notify("threads_picker: no threads to show (filter=" ..
        (show_resolved_ and "all" or "unresolved") .. ")", vim.log.levels.INFO)
      return
    end

    Snacks.picker.pick({
      title = string.format("PR #%d review threads (%s)", pr_.number,
        show_resolved_ and "all" or "unresolved"),
      items = items,
      format = function(item, _)
        local ret = {}
        local icon = item.resolved and "● " or "○ "
        local icon_hl = item.resolved and "Comment" or "DiagnosticWarn"
        ret[#ret + 1] = { icon, icon_hl }
        ret[#ret + 1] = { string.format("%s:%d", item.path or "?", item.line), "Comment" }
        if item.author and item.author ~= "" then
          ret[#ret + 1] = { "  @" .. item.author, "Comment" }
        end
        if item.preview and item.preview ~= "" then
          ret[#ret + 1] = { "  " .. item.preview, "Normal" }
        end
        if item.outdated then
          ret[#ret + 1] = { "  [outdated]", "Comment" }
        end
        return ret
      end,
      confirm = function(picker, item)
        picker:close()
        if not item.path then return end
        vim.cmd.edit(item.path)
        pcall(vim.api.nvim_win_set_cursor, 0, { item.line, 0 })
      end,
      win = {
        input = {
          keys = {
            ["<C-r>"] = { "resolve_thread", mode = { "n", "i" } },
            ["<C-b>"] = { "open_browser", mode = { "n", "i" } },
            ["<C-u>"] = { "toggle_resolved", mode = { "n", "i" } },
          },
        },
      },
      actions = {
        resolve_thread = function(picker, item)
          if not item or item.resolved then return end
          resolve_thread(item.thread_id, function()
            picker:close()
            -- Re-fetch the PR threads to pick up the resolved state
            vim.schedule(function() M.open() end)
          end)
        end,
        open_browser = function(_picker, item)
          if not item or not pr_.url then return end
          local url = thread_browser_url(pr_.url, item.thread_id)
          require("octo.navigation").open_in_browser_raw(url)
        end,
        toggle_resolved = function(picker, _item)
          picker:close()
          show_resolved = not show_resolved
          M._render(threads_, pr_, show_resolved)
        end,
      },
    })
  end

  M._render(threads, pr, show_resolved)
end

---Fetch and show review threads for a PR.
---@param pr table  -- pull request object with .owner, .name, .number, .url
local function fetch_and_show(pr)
  local gh = require("octo.gh")
  local queries = require("octo.gh.queries")
  local utils = require("octo.utils")

  gh.api.graphql({
    query = queries.review_threads,
    F = { owner = pr.owner, name = pr.name, number = pr.number },
    paginate = true,
    jq = ".",
    opts = {
      cb = gh.create_callback({
        success = function(output)
          local resp = utils.aggregate_pages(output,
            "data.repository.pullRequest.reviewThreads.nodes")
          local threads = resp.data.repository.pullRequest.reviewThreads.nodes
          if not threads or #threads == 0 then
            vim.notify("threads_picker: PR #" .. pr.number .. " has no review threads",
              vim.log.levels.INFO)
            return
          end
          render_picker(threads, pr)
        end,
      }),
    },
  })
end

---Entry point: detect the PR for the current context and open the picker.
function M.open()
  local octo_utils = require("octo.utils")
  local buffer = octo_utils.get_current_buffer()

  if buffer and buffer.node and buffer.node.number then
    local pr = buffer.node
    -- buffer carries the PR with full URL; ensure we have owner+name
    local owner, name = octo_utils.split_repo(buffer.repo)
    pr.owner = pr.owner or owner
    pr.name = pr.name or name
    pr.repo = buffer.repo
    fetch_and_show(pr)
    return
  end

  octo_utils.get_pull_request_for_current_branch(function(pr)
    if not pr then
      vim.notify("threads_picker: no PR for current branch", vim.log.levels.WARN)
      return
    end
    local owner, name = octo_utils.split_repo(pr.repo)
    pr.owner = pr.owner or owner
    pr.name = pr.name or name
    fetch_and_show(pr)
  end)
end

return M

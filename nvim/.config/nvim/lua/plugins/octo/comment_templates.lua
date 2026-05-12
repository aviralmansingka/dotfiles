local M = {}

local PREFIXES = {
  nit = "nit: ",
  q = "Q: ",
  b = "blocker: ",
  ["+"] = "+1, ",
}

---Open an Octo review comment buffer pre-filled with a prefix.
---Must be called from a review diff buffer with an active review session.
---Falls back to a notification with no other side effect when called from
---outside a review context.
---@param kind string one of "nit", "q", "b", "+"
function M.compose(kind)
  local prefix = PREFIXES[kind]
  if not prefix then
    vim.notify("comment_templates: unknown kind " .. tostring(kind), vim.log.levels.ERROR)
    return
  end

  local ok, reviews = pcall(require, "octo.reviews")
  if not ok then
    vim.notify("octo.reviews not available", vim.log.levels.ERROR)
    return
  end

  local review = reviews.get_current_review()
  if not review or review.id == -1 then
    vim.notify("comment_templates: no active review (use <localleader>vs to start one)", vim.log.levels.WARN)
    return
  end

  reviews.add_review_comment(false)

  -- Octo's add_review_comment is synchronous: by return it has created the
  -- thread compose buffer, swapped it into the alt window, run `normal! vvGk`
  -- and queued `:startinsert`. We defer one tick so startinsert takes effect,
  -- then feed the prefix as typed input.
  vim.schedule(function()
    vim.api.nvim_feedkeys(prefix, "n", false)
  end)
end

return M

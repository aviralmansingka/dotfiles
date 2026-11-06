-- Markdown text measured as it renders. Link destinations do not occupy
-- visible columns, so width calculations count the title only.
local M = {}

function M.display_text(line)
  -- wiki links: keep the alias, else the target's last path segment
  line = line:gsub("%[%[([^%]|]*)|([^%]]*)%]%]", "%2")
  line = line:gsub("%[%[([^%]]*)%]%]", function(target)
    return target:match("([^/]+)$") or target
  end)
  -- inline links and images: keep the bracketed text
  line = line:gsub("!?%[([^%]]*)%]%b()", "%1")
  -- reference links: keep the text
  line = line:gsub("%[([^%]]*)%]%[[^%]]*%]", "%1")
  return line
end

function M.width(line)
  return vim.fn.strdisplaywidth(M.display_text(line))
end

return M

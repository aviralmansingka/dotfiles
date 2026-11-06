-- Markdown text measured as it renders. Link destinations do not occupy
-- visible columns. Render-markdown draws a source icon and a space before
-- every link title, so each link counts as that 2-cell icon plus the title.
local ICON = "  " -- one glyph cell and one space

local M = {}

function M.display_text(line)
  -- wiki links: icon + alias, else icon + the target's last path segment
  line = line:gsub("%[%[([^%]|]*)|([^%]]*)%]%]", function(_, alias)
    return ICON .. alias
  end)
  line = line:gsub("%[%[([^%]]*)%]%]", function(target)
    return ICON .. (target:match("([^/]+)$") or target)
  end)
  -- inline links and images: icon + the bracketed text
  line = line:gsub("!?%[([^%]]*)%]%b()", function(title)
    return ICON .. title
  end)
  -- reference links: icon + the text
  line = line:gsub("%[([^%]]*)%]%[[^%]]*%]", function(title)
    return ICON .. title
  end)
  return line
end

function M.width(line)
  return vim.fn.strdisplaywidth(M.display_text(line))
end

return M

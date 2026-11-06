-- lua/helpers/markdown_wrap.lua, exercised headless.
-- Guards the visible-width reflow:
--   * prose wraps by rendered width, so a long link destination never leaves
--     blank space in a line;
--   * list items keep their marker and continuation indent, and two adjacent
--     items stay separate paragraphs;
--   * quotes repeat their prefix on every wrapped line;
--   * frontmatter, headings, tables, HTML, and fenced code pass through;
--   * hard line breaks survive;
--   * a second pass changes nothing.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local text = require("helpers.markdown_text")
local format = require("helpers.markdown_wrap")

local function widths(lines)
  local out = {}
  for _, line in ipairs(lines) do
    out[#out + 1] = text.width(line)
  end
  return out
end

local function max_width(lines)
  local max = 0
  for _, w in ipairs(widths(lines)) do
    if w > max then
      max = w
    end
  end
  return max
end

local function dump(lines)
  return table.concat(lines, "\n")
end

H.run("markdown_wrap_spec", function()
  local url = "https://app.notion.com/p/" .. string.rep("x", 90)

  -- prose wraps at the visible width, and the URL stays on one line
  local prose = {
    "Some prose with a [Notion pack]("
      .. url
      .. ") and enough trailing words to push this line past the width: "
      .. string.rep("more words ", 6)
      .. "end.",
  }
  local out = format.format(prose, 99)
  H.truthy(#out > 1, "the prose paragraph wraps")
  H.truthy(max_width(out) <= 99, "no wrapped line passes 99 visible cells")
  local joined = dump(out)
  H.eq(joined:find(url, 1, true) ~= nil, true, "the URL stays intact")
  H.eq(select(2, joined:gsub(url, "")), 1, "the URL appears once")
  H.truthy(max_width(prose) > 99, "the raw line was wider than the wrap")

  -- list items: marker kept, continuation indented, adjacent items separate
  local list = { "- " .. string.rep("word ", 40) }
  out = format.format(list, 60)
  H.truthy(#out > 1, "a long list item wraps")
  H.eq(out[1]:sub(1, 2), "- ", "the marker stays on the first line")
  H.eq(out[2]:sub(1, 2), "  ", "the continuation keeps the marker indent")

  local items = format.format({
    "- first item",
    "- second item",
    "1. ordered item",
    "2. next ordered",
  }, 99)
  H.eq(dump(items), "- first item\n- second item\n1. ordered item\n2. next ordered", "items stay separate")

  -- quotes repeat the prefix
  out = format.format({ "> " .. string.rep("word ", 40) }, 60)
  for _, line in ipairs(out) do
    H.eq(line:sub(1, 2), "> ", "every quote line keeps the prefix")
  end

  -- structure passes through
  local doc = {
    "---",
    "id: x",
    "---",
    "",
    "# Heading stays",
    "",
    "```lua",
    "local x = 1 -- " .. string.rep("wide ", 30),
    "```",
    "",
    "| a | b |",
    "|---|---|",
    "",
    "<div>",
    string.rep("wide ", 30),
    "</div>",
  }
  H.eq(dump(format.format(doc, 40)), dump(doc), "frontmatter, headings, code, tables, and HTML pass through")

  -- hard break keeps the two trailing spaces and ends the paragraph
  out = format.format({ "one two  ", "three " .. string.rep("word ", 30) }, 40)
  H.eq(out[1]:sub(-2), "  ", "the hard break keeps its trailing spaces")
  H.truthy(#out > 2, "the next paragraph still wraps")

  -- idempotent
  local long = { "A paragraph with a [link](https://example.com/very/long/path) and " .. string.rep("word ", 40) }
  local once = format.format(long, 60)
  H.eq(dump(format.format(once, 60)), dump(once), "a second pass changes nothing")
end)

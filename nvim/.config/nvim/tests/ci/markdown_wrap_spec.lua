-- lua/helpers/markdown_wrap.lua, exercised headless.
-- Guards the visible-width reflow:
--   * prose wraps by rendered width, so a long link destination never leaves
--     blank space in a line;
--   * list items keep their marker and continuation indent, and two adjacent
--     items stay separate paragraphs;
--   * quotes repeat their prefix on every wrapped line;
--   * frontmatter, headings, tables, HTML, and fenced code pass through;
--   * rules, setext underlines, and empty list items pass through, so a
--     dash-only line never folds into the paragraph above it;
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

  -- rules and empty items are structure: never folded into the line above
  H.eq(dump(format.format({ "Some prose here.", "---" }, 99)), "Some prose here.\n---",
    "a dash rule under prose stays on its own line")
  H.eq(dump(format.format({ "Title", "===" }, 99)), "Title\n===", "an equals underline stays put")
  H.eq(dump(format.format({ "one", "***", "two" }, 99)), "one\n***\ntwo", "a star rule splits the paragraphs")
  H.eq(dump(format.format({ "- parent item", "  - " }, 99)), "- parent item\n  - ",
    "an empty nested bullet survives reflow")
  H.eq(dump(format.format({ "- ", "- " }, 99)), "- \n- ", "empty top-level bullets survive reflow")

  -- hard break keeps the two trailing spaces and ends the paragraph
  out = format.format({ "one two  ", "three " .. string.rep("word ", 30) }, 40)
  H.eq(out[1]:sub(-2), "  ", "the hard break keeps its trailing spaces")
  H.truthy(#out > 2, "the next paragraph still wraps")

  -- a fence block ends at its own closing fence, and prose after it wraps
  local fence = {
    "```text",
    "   map.md",
    "```",
    "",
    "A paragraph after a fence with " .. string.rep("word ", 30) .. "end.",
  }
  out = format.format(fence, 60)
  H.eq(out[1], "```text", "the opening fence stays")
  H.eq(out[3], "```", "the closing fence stays")
  H.truthy(#out > 4, "prose after the fence still wraps")

  -- an unclosed fence runs to the end of the buffer, unwrapped
  local open = { "```lua", string.rep("code ", 40) }
  H.eq(dump(format.format(open, 60)), dump(open), "an unclosed fence passes through whole")

  -- two fences do not swallow the prose between them
  local pair = { "```a", "x", "```", string.rep("word ", 30), "```b", "y", "```" }
  out = format.format(pair, 60)
  H.eq(out[#out], "```", "the second fence closes")
  H.truthy(#out > 7, "prose between fences wraps")

  -- a pipe line without a delimiter row is prose and wraps
  out = format.format({ "| " .. string.rep("cell ", 30) .. "|" }, 60)
  H.truthy(#out > 1, "a lone pipe line wraps as prose")

  -- a real table passes through whole
  local table_doc = { "| a | b |", "|---|---|", "| " .. string.rep("cell ", 30) .. "| b |" }
  H.eq(dump(format.format(table_doc, 60)), dump(table_doc), "a table with a delimiter row passes through")

  -- idempotent
  local long = {"A paragraph with a [link](https://example.com/very/long/path) and " .. string.rep("word ", 40) }
  local once = format.format(long, 60)
  H.eq(dump(format.format(once, 60)), dump(once), "a second pass changes nothing")
end)

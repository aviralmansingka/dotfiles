-- Conform entry point for the Markdown visible-width reflow.
-- Reads the buffer on stdin and writes the reflowed text on stdout.
local here = debug.getinfo(1, "S").source:sub(2)
local dir = here:match("^(.*)[/\\][^/\\]*$") or "."
package.path = dir .. "/../lua/?.lua;" .. package.path

local format = require("helpers.markdown_format")
local width = tonumber(arg and arg[1] or "") or 99

io.write(format.format_string(io.read("*a") or "", width))

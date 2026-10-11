-- sidekick/ask/diff.lua parse contract (offline, pure, table-driven).
--
-- The parser is the gate between the model reply and the buffer edit, so
-- every verdict is pinned: fenced replies, bare NOOP, single-hunk apply,
-- multi-hunk REJECT, malformed @@ headers, empty/nil replies, junk lines.
-- Pure module — no buffer, no stubs needed.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
H.setup()

local diff = require("plugins.sidekick.ask.diff")

H.run("ask_diff_spec", function()
  local single_hunk = table.concat({
    "Sure, here it is:", -- preamble before the diff is allowed
    "",
    "--- a/foo.lua",
    "+++ b/foo.lua",
    "@@ -3,2 +3,2 @@",
    "-old one",
    "-old two",
    "+new one",
    "+new two",
  }, "\n")

  local cases = {
    {
      name = "single hunk returns only the + lines",
      input = single_hunk,
      added = { "new one", "new two" },
    },
    {
      name = "bare NOOP is an empty edit",
      input = "NOOP",
      added = {},
    },
    {
      name = "NOOP with surrounding whitespace is trimmed",
      input = "  NOOP  \n",
      added = {},
    },
    {
      name = "NOOP inside a fence parses",
      input = "```rust\nNOOP\n```",
      added = {},
    },
    {
      name = "NOOP among prose lines (no diff) parses",
      input = "I looked at it.\nNOOP\nnothing to change.",
      added = {},
    },
    {
      name = "fenced diff with language tag parses",
      input = "```diff\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n```",
      added = { "b" },
    },
    {
      name = "hunk header without file headers parses",
      input = "@@ -1,1 +1,1 @@\n-a\n+b",
      added = { "b" },
    },
    {
      name = "hunk header with trailing section context parses",
      input = "--- a/x\n+++ b/x\n@@ -3,2 +3,3 @@ function foo\n-a\n+b\nc",
      added = { "b" },
    },
    {
      name = "context and removed lines are ignored",
      input = "--- a/x\n+++ b/x\n@@ -1,3 +1,2 @@\n-keep1\n ctx\n-keep2\n+a",
      added = { "a" },
    },
    {
      name = "a + line may be empty",
      input = "@@ -1,1 +1,1 @@\n-a\n+",
      added = { "" },
    },
    {
      name = "leading whitespace after + is content",
      input = "@@ -1,1 +1,1 @@\n-a\n+  indented",
      added = { "  indented" },
    },
    {
      name = "no-newline marker junk is ignored",
      input = "@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file",
      added = { "b" },
    },
    {
      name = "counts without commas are accepted",
      input = "@@ -1 +1 @@\n-a\n+b",
      added = { "b" },
    },
    {
      name = "a NOOP line before a real diff loses to the diff",
      input = "NOOP\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b",
      added = { "b" },
    },
    -- error verdicts: added == nil, err matches
    { name = "nil reply is rejected", input = nil, err = "empty reply" },
    { name = "empty reply is rejected", input = "", err = "empty reply" },
    { name = "whitespace-only reply is rejected", input = " \n\t ", err = "empty reply" },
    {
      name = "prose without diff or NOOP is rejected",
      input = "I would rather explain than edit.",
      err = "no diff or NOOP found",
    },
    {
      name = "file headers without a hunk are rejected",
      input = "--- a/x\n+++ b/x",
      err = "no hunk found in diff",
    },
    {
      name = "two hunks are rejected",
      input = "--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,1 +9,1 @@\n-c\n+d",
      err = "multiple hunks not allowed",
    },
    {
      name = "malformed hunk header (missing + side) is rejected",
      input = "--- a/x\n+++ b/x\n@@ -1 @@\n-a\n+b",
      err = "malformed hunk header",
    },
    {
      name = "malformed hunk header (junk) is rejected",
      input = "--- a/x\n+++ b/x\n@@ nonsense\n-a\n+b",
      err = "malformed hunk header",
    },
    {
      name = "unterminated hunk header is rejected",
      input = "--- a/x\n+++ b/x\n@@ -1,1 +1,1\n-a\n+b",
      err = "malformed hunk header",
    },
  }

  for _, c in ipairs(cases) do
    local added, err = diff.parse(c.input)
    if c.added then
      H.eq(added, c.added, c.name)
      H.eq(err, nil, c.name .. " (no error)")
    else
      H.eq(added, nil, c.name)
      H.truthy(err and err:find(c.err, 1, true) ~= nil,
        c.name .. " (err contains '" .. c.err .. "', got " .. vim.inspect(err) .. ")")
    end
  end
end)

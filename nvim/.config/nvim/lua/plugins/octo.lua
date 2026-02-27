--- Convert common HTML patterns to markdown equivalents.
--- Pure-markdown content (no `<` chars) passes through with zero overhead.
local function html_to_markdown(text)
  if not text or not text:find("<") then
    return text
  end

  -- Line breaks and horizontal rules
  text = text:gsub("<br%s*/?>", "\n")
  text = text:gsub("<hr%s*/?>", "---")

  -- Linked images: <a href="url"><img alt="text" ...></a>
  text = text:gsub('<a[^>]-href="([^"]*)"[^>]*>%s*<img[^>]-alt="([^"]*)"[^>]*/?>%s*</a>', "[%2](%1)")

  -- Standalone links: <a href="url">text</a>
  text = text:gsub('<a[^>]-href="([^"]*)"[^>]*>(.-)</a>', "[%2](%1)")

  -- Standalone images: <img alt="text" ...>
  text = text:gsub('<img[^>]-alt="([^"]*)"[^>]*/?>',"%1")

  -- Bold
  text = text:gsub("<strong>(.-)</strong>", "**%1**")
  text = text:gsub("<b>(.-)</b>", "**%1**")

  -- Italic
  text = text:gsub("<em>(.-)</em>", "*%1*")
  text = text:gsub("<i>(.-)</i>", "*%1*")

  -- Inline code
  text = text:gsub("<code>(.-)</code>", "`%1`")

  -- Headings h1–h6
  for level = 1, 6 do
    local hashes = string.rep("#", level)
    text = text:gsub("<h" .. level .. "[^>]*>(.-)</h" .. level .. ">", hashes .. " %1")
  end

  -- Paragraphs
  text = text:gsub("<p[^>]*>(.-)</p>", "%1\n")

  -- Summary → bold
  text = text:gsub("<summary>(.-)</summary>", "**%1**")

  -- Strip container tags but keep content
  for _, tag in ipairs({ "details", "div", "span", "table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li", "section", "nav", "header", "footer" }) do
    text = text:gsub("<" .. tag .. "[^>]*>", "")
    text = text:gsub("</" .. tag .. ">", "")
  end

  -- Decode common HTML entities
  local entities = {
    ["&amp;"] = "&",
    ["&lt;"] = "<",
    ["&gt;"] = ">",
    ["&quot;"] = '"',
    ["&#39;"] = "'",
    ["&apos;"] = "'",
    ["&nbsp;"] = " ",
  }
  for entity, char in pairs(entities) do
    text = text:gsub(entity, char)
  end

  -- Strip any remaining HTML tags
  text = text:gsub("<[^>]+>", "")

  return text
end

return {
  "pwntester/octo.nvim",
  config = function(_, opts)
    require("octo").setup(opts)

    -- Add author to the pull_requests GraphQL query
    local queries = require("octo.gh.queries")
    queries.pull_requests = [[
query(
  $owner: String!,
  $name: String!,
  $base_ref_name: String,
  $head_ref_name: String,
  $labels: [String!],
  $states: [PullRequestState!],
  $order_by: IssueOrder,
  $endCursor: String,
) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      first: 100,
      after: $endCursor,
      baseRefName: $base_ref_name,
      headRefName: $head_ref_name,
      labels: $labels,
      states: $states,
      orderBy: $order_by,
    ) {
      nodes {
        __typename
        number
        title
        url
        repository { nameWithOwner }
        headRefName
        isDraft
        state
        author { login }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
]]

    -- Monkey-patch the snacks provider to include author in search + display
    local snacks_provider = require("octo.pickers.snacks.provider")
    local original_pull_requests = snacks_provider.pull_requests

    snacks_provider.pull_requests = function(pr_opts)
      -- Temporarily patch the Snacks.picker.pick to intercept the call
      local Snacks = require("snacks")
      local original_pick = Snacks.picker.pick

      Snacks.picker.pick = function(pick_opts)
        -- Patch items: add author to text for fuzzy matching
        if pick_opts.items then
          local max_number = -1
          for _, pull in ipairs(pick_opts.items) do
            if pull.number and pull.number > max_number then
              max_number = pull.number
            end
            local author = pull.author and pull.author.login or ""
            pull.text = string.format("#%d %s %s", pull.number, pull.title, author)
          end

          -- Override format to show author
          local utils = require("octo.utils")
          pick_opts.format = function(item, _)
            ---@type snacks.picker.Highlight[]
            local ret = {}
            ---@diagnostic disable-next-line: assign-type-mismatch
            ret[#ret + 1] = utils.get_icon({ kind = item.kind, obj = item })
            ret[#ret + 1] = { string.format("#%d", item.number), "Comment" }
            ret[#ret + 1] = { (" "):rep(#tostring(max_number) - #tostring(item.number) + 1) }
            ret[#ret + 1] = { item.title, "Normal" }
            local author = item.author and item.author.login or ""
            if author ~= "" then
              ret[#ret + 1] = { "  @" .. author, "Comment" }
            end
            return ret
          end
        end

        -- Restore and call original
        Snacks.picker.pick = original_pick
        return original_pick(pick_opts)
      end

      return original_pull_requests(pr_opts)
    end

    -- Also patch the picker module reference
    snacks_provider.picker.prs = snacks_provider.pull_requests

    -- Monkey-patch octo writers to convert HTML → markdown before rendering
    local writers = require("octo.ui.writers")

    local original_write_body = writers.write_body_agnostic
    writers.write_body_agnostic = function(bufnr, body, line, viewer_can_update)
      body = html_to_markdown(body)
      return original_write_body(bufnr, body, line, viewer_can_update)
    end

    local original_write_comment = writers.write_comment
    writers.write_comment = function(bufnr, comment, kind, line)
      if comment and comment.body then
        comment.body = html_to_markdown(comment.body)
      end
      return original_write_comment(bufnr, comment, kind, line)
    end
  end,
}

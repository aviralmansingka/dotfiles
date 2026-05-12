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

local function smart_entry()
  require("octo.reviews").start_or_resume_review()
end

local function prompt_author()
  vim.ui.input({ prompt = "Author handle: " }, function(input)
    if input and input ~= "" then
      vim.cmd("Octo pr search author:" .. input .. " state:open")
    end
  end)
end

--- Open the current PR in a browser AND copy the URL to the system clipboard.
--- The clipboard half is the useful one over SSH where opening a local browser
--- via `gh pr view --web` either no-ops or opens a browser on the remote box.
local function open_browser_and_copy()
  local utils = require("octo.utils")
  local navigation = require("octo.navigation")

  local buffer = utils.get_current_buffer()
  if buffer and buffer:isPullRequest() then
    local remote = utils.get_remote_host() or "github.com"
    local url = string.format("https://%s/%s/pull/%d", remote, buffer.repo, buffer.number)
    utils.copy_url(url)
    navigation.open_in_browser("pull_request", buffer.repo, buffer.number)
    return
  end

  vim.system({ "gh", "pr", "view", "--json", "url", "-q", ".url" }, { text = true }, function(result)
    vim.schedule(function()
      if result.code ~= 0 or not result.stdout or result.stdout == "" then
        utils.error("no PR found for current context")
        return
      end
      local url = (result.stdout):gsub("%s+$", "")
      utils.copy_url(url)
      navigation.open_in_browser_raw(url)
    end)
  end)
end

return {
  "pwntester/octo.nvim",
  keys = {
    -- Disable LazyVim octo extras' <leader>g* keys; the Octo namespace lives under <leader>O
    { "<leader>gi", false },
    { "<leader>gI", false },
    { "<leader>gp", false },
    { "<leader>gP", false },
    { "<leader>gr", false },
    { "<leader>gS", false },
    -- <leader>O Octo namespace
    { "<leader>O",  "",                                                                 desc = "+octo" },
    { "<leader>OO", smart_entry,                                                        desc = "Smart entry (review/list)" },
    { "<leader>Op", "<cmd>Octo pr list<CR>",                                            desc = "PR list" },
    { "<leader>OP", "<cmd>Octo pr search<CR>",                                          desc = "PR search" },
    { "<leader>Om", "<cmd>Octo pr search author:@me state:open<CR>",                    desc = "My PRs" },
    { "<leader>Or", "<cmd>Octo pr search review-requested:@me state:open<CR>",          desc = "PRs to review" },
    { "<leader>OA", prompt_author,                                                      desc = "PRs by author..." },
    { "<leader>OT", function() require("plugins.octo.threads_picker").open() end,       desc = "Threads picker" },
    { "<leader>Oc", "<cmd>Octo pr checkout<CR>",                                        desc = "Checkout PR" },
    { "<leader>OC", "<cmd>Octo pr create<CR>",                                          desc = "Create PR from current branch" },
    { "<leader>Ob", open_browser_and_copy,                                              desc = "Open PR in browser + copy URL" },
    -- Comment-prefix templates (active when inside a review session; no-op otherwise)
    { "<localleader>cn", function() require("plugins.octo.comment_templates").compose("nit") end, mode = { "n", "x" }, desc = "nit comment" },
    { "<localleader>cq", function() require("plugins.octo.comment_templates").compose("q")   end, mode = { "n", "x" }, desc = "question comment" },
    { "<localleader>cb", function() require("plugins.octo.comment_templates").compose("b")   end, mode = { "n", "x" }, desc = "blocker comment" },
    { "<localleader>c+", function() require("plugins.octo.comment_templates").compose("+")   end, mode = { "n", "x" }, desc = "praise comment" },
  },
  opts = {
    -- Disable Projects v2 fields in PR/issue queries; the gh token does not
    -- have `read:project` and the failures cascade into empty PR buffers.
    default_to_projects_v2 = false,
    -- Open the working-tree file (with real filetype + path) on the RIGHT
    -- side of review diffs so LSP/treesitter/format-on-save/tests attach.
    -- Octo prompts to `gh pr checkout` when starting a review off the
    -- PR's head branch, so the local file matches the PR's content.
    use_local_fs = true,
    picker_config = {
      mappings = {
        open_in_browser = { lhs = "<leader>gO", desc = "open in browser" },
      },
    },
  },
  config = function(_, opts)
    require("octo").setup(opts)

    -- Octo's reviews/file-entry.lua sets modifiable=false on both diff
    -- buffers after creation, even when use_local_fs=true makes the
    -- RIGHT buffer a real working-tree file. Re-enable modifiable on
    -- RIGHT-side buffers backed by a real file path so LSP code actions
    -- and inline edits work in the review tab.
    vim.api.nvim_create_autocmd("BufWinEnter", {
      group = vim.api.nvim_create_augroup("OctoRightPaneEditable", { clear = true }),
      callback = function(args)
        local ok, props = pcall(vim.api.nvim_buf_get_var, args.buf, "octo_diff_props")
        if not ok or not props or props.split ~= "RIGHT" then
          return
        end
        if vim.api.nvim_buf_get_name(args.buf):match("^octo://") then
          return -- not a local-fs buffer
        end
        vim.bo[args.buf].modifiable = true
      end,
    })

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

    -- Make in_pr_branch correctly detect the common "I just ran
    -- `gh pr checkout` and am literally on the PR's head branch" case.
    -- Octo's stock check requires the local branch to have an upstream
    -- tracking ref AND the remote name to resolve to pr.head_repo —
    -- which is brittle. The simpler-and-correct check for same-repo PRs
    -- is just: current branch name matches pr.head_ref_name. Wrap the
    -- function so it returns true under either the stock check OR this
    -- simpler one. Net effect: no spurious "would you like to checkout"
    -- prompt when starting a review while already on the PR's branch,
    -- and use_local_fs correctly swaps the RIGHT pane to the working-
    -- tree file so gopls (and every other path-based LSP) attaches.
    do
      local octo_utils = require("octo.utils")
      local orig_in_pr_branch = octo_utils.in_pr_branch
      octo_utils.in_pr_branch = function(pr)
        if orig_in_pr_branch(pr) then
          return true
        end
        if not pr or not pr.head_ref_name then
          return false
        end
        local current = vim.fn.system("git rev-parse --abbrev-ref HEAD"):gsub("%s+", "")
        if vim.v.shell_error ~= 0 then
          return false
        end
        if current ~= pr.head_ref_name then
          return false
        end
        -- Same-repo PRs only: when the PR's head_repo equals the base
        -- repo, a branch-name match is sufficient. For cross-repo PRs
        -- the stock tracking-ref check is still required and already
        -- ran above.
        if pr.head_repo and pr.repo and pr.head_repo:lower() ~= pr.repo:lower() then
          return false
        end
        return true
      end
    end

    -- Augment the create_pr mutation to return headRepository.
    -- Octo's stock mutation returns baseRepository but not headRepository,
    -- so the success callback renders the freshly-created PR buffer with
    -- nil headRepository — and any later action that calls
    -- OctoBuffer:get_pr (e.g. starting a review) NPEs at
    -- octo/model/octo-buffer.lua:1045 on
    -- `self:pullRequest().headRepository.nameWithOwner`.
    local mutations = require("octo.gh.mutations")
    mutations.create_pr = mutations.create_pr:gsub(
      "baseRepository %{[^}]*%}",
      "%0\n      headRepository {\n        name\n        nameWithOwner\n      }",
      1
    )

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

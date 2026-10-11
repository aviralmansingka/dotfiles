-- plugins/octo.lua config() monkey-patches, run under `nvim --headless -u NONE`
-- against stub octo modules (offline harness, house pattern A7).
--
-- The REAL config() closure runs against `octo.*` stubs preloaded into
-- package.loaded before dofile. Every assertion checks a POST-CONDITION of
-- the real patch (the state of the patched module/table after config()),
-- never a copy of the patch logic.
--
-- Regression classes pinned here (merged PRs #28, #37-#45):
--   * mutations.create_pr gsub must actually match — gsub returns the
--     original string when the pattern misses, so a reformatted upstream
--     mutation silently drops headRepository and the next get_pr NPEs at
--     octo/model/octo-buffer.lua:1045 (#41).
--   * in_pr_branch wrap: same-repo branch-name match, cross-repo fallback to
--     the stock check, git failure, missing head_ref_name (#44/#45).
--   * toggle_viewed wrap stays idempotent across a config reload (#28).
--   * html_to_markdown table cases + the writer chains that call it.

local here = debug.getinfo(1, "S").source
here = here:sub(1, 1) == "@" and here:sub(2) or here
local H = dofile(vim.fs.dirname(here) .. "/harness.lua")
local root = H.setup()

-- Stock octo.nvim create_pr mutation body, exactly as shipped by the pinned
-- commit d05b852ad7eba6e34ffe38ee2db430f0fd6f6225 (lazy-lock.json). The real
-- module appends fragment strings AFTER this body, so the first
-- `baseRepository {...}` match lives in this text either way. If the lock
-- pin moves, re-extract from
-- ~/.local/share/nvim/lazy/octo.nvim/lua/octo/gh/mutations.lua.
local STOCK_CREATE_PR = [==[
mutation($input: CreatePullRequestInput!) {
  createPullRequest(input: $input) {
    pullRequest {
      id
      number
      state
      title
      body
      createdAt
      closedAt
      updatedAt
      url
      files(first:100) {
        nodes {
          path
          viewerViewedState
        }
      }
      merged
      mergedBy {
        ... on Organization { name }
        ... on Bot { login }
        ... on User {
          login
          isViewer
        }
        ... on Mannequin { login }
      }
      participants(first:10) {
        nodes {
          login
        }
      }
      additions
      deletions
      commits {
        totalCount
      }
      changedFiles
      headRefName
      headRefOid
      baseRefName
      baseRefOid
      baseRepository {
        name
        nameWithOwner
      }
      milestone {
        title
        state
      }
      author {
        login
      }
      viewerDidAuthor
      viewerCanUpdate
      ...ReactionGroupsFragment
      timelineItems(first: 100) {
        ...PullRequestTimelineItemsConnectionFragment
      }
      reviewDecision
      reviewThreads(last:100) {
        nodes {
          ...ReviewThreadInformationFragment
          comments(first: 100) {
            nodes {
              ...ReviewThreadCommentFragment
            }
          }
        }
      }
      labels(first: 20) {
        ...LabelConnectionFragment
      }
      assignees(first: 20) {
        ...AssigneeConnectionFragment
      }
      reviewRequests(first: 20) {
        totalCount
        nodes {
          requestedReviewer {
            ... on User {
              login
              isViewer
            }
            ... on Mannequin { login }
            ... on Bot { login }
            ... on Team { name }
          }
        }
      }
    }
  }
}
]==]

--- Install fresh stub octo modules, dofile the real spec, run config().
--- Each call gets brand-new stub tables so patch counts stay exact.
local function load_and_configure()
  local env = {
    setup_calls = 0,
    setup_opts = nil,
    orig_toggle_calls = 0,
    next_unviewed_calls = 0,
    layout = nil,
    stock_in_pr_branch = false,
    stock_in_pr_branch_calls = 0,
    system_calls = {},
    write_body = {},
    write_comment = {},
    provider_calls = 0,
    provider_items = {},
    pick_calls = {},
  }

  env.mappings = {
    toggle_viewed = function()
      env.orig_toggle_calls = env.orig_toggle_calls + 1
    end,
  }
  env.utils = {
    in_pr_branch = function(pr)
      env.stock_in_pr_branch_calls = env.stock_in_pr_branch_calls + 1
      return env.stock_in_pr_branch
    end,
    get_icon = function()
      return "P"
    end,
  }
  env.reviews = {
    get_current_layout = function()
      return env.layout
    end,
  }
  env.queries = { pull_requests = "stock placeholder query" }
  env.mutations = { create_pr = STOCK_CREATE_PR }
  env.provider = {
    pull_requests = function()
      env.provider_calls = env.provider_calls + 1
      require("snacks").picker.pick({ items = env.provider_items })
    end,
    picker = {},
  }
  env.writers = {
    write_body_agnostic = function(_, body)
      env.write_body[#env.write_body + 1] = body
    end,
    write_comment = function(_, comment)
      env.write_comment[#env.write_comment + 1] = comment
    end,
  }
  env.snacks = {
    picker = {
      pick = function(opts)
        env.pick_calls[#env.pick_calls + 1] = opts
      end,
    },
  }

  package.loaded["octo"] = {
    setup = function(opts)
      env.setup_calls = env.setup_calls + 1
      env.setup_opts = opts
    end,
  }
  package.loaded["octo.mappings"] = env.mappings
  package.loaded["octo.utils"] = env.utils
  package.loaded["octo.reviews"] = env.reviews
  package.loaded["octo.gh.queries"] = env.queries
  package.loaded["octo.gh.mutations"] = env.mutations
  package.loaded["octo.pickers.snacks.provider"] = env.provider
  package.loaded["octo.ui.writers"] = env.writers
  package.loaded["snacks"] = env.snacks

  local spec = dofile(root .. "/lua/plugins/octo.lua")
  spec.config(nil, spec.opts)
  return env, spec
end

H.run("octo_spec", function()
  -- ── mutations.create_pr: headRepository injection (#41) ────────────────
  -- The gsub-returns-original trap: a missed pattern hands back the stock
  -- string, so assert the string CHANGED, not just that it "looks right".
  do
    local env = load_and_configure()
    local patched = env.mutations.create_pr
    H.ne(patched, STOCK_CREATE_PR,
      "the create_pr gsub actually matched (a silent no-op drops headRepository and NPEs octo-buffer.lua:1045)")
    H.truthy(patched:find("headRepository {", 1, true),
      "patched create_pr selects headRepository")
    H.truthy(patched:find("headRepository {\n        name\n        nameWithOwner\n      }", 1, true),
      "headRepository block carries name and nameWithOwner")
    local _, head_count = patched:gsub("headRepository {", "")
    H.eq(head_count, 1, "exactly one headRepository block (gsub n=1)")
    H.truthy(patched:find("baseRepository {", 1, true),
      "the stock baseRepository block is preserved (%0 keeps the match)")
    H.truthy(patched:find("nameWithOwner\n      }\n      headRepository {", 1, true),
      "headRepository follows the baseRepository block")
    H.eq(env.setup_calls, 1, "octo.setup ran once during config")
  end

  -- ── in_pr_branch wrap (#44/#45) ────────────────────────────────────────
  do
    local env = load_and_configure()
    local wrapped = env.utils.in_pr_branch

    local sys_calls = {}
    local sys_out = ""
    local vstub = { shell_error = 0 }
    local restore_sys = H.replace(vim.fn, "system", function(cmd)
      sys_calls[#sys_calls + 1] = cmd
      return sys_out
    end)
    local restore_v = H.replace(vim, "v", vstub)

    local same_pr = { head_ref_name = "feature-x", head_repo = "me/repo", repo = "me/repo" }

    -- stock check true short-circuits before any git call
    env.stock_in_pr_branch = true
    H.truthy(wrapped({ head_ref_name = "other", head_repo = "fork/repo", repo = "me/repo" }),
      "the stock tracking-ref check still returns true on its own")
    H.eq(#sys_calls, 0, "stock short-circuit runs no git command")

    -- same-repo branch-name match
    env.stock_in_pr_branch = false
    sys_out = "feature-x\n"
    H.truthy(wrapped(same_pr), "same-repo PR on the head branch returns true")
    H.eq(#sys_calls, 1, "the branch-name check runs exactly one git command")
    H.eq(sys_calls[1], "git rev-parse --abbrev-ref HEAD", "branch resolved with the abbrev-ref command")

    -- case-insensitive repo compare (GitHub repos are case-insensitive)
    H.truthy(wrapped({ head_ref_name = "feature-x", head_repo = "Me/Repo", repo = "me/repo" }),
      "repo identity compares case-insensitively")

    -- branch mismatch
    sys_out = "main\n"
    H.eq(wrapped(same_pr), false, "a different local branch returns false")

    -- git failure
    sys_out = "feature-x\n"
    vstub.shell_error = 3
    H.eq(wrapped(same_pr), false, "git failure (shell_error ~= 0) returns false")
    vstub.shell_error = 0

    -- missing head_ref_name / nil pr: false, and no git call
    sys_calls = {}
    H.eq(wrapped({ head_repo = "me/repo", repo = "me/repo" }), false,
      "a PR without head_ref_name returns false")
    H.eq(wrapped(nil), false, "nil pr returns false")
    H.eq(#sys_calls, 0, "no git command ran for a missing head_ref_name")

    -- cross-repo PR: branch-name match is NOT sufficient
    sys_out = "feature-x\n"
    H.eq(wrapped({ head_ref_name = "feature-x", head_repo = "fork/repo", repo = "me/repo" }), false,
      "cross-repo PR still requires the stock check")

    -- no repo info at all: the wrap assumes same-repo (documented semantics)
    H.truthy(wrapped({ head_ref_name = "feature-x" }),
      "a PR without repo fields defaults to the same-repo assumption")

    restore_v()
    restore_sys()
  end

  -- ── toggle_viewed wrap + reload idempotency (#28) ──────────────────────
  do
    local env, spec = load_and_configure()
    env.layout = {
      select_next_unviewed_file = function()
        env.next_unviewed_calls = env.next_unviewed_calls + 1
      end,
    }

    env.mappings.toggle_viewed()
    H.eq(env.orig_toggle_calls, 1, "stock toggle_viewed ran once")
    H.eq(env.next_unviewed_calls, 1, "the next-unviewed jump chained exactly once")

    -- nil layout tolerated (file panel closed / no review)
    env.layout = nil
    env.mappings.toggle_viewed()
    H.eq(env.orig_toggle_calls, 2, "stock toggle_viewed ran again")
    H.eq(env.next_unviewed_calls, 1, "nil layout: no jump, no error")

    -- reload: a second config() against the SAME module table (what
    -- :Lazy reload or a re-source does) must not stack a second jump.
    env.layout = {
      select_next_unviewed_file = function()
        env.next_unviewed_calls = env.next_unviewed_calls + 1
      end,
    }
    local spec2 = dofile(root .. "/lua/plugins/octo.lua")
    spec2.config(nil, spec2.opts)
    _ = spec
    env.mappings.toggle_viewed()
    H.eq(env.orig_toggle_calls, 3, "after reload, the stock action ran once")
    H.eq(env.next_unviewed_calls, 2, "after reload, one keypress jumps exactly once (no double-wrap)")
  end

  -- ── queries.pull_requests replacement ──────────────────────────────────
  do
    local env = load_and_configure()
    local q = env.queries.pull_requests
    H.eq(type(q), "string", "pull_requests query is a string")
    H.ne(q, "stock placeholder query", "the stock query was replaced")
    H.truthy(q:find("author { login }", 1, true), "author is selected")
    H.truthy(q:find("repository { nameWithOwner }", 1, true), "repository is selected")
    H.truthy(q:find("headRefName", 1, true), "headRefName filter is present")
    H.truthy(q:find("isDraft", 1, true), "isDraft is present")
  end

  -- ── snacks provider chain (author in search + display) ─────────────────
  do
    local env = load_and_configure()
    env.provider_items = {
      { number = 42, title = "Fix login", kind = "pull_request", author = { login = "alice" } },
      { number = 100, title = "Bigger", kind = "pull_request", author = nil },
    }
    H.truthy(env.provider.pull_requests ~= nil and env.provider.picker ~= nil,
      "stub provider shape intact before the call")

    -- Drive the real patched provider: it wraps Snacks.picker.pick around
    -- the stock (stub) provider call, so the pick recorder sees patched opts.
    env.provider.pull_requests({})
    H.eq(env.provider_calls, 1, "the stock provider still ran")
    H.eq(#env.pick_calls, 1, "one pick call came through")
    local opts = env.pick_calls[1]
    H.eq(opts.items[1].text, "#42 Fix login alice", "item text includes the author for fuzzy match")
    H.eq(opts.items[2].text, "#100 Bigger ", "missing author leaves a trailing blank, no @")
    H.eq(type(opts.format), "function", "a custom format fn was installed")
    local ret = opts.format(opts.items[1], nil)
    local found_at, found_title, found_author = false, false, false
    for _, cell in ipairs(ret) do
      if cell[1] == "#42" then
        found_at = true
      end
      if cell[1] == "Fix login" then
        found_title = true
      end
      if cell[1] == "  @alice" then
        found_author = true
      end
    end
    H.truthy(found_at, "format renders the PR number")
    H.truthy(found_title, "format renders the title")
    H.truthy(found_author, "format renders the @author cell")
    H.truthy(env.snacks.picker.pick ~= nil and env.pick_calls[1] ~= nil,
      "Snacks.picker.pick was restored after the intercept")
    H.eq(env.provider.picker.prs, env.provider.pull_requests,
      "the provider module reference (picker.prs) points at the patched fn")
  end

  -- ── writers chain: html_to_markdown before render ──────────────────────
  do
    local env = load_and_configure()
    env.writers.write_body_agnostic(0, "plain **markdown**", 1, false)
    env.writers.write_body_agnostic(0, "<strong>bold</strong> &amp; <code>x</code>", 1, false)
    H.eq(env.write_body[1], "plain **markdown**", "pure markdown passes through unchanged")
    H.eq(env.write_body[2], "**bold** & `x`", "HTML in a body converts to markdown")

    env.writers.write_comment(0, { body = 'see <a href="https://x">link</a>' }, "kind", 1)
    H.eq(env.write_comment[1].body, "see [link](https://x)", "comment body converts to markdown")
    local no_body = { body = nil }
    env.writers.write_comment(0, no_body, "kind", 1)
    H.eq(env.write_comment[2].body, nil, "a comment without a body passes through")
  end

  -- ── BufWinEnter autocmd: RIGHT local-fs buffer becomes editable (#39) ──
  do
    load_and_configure()
    local groups = vim.api.nvim_get_autocmds({ group = "OctoRightPaneEditable" })
    H.truthy(#groups >= 1, "the OctoRightPaneEditable autocmd group is registered")

    local function pane_buf(name, split)
      local buf = vim.api.nvim_create_buf(false, true)
      vim.api.nvim_buf_set_name(buf, name)
      vim.api.nvim_buf_set_var(buf, "octo_diff_props", { split = split })
      vim.bo[buf].modifiable = false
      return buf
    end

    local right = pane_buf(vim.fn.tempname() .. "-rightpane.lua", "RIGHT")
    vim.api.nvim_exec_autocmds("BufWinEnter", { buffer = right })
    H.eq(vim.bo[right].modifiable, true, "a RIGHT local-fs buffer becomes modifiable")

    local left = pane_buf(vim.fn.tempname() .. "-leftpane.lua", "LEFT")
    vim.api.nvim_exec_autocmds("BufWinEnter", { buffer = left })
    H.eq(vim.bo[left].modifiable, false, "a LEFT pane stays non-modifiable")

    local scratch = pane_buf("octo://me/repo/42/files", "RIGHT")
    vim.api.nvim_exec_autocmds("BufWinEnter", { buffer = scratch })
    H.eq(vim.bo[scratch].modifiable, false, "an octo:// buffer stays non-modifiable")

    local plain = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(plain, vim.fn.tempname() .. "-plain.lua")
    vim.bo[plain].modifiable = false
    vim.api.nvim_exec_autocmds("BufWinEnter", { buffer = plain })
    H.eq(vim.bo[plain].modifiable, false, "a buffer without octo_diff_props is untouched")
  end

  -- ── html_to_markdown pure table cases (real fn via upvalue) ────────────
  do
    local _, spec = load_and_configure()
    local h2m = H.upvalue(spec.config, "html_to_markdown")

    H.eq(h2m(nil), nil, "nil passes through")
    H.eq(h2m(""), "", "empty passes through")
    H.eq(h2m("plain text, no tags"), "plain text, no tags", "no '<' takes the fast path")
    H.eq(h2m("a<br>b<br />c"), "a\nb\nc", "br converts to newline")
    H.eq(h2m("x<hr>y"), "x---y", "hr converts to a rule")
    H.eq(h2m('<a href="https://e.io">text</a>'), "[text](https://e.io)", "links convert")
    H.eq(h2m('<a href="u"><img alt="pic" src="s.png"></a>'), "[pic](u)", "linked images convert")
    H.eq(h2m('<img alt="shot" src="s.png">'), "shot", "standalone images keep the alt text")
    H.eq(h2m("<strong>s</strong> and <b>b</b>"), "**s** and **b**", "bold converts")
    H.eq(h2m("<em>e</em> and <i>i</i>"), "*e* and *i*", "italic converts")
    H.eq(h2m("<code>c</code>"), "`c`", "inline code converts")
    H.eq(h2m("<h2>Title</h2>"), "## Title", "headings convert")
    H.eq(h2m("<p>para</p>"), "para\n", "paragraphs unroll with a newline")
    H.eq(h2m("<details><summary>s</summary>body</details>"), "**s**body",
      "summary bolds and details unrolls")
    -- The fast path passes any body with no '<' straight through, so
    -- entities only decode when the body also carries HTML tags.
    H.eq(h2m("&amp;&lt;&gt;&quot;&#39;&nbsp;"), "&amp;&lt;&gt;&quot;&#39;&nbsp;",
      "an entity-only body takes the no-'<' fast path unchanged")
    H.eq(h2m("<b>a</b> &amp; &quot; &#39; &nbsp;end"), "**a** & \" '  end",
      "common entities decode alongside tags")
    -- C32a fixed: the tag-stripping pass runs BEFORE entity decoding, so
    -- a decoded &lt;…&gt; pair survives as literal text.
    H.eq(h2m("<b>x</b> a &lt; b &gt; c"), "**x** a < b > c",
      "decoded angle brackets survive the tag-stripping pass")
    H.eq(h2m("<code>&lt;tag&gt;</code>"), "`<tag>`",
      "a decoded angle pair inside a converted tag stays literal")
    H.eq(h2m("<div><span>keep</span></div>"), "keep", "container tags strip, content stays")
    H.eq(h2m("tail <unknown>tag</unknown>"), "tail tag", "unknown tags strip")
  end
end)

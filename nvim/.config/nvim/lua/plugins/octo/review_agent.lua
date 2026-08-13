local herdr = require("plugins.sidekick.herdr")

local M = {}

local state_path = vim.fn.stdpath("state") .. "/octo-review-agents.json"
local context_var = "octo_review_context"

local function notify(message, level)
  vim.notify("Octo review: " .. message, level or vim.log.levels.ERROR)
end

local function trim(value)
  return (value or ""):gsub("%s+$", "")
end

local function command(args, opts)
  opts = opts or {}
  opts.text = true
  return vim.system(args, opts):wait()
end

local function git(cwd, args)
  local cmd = { "git", "-C", cwd }
  vim.list_extend(cmd, args)
  return command(cmd)
end

local function ref_slug(repo, number)
  return (repo .. "-" .. tostring(number)):lower():gsub("[^%w._-]+", "-")
end

local function branch_name(repo, number)
  return "review/" .. ref_slug(repo, number)
end

local function tab_context(tab)
  local ok, context = pcall(vim.api.nvim_tabpage_get_var, tab or 0, context_var)
  return ok and type(context) == "table" and context or nil
end

local function set_tab_context(tab, context)
  vim.api.nvim_tabpage_set_var(tab, context_var, context)
  vim.api.nvim_tabpage_set_var(tab, "octo_review_state", context.state)
  vim.api.nvim_tabpage_set_var(tab, "octo_review_unseen", context.unseen == true)
  vim.cmd.redrawtabline()
end

local function load_state()
  if vim.fn.filereadable(state_path) ~= 1 then
    return { reviews = {} }
  end
  local ok, decoded = pcall(vim.json.decode, table.concat(vim.fn.readfile(state_path), "\n"))
  if not ok or type(decoded) ~= "table" then
    return { reviews = {} }
  end
  decoded.reviews = type(decoded.reviews) == "table" and decoded.reviews or {}
  return decoded
end

local function save_state(state)
  vim.fn.mkdir(vim.fn.fnamemodify(state_path, ":h"), "p")
  local temporary = state_path .. ".tmp"
  if vim.fn.writefile({ vim.json.encode(state) }, temporary) ~= 0 then
    return false
  end
  return vim.uv.fs_rename(temporary, state_path) ~= nil
end

local function review_key(host, repo, number)
  return string.format("%s/%s#%d", host or "github.com", repo:lower(), number)
end

local function review_state(pr)
  if pr.isDraft then
    return "draft"
  end
  if pr.mergedAt or pr.state == "MERGED" then
    return "merged"
  end
  if pr.state == "CLOSED" then
    return "closed"
  end
  return "open"
end

function M.fingerprint(pr)
  local checks = {}
  for _, check in ipairs(pr.statusCheckRollup or {}) do
    checks[#checks + 1] = table.concat({
      check.name or check.context or "",
      check.conclusion or check.state or check.status or "",
      check.completedAt or check.startedAt or "",
    }, ":")
  end
  table.sort(checks)
  return vim.fn.sha256(vim.json.encode({
    head = pr.headRefOid,
    updated = pr.updatedAt,
    state = review_state(pr),
    comments = #(pr.comments or {}),
    reviews = #(pr.reviews or {}),
    checks = checks,
  }))
end

function M.agent_name(repo, number)
  local name = repo:match("/([^/]+)$") or repo
  name = name:lower():gsub("[^%w_-]+", "-"):sub(1, 15):gsub("-$", "")
  return ("codex-pr-%s-%d"):format(name, number):sub(1, 32)
end

function M.is_session(name)
  return type(name) == "string" and name:match("^codex%-pr%-") ~= nil
end

local function wrap_line(line, width)
  local function display_width(value)
    return vim.fn.strdisplaywidth(value)
  end
  if display_width(line) <= width then
    return { line }
  end
  local prefix = line:match("^(%s*[%-%*+]%s+)") or line:match("^(%s*%d+[%.%)]%s+)") or line:match("^(%s*>%s*)") or ""
  local content = line:sub(#prefix + 1)
  local continuation = prefix:gsub("[^%s]", " ")
  local available = math.max(width - display_width(prefix), 20)
  local out, current = {}, prefix
  for word in content:gmatch("%S+") do
    if current ~= prefix and display_width(current .. " " .. word) > width then
      out[#out + 1] = current
      current = continuation .. word
    elseif current == prefix then
      current = current .. word
    else
      current = current .. " " .. word
    end
    if display_width(word) > available and display_width(current) > width then
      out[#out + 1] = current
      current = continuation
    end
  end
  if current ~= prefix and current ~= continuation then
    out[#out + 1] = current
  end
  return #out > 0 and out or { line }
end

function M.wrap_markdown(body, width)
  width = width or 60
  local out, fenced = {}, false
  for _, line in ipairs(vim.split(body or "", "\n", { plain = true })) do
    local fence = line:match("^%s*```") or line:match("^%s*~~~")
    local preserve = fenced
      or fence
      or line:find("|", 1, true)
      or line:match("^    ")
      or line:match("^%s*<[%w/!]")
      or line:match("^%s*#")
    if fence then
      fenced = not fenced
    end
    if preserve or line == "" then
      out[#out + 1] = line
    else
      vim.list_extend(out, wrap_line(line, width))
    end
  end
  return out
end

local function description_lines(context)
  local lines = {
    string.format("# %s", context.title),
    "",
    string.format("%s/%s#%d · %s", context.host, context.repo, context.number, context.state),
    string.format("@%s · %s → %s", context.author, context.head_ref, context.base_ref),
    "",
  }
  vim.list_extend(lines, M.wrap_markdown(context.body, 60))
  return lines
end

local function review_buffer(context)
  local name = string.format("octo-review://%s/%s/pull/%d", context.host, context.repo, context.number)
  local bufnr = vim.fn.bufnr(name)
  if bufnr < 0 then
    bufnr = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(bufnr, name)
  end
  vim.bo[bufnr].modifiable = true
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, description_lines(context))
  vim.b[bufnr].octo_review_body = context.body
  vim.b[bufnr].octo_review_key = context.key
  vim.bo[bufnr].buftype = "nofile"
  vim.bo[bufnr].bufhidden = "hide"
  vim.bo[bufnr].swapfile = false
  vim.bo[bufnr].buflisted = false
  vim.bo[bufnr].filetype = "markdown"
  vim.bo[bufnr].modifiable = false
  return bufnr
end

function M.restore(context)
  context = context or tab_context(vim.api.nvim_get_current_tabpage())
  if not context then
    return false
  end
  local win
  for _, candidate in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    local is_sidekick = pcall(vim.api.nvim_win_get_var, candidate, "sidekick_cli")
    if vim.api.nvim_win_get_config(candidate).relative == "" and not is_sidekick then
      win = candidate
      break
    end
  end
  if not win then
    vim.cmd("leftabove vnew")
    win = vim.api.nvim_get_current_win()
  end
  vim.api.nvim_set_current_win(win)
  pcall(vim.cmd, "silent! only")
  vim.api.nvim_win_set_buf(win, review_buffer(context))
  vim.api.nvim_win_set_width(win, math.min(60, math.max(vim.o.columns - 40, 20)))
  vim.wo[win].winfixwidth = true
  vim.wo[win].wrap = false
  vim.wo[win].linebreak = false
  vim.wo[win].number = false
  vim.wo[win].relativenumber = false
  vim.wo[win].signcolumn = "no"
  vim.wo[win].winbar = "%#Title# PR description %#Comment#· <C-w>l agent "
  return true
end

local function record_for_session(name)
  local state = load_state()
  for _, record in pairs(state.reviews) do
    if record.agent_name == name then
      return record
    end
  end
end

function M.restore_for_session(name)
  if not M.is_session(name) then
    return false
  end
  local tab = vim.api.nvim_get_current_tabpage()
  local context = tab_context(tab) or record_for_session(name)
  if not context then
    return false
  end
  set_tab_context(tab, context)
  return M.restore(context)
end

function M.configure_terminal(terminal)
  if not terminal or not terminal.tool or not M.is_session(terminal.tool.name) then
    return
  end
  terminal.opts.layout = "right"
  terminal.opts.split.width = math.max(vim.o.columns - 61, 40)
end

function M.bind_workspace(tab, workspace)
  if not workspace or not workspace.workspace_id then
    return false
  end
  local state = load_state()
  for _, record in pairs(state.reviews) do
    if record.workspace_id == workspace.workspace_id then
      set_tab_context(tab, record)
      return true
    end
  end
  return false
end

local function parse_remote(url)
  url = trim(url):gsub("%.git$", "")
  local host, repo = url:match("^git@([^:]+):(.+)$")
  if not host then
    host, repo = url:match("^ssh://[^@]+@([^/]+)/(.+)$")
  end
  if not host then
    host, repo = url:match("^https?://([^/]+)/(.+)$")
  end
  return host, repo
end

local function matching_remote(path, host, repo)
  local root = trim(git(path, { "rev-parse", "--show-toplevel" }).stdout)
  if root == "" then
    return nil
  end
  local remotes = git(root, { "remote" })
  if remotes.code ~= 0 then
    return nil
  end
  for _, remote in ipairs(vim.split(trim(remotes.stdout), "\n", { plain = true, trimempty = true })) do
    local url = git(root, { "remote", "get-url", remote })
    local remote_host, remote_repo = parse_remote(url.stdout)
    if remote_host and remote_repo and remote_host:lower() == host:lower() and remote_repo:lower() == repo:lower() then
      return root, remote
    end
  end
end

local function repository_candidates(cwd, repo)
  local candidates, seen = {}, {}
  local function add(path)
    path = path and vim.fs.normalize(vim.fn.fnamemodify(path, ":p")) or nil
    if path and not seen[path] and vim.fn.isdirectory(path) == 1 then
      seen[path] = true
      candidates[#candidates + 1] = path
    end
  end
  add(cwd)
  if vim.fn.executable("ghq") == 1 then
    local ghq = command({ "ghq", "list", "-p" })
    if ghq.code == 0 then
      for _, path in ipairs(vim.split(trim(ghq.stdout), "\n", { plain = true, trimempty = true })) do
        add(path)
      end
    end
  end
  local name = repo:match("/([^/]+)$")
  local home = vim.fn.expand("~")
  for _, parent in ipairs({ "", "projects", "tools", "playground", "modal-projects" }) do
    add(vim.fs.joinpath(home, parent, name))
  end
  return candidates
end

local function resolve_repository(cwd, host, repo)
  for _, path in ipairs(repository_candidates(cwd, repo)) do
    local root, remote = matching_remote(path, host, repo)
    if root then
      return root, remote
    end
  end
end

local function has_rebase(cwd)
  local git_dir = trim(git(cwd, { "rev-parse", "--git-dir" }).stdout)
  if git_dir == "" then
    return false
  end
  if not vim.startswith(git_dir, "/") then
    git_dir = vim.fs.joinpath(cwd, git_dir)
  end
  return vim.fn.isdirectory(vim.fs.joinpath(git_dir, "rebase-merge")) == 1
    or vim.fn.isdirectory(vim.fs.joinpath(git_dir, "rebase-apply")) == 1
end

local function preserve_local_changes(cwd)
  local status = git(cwd, { "status", "--porcelain", "--untracked-files=all" })
  if status.code ~= 0 or trim(status.stdout) == "" then
    return status.code == 0
  end
  if git(cwd, { "add", "-A" }).code ~= 0 then
    return false
  end
  return git(cwd, { "commit", "-m", "chore: preserve local PR review edits" }).code == 0
end

local function sync_branch(context, new_head)
  local cwd = context.cwd
  local slug = ref_slug(context.repo, context.number)
  local base_ref = "refs/octo-review/base/" .. slug
  local recovery_ref = "refs/octo-review/recovery/" .. slug
  if has_rebase(cwd) then
    return true, base_ref, recovery_ref
  end
  if not preserve_local_changes(cwd) then
    notify("could not commit local changes before refreshing the PR")
    return nil
  end
  local old_head = trim(git(cwd, { "rev-parse", "--verify", base_ref }).stdout)
  if old_head == "" then
    git(cwd, { "update-ref", base_ref, new_head })
    return false, base_ref, recovery_ref
  end
  if old_head == new_head then
    return false, base_ref, recovery_ref
  end
  local current = trim(git(cwd, { "rev-parse", "HEAD" }).stdout)
  if git(cwd, { "update-ref", recovery_ref, current }).code ~= 0 then
    notify("could not create the recovery ref before rebase")
    return nil
  end
  local rebased = git(cwd, { "-c", "core.editor=true", "rebase", "--onto", new_head, old_head })
  if rebased.code ~= 0 then
    return true, base_ref, recovery_ref
  end
  if git(cwd, { "diff", "--check" }).code ~= 0 then
    notify("rebased branch failed git diff --check; recovery ref retained")
    return nil
  end
  git(cwd, { "update-ref", base_ref, new_head })
  git(cwd, { "update-ref", "-d", recovery_ref })
  return false, base_ref, recovery_ref
end

local function ensure_scope(root, remote, context)
  local slug = ref_slug(context.repo, context.number)
  local head_ref = "refs/octo-review/heads/" .. slug
  local fetched = git(root, {
    "fetch",
    "--force",
    remote,
    string.format("+refs/pull/%d/head:%s", context.number, head_ref),
  })
  if fetched.code ~= 0 then
    notify("could not fetch PR head: " .. trim(fetched.stderr))
    return nil
  end
  local head = trim(git(root, { "rev-parse", head_ref }).stdout)
  if head == "" then
    notify("fetched PR head could not be resolved")
    return nil
  end

  local branch = branch_name(context.repo, context.number)
  local listed = herdr.call({ "worktree", "list", "--cwd", root })
  local found
  for _, worktree in ipairs(listed and listed.worktrees or {}) do
    if worktree.branch == branch then
      found = worktree
      break
    end
  end
  local workspace_id = found and found.open_workspace_id or nil
  if not found or not workspace_id then
    local action = found and "open" or "create"
    local args = { "worktree", action, "--cwd", root, "--branch", branch }
    if action == "create" then
      vim.list_extend(args, { "--base", head_ref })
    end
    vim.list_extend(args, { "--label", context.label, "--no-focus" })
    local result = herdr.call(args)
    found = result and result.worktree or nil
    workspace_id = result and result.workspace and result.workspace.workspace_id or nil
  end
  if not found or not workspace_id or not found.path then
    notify("could not create or reopen the PR worktree workspace")
    return nil
  end
  context.cwd = found.path
  context.branch = branch
  context.workspace_id = workspace_id
  local conflict, base_ref, recovery_ref = sync_branch(context, head)
  if conflict == nil then
    return nil
  end
  return context, conflict, head, base_ref, recovery_ref
end

local function prompt_text(context, conflict, head, base_ref, recovery_ref)
  local conflict_instructions = ""
  local mutation_instructions = [[This first pass is read-only: do not edit files, post comments, push,
approve, merge, or otherwise mutate GitHub unless the user explicitly asks.]]
  if conflict then
    conflict_instructions = string.format(
      [[

A git rebase is currently conflicted. Resolve every conflict semantically, stage the resolutions,
and finish the rebase yourself with GIT_EDITOR=true git rebase --continue. Run relevant tests plus
git diff --check. Only after they pass, run:
  git update-ref %s %s
  git update-ref -d %s
If resolution or validation fails, leave the recovery ref intact and explain the blocker.]],
      base_ref,
      head,
      recovery_ref
    )
    mutation_instructions = [[Apart from the required conflict resolution, do not make unrelated edits,
post comments, push, approve, merge, or otherwise mutate GitHub unless the user explicitly asks.]]
  end
  return string.format(
    [[You are the dedicated review agent for %s#%d in %s.

Refresh the complete PR context before answering:
- gh pr view %d --repo %s --json number,title,body,state,isDraft,mergedAt,author,baseRefName,headRefName,headRefOid,updatedAt,reviewDecision,mergeStateStatus,statusCheckRollup,comments,reviews,files,commits
- gh pr diff %d --repo %s
- gh pr checks %d --repo %s

Read the full diff, checks, reviews, and comments. Then produce a compact context summary of at most
30 lines covering intent, change map, checks, review signals, risks, and local branch state. After the
summary, wait for instructions. %s%s]],
    context.repo,
    context.number,
    context.cwd,
    context.number,
    context.repo,
    context.number,
    context.repo,
    context.number,
    context.repo,
    mutation_instructions,
    conflict_instructions
  )
end

local function mark_seen(key, fingerprint, tab)
  local state = load_state()
  local record = state.reviews[key]
  if not record then
    return
  end
  record.seen_fingerprint = fingerprint
  record.unseen = false
  state.reviews[key] = record
  save_state(state)
  if tab and vim.api.nvim_tabpage_is_valid(tab) then
    set_tab_context(tab, record)
  end
end

local function start_agent(context, conflict, head, base_ref, recovery_ref)
  local internal = require("plugins.sidekick.internal")
  local slug = context.agent_name:sub(#"codex-" + 1)
  internal.start_named_session("codex", slug, context.cwd)
  local tab = vim.api.nvim_get_current_tabpage()
  local prompt = prompt_text(context, conflict, head, base_ref, recovery_ref)
  local function submit(remaining)
    if not herdr.get_agent(context.agent_name) then
      if remaining > 0 then
        vim.defer_fn(function()
          submit(remaining - 1)
        end, 200)
      else
        notify("review agent did not become ready", vim.log.levels.WARN)
      end
      return
    end
    vim.system(
      { "herdr", "agent", "prompt", context.agent_name, prompt, "--wait", "--timeout", "900000" },
      { text = true },
      vim.schedule_wrap(function(result)
        local refreshed = result.code == 0
        if refreshed and conflict then
          local base = git(context.cwd, { "rev-parse", "--verify", base_ref })
          local recovery = git(context.cwd, { "rev-parse", "--verify", recovery_ref })
          refreshed = not has_rebase(context.cwd) and trim(base.stdout) == head and recovery.code ~= 0
        end
        if refreshed then
          mark_seen(context.key, context.fingerprint, tab)
        else
          notify("context refresh did not finish; unseen status retained", vim.log.levels.WARN)
        end
      end)
    )
  end
  submit(50)
end

local function activate(pr, opts)
  local host = opts.host or "github.com"
  local repo = opts.repo
  local number = tonumber(opts.number)
  local root, remote = resolve_repository(opts.cwd, host, repo)
  if not root then
    notify(string.format("no local clone for %s/%s; open the PR from a matching checkout", host, repo))
    return
  end

  local name = repo:match("/([^/]+)$") or repo
  local key = review_key(host, repo, number)
  local state = load_state()
  local previous = state.reviews[key]
  local fingerprint = M.fingerprint(pr)
  local context = {
    key = key,
    host = host,
    repo = repo,
    number = number,
    label = string.format("%s · #%d", name, number),
    title = pr.title or ("Pull request #" .. number),
    body = pr.body or "",
    author = pr.author and pr.author.login or "?",
    base_ref = pr.baseRefName or "?",
    head_ref = pr.headRefName or "?",
    state = review_state(pr),
    fingerprint = fingerprint,
    seen_fingerprint = previous and previous.seen_fingerprint or nil,
    unseen = previous ~= nil and previous.seen_fingerprint ~= fingerprint,
    agent_name = M.agent_name(repo, number),
  }

  local scoped, conflict, head, base_ref, recovery_ref = ensure_scope(root, remote, context)
  if not scoped then
    return
  end
  state.reviews[key] = scoped
  if not save_state(state) then
    notify("could not persist review workspace state", vim.log.levels.WARN)
  end
  if not require("plugins.herdr.workspaces").focus(scoped.workspace_id) then
    return
  end
  local tab = vim.api.nvim_get_current_tabpage()
  set_tab_context(tab, scoped)
  M.restore(scoped)
  start_agent(scoped, conflict, head, base_ref, recovery_ref)
end

function M.open(opts)
  opts = opts or {}
  local repo = opts.repo
  local number = tonumber(opts.number)
  if not repo or not number then
    notify("repository and PR number are required")
    return
  end
  local cwd = opts.cwd or vim.fn.getcwd(-1, 0)
  local host = opts.host or "github.com"
  local fields = table.concat({
    "number",
    "title",
    "body",
    "state",
    "isDraft",
    "mergedAt",
    "author",
    "baseRefName",
    "headRefName",
    "headRefOid",
    "updatedAt",
    "reviewDecision",
    "mergeStateStatus",
    "statusCheckRollup",
    "comments",
    "reviews",
    "files",
    "commits",
  }, ",")
  local env = host ~= "github.com" and vim.tbl_extend("force", vim.fn.environ(), { GH_HOST = host }) or nil
  vim.system(
    { "gh", "pr", "view", tostring(number), "--repo", repo, "--json", fields },
    { text = true, env = env },
    vim.schedule_wrap(function(result)
      if result.code ~= 0 then
        notify("gh pr view failed: " .. trim(result.stderr))
        return
      end
      local ok, pr = pcall(vim.json.decode, result.stdout or "")
      if not ok or type(pr) ~= "table" then
        notify("gh pr view returned invalid JSON")
        return
      end
      activate(pr, { repo = repo, number = number, host = host, cwd = cwd })
    end)
  )
end

function M.open_current()
  local cwd = vim.fn.getcwd(-1, 0)
  vim.system(
    { "gh", "pr", "view", "--json", "number,url" },
    { cwd = cwd, text = true },
    vim.schedule_wrap(function(result)
      if result.code ~= 0 then
        notify("current branch has no pull request", vim.log.levels.WARN)
        return
      end
      local ok, value = pcall(vim.json.decode, result.stdout or "")
      local host, repo, number = ok and value.url and value.url:match("^https?://([^/]+)/(.+)/pull/(%d+)")
      if not host or not repo or not number then
        notify("could not identify the current pull request")
        return
      end
      M.open({ host = host, repo = repo, number = tonumber(number), cwd = cwd })
    end)
  )
end

function M.setup()
  local octo = require("octo")
  if octo._review_agent_setup then
    return
  end
  octo._review_agent_setup = true

  local utils = require("octo.utils")
  local uri = require("octo.uri")
  local original_get_pull_request = utils.get_pull_request
  utils.get_pull_request = function(...)
    local repo, number = uri.get_repo_number_from_varargs(...)
    if repo and number then
      M.open({ repo = repo, number = number })
      return
    end
    return original_get_pull_request(...)
  end

  local original_load_buffer = octo.load_buffer
  octo.load_buffer = function(opts)
    local bufnr = opts and opts.bufnr or vim.api.nvim_get_current_buf()
    local parsed = uri.parse(vim.api.nvim_buf_get_name(bufnr))
    if parsed and parsed.kind == "pull" then
      M.open({ host = parsed.hostname or "github.com", repo = parsed.repo, number = tonumber(parsed.id) })
      vim.schedule(function()
        if vim.api.nvim_buf_is_valid(bufnr) then
          pcall(vim.api.nvim_buf_delete, bufnr, { force = true })
        end
      end)
      return
    end
    return original_load_buffer(opts)
  end
end

return M

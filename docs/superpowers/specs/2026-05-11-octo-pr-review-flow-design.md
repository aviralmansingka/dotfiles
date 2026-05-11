# Octo PR review flow — design

**Date:** 2026-05-11
**Branch context:** brainstorming session; no implementation branch yet
**Status:** draft, awaiting approval before plan

## Goal

Make PR review work in Neovim feel like a coherent flow rather than a pile of `:Octo …` commands. Standardise on Octo as the cockpit for both sides (reviewer and author), close three concrete gaps in the default UX:

1. Discoverability — no top-level Octo namespace, no entry-point for "review current branch's PR" or "PRs by author=X".
2. Comment authoring — visual-select + `<localleader>ca` is fine for raw comments, but there's no fast path for prefixed comments (`nit:`, `Q:`, `blocker:`, `+1`) that the author can later triage by kind.
3. Thread triage — `]c`/`[c` and `]t`/`[t` are step-throughs, not a "single pane of glass" for what's left to handle. Default Octo has no threads picker.

Explicitly out of scope: AI/LLM integration (no prbot bridge in this design), changes to gitsigns/lazygit, and gh CLI wrappers in zsh.

## Current state inventory

What exists today in this repo:

- `nvim/.config/nvim/lua/plugins/octo.lua` — Octo plugin spec with non-trivial customisation:
  - Custom `pull_requests` GraphQL query adding `author { login }`.
  - Snacks picker provider monkey-patched to display `#NN  title  @author` and fuzzy-match on author.
  - HTML→Markdown converter run over PR/comment bodies via patched `octo.ui.writers`.
  - One custom picker mapping: `open_in_browser = <leader>gO`.
- `nvim/.config/nvim/lua/config/lazy.lua` imports `lazyvim.plugins.extras.util.octo`, which provides:
  - Top-level keys under `<leader>g…`: `gi`, `gI`, `gp`, `gP`, `gr`, `gS`.
  - `<localleader>` group labels for `a/c/l/i/r/p/v/g` in `octo` filetype.
  - Picker selection logic (telescope → fzf-lua → snacks).
- Octo defaults the user relies on, unchanged: `<localleader>vs` start/submit review, `<localleader>ca` add comment, `<localleader>sa` add suggestion, `<localleader>cr` reply, `<localleader>rt`/`rT` resolve/unresolve thread, `]c`/`[c` next/prev comment, `]t`/`[t` next/prev thread, `]q`/`[q` next/prev file, `]u`/`[u` next/prev unviewed file, `<localleader><space>` toggle viewed, `<C-a>`/`<C-m>`/`<C-r>` approve/comment/request-changes in submit window, `<leader>qa` approve PR (global), `auto_show_threads = true`.
- Skills available for adjacent work but **not used in this design**: `/prbot review|resolve|summarize`, `/ci`, `/review`, `/security-review`. They stay independent of Octo.

What does **not** conflict (verified):

- `gitsigns.nvim` keymaps are `<leader>h*` (hunk) and `]c`/`[c` (hunk navigation). `]c`/`[c` are buffer-local in Octo filetypes, so buffer-local resolution applies — no fix needed.
- No third-party PR tooling (no Neogit, Diffview, Fugitive) is configured.

## Architecture

### File layout

```
nvim/.config/nvim/lua/plugins/
  octo.lua                  # existing — extended with top-level `keys` table
  octo/
    threads_picker.lua      # new — Snacks-based picker for current PR's review threads
    comment_templates.lua   # new — wraps Octo add_*comment fns with prefix injection
```

`octo.lua` already holds 192 lines of writers/queries patches; new code goes under `octo/` to keep concerns separate. The two new files are small and self-contained, and only `octo.lua` needs to require them (via `init`/`config`) so lazy.nvim doesn't need extra plugin entries.

### Namespace cleanup

LazyVim octo extras' top-level keys move out of `<leader>g…` into a dedicated `<leader>O…` namespace. The `<leader>g…` group returns to local-git only (lazygit, gitsigns hunks).

- Disable in plugin override: `<leader>gi`, `<leader>gI`, `<leader>gp`, `<leader>gP`, `<leader>gr`, `<leader>gS` (set `false` via Lazy `keys` table).
- Keep the existing custom picker mapping `<leader>gO` (open in browser) — user explicitly wants this preserved.
- Add `<leader>O` group label via which-key.

### Top-level keymap table

All global, mode `n` unless noted.

| Key | Action | Implementation |
|---|---|---|
| `<leader>OO` | Smart entry: if current branch has an open PR, start/resume review; else open PR list | Detects PR via `gh pr view --json number,state --jq` then `:Octo review start`/`resume`; else `:Octo pr list` |
| `<leader>Op` | PR list (default scope) | `:Octo pr list` |
| `<leader>OP` | PR search (free-form within PRs) | `:Octo pr search` |
| `<leader>Om` | PRs authored by me | `:Octo pr list author=@me` |
| `<leader>Or` | PRs requesting my review | `:Octo pr list reviewer=@me state=open` (verify flag syntax at impl) |
| `<leader>OA` | Prompt for author, then list | `vim.ui.input` → `:Octo pr list author=<input>` |
| `<leader>OS` | Free-form Octo search (all kinds) | `:Octo search` |
| `<leader>OT` | Threads picker for current PR | `require('plugins.octo.threads_picker').open()` |
| `<leader>Oi` | Issue list | `:Octo issue list` |
| `<leader>OI` | Issue search | `:Octo issue search` |
| `<leader>Oc` | Checkout PR (picker if not in a PR buffer); commonly chained with `<leader>OO` to start the review on the checked-out branch | `:Octo pr checkout` |
| `<leader>Ob` | Open PR in browser | `:Octo pr browser` |

### Comment template keymaps (buffer-local)

Mode `n` and `x`, filetypes `octo` and `octo_diff` (and any other review-context filetype Octo uses — verify list at impl).

| Key | Prefix | Calls |
|---|---|---|
| `<localleader>cn` | `nit: ` | `add_review_comment` or `add_comment` depending on context |
| `<localleader>cq` | `Q: ` | same |
| `<localleader>cb` | `blocker: ` | same |
| `<localleader>c+` | `+1, ` | same |

Existing `<localleader>ca` (raw comment), `<localleader>sa` (suggestion), `<localleader>cr` (reply), `<localleader>cd` (delete), `<localleader>ce` (edit history) remain untouched.

## Flows within a review

### Reviewer flow (someone else's PR)

Four phases.

**Phase 1 — Find.** Pick an entry point based on intent. All four open the snacks PR picker; the existing author-display patch surfaces `@author` in each row, and the fuzzy-match field includes the author handle so you can narrow further by typing `@name`. `<CR>` opens the highlighted PR's `octo://` buffer.

| Intent | Key | What it runs |
|---|---|---|
| "PRs assigned to me to review" | `<leader>Or` | `:Octo pr list reviewer=@me state=open` |
| "PRs by a specific teammate" | `<leader>OA` | `vim.ui.input` prompts for author handle, then `:Octo pr list author=<input>` |
| "PRs I authored" (catch-up on my own backlog) | `<leader>Om` | `:Octo pr list author=@me` |
| "All open PRs, narrow with the picker" | `<leader>Op` | `:Octo pr list` — fuzzy-match in the picker by `#NN`, title, or `@author` |
| "Check out this PR locally so I can run/debug it, then review" | `<leader>Oc` → `<leader>OO` | `:Octo pr checkout` (picker if not in a PR buffer) switches the working tree to the PR's head branch; then smart-entry detects the PR for the current branch, opens the PR buffer and starts the review |

Picking by author has two paths because they serve different use cases: `<leader>OA` is best when you know exactly whose PRs you want (one-shot, no scrolling); `<leader>Op` + typing `@name` in the picker is best when you're browsing or unsure of the handle. Both rely on the same author field in the existing GraphQL query.

**Checkout-then-review chain.** `<leader>Oc` invokes `:Octo pr checkout`, which is global (works anywhere — see `octo/commands.lua:599`): if the current buffer is not an Octo PR buffer it opens the PR picker, on selection it shells `gh pr checkout <n>` and your working tree moves to the PR's head branch. The picker step is skipped if you're already in a PR buffer. Importantly, checkout does **not** open the PR's Octo buffer afterwards — you end up on the branch but in whatever file you started from. To start the review from there, follow up with `<leader>OO`: the smart-entry detects an open PR for the current branch and runs `:Octo review start` (or `resume`). Two keystrokes total. This is the path to use when you want full LSP / test-runner / debugger support against the PR's code, not just diff-reading.

**Phase 2 — Survey.** Read the PR description, scan existing comments. `]c`/`[c` step through existing comments in this buffer. `<localleader>pc` lists commits if the PR is multi-commit. No review tab open yet.

**Phase 3 — Start review.** `<localleader>vs` opens the review tab: file panel left, diff right. `<localleader>e` toggles focus to the file panel. `<localleader>b` hides/shows the panel.

**Phase 4 — Walk and comment.** For each changed file:

- Navigate: `]q`/`[q` next/prev file, or `]u`/`[u` next/prev *unviewed* file (closer to how GitHub's "viewed" checkbox flow works).
- Mark viewed: `<localleader><space>` when done with a file.
- Comment on lines: visual-select range → template keymap.
  - `<localleader>cn` for `nit: …` (stylistic, non-blocking).
  - `<localleader>cq` for `Q: …` (question, not a change request).
  - `<localleader>cb` for `blocker: …` (must fix before merge).
  - `<localleader>c+` for `+1, …` (praise).
  - `<localleader>ca` raw, no prefix.
  - `<localleader>sa` inline suggestion block.
- Each template opens the review-comment compose buffer, writes the prefix, leaves the cursor at end-of-prefix in insert mode. The user finishes the sentence; `<localleader>vs` from the comment buffer commits the comment to the pending review (existing Octo behaviour).
- Revisit threads on the current file: `]t`/`[t` (existing default).

**Phase 5 — Finalize.** `<localleader>vs` from the review tab again opens the submit window. The submit window has a freeform text area for the overall review summary. Then:

- `<C-a>` approve
- `<C-m>` comment
- `<C-r>` request changes
- `<C-c>` close tab without submitting

### Author flow (own PR with comments to triage)

Three phases.

**Phase 1 — Enumerate.** `<leader>OO` smart-entry detects the open PR and opens the PR buffer. `<leader>OT` opens the threads picker, default-filtered to unresolved threads. Rows: `[unresolved] path:line @author preview…`.

**Phase 2 — Resolve loop.** For each thread:

- `<CR>` jumps to `path:line` in the working file (not the diff view) so normal LSP editing is available. The latest comment shows in a floating preview (`auto_show_threads = true` already on).
- Decide:
  - **Fix code** — edit the file, save. The push will close the thread implicitly, or use `<localleader>rt` to mark resolved explicitly.
  - **Reply only** — `<localleader>cr` reply, write response, `<localleader>vs` submit reply.
  - **Disagree** — reply with reasoning; leave thread unresolved for the reviewer to close.
- In the threads picker, `<C-r>` resolves the highlighted thread without leaving the picker (useful for bulk wrap-up too).

**Phase 3 — Push.** Standard git workflow via `<leader>gg` (lazygit) or terminal. No polling; refresh the threads picker manually when needed.

## Custom component specs

### Threads picker — `nvim/.config/nvim/lua/plugins/octo/threads_picker.lua`

**Data source.** GraphQL query for `pullRequest.reviewThreads`, paged, fetching per thread: `id`, `isResolved`, `isOutdated`, `path`, `line`, `startLine`, latest `comment.body`, latest `comment.author.login`. Reuse Octo's `octo.gh.queries.review_threads` if it exists; otherwise add a new query string in `octo.lua` next to the `pull_requests` patch.

**Picker shape.** Mirrors the existing `snacks_provider.pull_requests` monkey-patch.

- Item shape:
  ```lua
  { thread_id, path, line, resolved, outdated, author, preview, raw }
  ```
- `text` field for fuzzy matching: `"<path>:<line> @<author> <preview>"`.
- Format columns: `[●/○]` resolved icon (Comment hl) · `path:line` (Comment hl) · `@author` (Comment hl) · `preview` (Normal hl, truncated to ~60 chars).
- Default filter: `not isResolved and not isOutdated`.

**In-picker actions.**

| Key | Action |
|---|---|
| `<CR>` | Open `path:line` in working buffer (`vim.cmd.edit` + `nvim_win_set_cursor`); render thread popup (verify Octo API at impl) |
| `<C-r>` | Resolve highlighted thread via Octo API or `gh api graphql` mutation `resolveReviewThread`; refresh picker |
| `<C-b>` | Open thread in browser (PR URL + `#discussion_r<id>`) |
| `<C-x>` | Open in review tab at `path:line` (start review if none pending, then jump) |
| `<C-u>` | Toggle unresolved-only filter (default on) |
| `<C-o>` | Toggle outdated visibility |
| `<C-y>` | Filter to "threads where I commented" |

**Entry point.** `require('plugins.octo.threads_picker').open()`. If `octo.utils.get_pull_request()` returns nil (no PR associated with current branch), show error toast: `"no PR for current branch"`.

**Implementation risk.** Octo's internal API for resolving threads and rendering thread popups is not formally stable. Implementation must grep Octo source for the actual function names. If the internal API turns out to be unreliable, fall back to shelling out: `gh api graphql -f query='mutation { resolveReviewThread(input: { threadId: "..." }) { thread { id } } }'`. Slower but bulletproof. The plan should include a small spike to pick the path before committing to one.

### Comment templates — `nvim/.config/nvim/lua/plugins/octo/comment_templates.lua`

**Templates table.**

```lua
{
  nit = "nit: ",
  q   = "Q: ",
  b   = "blocker: ",
  ["+"] = "+1, ",
}
```

**`compose(kind)` function.**

1. Capture current visual range (`getpos("'<")`/`getpos("'>")`) or current line in normal mode.
2. Detect context: if filetype is `octo_diff` (review tab), call Octo's `add_review_comment`; if `octo` (PR buffer), call `add_comment`. Verify function names at impl.
3. Octo opens the compose buffer asynchronously. Use `vim.api.nvim_create_autocmd("BufEnter", { pattern = "octo://*reviewcomment*", once = true })` to inject the prefix when the buffer opens. Inside the autocmd:
   - `nvim_buf_set_lines(buf, 0, 0, false, { prefix })`
   - Set cursor at end of prefix line
   - `vim.cmd("startinsert!")`
4. User completes the sentence and uses the existing submit chord (no change).

**Implementation risk.** The BufEnter+autocmd pattern is the most plausible way to inject text into an async-opened Octo buffer, but it depends on Octo's buffer naming convention. The plan should spike this with a single template (`nit`) before generalising to all four.

## Keymap migration table

What gets removed, kept, and added.

**Removed (override to `false` in Lazy `keys` for the LazyVim octo extra):**

| Old key | Reason |
|---|---|
| `<leader>gi` | moves to `<leader>Oi` |
| `<leader>gI` | moves to `<leader>OI` |
| `<leader>gp` | moves to `<leader>Op` |
| `<leader>gP` | moves to `<leader>OP` |
| `<leader>gr` | dropped (`Octo repo list` is rare; reachable via `:Octo repo list`) |
| `<leader>gS` | moves to `<leader>OS` |

**Kept unchanged:**

- All `<localleader>` defaults from Octo (`vs`, `ca`, `sa`, `cr`, `rt`, `rT`, `pc`, `e`, `b`, `<space>`, etc.).
- All gitsigns `<leader>h*` and `]c`/`[c` (buffer-local resolution against Octo's `]c`/`[c`).
- `<leader>qa` (Octo's global approve-PR shortcut).
- Submit window `<C-a>`/`<C-m>`/`<C-r>`/`<C-c>`.
- Custom picker mapping `<leader>gO` (open in browser).

**Added (top-level):** the 11-row table in the Architecture section.

**Added (buffer-local, `octo` and `octo_diff`):** the four `<localleader>c{n,q,b,+}` template keys.

## Cleanup checklist for implementation

The plan must include explicit steps for:

- LazyVim octo extras override: in `octo.lua`'s plugin spec, add `keys = { { "<leader>gi", false }, { "<leader>gI", false }, … }` for the six keys above. Confirm the override survives the LazyVim extras' own `keys` registration order.
- Which-key group label: `{ "<leader>O", group = "octo" }`. Done via the same `keys` table or a `which-key` config block.
- Smoke-test buffer-local `]c`/`[c`: open a real PR in `:Octo pr` and confirm `]c` moves between comments, not gitsigns hunks. If broken, set buffer-local `nmap` explicitly in an `FileType octo` autocmd.

## Non-goals (explicit)

- No Claude/prbot integration. The prbot REVIEW.md flow stays independent; if a future design wants to bridge it to GitHub review comments, that's a separate spec.
- No changes to gitsigns, lazygit, neogit-if-added.
- No new gh CLI wrappers in `zsh/.zshrc`.
- No automated polling for new comments. Manual refresh of the threads picker is enough.
- No multi-PR dashboard. One PR at a time, surfaced via the existing PR-list picker.

## Open questions for the plan

These are deliberately deferred to the implementation plan, not resolved here:

1. Exact Octo function names for `add_review_comment` / `add_comment` / thread resolution / thread popup rendering. Resolved via reading `~/.local/share/nvim/lazy/octo.nvim` source.
2. Correct flag for "PRs requesting my review" — likely `reviewer=@me` but needs verification against Octo's `pr list` arg parsing.
3. Whether the threads-picker resolve action should use Octo internal API or `gh api graphql` fallback — decided after a spike during implementation.
4. Whether the comment-template autocmd pattern fires reliably for both review and non-review comments — spike with `nit` template before generalising.

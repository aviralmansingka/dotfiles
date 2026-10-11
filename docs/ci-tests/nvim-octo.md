# nvim Octo test suite

## Purpose

This suite tests the Octo plugin layer. The layer holds monkey-patches on
octo.nvim that fail in silence when upstream code changes shape. The
suite checks the state after each patch, not a copy of the patch logic.
It runs no live GitHub call and no plugin manager.

## Overview (merged PRs)

The layer came from ten merged pull requests. #28 built the review flow
and its `<leader>O` keys. #37 fixed a silent keymap drop: one malformed
`group=` entry killed the whole `<leader>O` namespace. #38 made review
diffs open the working-tree file on the right side; #39 made them editable
again. #40 added the create-PR chord; #41 injected `headRepository` into
the create-PR mutation — the stock mutation returned nil there, and the
next `get_pr` call failed at octo-buffer.lua:1045. #43 added the browser
and copy action. #44 and #45 fixed `in_pr_branch`: the stock check asked
for a checkout prompt while the user already sat on the PR head branch.

## What the suite covers

Four specs run under `nvim --headless -u NONE` through the shared harness
(`nvim/tests/ci/harness.lua`), with stubs in place before load (A7).

- `octo_spec`: the real `config()` runs against stub `octo.*` modules. It
  checks the create-PR gsub post-conditions (a missed pattern returns the
  original string), the `in_pr_branch` wrap (same-repo match, cross-repo
  fallback, git failure, missing `head_ref_name`, case-blind compare),
  the `toggle_viewed` wrap, the query swap, the provider and writer
  chains, the right-pane autocmd, and `html_to_markdown` cases.
- `octo_comment_templates_spec`: the `PREFIXES` map and the compose guard
  chain. An unknown kind notifies at ERROR. A missing review notifies at
  WARN and opens no buffer; a failed `require` notifies at ERROR. The
  happy path feeds the prefix one tick later.
- `octo_threads_picker_spec`: the pure functions `one_line_preview`,
  `thread_line`, `thread_author`, `thread_preview`, `build_items`, and
  `thread_browser_url` via the closure graph, plus the render path against
  a stub Snacks picker.
- `octo_pr_review_picker_spec`: the exact `gh search prs` argv for the
  three queries, the seven-day window on a frozen clock, the failure path,
  the URL dedup, the reason labels, `to_item`, and `preview_lines`.

## How to run

Run `scripts/test-nvim-octo.sh` from the repository root. It finds nvim
on `PATH`, else in `~/.local/share/bob`, and globs
`nvim/tests/ci/octo*_spec.lua`. Each case must print `PASS` and exit zero;
nvim exits zero even when a lua chunk fails, so the script also requires
the `PASS` mark. Without nvim, the entry prints `SKIP` and exits zero;
`STRICT=1` turns that into a FAIL. The headless suite
`scripts/test-nvim-headless.sh` globs the same files.

## Runtime and SLA

The entry must stay under 60 s; each spec under 5 s, and the script
fails a spec over budget. Measured: about 70 ms for the entry, 10 to
16 ms per spec.

## Coverage result

Every pure or stub-testable function of the four modules runs in the
suite. One genuine bug came out of the work: a reloaded config wrapped
`toggle_viewed` twice, so one keypress jumped twice. The fix guards the
wrap with a flag on `octo.mappings`, and the suite pins the guard.

## Known gaps

- Live halves stay untested: `unify_review_view` (window layout, async
  gitsigns); threads_picker `resolve_thread`, `fetch_and_show`, `M.open`
  (GraphQL); `smart_entry`, `prompt_author`, and the `gh pr view` half of
  `open_browser_and_copy`.
- The create-PR fixture copies the stock mutation from the pinned octo.nvim
  commit. If upstream reformats the mutation, the suite still passes
  against the copy; it cannot see upstream drift. Re-extract the fixture
  when the lazy-lock pin moves.
- Fixed and pinned (was a quirk): `html_to_markdown` now strips raw tags
  before entity decoding, so decoded `&lt;…&gt;` pairs survive as literal
  text; `one_line_preview` returns an empty string for newline-only
  bodies.

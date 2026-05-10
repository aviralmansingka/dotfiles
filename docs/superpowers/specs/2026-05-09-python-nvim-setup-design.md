---
title: Neovim Python Setup for ~/modal
date: 2026-05-09
status: design
---

# Neovim Python Setup for ~/modal

## Goal

Bring the LazyVim-based Neovim config to feature parity with a modern Python IDE for the `~/modal` repo. Concretely:

- Type-checking + completion via **basedpyright** that resolves both
third-party and first-party (`modal`, `modal_server`, `modal_internal_common`, `modal_volumes`,
`modal_cloud_provider_data`, `modal_sip_operator`, `modal_tools`, `modal_workspace`, …) imports through the editable
installs already present in `~/modal/.venv/lib/python3.11/site-packages/*.pth`.
- Lint + format via **ruff** that mirrors `inv lint --fix` exactly:
`ruff check --fix` followed by `ruff format`, run on save, using the project's pinned `ruff` binary
(`~/modal/.venv/bin/ruff`, currently 0.9.6) so the editor tracks the repo's pyproject ruff config (line-length 120, `I`
isort, banned module-level imports, etc.) without manual sync.
- Pytest debug via **nvim-dap-python** pinned to `~/modal/.venv/bin/python`,
so debug sessions inherit the same editable installs and dependency set as `pytest` runs.
- Pytest discovery via **neotest-python** pinned to the same interpreter,
with `runner = "pytest"`.

## Non-goals

- Bazel test integration. `~/modal` uses `rules_python` via Bazel for some
build/test paths, but the uv venv has every workspace member editable- installed via `.pth` files, so basedpyright
resolves everything without a Bazel bridge. Running `bazel test //path:target` stays at the CLI; neotest uses pytest in
the venv.
- Debug for Bazel-launched test targets, `modal run <file.py>` flows, or
attaching to remote subprocesses. Pytest debug only.
- Per-workspace-member venv switching. `~/modal/.venv` is the single
workspace venv (uv workspace root), so one venv covers all members.
- Automatic `uv sync` from the editor. The user runs `uv sync --all-packages`
from the CLI; the LSP picks up the resulting `.venv` on `:LspRestart`.

## Architecture

Edits and one new file:

- `lua/config/options.lua` (edit) — set `vim.g.lazyvim_python_lsp = "basedpyright"` before
the `LazyVim` plugin loads. This is the documented knob the `lazyvim.plugins.extras.lang.python` extra reads at line 9
of its source.
- `lua/plugins/mason.lua` (edit) — drop `pyright`, append `basedpyright` and
`debugpy`. (`ruff` already present.)
- `lua/plugins/python.lua` (new) — load-bearing Python config:
  - basedpyright LSP `settings` with `python.pythonPath` resolved per buffer
to `<root>/.venv/bin/python`.
  - ruff LSP `cmd` resolved per buffer to `<root>/.venv/bin/ruff` when present,
Mason ruff otherwise.
  - `nvim-dap-python` setup pointed at `<root>/.venv/bin/python` (overrides
the `debugpy-adapter` default the LazyVim extra installs).
  - `neotest-python` opts → `runner = "pytest"`, `python = ".venv/bin/python"`.
- `lua/plugins/conform.lua` (edit) — add `python = { "ruff_fix", "ruff_format" }`
to `formatters_by_ft`, and override the two formatters' `command` to prefer `<root>/.venv/bin/ruff` when present.

The LazyVim Python extra stays enabled in `lazyvim.json`. All changes layer on top of it; nothing replaces it.

## Venv resolution helper

A single helper, defined inline near the top of `python.lua`, finds the project's `.venv` from a buffer. It walks up
from the buffer's directory looking for `.venv/bin/python`. Returns the absolute path or `nil`.

```lua
local function find_venv_python(start_dir)
  local found = vim.fs.find(".venv/bin/python", {
    upward = true,
    type = "file",
    path = start_dir or vim.fn.getcwd(),
    limit = 1,
  })
  return found[1]
end
```

basedpyright settings, ruff `cmd`, dap-python `setup`, neotest-python `python`, and conform formatters all consult this
helper. None of them hardcode `~/modal` — they work for any future Python uv-workspace project.

## LSP wiring

### basedpyright

Added to `opts.servers` in `python.lua`:

```lua
opts.servers.basedpyright = {
  settings = {
    basedpyright = {
      analysis = {
        typeCheckingMode = "standard",
        diagnosticMode = "openFilesOnly",
        useLibraryCodeForTypes = true,
        autoImportCompletions = true,
        autoSearchPaths = true,
      },
    },
    python = {
      pythonPath = nil,  -- set per-buffer in on_new_config
    },
  },
  on_new_config = function(new_config, root_dir)
    local venv_py = find_venv_python(root_dir)
    if venv_py then
      new_config.settings.python.pythonPath = venv_py
    end
  end,
}
```

`typeCheckingMode = "standard"` is basedpyright's middle ground — more strict than pyright's default but not the noisy
`strict` / `all`. Adjustable later if the user wants more or less.

`diagnosticMode = "openFilesOnly"` keeps basedpyright fast on a repo this size (modal has thousands of `.py` files).
Workspace-wide diagnostics are available on demand via `:WorkspaceDiagnostics` patterns if added later.

### ruff LSP

We do **not** override `opts.setup.ruff` — the LazyVim extra already defines it to disable ruff's hover (so basedpyright
owns hover). Overriding `setup` would silently drop that. Instead, we set per-workspace `cmd` via lspconfig's
`on_new_config` hook on `opts.servers.ruff`:

```lua
local function find_venv_ruff(start_dir)
  local found = vim.fs.find(".venv/bin/ruff", {
    upward = true, type = "file", limit = 1,
    path = start_dir or vim.fn.getcwd(),
  })
  return found[1]
end

opts.servers.ruff = {
  on_new_config = function(new_config, root_dir)
    local r = find_venv_ruff(root_dir)
    if r and vim.fn.executable(r) == 1 then
      new_config.cmd = { r, "server" }
    end
  end,
}
```

`on_new_config` runs each time lspconfig spawns a new ruff client (one per unique `root_dir`), so `cmd` is correct per
project. Falls back to Mason's ruff (the extra's default cmd) when no project venv exists. The extra's `setup.ruff`
function still runs and disables hover on attach.

## DAP wiring

The LazyVim Python extra calls `require("dap-python").setup("debugpy-adapter")` once at plugin load, with
`vim.fn.getcwd()` implied. That binds dap-python to Mason's `debugpy-adapter` shim, which uses Mason's debugpy install —
zero workspace `.pth` visibility. Breaks debug for any test that imports `modal_server` or other workspace packages.

Worse, calling `setup(...)` once at startup means the resolved path is whatever cwd was at nvim launch — opening nvim
from `~/` and `:cd ~/modal` later doesn't re-resolve.

Fix: re-call `setup` lazily, idempotently, on the first `BufEnter` of any Python buffer in a project that has a venv:

```lua
{
  "mfussenegger/nvim-dap-python",
  config = function()
    -- Initial setup with Mason fallback so nothing breaks for
    -- Python files outside a uv project.
    require("dap-python").setup("debugpy-adapter")

    local resolved_for = {}  -- root_dir -> true once setup() called for it
    vim.api.nvim_create_autocmd("BufEnter", {
      pattern = "*.py",
      callback = function(args)
        local root = vim.fs.root(args.buf, { ".venv", "pyproject.toml" })
        if not root or resolved_for[root] then return end
        local venv_py = root .. "/.venv/bin/python"
        if vim.fn.executable(venv_py) == 1 then
          require("dap-python").setup(venv_py)
          resolved_for[root] = true
        end
      end,
    })
  end,
}
```

`setup(python_path)` makes dap-python invoke `<python_path> -m debugpy.adapter`, which uses **debugpy from the venv** —
the editable `.pth` files load, so breakpoints in `server/server_test/test_*.py` can step into `modal_server/...`.

The existing `<localleader>b/c/s/d/a/q` keymaps from `dap.lua` work unchanged. The extra's `<leader>dPt` (test method)
and `<leader>dPc` (test class) keymaps work as designed.

Caveat: `dap-python.setup` reassigns the global `dap.adapters.python` and `dap.configurations.python`. Switching
projects within one nvim session re-points the adapter to the most recently entered project's venv. Acceptable for the
single-monorepo use case; document this in failure modes.

## Tests (neotest)

```lua
{
  "nvim-neotest/neotest",
  opts = {
    adapters = {
      ["neotest-python"] = {
        runner = "pytest",
        python = function()
          return find_venv_python(vim.fn.getcwd()) or "python"
        end,
        args = { "--no-header" },
      },
    },
  },
}
```

`python` accepts a function in neotest-python ≥ 1.0; called once per test discovery. Returning the venv's python ensures
pytest plugins (pytest-asyncio, pytest-timeout, pytest-markdown-docs — all present in `~/modal/.venv`) are loaded the
same way `pytest` from the CLI would load them.

`conftest.py` at repo root and per-package conftests are discovered by pytest itself, so the custom `ModalRunner` from
`~/modal/conftest.py` works without extra wiring.

## Format on save (conform)

Mirror `inv lint --fix` (= `ruff check --fix` then `ruff format`):

```lua
opts.formatters_by_ft.python = { "ruff_fix", "ruff_format" }

local function venv_ruff(self, ctx)
  local r = vim.fs.find(".venv/bin/ruff", {
    upward = true, type = "file", limit = 1, path = ctx.dirname,
  })[1]
  return r or "ruff"
end
opts.formatters.ruff_fix = { command = venv_ruff }
opts.formatters.ruff_format = { command = venv_ruff }
```

Conform's stock `ruff_fix` runs `ruff check --fix --exit-zero --no-cache --quiet -`; `ruff_format` runs `ruff format
--no-cache --stdin-filename=... -`. Overriding only `command` keeps the args (which match what `inv lint --fix` does —
`ruff check --fix` honors `[tool.ruff.lint]` for selection including `I` isort).

The current `format_on_save` function returns `nil` for non-markdown, which to conform means **don't format**. Extend it
to opt python in:

```lua
format_on_save = function(bufnr)
  local ft = vim.bo[bufnr].filetype
  if ft == "markdown" then
    return { timeout_ms = 2000, lsp_fallback = false }
  end
  if ft == "python" then
    return { timeout_ms = 2000, lsp_fallback = false }
  end
  return nil
end
```

Two passes (ruff_fix then ruff_format) within a 2s timeout is comfortable — each pass is sub-100ms on typical files.
`lsp_fallback = false` keeps basedpyright's organize-imports out of the picture; ruff's isort is the source of truth.

## Mason changes

```lua
ensure_installed = {
  -- ... existing ...
  "basedpyright",  -- replaces pyright
  "debugpy",       -- DAP fallback when no project venv
  "ruff",          -- already present, kept for fallback
  -- pyright removed
}
```

Rationale for keeping Mason's `ruff` and `debugpy` as fallbacks: opening a Python file outside a uv project (e.g. a
one-off script under `~/scratch`) should still get linting and debug. The find-venv helper returns `nil` and the
formatters / dap-python use the Mason binaries.

## `lua/config/options.lua` change

The LazyVim Python extra reads `vim.g.lazyvim_python_lsp` at module load. The existing file already sets
`vim.g.lazyvim_picker` and `vim.g.root_spec`; add one line alongside them:

```lua
vim.g.lazyvim_python_lsp = "basedpyright"
```

The extra then enables `basedpyright` and disables `pyright` automatically via the loop in the LazyVim extra source.

## Manual setup steps

One-time, per machine:

- `:Mason` then `i` on `basedpyright` and `debugpy` (or restart nvim — Mason
installs from `ensure_installed` on first run).

Per ~/modal clone:

- `cd ~/modal && uv sync --all-packages` to populate `.venv` (already done on
this machine — verified).
- That's it. No `pyrightconfig.json` needed; basedpyright auto-discovers via
`python.pythonPath`.

## Validation (delegated to `neovim-debugger` agent)

Dispatch contract:

> Verify Python setup in `~/modal`. Open `server/server_test/<an existing test
file>`. Expect basedpyright + ruff LSPs attached. Query `workspace/symbol`
> for `App` (modal first-party class). Cap diagnostics at sane limit (< 50 for
> a single test file). Trigger completion after `modal.` in insert mode at a
> reasonable line. Verify dap-python adapter resolves to
> `~/modal/.venv/bin/python -m debugpy.adapter`. Run `:Neotest summary` to
> confirm tests are discovered.

Recipes the agent runs (reference):

```lua
-- LSPs attached
vim.lsp.get_clients({ bufnr = 0 })
-- expect names: basedpyright, ruff

-- Workspace symbol for a known modal class
vim.lsp.buf_request_sync(0, "workspace/symbol", { query = "App" }, 8000)

-- Diagnostics
#vim.diagnostic.get(0)

-- Completion at "modal." (insert mode, after typing the dot)
vim.lsp.buf_request_sync(0, "textDocument/completion",
  vim.lsp.util.make_position_params(0, "utf-16"), 5000)

-- dap-python adapter inspection
require("dap").adapters.python
-- expect command = "/Users/aviral/modal/.venv/bin/python", args = { "-m", "debugpy.adapter" }

-- Neotest discovery
require("neotest").run.run(vim.fn.expand("%"))  -- discover, don't auto-run
```

If the agent reports "Import 'modal_server' could not be resolved" or similar, basedpyright is reading the wrong
`python.pythonPath`. Verify with:

```lua
vim.lsp.get_clients({ name = "basedpyright" })[1].config.settings.python.pythonPath
-- expect "/Users/aviral/modal/.venv/bin/python"
```

Cache wipe if needed: `rm -rf ~/.cache/basedpyright/` and `:LspRestart`. (Less common with basedpyright than pyright;
basedpyright re-indexes more eagerly.)

## Failure modes and recovery

**Stale workspace after `uv sync`.** New deps don't show up until basedpyright re-reads `.venv`. `:LspRestart` is
enough; cache wipe is rarely needed.

**Mason install ordering.** On a brand-new machine, the first nvim launch queues `basedpyright` and `debugpy` for
install but they aren't on disk yet. Subsequent launches work. We do not poll-install in headless verification — the
`neovim-debugger` agent should run against a live session that has already settled.

**venv-selector picking the wrong venv.** The LazyVim extra ships `venv-selector.nvim` which caches the last selected
venv. If the user has multiple Python projects open in one nvim session and venv-selector picks the wrong one, our
`find_venv_python` (root-walk) is independent of venv-selector state and still resolves correctly per buffer. The two
coexist; venv-selector only affects what `:VenvSelect` shows.

**Project ruff version drift.** When `~/modal/.venv/bin/ruff` upgrades from 0.9.x to 1.x with breaking output, our
formatter still works because we resolve the binary path each buffer. If the user wants a ruff version pinned across all
Python projects, they can ignore the venv ruff and use Mason's; for ~/modal specifically, the venv ruff is the source of
truth.

**Two LSPs (ruff + basedpyright) on one buffer.** Intentional. ruff handles diagnostics + format; basedpyright handles
types, completion, hover, definition. The LazyVim extra disables ruff hover so they don't conflict. blink.cmp scores
both sources; basedpyright's deeper symbol model wins on Python identifiers.

**Multi-project debug ambiguity in one nvim session.** `dap-python.setup` reassigns global `dap.adapters.python`. The
lazy `BufEnter` autocmd re-points to whichever project's `.py` was most recently entered. If a user has buffers open
from two different uv projects and starts a debug session immediately after switching, the adapter may still be the
previous project's. Workaround: focus a buffer in the target project before `<leader>dPt`. Acceptable for the
single-monorepo (`~/modal`) use case.

## Out of scope / follow-ups

- Bazel test debug. If the user later needs to step through `bazel test` runs,
options are: bazel + python-debug rule, or a custom DAP launch config that attaches to a `python -Xfrozen_modules=off -m
debugpy --listen 5678` shell. Defer.
- `modal run <file.py>` debug. Modal's CLI execs the file in a remote sandbox;
attaching nvim's debugger is out of scope.
- Adding `python.pythonPath` resolution that respects `pyenv` / `mise` if no
`.venv` is found. Not needed for `~/modal`.
- A `pyrightconfig.json` checked into `~/modal`. Avoidable with our per-buffer
resolution; revisit if cross-editor consistency becomes a requirement.

## Files changed

- `lua/config/options.lua` (edit, +1 line)
- `lua/plugins/mason.lua` (edit, ±2 entries)
- `lua/plugins/conform.lua` (edit, +1 ft + 2 formatters override)
- `lua/plugins/python.lua` (new)

Total expected diff: ~150 lines, all in `lua/plugins/python.lua`.

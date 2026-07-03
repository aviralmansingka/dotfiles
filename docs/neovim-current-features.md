# Neovim Configuration: Current Feature Inventory

_Audit date: 2026-07-03_

This is a retrospective map of the features already configured in the dotfiles Neovim setup. It is based on a static audit of `nvim/.config/nvim`, including `lua/config`, `lua/plugins`, `lua/helpers`, `luasnippets`, `scripts`, `lazyvim.json`, and `lazy-lock.json`.

## 1. Configuration shape

| Layer | Files | Notes |
|---|---|---|
| Entry point | `init.lua` | Bootstraps `require("config.lazy")`. |
| Lazy bootstrap/spec | `lua/config/lazy.lua` | Loads LazyVim, LazyVim extras, and `{ import = "plugins" }`; enables update checking without notifications, sets install fallback colorschemes, and disables selected builtin runtime plugins (`gzip`, `tarPlugin`, `tohtml`, `tutor`, `zipPlugin`). |
| Core options/keymaps | `lua/config/options.lua`, `lua/config/keymaps.lua`, `lua/config/autocmds.lua` | Custom options and one global custom keymap; autocmds file is currently placeholder-only. |
| Custom plugin specs | `lua/plugins/*.lua`, `lua/plugins/**` | Main feature implementation surface. |
| Custom helpers | `lua/helpers/*.lua` | Markdown/vault helper modules. |
| Custom snippets | `luasnippets/*.lua` | LuaSnip snippets, currently Groovy/Gradle. |
| Scripts | `scripts/modal/*.sh` | Modal-specific gopls/DAP support scripts. |
| LazyVim metadata | `lazyvim.json` | Declares additional extras state; not identical to imports in `lazy.lua`. |
| Lockfile | `lazy-lock.json` | Confirms installed plugin surface, including inherited LazyVim plugins. |

## 2. LazyVim extras and inherited plugin surface

### Explicit imports in `lua/config/lazy.lua`

| Area | Enabled extras |
|---|---|
| Coding | `luasnip`, `yanky` |
| Editor/navigation | `mini-files`, `snacks_explorer`, `snacks_picker` |
| Languages | `clangd`, `docker`, `git`, `json`, `markdown`, `python`, `rust`, `toml`, `yaml` |
| Testing | `test.core` |
| Utilities | `dot`, `mini-hipatterns`, `octo`, `startuptime` |

### Extras also present in `lazyvim.json`

`lazyvim.json` additionally records:

- `lazyvim.plugins.extras.dap.core`
- `lazyvim.plugins.extras.dap.nlua`
- `lazyvim.plugins.extras.lang.helm`
- `lazyvim.plugins.extras.lang.go`
- `lazyvim.plugins.extras.lsp.none-ls`

Some of these are also imported from custom specs (`go.lua` imports Go + none-ls). Others appear only through LazyVim metadata/lockfile and should be treated as inherited/active until runtime verification proves otherwise.

### Confirmed installed/inherited plugin surface from `lazy-lock.json`

Not every plugin below has custom configuration, but all are part of the locked Neovim environment:

- LazyVim core/editor: `LazyVim`, `lazy.nvim`, `snacks.nvim`, `which-key.nvim`, `flash.nvim`, `noice.nvim`, `todo-comments.nvim`, `grug-far.nvim`, `mini.ai`, `mini.files`, `mini.hipatterns`, `mini.icons`, `mini.pairs`, `nvim-web-devicons`, `ts-comments.nvim`, `plenary.nvim`, `nui.nvim`, `nvim-nio`.
- UI/themes/status: `gruvbox-material`, `tokyonight.nvim`, `catppuccin`, `lualine.nvim`, `bufferline.nvim` (disabled), `tabby.nvim`, `nvim-colorizer.lua`.
- LSP/completion/formatting/linting: `nvim-lspconfig`, `mason.nvim`, `mason-lspconfig.nvim`, `none-ls.nvim`, `conform.nvim`, `nvim-lint`, `blink.cmp`, `blink.compat`, `blink-emoji.nvim`, `SchemaStore.nvim`, `lazydev.nvim`.
- Treesitter: `nvim-treesitter`, `nvim-treesitter-context`, `nvim-treesitter-textobjects`, `nvim-ts-autotag`.
- Languages: `rustaceanvim`, `crates.nvim`, `clangd_extensions.nvim`, `helm-ls.nvim`, `nvim-jdtls`, `spring-boot.nvim`, `venv-selector.nvim`.
- Debug/test: `nvim-dap`, `nvim-dap-ui`, `mason-nvim-dap`, `nvim-dap-go`, `nvim-dap-python`, `nvim-dap-virtual-text` (disabled in custom DAP spec), `one-small-step-for-vimkind`, `neotest`, `neotest-golang`, `neotest-python`, `neotest-java`.
- Markdown/notes/GitHub: `vim-pencil`, `autolist.nvim`, `render-markdown.nvim`, `markdown-preview.nvim`, `obsidian.nvim`, `octo.nvim`.
- Git/sessions/projects/terminal/agents: `gitsigns.nvim`, `vim-tmux-navigator`, `project.nvim`, `persistence.nvim`, `sidekick.nvim`, `claudecode.nvim`, `opencode.nvim`.

## 3. Feature inventory by domain

### Core editor behavior

Sources: `lua/config/options.lua`, `lua/config/keymaps.lua`

Configured:

- True color and line numbers.
- Swap files fully disabled, including recovery prompt suppression.
- OSC52 clipboard support for SSH sessions: copy over OSC52, paste via local Neovim registers to avoid SSH paste timeouts.
- Custom `vim.paste` handling for terminal buffers: wraps terminal pastes with bracketed-paste markers and coalesces chunked SSH paste phases so nested terminal programs do not interpret pasted newlines as keystrokes.
- Stack-based jumplist behavior via `jumpoptions=stack`.
- LazyVim picker set to Snacks: `vim.g.lazyvim_picker = "snacks"`.
- Root detection intentionally pinned to cwd: `vim.g.root_spec = { "cwd" }`.
- LazyVim Python LSP preference set to `basedpyright`.
- LazyVim import-order check disabled.
- Insert-mode `<C-/>` maps to Escape.

### UI, theme, statusline, tabline, dashboard, GUI

Sources: `colorscheme.lua`, `lualine.lua`, `tabline.lua`, `dashboard.lua`, `neovide.lua`, `colorizer.lua`, `fidget.lua`

Configured:

- Gruvbox Material primary colorscheme with dark background, medium contrast, italics/bold enabled, custom float backgrounds, custom diagnostic line highlight, and custom plugin highlight groups.
- Custom highlights for:
  - Snacks picker surfaces and cursor rows.
  - render-markdown headings/backgrounds/check states.
  - Claude Code border.
  - Blink completion/docs/source/ghost text.
  - DAP signs and stopped/breakpoint/exception line states.
  - Neotest status icons without hard background squares.
- Lualine custom gruvbox theme, mode icons, branch/diff/diagnostic/filename/filetype/progress/location sections, global statusline, disabled on dashboard/alpha, auto-hidden in terminal buffers.
- Tabby replaces LazyVim Bufferline; Bufferline is explicitly disabled. Custom tab + buffer layout, separators, modified indicator, buffer navigation with `<S-h>/<S-l>`, close with `<S-q>`.
- Snacks dashboard actions: find file, new file, restore last session, open Sidecar, LazyGit, Claude Code, quit.
- Neovide-specific behavior: font, left Option as Meta on macOS, bell disabled, Cmd copy/paste/select-all/save/font-size shortcuts, and UIEnter setup.
- Global Noice `<C-b>` override removal so `<C-b>` is not hijacked for Noice popup scrolling.
- Colorizer highlights color literals across files with RGB/RRGGBB/RRGGBBAA/name support and filetype-specific behavior.
- Fidget shows LSP progress and notifications with custom TTLs, icons, transparency, and bottom alignment.

### Completion, snippets, and yank history

Sources: `blink-cmp.lua`, `luasnippets/groovy.lua`, LazyVim `coding.yanky` extra

Configured:

- Blink.cmp completion engine lazy-loaded on insert/cmdline.
- Completion disabled in terminal buffers and buffers with `vim.b.completion = false`.
- Sources: LSP, path, snippets, buffer, emoji, Obsidian note links, Obsidian new note, Obsidian tags.
- Emoji completion only for `gitcommit`, `markdown`, and `text` filetypes.
- Obsidian completion exposed through `blink.compat`.
- Key behavior: Tab accepts selected item, Shift-Tab hides, Ctrl-Space shows, Ctrl-H/L snippet backward/forward, Ctrl-B disabled.
- Completion menu and docs use rounded borders; docs auto-show after 200ms.
- Signature help enabled with rounded border.
- LuaSnip configured with history, jsregexp build, friendly snippets, VSCode snippets, and custom Lua snippets.
- Custom Groovy/Gradle snippets for common dependency declarations, `dependencies {}`, `repositories { mavenCentral() }`, and plugin declarations.
- LazyVim's `coding.yanky` extra is enabled, so yank ring/history behavior is part of the configured inherited editing surface even though there is no custom `yanky.nvim` override.

### LSP, Mason, language servers, diagnostics support

Sources: `lsp.lua`, `mason.lua`, `build-files.lua`, `clangd.lua`, `fidget.lua`, plus language-specific files

Configured:

- General LSP signature-help border set to rounded.
- Lua LS configured for LuaJIT, `vim` global, runtime library, code lens, call snippets, hints, private doc naming, telemetry disabled.
- Mason ensure-installs:
  - Lua/Rust/Python: `lua-language-server`, `rust-analyzer`, `stylua`, `ruff`, `basedpyright`, `debugpy`.
  - Java/JVM: `jdtls`, `java-debug-adapter`, `vscode-spring-boot-tools`, `google-java-format`, `groovy-language-server`, `gradle-language-server`.
  - Bazel/Starlark: `starpls`, `buildifier`.
  - Go: `gopls`, `goimports`, `gofumpt`, `golangci-lint`, `gomodifytags`, `impl`, `delve`.
- Gradle LS configured with Gradle wrapper support.
- Groovy LS configured from Mason jar, using OpenJDK 25, for plain Groovy/Jenkinsfile contexts and deliberately skipped inside Gradle projects.
- Starlark `starpls` configured for `bzl` files and Bazel roots.
- Clangd configured with background index, clang-tidy, IWYU header insertion, detailed completion, placeholders, LLVM fallback style.
- Trouble configured for diagnostics, buffer diagnostics, symbols, LSP references, loclist, and quickfix, with custom symbol filters/icons.

### Formatting

Source: `conform.lua`

Configured:

- Format-on-save for markdown, python, java, lua, and go; no LSP fallback.
- Default format timeout 2s and LSP formatting disabled.
- Formatter chains:
  - Markdown: Prettier (`--prose-wrap preserve`, print width 120) then custom `markdown_wrap` visual-width rewrapper.
  - Lua: Stylua.
  - Java: Google Java Format.
  - Go: goimports then gofumpt.
  - Bazel/Starlark: buildifier.
  - Python: ruff check/fix then ruff format, preferring project `.venv/bin/ruff`.

### Treesitter and code context

Sources: `treesitter.lua`, `treesitter-context.lua`, `dap.lua`, `helpers/markdown_links.lua`

Configured:

- Ensured parsers: bash, JSON, Lua, Markdown, Markdown inline, Python, query, regex, TS/TSX, TypeScript, Vim, YAML, TOML.
- Treesitter context enabled on `BufReadPost`, capped at 3 context lines.
- Treesitter is also used for:
  - DAP expression-under-cursor detection.
  - Markdown inline-link URL selection/editing.

### Navigation, files, projects, sessions, buffers

Sources: `extend-mini-files.lua`, `snacks-picker.lua`, `project.lua`, `persistence.lua`, `vim-tmux-navigator.lua`, `tabline.lua`

Configured:

- Mini.files opens at the current file's directory with `<leader>e`; preview window width set to 60.
- Snacks picker:
  - File and grep sources include hidden files and follow symlinks.
  - Files exclude `.git`, `node_modules`, `.DS_Store`.
  - Filename-first formatting.
  - Telescope-like layout with rounded border, cycling, reverse ordering.
  - `<C-b>` disabled in picker input/list.
- Project picker `<leader>fp` opens recent `project.nvim` roots and then Snacks file picker at the chosen root.
- Project.nvim syncs cwd/root, respects buffer cwd, updates focused file, detects by patterns `init.lua`, `build.gradle`, `.git`.
- Persistence stores sessions under `stdpath("state")/sessions/` with buffers/curdir/tabs/window/folds/globals. Keymaps: `<leader>qs`, `<leader>ql`, `<leader>qd`.
- tmux/nvim directional navigation with `<C-h/j/k/l>` and previous with `<C-\\>`.
- Tab/buffer navigation handled by Tabby and Snacks buffer delete.

### Terminal, shell tools, Sidecar

Sources: `toggleterm.lua`, `sidecar.lua`, `dashboard.lua`, `opencode.lua`

Configured:

- Snacks terminal uses a singleton 90% float, rounded/Neovide border, no backdrop, `q` hides, `<C-]>` returns terminal normal mode.
- Global terminal-mode `<C-]>` stops insert mode.
- K9s toggle: `gk`.
- LazyGit launcher: `gG`, resolving git root from current file when possible.
- Sidecar terminal toggle: `gS`, dashboard `S`, using `/opt/homebrew/bin/sidecar` when available else `sidecar`.
- OpenCode terminal provider uses Snacks float, command `~/.opencode/bin/opencode`, autoread enabled.

### Debugging / DAP

Sources: `dap.lua`, `modal/dap.lua`, `colorscheme.lua`, `python.lua`, `jdtls.lua`, `lazyvim.json`

Configured:

- nvim-dap with dap-ui, mason-nvim-dap, nvim-dap-python; nvim-dap-virtual-text dependency is declared but disabled.
- DAP UI icons customized; UI does not auto-open on session start and is toggled with `<leader>dt`.
- DAP keymaps include continue, step into/over/out/back, close, breakpoint toggle, eval expression in REPL split, show logs, and stringified yank.
- Treesitter expression detection identifies the smallest useful expression/call under cursor for evaluation.
- Idle auto-eval hover after 2s of stillness while paused in Python/Go/Java buffers.
- Hover/REPL local `<localleader>y` yanks stringified value, with per-DAP-type stringify wrappers.
- `<leader>dl` tails DAP stdout/stderr log files into terminal buffers.
- Custom DAP signs/highlights for breakpoints, conditional breakpoints, logpoints, stopped lines, rejected breakpoints, and exceptions.
- Modal-specific DAP launch config for `~/modal/go/machine-manager` with `-tags=ui` and ports `9910/9911/9912`.
- Python DAP is repointed to project `.venv/bin/python` on Python buffer entry.
- JDTLS loads Java debug adapter bundle but intentionally excludes Java test bundles.
- `lazyvim.json` records LazyVim DAP core and nlua extras.

### Testing

Sources: `go.lua`, `python.lua`, `java.lua`, `jdtls.lua`, `lazyvim.json`

Configured:

- LazyVim `test.core` and neotest are active.
- Go:
  - neotest-golang root patched to nearest `go.mod`.
  - Default test args drop `-race`; `<leader>tR` runs nearest with `-race`.
  - Single-file/single-test discovery patches `go list ./...` to `go list .` for faster loops.
  - `<leader>tT` runs all tests in nearest Go module.
  - `<leader>ts` scopes neotest summary to current module/root for Go/Python/Java.
- Python:
  - neotest-python uses pytest, project `.venv`, and args `--no-header --no-cov`.
  - Build spec patched to run from uv workspace root and fix DAP strategy cwd.
  - `<leader>tT` runs all tests under nearest `pyproject.toml`.
- Java:
  - neotest-java adapter registered.
  - Upstream neotest-java Path bug patched locally for Gradle path handling.
  - JDTLS/LazyVim Java test keymaps are removed so neotest is the sole Java test path.
  - `<leader>tg` and `<leader>tT` mapped to neotest for Java buffers.

### Go development

Source: `go.lua`, `scripts/modal/gopackagesdriver.sh`, `scripts/modal/probe-gopls.sh`

Configured:

- LazyVim Go extra and none-ls imported.
- Gopls root prefers nearest `go.mod`, then `go.work`, then `.git`, avoiding monorepo parent roots when the module is lower.
- Buffer-local Go keymaps: nearest test (`<leader>tg`), `go build ./...` (`<leader>gc`), LSP restart (`<leader>gr`).
- Live golangci-lint diagnostics disabled due false-positive typecheck cascades in multi-module `go.work` workspaces; CLI still installed.
- Bazel/rules_go support:
  - Detects `MODULE.bazel`, `WORKSPACE`, `WORKSPACE.bazel`.
  - Optional `GOPACKAGESDRIVER=auto` driver discovery.
  - Modal-named Bazel workspace uses dotfiles driver: `scripts/modal/gopackagesdriver.sh`.
  - Gopls `directoryFilters` excludes Bazel outputs.
  - Modal workspaces add `-bazel-modal` and Bazel workspace file globs.
  - Warns if `GOPACKAGESDRIVER=auto` is requested but no driver is found.
  - Post-merge `vim.lsp.config` hook preserves gopls `before_init` across Lazy reload/LspRestart.
- `probe-gopls.sh` verifies a live Neovim socket has Modal gopls wiring, including driver env and filters.

### Python development

Source: `python.lua`, `scripts/modal/dap-python-dev-cluster.sh`

Configured:

- Basedpyright and Ruff LSP integration on top of LazyVim Python extra; lockfile also includes LazyVim's inherited `venv-selector.nvim` Python stack.
- Project `.venv` discovery via upward search for `.venv/bin/python` and `.venv/bin/ruff`.
- Basedpyright diagnostics handlers suppressed and diagnostic provider cleared on init; Ruff/formatting are expected to own actionable feedback.
- Basedpyright settings: standard type checking, open-files-only diagnostics, library code types, auto imports/search paths.
- Ruff server command prefers project venv executable.
- Buffer-local Python keymaps: LSP restart (`<leader>pr`) and project-scoped test run-all (`<leader>tT`).
- DAP Python setup rerun with project venv interpreter on first Python `BufEnter` per root.
- Modal dev-cluster DAP wrapper exists for EC2-style Modal paths/env inheritance.

### Java/JVM/build-file development

Sources: `java.lua`, `jdtls.lua`, `spring-boot.lua`, `build-files.lua`, `luasnippets/groovy.lua`

Configured:

- LazyVim Java extra imported.
- JDTLS root markers: Bazel, Gradle, Maven, `.git`.
- OpenJDK 25 pinned for JDTLS (`JAVA_HOME`, `PATH`, JavaSE-25 runtime).
- Java imports: BSP auto, Gradle enabled, Maven enabled.
- Bazel Java warning if a Bazel root has no `.bsp/`; message points to bazel-bsp install command.
- Java completion: postfix and guessed method arguments.
- Java inlay hints and reference/implementation code lens configured with both casing variants for compatibility.
- Java debug adapter bundle loaded; Java test bundles intentionally excluded.
- JDTLS buffer-local keymaps: neotest nearest/all, compile (`<leader>jc`), restart (`<leader>jr`).
- Spring Boot plugin active for `java`, `yaml`, `jproperties` with JDTLS/LSP dependencies.
- Gradle LS with wrapper support.
- Groovy LS for plain Groovy/Jenkinsfile contexts outside Gradle roots.
- Starlark/Bazel `starpls` and buildifier support.
- Gradle-oriented Groovy snippets.

### Markdown, notes, vault, Obsidian

Sources: `markdown.lua`, `obsidian.lua`, `helpers/obsidian.lua`, `helpers/markdown_links.lua`, `helpers/markdown_wrap.lua`

Configured:

- vim-pencil soft wrap for markdown, textwidth 120, autoformat.
- Markdown and Octo buffers use custom formatexpr from `helpers.markdown_wrap`.
- `helpers.markdown_wrap` rewraps prose paragraphs by visual width, collapsing `[text](url)` to text for width calculation and preserving code/frontmatter/lists/tables/headings.
- `helpers.markdown_links`:
  - Conceal level/cursor configured for markdown and Octo.
  - URL text objects: `iu`, `au`.
  - Edit URL under cursor: `<leader>mu`.
  - Visual paste transforms selected text + URL register into `[selection](url)`.
- Autolist behavior after markdown load: list continuation, tab/shift-tab indentation, Enter new bullet, checkbox toggle, recalculate, cycle list type, recalculation after indent/delete. These mappings are registered globally by the current config after the plugin loads, not buffer-locally.
- render-markdown configured for markdown and Octo:
  - Conceal cursor stays active.
  - Anti-conceal tuned.
  - Custom checkbox icons/states, code block rendering, heading icons/backgrounds, link/wiki-link icons, quotes.
- Vault-specific Snacks pickers:
  - Active vault todos excluding legacy locations and Habit Tracking sections: `<leader>ft`.
  - Active todos by tag: `<leader>fT`.
  - Tags across frontmatter and inline tags: `<leader>ot`.
  - Backlinks to current note: `<leader>ob`.
  - Outgoing wiki links: `<leader>ol`.
- Obsidian.nvim:
  - Workspace `~/vault`.
  - Daily-notes config still points at `journal`, but custom backlog helpers supersede daily logging.
  - Templates from `templates`.
  - Completion enabled through blink compat.
  - Wiki links preferred.
  - Note IDs slugify titles.
  - `gf` passthrough and Enter smart action.
  - Obsidian UI disabled in favor of render-markdown.
  - Keymaps for quick switch/search/inbox/new/template/rename/open.
- Weekly backlog workflow:
  - `helpers.obsidian` creates/opens `~/vault/3_logs/YYYY-WW/backlog.md`.
  - For new backlog files, writes frontmatter, `# YYYY-WW: Backlog`, `## Log`, and date heading; for existing files, ensures `## Log` and the requested day heading.
  - Preserves/creates day headings for today/yesterday/tomorrow.
  - Commands: `VaultBacklogToday/Yesterday/Tomorrow`, `ObsidianToday/Yesterday/Tomorrow`.
  - Keymaps: `<leader>od`, `<leader>oy`, `<leader>om`.

### Git, GitHub, PR review

Sources: `gitsigns.lua`, `octo.lua`, `octo/*.lua`, `lazy.lua`

Configured:

- Gitsigns custom gutter signs.
- Hunk navigation with `]c` / `[c`, respecting diff mode.
- Hunk actions: stage/reset hunk or visual range, stage buffer, undo stage, reset buffer, preview hunk, inline preview, blame line, diff against index, diff against last commit.
- Toggles: current line blame and deleted lines.
- Octo under `<leader>O` namespace; LazyVim `<leader>g*` Octo defaults disabled.
- Octo keymaps: smart entry, PR list/search/my PRs/review picker/author picker/thread picker/checkout/create/open browser+copy URL.
- Octo options:
  - `default_to_projects_v2 = false` to avoid token scope failures.
  - `use_local_fs = true` for right-pane local file buffers in reviews.
  - Toggle viewed maps to toggle + next unviewed.
- Octo review patches:
  - Right-pane local review buffers made modifiable.
  - Same-branch PR detection made less brittle.
  - Create PR mutation patched to include `headRepository`.
  - PR list GraphQL query includes author.
  - Snacks PR picker includes author in fuzzy text and display.
  - HTML body/comment content converted toward markdown before rendering.
  - Review view can be unified to drop left pane and use gitsigns gutter.
- Custom pickers:
  - `octo/pr_review_picker.lua` searches PRs to review + assigned, including recently merged/closed assigned PRs.
  - `octo/threads_picker.lua` lists review threads, supports browser open, resolve thread, toggle resolved visibility.
- Comment templates: nit/question/blocker/praise prefixes under `<localleader>c*` in review context.

### AI agents and assistant workflows

Sources: `sidekick.lua`, `sidekick/*.lua`, `claude-code.lua`, `opencode.lua`, `dashboard.lua`

Configured:

- Sidekick.nvim configured with tmux mux backend.
- Agent tools: Pi, Codex, Cursor Agent, OpenCode, Claude.
- Primary agent order: Pi, Codex. Full order: Pi, Codex, Cursor, OpenCode, Claude.
- Tool commands include bypass/force flags where configured:
  - Codex: `codex --dangerously-bypass-approvals-and-sandbox`.
  - Cursor: `cursor-agent --force`.
  - Claude: `claude --dangerously-skip-permissions`.
- Branded terminal floats/splits with per-tool colors, borders, titles, branch/cwd metadata, and right-aligned cwd display in the Sidekick CLI picker.
- Cursor Agent uses right split; other tools default to float.
- Tmux integration:
  - Match existing tmux panes to tools.
  - Rehydrate registry from tmux panes.
  - Named sessions stored/identified through session labels and tmux env.
  - Branch metadata stored in tmux env.
- Session UX:
  - Last session quick toggle: `<C-.>`.
  - Select/detach/send/prompt/toggle float-split/list local/list global/search/new named sessions under `<leader>a*`.
  - Cwd session picker and global named-session picker include previews and kill-session support.
  - Search across captured named session pane contents with ripgrep.
- Inline ask/edit workflow:
  - Codex Spark model via `codex --model gpt-5.3-codex-spark --sandbox read-only -a never exec --output-last-message ...`.
  - Ask about current line/selection.
  - Builds context with Tree-sitter scope detection and LSP-hover symbol enrichment before sending prompts.
  - Request unified diff edit for line/selection.
  - Signs/extmarks show pending/done ask/edit state and ranges.
  - Floating UI for prompts/answers/diff previews.
  - Apply/reject/yank/clear answer or diff from current line.
- Claude Code plugin auto-starts, uses no terminal provider, keeps diff terminal focus, opens diffs in new tabs, command `~/.local/bin/claude --dangerously-skip-permissions`.
- OpenCode plugin configured with Snacks float and `~/.opencode/bin/opencode`.

### Modal-specific workflows

Sources: `modal/init.lua`, `modal/build.lua`, `modal/dap.lua`, `go.lua`, `scripts/modal/*.sh`

Configured:

- Modal build dispatcher on `<leader>mb`.
- Current registered build: `go/machine-manager` runs `go generate -tags=ui ./machine-manager/` from `~/modal/go` to populate `ui/dist`.
- Modal Go DAP launch config for `machine-manager` with cwd `~/modal`, build flags `-tags=ui`, and args `9910 9911 9912`.
- Modal gopls GOPACKAGESDRIVER launcher uses bazelisk/bazel and refuses non-`modal` Bazel roots.
- Modal gopls probe script validates live Neovim socket wiring.
- Modal Python dev-cluster DAP wrapper exists for remote/dev-cluster debugging.

### Neovim verification harness

Sources: `scripts/verify-nvim`, `scripts/verify-nvim.lua`, vault notes under `1_wip/epics/neovim/`

Configured:

- `scripts/verify-nvim` resolves Neovim from PATH, Bob nightly, or Bob stable, then runs headless checks from the dotfiles repo root.
- Harness cases:
  - `agent-keymaps`: verifies removed legacy agent keymaps stay removed, required Pi/Codex/local/global mappings exist, and Sidekick has no duplicate agent keymaps.
  - `sidekick-pi`: verifies Pi/Codex primary ordering, Pi tool registration, named Pi command construction, registry parsing, branding lookup, and `<c-.>` local fallback.
  - `sidekick-pi-tmux`: creates a temporary real tmux Pi session and verifies discovery, rehydration, local picker visibility, `SIDEKICK_BRANCH` metadata readback, and search snapshot capture.
- The vault tracks next steps for manifest/artifact output, UI/screenshot checks, and a read-only verifier agent workflow.

## 4. Vault feature cross-check

Cross-checked against vault Neovim notes in `1_wip/epics/neovim/`, `projects/journal.md`, `projects/neovim-feedback.md`, `CONTEXT.md`, and `3_logs/2026-W27/neovim-harness-subagent-verification-plan.md`.

| Vault feature / desire | Status in this inventory |
|---|---|
| `neovim-agent-interface`: Sidekick as canonical interface; Pi + Codex primary; Claude/Cursor/OpenCode optional/legacy | Covered under AI agents and keymap namespace map. |
| `agent-session-management`: tmux-backed named sessions, cwd/global pickers, search, branch metadata | Covered under AI agents; open worktree isolation remains follow-up. |
| `neovim-verification`: deterministic `verify-nvim` checks and read-only verifier workflow | Added as configured harness section; verifier/UI artifacts remain planned. |
| `vault-issue-workflow`: query/create/link vault issues from Neovim/Pi | Not currently configured in Neovim; tracked as planned work under follow-ups. |
| Better journal/list UX | Partially covered by markdown/vault/Obsidian features: Autolist, vim-pencil, render-markdown, backlog helpers, todo/tag/backlink/outgoing-link pickers. Image rendering and monthly habit aggregation remain not configured. |
| Open LazyVim from dashboard | Not configured; dashboard currently has files/new/session/Sidecar/LazyGit/Claude/quit. |
| Neovim work replay / repository reconstruction language | Not currently configured; tracked as conceptual/future work, not an active Neovim feature. |

## 5. Custom keymap namespace map

This is not exhaustive for inherited LazyVim mappings, but covers custom mappings found in this audit.

| Namespace | Purpose |
|---|---|
| `<leader>a*` | Sidekick/agent workflows: ask/edit, sessions, send context, toggle agents, named sessions, search. |
| `<leader>O*` | Octo/GitHub PR workflows. |
| `<leader>o*` | Obsidian/vault workflows. |
| `<leader>fT`, `<leader>ft` | Vault todo pickers. |
| `<leader>h*` | Gitsigns hunk actions. |
| `<leader>g{c,r}` | Go build and Go LSP restart (buffer-local in Go). |
| `<leader>pr` | Python LSP restart (buffer-local in Python). |
| `<leader>j{c,r}` | Java compile/restart jdtls (buffer-local in Java). |
| `<leader>mb` | Modal build dispatcher. |
| `<leader>e`, `<leader>fp` | Mini.files at current file and project picker. |
| `<leader>t*` | Test/toggle namespace: language-scoped neotest mappings, gitsigns toggles, LazyVim toggles. |
| `<leader>x*` | Trouble diagnostics/location-list/quickfix namespace. |
| `<leader>c*` | Trouble symbols/LSP references and markdown Autolist cycle mappings. |
| `<leader>d*` | DAP UI/log actions (`<leader>dt`, `<leader>dl`). |
| `<localleader>*` | DAP stepping/eval, Octo review helpers, gitsigns inline preview. |
| `g*` custom | `gk` K9s, `gG` LazyGit, `gS` Sidecar. |
| `<C-h/j/k/l>` | tmux/nvim directional navigation. |
| `<S-h/l/q>` | buffer previous/next/close via Tabby/Snacks. |
| Markdown text objects | `iu`/`au` select URL; visual `p/P` is URL-aware. |
| Sidekick inline edit | Global `<Tab>`/`<S-Tab>` accept/reject Sidekick edit when cursor is on a completed edit entry, otherwise fall back. |

## 6. External dependency contract observed

The config assumes or integrates with these executables/paths:

- System/CLI: `git`, `tmux`, `rg`, `gh`, `k9s`, `lazygit`, `sidecar`, `nvim --server`, `lsof`/`find`/`stat` on macOS for probes.
- Agent CLIs: `pi`, `codex`, `cursor-agent`, `opencode`, `claude` (`~/.local/bin/claude` preferred), `~/.opencode/bin/opencode`.
- Java: `/opt/homebrew/opt/openjdk@25`, Mason `jdtls`, Java debug adapter, Spring Boot tools.
- Go: `go`, `delve`, `gopls`, `goimports`, `gofumpt`, optional `bazelisk`/`bazel`, optional `GOPACKAGESDRIVER=auto`.
- Python: project `.venv/bin/python`, `.venv/bin/ruff`, `uv.lock` for workspace root inference, `debugpy`.
- Formatting/build: `prettier`, `stylua`, `google-java-format`, `buildifier`, `ruff`.
- Vault path: `~/vault`; Modal path: `~/modal`.

## 7. Potential cleanup / follow-up items

1. **Duplicate LazyVim import:** `lazyvim.plugins.extras.editor.snacks_picker` appears twice in `lua/config/lazy.lua`.
2. **LazyVim metadata drift:** `lazyvim.json` records extras not explicitly imported in `lua/config/lazy.lua` (`dap.core`, `dap.nlua`, `helm`). Decide whether `lazyvim.json` is active source-of-truth or historical residue, then align.
3. **DAP key conflict:** `dap.lua` defines `<localleader>b` twice: breakpoint toggle and step back. Confirm runtime behavior and move one mapping.
4. **Project.nvim comment drift:** `project.lua` comment says `BUILD.bazel before .git`, but `patterns` currently are `{ "init.lua", "build.gradle", ".git" }` and do not include `BUILD.bazel`.
5. **README now points to this inventory;** next pass can split stable docs into focused pages:
   - `core-editor.md`
   - `languages.md`
   - `debug-test.md`
   - `markdown-vault.md`
   - `git-pr-review.md`
   - `ai-agents.md`
   - `modal.md`
6. **Generate a machine-readable keymap index** from custom specs and compare with runtime `:map`/which-key output.
7. **Autolist mapping scope:** mappings in `markdown.lua` are global after Autolist loads; decide whether to make them buffer-local for markdown only.
8. **Duplicate DAP sign/highlight definitions:** DAP signs/highlights are defined in both `colorscheme.lua` and `dap.lua`; consolidate or document why both are needed.
9. **Duplicate Treesitter parser additions:** `treesitter.lua` both sets `ensure_installed` and then extends it with TS/TSX again; simplify to one strategy.
10. **Unwired Sidekick modules:** `sidekick/starship.lua` and `sidekick/resume.lua` exist but are not referenced by the current Sidekick spec; wire them or archive them.
11. **Vault issue workflow:** implement the planned `:Issues`/picker/create/link workflow tracked in `1_wip/epics/neovim/issues/vault-issues-in-neovim.md`.
12. **Journal wishlist gaps:** image rendering, monthly habit aggregation, and opening LazyVim from the dashboard are desired in the vault but not configured.
13. **Runtime validation pass:** static audit cannot prove which LazyVim metadata extras are actually loaded; run `:Lazy`, `:LazyExtras`, or a headless `nvim --headless` probe if needed.

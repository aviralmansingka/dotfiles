# Neovim Current Feature Inventory

_Audit date: 2026-07-03_

This is a grouped inventory of user-visible features available in the current Neovim setup. It groups features by
workflow area rather than plugin files, Lua modules, or implementation structure.

## Removed and pending-removal features

- Blink ghost text is disabled as a completion feature, even though a muted Gruvbox ghost-text highlight is still defined.
- DAP virtual text is declared but disabled.
- The old `<leader>qs` session-save mapping is gone; it now restores the current session.
- The old `<leader>qd` session-delete mapping is gone; it now stops saving the current session.
- Legacy Sidekick keymaps are removed: `<c-;>`, `<leader>ao`, `<leader>au`, `<leader>ar`, and `<localleader>e`.
- The Claude Code `<leader>acs` mapping is removed.
- OpenCode direct keymaps `gO` and `<c-'>` are removed; OpenCode remains available through Sidekick and plugin commands.
- The Sidekick resume module exists, but the former `<leader>ar` resume binding is intentionally not part of the current keymap surface.
- Modal-specific editor features are currently configured but should be removed from the editor surface:
  - Modal build dispatcher on `<leader>mb`.
  - Modal machine-manager build integration.
  - Modal machine-manager Go DAP launch configuration.
  - Modal machine-manager DAP operational preconditions.
  - Modal gopls GOPACKAGESDRIVER launcher.
  - Modal gopls live-socket probe.
  - Modal-specific gopls workspace settings and Bazel workspace globs.
  - Modal Bazel workspace gopackagesdriver resolution.
  - Modal Python dev-cluster DAP wrapper.
  - Modal workflow path dependency on `~/modal`.

## Coding features

### Per-language extension model

- Highlighting: partially per-language.
- Formatting: per-language or per-filetype.
- Diagnostics: per-language sources with shared UI.
- LSP: per-language.
- Testing: per-language adapters.
- DAP: per-language adapters and launch configs.

### Completion and snippets

- Blink ghost text highlighting uses muted Gruvbox gray, but Blink ghost text itself is disabled.
- Blink completion menu and docs use Gruvbox background and foreground colors.
- Blink completion and docs borders use brighter foreground contrast.
- Blink completion source labels use muted Gruvbox gray.
- Blink.cmp provides completion in insert and command-line contexts.
- Completion is disabled in terminal buffers.
- Completion can be disabled per buffer with `vim.b.completion = false`.
- Completion sources include LSP, path, snippets, buffer text, emoji, Obsidian note links, Obsidian new notes, and Obsidian tags.
- Emoji completion is available in git commit, Markdown, and text buffers.
- Obsidian completion is available through Blink compatibility integration.
- `<Tab>` accepts the selected completion item.
- `<S-Tab>` hides completion.
- `<C-Space>` opens completion.
- `<C-h>` and `<C-l>` move through snippet placeholders.
- `<C-b>` is disabled inside completion UI.
- Completion menus use rounded borders.
- Completion documentation uses rounded borders.
- Completion documentation auto-shows after 200ms.
- Blink completion can auto-insert matching brackets for accepted items.
- Blink completion rendering uses Treesitter highlighting for LSP items.
- LuaSnip is enabled with snippet history and autosnippets.
- Friendly snippets and VSCode-style snippets are loaded.
- Custom Groovy and Gradle snippets are available.
- Groovy snippets cover dependency declarations.
- Gradle snippets cover `dependencies`, `repositories { mavenCentral() }`, and plugin declarations.
- Yank history/ring behavior is available through LazyVim yank integration.

### Highlighting

- Treesitter parsers are ensured for bash, JSON, Lua, Markdown, Markdown inline, Python, query, regex, TypeScript, TSX, Vim, YAML, and TOML.
- Treesitter context shows code context after buffer read.
- Treesitter context is capped at 3 lines.
- Treesitter helps detect debug expressions under the cursor.
- Treesitter helps select and edit Markdown inline-link URLs.
- Treesitter textobjects and TS autotag are inherited from LazyVim.
- Color literals are highlighted across buffers.
- Color highlighting supports RGB, RRGGBB, RRGGBBAA, and named colors.
- DAP breakpoint signs use Gruvbox yellow.
- DAP conditional breakpoints use brighter yellow.
- DAP stopped-line signs use Gruvbox blue.
- DAP logpoints use Gruvbox teal.
- DAP rejected breakpoints use Gruvbox gray.
- DAP exceptions use Gruvbox red.
- DAP breakpoint, stopped-line, and exception line highlights use subtle dark tinted backgrounds.
- Neotest inline status icons use transparent backgrounds so they do not render hard squares.

### Formatting

- Format-on-save is enabled for Markdown, Python, Java, Lua, and Go.
- LSP formatting fallback is disabled.
- Default formatting timeout is 2 seconds.
- Markdown formatting uses Prettier while preserving prose wrapping, then a custom visual-width rewrapper.
- Lua formatting uses Stylua.
- Java formatting uses Google Java Format.
- Go formatting uses goimports followed by gofumpt.
- Bazel and Starlark formatting uses buildifier.
- Python formatting uses Ruff fix and Ruff format.
- Python formatting prefers project-local `.venv/bin/ruff` when available.

### Diagnostics

- Trouble provides workspace diagnostics.
- Trouble provides buffer diagnostics.
- Trouble provides symbols.
- Trouble provides LSP references.
- Trouble provides location-list and quickfix views.
- Trouble uses custom symbol filters and icons.
- Fidget shows LSP progress.
- Fidget shows notifications with custom TTLs, icons, transparency, and bottom alignment.
- Basedpyright diagnostics are suppressed so Ruff/formatting owns actionable feedback.
- Basedpyright diagnostics are limited to open files.
- Live golangci-lint diagnostics are disabled to avoid false-positive cascades in multi-module workspaces.
- Golangci-lint CLI remains installed.

### LSP

- General LSP signature-help borders are rounded.
- Mason installs Lua, Rust, Python, Java/JVM, Bazel/Starlark, and Go development tools.
- Lua tooling includes `lua-language-server` and `stylua`.
- Rust tooling includes `rust-analyzer`.
- Python tooling includes `ruff`, `basedpyright`, and `debugpy`.
- Java/JVM tooling includes `jdtls`, Java debug adapter, Spring Boot tools, Google Java Format, Groovy language server, and Gradle language server.
- Bazel/Starlark tooling includes `starpls` and `buildifier`.
- Go tooling includes `gopls`, `goimports`, `gofumpt`, `golangci-lint`, `gomodifytags`, `impl`, and `delve`.
- Lua language support is configured for LuaJIT and the Neovim runtime.
- Lua language support recognizes the `vim` global.
- Lua language support includes code lens, hints, call snippets, private doc naming, and disabled telemetry.
- Gradle language support uses Gradle wrapper support.
- Groovy language support is available for plain Groovy and Jenkinsfile contexts.
- Groovy language support is skipped inside Gradle projects to avoid conflicting project ownership.
- Starlark language support is available for Bazel files.
- Clangd support includes background indexing.
- Clangd support includes clang-tidy.
- Clangd support includes IWYU header insertion.
- Clangd support includes detailed completion.
- Clangd support includes placeholders and LLVM fallback style.
- Go language support is enabled.
- Go root detection prefers nearest `go.mod`, then `go.work`, then `.git`.
- Go root detection avoids accidentally selecting a monorepo parent when a lower module exists.
- Go buffers have an LSP restart keymap.
- Go Bazel/rules_go support detects Bazel workspace markers.
- Go Bazel/rules_go support can use `GOPACKAGESDRIVER=auto` discovery.
- Go `GOPACKAGESDRIVER` defaults to off, supports explicit driver paths, and mirrors explicit paths into `settings.gopls.env`.
- Neotest Go subprocesses intentionally do not inherit the `GOPACKAGESDRIVER=auto` discovery behavior.
- Gopls excludes Bazel output directories.
- Go setup warns when `GOPACKAGESDRIVER=auto` is requested but no driver is found.
- Gopls configuration preserves `before_init` behavior across reloads and LSP restarts.
- Python language support is enabled.
- Basedpyright is the preferred Python LSP.
- Ruff LSP integration is enabled.
- Project `.venv/bin/python` discovery is available.
- Project `.venv/bin/ruff` discovery is available.
- Basedpyright uses standard type checking.
- Basedpyright uses library code types, auto imports, and search paths.
- Ruff server command prefers the project virtualenv executable.
- Python LSP and Ruff virtualenv binding is resolved at plugin-load time from the current working directory.
- Switching Python projects expects a Neovim relaunch or `:LspRestart` after `:cd`.
- Python buffers have an LSP restart keymap.
- Java language support is enabled.
- JDTLS supports Bazel, Gradle, Maven, and Git roots.
- OpenJDK 25 is pinned for JDTLS.
- Java imports support BSP, Gradle, and Maven.
- Bazel Java projects warn when `.bsp/` is missing.
- Java completion includes postfix completion.
- Java completion includes guessed method arguments.
- Java inlay hints are configured.
- Java reference and implementation code lenses are configured.
- JDTLS buffers have compile and restart keymaps.
- Spring Boot support is active for Java, YAML, and Java properties.
- Gradle language support is available.
- Groovy language support is available outside Gradle roots.
- Starlark/Bazel language support is available.

### Testing

- Neotest is available through LazyVim test support.
- Go tests use neotest-golang.
- Go neotest root detection uses the nearest `go.mod`.
- Go default test args drop `-race`.
- `<leader>tR` runs the nearest Go test with `-race`.
- Go single-file and single-test discovery uses faster local package listing.
- `<leader>tT` runs all tests in the nearest Go module.
- `<leader>ts` scopes the neotest summary to the current Go, Python, or Java root.
- Python tests use neotest-python with pytest.
- Python tests use project `.venv` when available.
- Python pytest args include `--no-header --no-cov`.
- Python test execution runs from the uv workspace root when applicable.
- Python DAP strategy cwd is patched for project execution.
- `<leader>tT` runs all Python tests under the nearest `pyproject.toml`.
- Python buffers have a project-scoped test-run-all keymap.
- Java tests use neotest-java.
- Java Gradle path handling is patched around an upstream neotest-java path bug.
- JDTLS and LazyVim Java test keymaps are removed so neotest is the sole Java test path.
- JDTLS buffers have neotest nearest/all keymaps.
- `<leader>tg` runs nearest Java tests through neotest.
- `<leader>tT` runs Java test groups through neotest.

### DAP

- nvim-dap, DAP UI, Mason-managed DAP integration, and Python DAP integration are available.
- DAP virtual text is declared but disabled.
- DAP UI has customized icons, does not auto-open on session start, and toggles with `<leader>dt`.
- DAP keymaps support continue, step into, step over, step out, close, expression eval, logs, and stringified yank.
- DAP breakpoint toggle and step-back currently share `<localleader>b`, so the effective direct keymap is ambiguous.
- DAP expression evaluation can infer the smallest useful expression or call under the cursor.
- DAP expression evaluation supports idle hover while paused and a bottom REPL-split path that preserves source-window focus.
- DAP hover/REPL values can be stringified and yanked.
- `<leader>dl` tails DAP stdout and stderr logs into terminal buffers.
- DAP signs distinguish breakpoints, conditional breakpoints, logpoints, stopped lines, rejected breakpoints, and exceptions.
- Python DAP uses the project `.venv/bin/python` when available.
- Python DAP setup reruns per project root on first Python buffer entry.
- Java DAP loads the Java debug adapter bundle and intentionally excludes Java test bundles.
- LazyVim DAP core and nlua extras are recorded in the Neovim metadata.

### Git and review workflow

- Gitsigns shows custom gutter signs.
- `gG` opens LazyGit.
- LazyGit opens from the current buffer's valid Git root when available.
- LazyGit falls back to the current buffer directory when Git root detection is invalid.
- LazyGit falls back to Neovim cwd when the buffer path is not usable.
- `]c` and `[c` navigate Git hunks while respecting diff mode.
- Hunk actions include stage hunk, reset hunk, stage visual range, reset visual range, stage buffer, undo stage, reset buffer, preview hunk, inline preview, blame line, diff against index, and diff against last commit.
- `<localleader>g` previews the current Git hunk inline.
- Git toggles include current-line blame and deleted-line display.
- Octo is namespaced under `<leader>O`.
- LazyVim default Octo `<leader>g*` mappings are disabled.
- Octo supports smart entry.
- Octo supports PR list, search, my PRs, review picker, author picker, thread picker, checkout, create, browser open, and URL copy.
- Octo browser open also copies the PR URL and can fall back to `gh pr view` outside Octo PR buffers.
- Octo avoids Projects v2 token-scope failures by not defaulting to Projects v2.
- Octo uses local filesystem buffers for right-pane PR review files.
- Octo toggle-viewed moves to the next unviewed file.
- Octo right-pane local review buffers are made modifiable.
- Octo same-branch PR detection is less brittle.
- Octo PR creation includes `headRepository`.
- Octo PR list query includes author.
- Octo PR picker includes author in fuzzy text and display.
- Octo converts HTML body/comment content toward Markdown before rendering.
- Octo review view can be unified to drop the left pane and use gitsigns gutter.
- Octo unified review view is reversible and changes the Gitsigns base to the PR base commit while active.
- PR review picker searches PRs to review and assigned PRs.
- PR review picker includes recently merged or closed assigned PRs.
- Review thread picker lists review threads.
- Review thread picker defaults to unresolved threads and marks resolved or outdated threads in display text.
- Review thread picker can open a thread in the browser.
- Review thread picker can resolve threads.
- Review thread picker can toggle resolved thread visibility.
- Review thread picker can jump to a thread's file and line when local context is available.
- Octo comment templates include nit, question, blocker, and praise prefixes.
- Octo comment templates are bound in review contexts on `<localleader>cn`, `<localleader>cq`, `<localleader>cb`, and `<localleader>c+`.

### Inherited coding integrations and external tools

- Nvim-lspconfig provides the base Neovim LSP client configuration layer.
- Mason manages language-server, formatter, linter, and debugger installs.
- None-ls exposes external tools through LSP-style sources.
- Conform provides the shared formatting runner.
- Nvim-lint provides the shared lint runner.
- Blink.cmp provides the inherited completion engine surface.
- SchemaStore provides JSON schema metadata.
- Lazydev improves Lua development inside Neovim plugin/config files.
- Treesitter textobjects are inherited from LazyVim.
- TS autotag is inherited from LazyVim.
- Docker language integration is inherited from LazyVim.
- Git filetype integration is inherited from LazyVim.
- JSON language integration is inherited from LazyVim.
- TOML language integration is inherited from LazyVim.
- YAML language integration is inherited from LazyVim.
- Rust language integration is inherited from LazyVim.
- Crates.nvim support is inherited from LazyVim.
- Clangd extension support is inherited from LazyVim.
- Helm language-server support is inherited from LazyVim.
- JDTLS support is inherited from LazyVim and extended by local Java config.
- Spring Boot support is inherited from LazyVim and extended by local config.
- Venv-selector support is inherited for Python virtualenv selection.
- Nvim-dap provides the shared debug adapter protocol client.
- DAP UI provides debug panels.
- DAP Go support is inherited from LazyVim.
- DAP Python support is inherited from LazyVim and extended by local Python config.
- DAP UI tooling is inherited from LazyVim.
- One-small-step-for-vimkind enables Lua/Neovim debugging.
- Neotest provides the shared test runner.
- Neotest-golang provides Go test discovery and execution.
- Neotest-python provides Python test discovery and execution.
- Neotest-java provides Java test discovery and execution.
- Gitsigns provides Git gutter and hunk actions.
- Vim-tmux-navigator provides navigation between Neovim splits and tmux panes.
- Project.nvim provides recent-project detection and project roots.
- Persistence provides session restore and stop-save behavior.
- Dot-file graphing support is inherited from LazyVim.
- Startuptime support is inherited from LazyVim.
- External CLI integrations expect `git`.
- External CLI integrations expect `tmux`.
- External CLI integrations expect `rg`.
- External CLI integrations expect `gh`.
- External CLI integrations expect `k9s`.
- External CLI integrations expect `lazygit`.
- External CLI integrations expect Neovim remote server support.
- Java integrations expect OpenJDK 25.
- Java integrations expect Mason-managed Java tooling.
- Go integrations expect Go.
- Go integrations expect Delve.
- Go integrations expect gopls.
- Go integrations expect goimports.
- Go integrations expect gofumpt.
- Go integrations can use optional Bazel or Bazelisk support.
- Go integrations can use optional GOPACKAGESDRIVER behavior.
- Python integrations expect project virtualenvs.
- Python integrations expect Ruff.
- Python integrations expect debugpy.
- Python integrations use uv workspace metadata when present.
- Formatting and build integrations expect Prettier.
- Formatting and build integrations expect Stylua.
- Formatting and build integrations expect Google Java Format.
- Formatting and build integrations expect buildifier.
- Formatting and build integrations expect Ruff.

## Agent integration features

### Agent scope

- Agent integration is a cross-workflow editor feature, not a coding-only feature.
- Agents can be used alongside coding, notetaking, planning, and review workflows.
- Agent prompts can use the current line or selection as context from any relevant buffer.

### Sidekick agent surface

- Sidekick provides the canonical in-Neovim agent interface.
- Sidekick uses tmux as its mux backend.
- Sidekick tools include Pi, Codex, Cursor Agent, OpenCode, and Claude.
- Primary Sidekick agents are Pi and Codex.
- Full Sidekick agent order is Pi, Codex, Cursor, OpenCode, Claude.
- Codex agent command uses bypass/sandbox flags as configured.
- Cursor Agent command uses force mode.
- Claude command uses skip-permissions mode.
- Agent CLI integrations expect `pi`, `codex`, `cursor-agent`, `opencode`, and `claude`.

### Agent UI and identity

- Agent UI colors are documented separately from the general editor colorscheme.
- Sidekick agent terminals have branded colors, borders, titles, branch metadata, and cwd metadata.
- Sidekick gives each agent a stable visual identity.
- Pi uses Gruvbox yellow (`#fabd2f`).
- Codex uses Gruvbox aqua (`#89b482`).
- Cursor Agent uses soft violet (`#B19CD9`).
- OpenCode uses Gruvbox gray (`#928374`).
- Claude uses terracotta (`#e48285`) in Sidekick.
- Unknown or fallback Sidekick tools use neutral gray (`#7C7C7C`).
- Sidekick ask UI uses Gruvbox blue (`#83a598`).
- Sidekick edit UI uses faded purple (`#8f3f71`).
- Sidekick branch metadata uses Starship-style purple (`#d3869b`).
- Sidekick floats use per-agent colored rounded borders.
- Sidekick floats use per-agent colored titles.
- Sidekick splits use per-agent colored winbars.
- Sidekick splits use per-agent colored window separators.
- Sidekick session pickers render agent labels with matching per-agent colors.
- Sidekick cwd session picker uses transparent picker backgrounds so terminal previews stay visible.
- Sidekick CLI picker shows right-aligned cwd.

### Agent sessions and routing

- Cursor Agent opens in a right split.
- Other Sidekick tools default to floats.
- Sidekick can match existing tmux panes to tools.
- Sidekick can rehydrate its registry from tmux panes.
- Sidekick named sessions are stored and identified through session labels and tmux environment.
- Sidekick named-session prompts collect both a session label and working directory.
- Pi and Claude named sessions receive native `--name <slug>` command arguments.
- Sidekick branch metadata is stored in tmux environment.
- `<C-.>` toggles the last picker-selected Sidekick session, falling back to the cwd session picker.
- Sidekick supports selecting, detaching, sending context, prompting, toggling float/split, listing local sessions, listing global sessions, searching sessions, and creating named sessions.
- Sidekick keymaps include ask/edit/apply/reject/yank, select/detach/send file/send visual/prompt, Pi/Codex toggles, local/global pickers, session search, and named-session creation.
- Sidekick cwd session picker includes previews.
- Sidekick global named-session picker includes previews.
- Sidekick session pickers support killing sessions.
- Sidekick can search captured named-session pane contents with ripgrep.

### Inline ask and edit

- Sidekick inline ask workflow can ask about the current line or selection.
- Sidekick inline edit workflow can request a unified diff edit for the current line or selection.
- Sidekick inline ask/edit uses Codex Spark in read-only/no-approval exec mode.
- Sidekick ask/edit context includes Tree-sitter scope detection.
- Sidekick ask/edit context includes LSP-hover symbol enrichment.
- Sidekick signs and extmarks show pending and completed ask/edit state.
- Sidekick has floating UI for prompts, answers, and diff previews.
- Sidekick answers and diffs can be applied, rejected, yanked, or cleared from the current line.

### Standalone agent terminals

- Sidecar opens in a terminal with `gS`.
- Sidecar is available from the dashboard.
- Sidecar prefers `/opt/homebrew/bin/sidecar` when present.
- OpenCode runs in a Snacks floating terminal.
- OpenCode command path is `~/.opencode/bin/opencode`.
- Autoread is enabled for OpenCode workflows.
- Claude Code plugin auto-starts.
- Claude Code is available from the dashboard.
- Claude Code plugin uses no terminal provider.
- Claude Code keeps diff terminal focus.
- Claude Code opens diffs in new tabs.
- Claude Code has a custom terracotta border (`#da7756`) on Gruvbox dark background.
- Claude Code command is `~/.local/bin/claude --dangerously-skip-permissions`.
- OpenCode plugin uses a Snacks float and no direct plugin keymaps.

## Notetaking features

### Markdown editing

- Markdown headings use a six-color Gruvbox ramp: orange, yellow, green, blue, purple, red.
- Markdown editing uses vim-pencil soft wrap.
- Markdown text width is 120.
- Markdown autoformat is enabled.
- Markdown and Octo buffers use a visual-width-aware prose rewrapper.
- Markdown rewrap preserves code blocks, frontmatter, lists, tables, and headings.
- Markdown rewrap treats link text as visible width while ignoring URL width.
- Markdown and Octo URL text objects are available with `iu` and `au`.
- Markdown and Octo URL under cursor can be edited with `<leader>mu`.
- Visual paste can transform selected text plus a URL register into a Markdown link.
- Markdown and Octo link conceal behavior is configured.

### Lists and tasks

- Autolist continues lists on Enter.
- Autolist supports list indentation and de-indentation.
- Autolist supports checkbox toggle.
- Autolist supports list recalculation.
- Autolist supports list-type cycling.
- Autolist recalculates after indent and delete.
- Autolist keymaps cover insert `<Tab>/<S-Tab>/<CR>`, normal `o`/`O`/`<CR>`/`<C-r>`, and list cycling on `<leader>cn` and `<leader>cp`.

### Rendered Markdown

- Rendered Markdown heading backgrounds use blended dark variants of the same six-color ramp.
- Rendered Markdown checkbox states use green for checked, gray for unchecked, and yellow for todo.
- Rendered Markdown is enabled for Markdown and Octo buffers.
- Rendered Markdown keeps conceal cursor active.
- Rendered Markdown anti-conceal behavior is tuned.
- Rendered Markdown customizes checkbox icons and states.
- Rendered Markdown customizes code block rendering.
- Rendered Markdown customizes heading icons and backgrounds.
- Rendered Markdown customizes link and wiki-link icons.
- Rendered Markdown includes custom web, Discord, GitHub, GitLab, Google, Neovim, Reddit, StackOverflow, Wikipedia, and YouTube link icons.
- Rendered Markdown customizes quote rendering.

### Obsidian and vault

- Vault workspace is `~/vault`.
- Obsidian wiki links are preferred.
- Obsidian note IDs slugify titles.
- Obsidian templates load from the vault templates directory.
- Obsidian completion is integrated into completion.
- Obsidian `gf` passthrough is configured.
- Obsidian Enter smart action is configured.
- Obsidian UI is disabled in favor of rendered Markdown.
- Obsidian keymaps support quick switch, search, inbox, new note, template insertion, rename, and open.
- Vault active todo picker excludes legacy locations, `.git`, `.obsidian`, templates, and Habit Tracking sections.
- `<leader>ft` opens active vault todos.
- `<leader>fT` opens active todos by tag.
- `<leader>ot` opens vault tags across frontmatter array tags, frontmatter list tags, and inline tags while skipping headings and code fences.
- `<leader>ob` opens case-insensitive backlinks to the current note, including aliased wiki links.
- `<leader>ol` opens outgoing wiki links from the current note, including unsaved-buffer and missing-target handling.

### Weekly backlog helpers

- Weekly backlog helpers create or open `~/vault/3_logs/YYYY-WW/backlog.md`.
- New weekly backlog files get frontmatter, title, log section, and date heading.
- Existing weekly backlog files are repaired to include log section and requested day heading.
- Backlog helpers support today, yesterday, and tomorrow.
- Backlog commands include `VaultBacklogToday`, `VaultBacklogYesterday`, `VaultBacklogTomorrow`, `ObsidianToday`, `ObsidianYesterday`, and `ObsidianTomorrow`.
- Backlog keymaps include `<leader>od`, `<leader>oy`, and `<leader>om`.

### Inherited notetaking integrations

- LazyVim inherited Markdown/notes/GitHub integrations include vim-pencil, autolist, render-markdown, markdown-preview, Obsidian, and Octo.
- Vault workflows expect `~/vault`.

## Editor platform features

### Plugin management

- LazyVim-based Neovim distribution with custom dotfiles layered on top.
- Lazy.nvim bootstraps from the stable branch.
- Lazy.nvim imports LazyVim core plugins, LazyVim extras, and custom plugin specs.
- Custom plugin specs live under `nvim/.config/nvim/lua/plugins`.
- Custom plugins load during startup by default.
- Plugin versions track latest git commits rather than semver releases.
- Lazy.nvim uses Tokyonight and Habamax as install fallback colorschemes.
- Lazy.nvim silently checks for plugin updates.
- Lazy.nvim disables selected builtin runtime plugins: `gzip`, `tarPlugin`, `tohtml`, `tutor`, and `zipPlugin`.
- Lazy-lock pins installed plugin commits.
- LazyVim metadata records enabled extras and install metadata.

### Picker and root behavior

- Snacks is the configured picker backend for LazyVim picker flows.
- Snacks picker UI has customized surfaces and cursor-row highlights.
- Snacks file picker includes hidden files.
- Snacks grep includes hidden files.
- Snacks pickers follow symlinks.
- Snacks file picker excludes `.git`, `node_modules`, and `.DS_Store`.
- Snacks picker formats results filename-first.
- Snacks picker uses a Telescope-like layout with rounded borders, cycling, and reverse ordering.
- `<C-b>` is disabled inside Snacks picker input/list.
- Mini.files opens file explorer at the current file's directory with `<leader>e`.
- Mini.files preview width is widened.

### Session and project management

- `<leader>fp` opens a recent-project picker.
- Selecting a project opens the file picker at that project root.
- Project detection recognizes `init.lua`, `build.gradle`, and `.git`.
- Project handling syncs cwd/root, respects buffer cwd, and updates focused file.
- Project/root behavior is pinned to the current working directory by default.
- Sessions persist buffers, current directory, tabs, windows, folds, and globals.
- Sessions are stored under Neovim state.
- `<leader>qs` restores the current session.
- `<leader>ql` restores the last session.
- `<leader>qd` stops saving the current session.

### Terminal workflow

- `<C-h>`, `<C-j>`, `<C-k>`, and `<C-l>` navigate between Neovim splits and tmux panes.
- `<C-\>` returns to the previous tmux/Neovim pane.
- Snacks terminal opens as a singleton floating terminal.
- Terminal float uses 90% width and height.
- Terminal float has a rounded or Neovide-specific border.
- Terminal float hides with `q`.
- `<C-]>` exits terminal insert mode.
- `gk` toggles K9s.

### Theme and UI surfaces

- True color support is enabled.
- Gruvbox Material is the primary non-agent colorscheme.
- Gruvbox Material uses a dark background.
- Gruvbox Material uses medium background contrast.
- Gruvbox Material uses low UI contrast.
- Gruvbox Material uses the `mix` foreground palette.
- Gruvbox Material uses the `blend` float style.
- Gruvbox Material uses the `afterglow` statusline style.
- Gruvbox Material enables italic text.
- Gruvbox Material enables bold text.
- Gruvbox Material enables diagnostic line highlights.
- Inactive-window dimming is disabled.
- Floating windows use a dark Gruvbox background.
- Floating window borders use a subtle Gruvbox gray.
- Floating window titles use Gruvbox orange.
- Terminal floats use Gruvbox background and foreground colors.
- Snacks picker windows use Gruvbox background and foreground colors.
- Snacks picker cursor rows use a brighter Gruvbox cursorline shade.
- Snacks picker borders stay subtle against the background.
- Noice does not hijack `<C-b>` for popup scrolling.
- Noice suppresses Neovide's transient font-update warning during GUI attach.

### Core editing and clipboard

- Absolute and relative line-number behavior is available through the configured editor defaults.
- Swap files and swap recovery prompts are disabled.
- Jumplist behavior is stack-based.
- Insert-mode `<C-/>` exits insert mode.
- The system clipboard is the default unnamed clipboard.
- SSH clipboard copy works through OSC52.
- SSH paste avoids remote terminal paste timeouts by using local Neovim registers.
- Terminal-buffer paste uses bracketed-paste wrapping so pasted newlines are not interpreted as keystrokes by nested terminal programs.

### Statusline, tabline, dashboard, and GUI

- Lualine provides a custom statusline theme.
- Lualine shows mode, branch, diff, diagnostics, filename, filetype, progress, and location.
- Global statusline is enabled.
- Statusline is hidden in dashboard and terminal buffers.
- Tabby replaces Bufferline for tab and buffer display.
- Bufferline is explicitly disabled.
- Tabline shows tabs and buffers with custom separators and modified indicators.
- `<S-h>` and `<S-l>` navigate buffers.
- `<S-q>` closes the current buffer.
- Dashboard actions include finding files, creating a new file, restoring the last session, opening Sidecar, opening LazyGit, opening Claude Code, and quitting.
- Neovide has a custom font configuration.
- Neovide maps left Option as Meta on macOS.
- Neovide disables the bell.
- Neovide supports Cmd copy, paste, select-all, save, and font-size shortcuts.

### Inherited editor integrations

- Snacks provides inherited picker, explorer, dashboard, input, notification, and terminal UI building blocks.
- Which-key shows available keymaps after prefix keys.
- Flash provides fast search and jump navigation.
- Noice provides enhanced command-line, message, and popup UI.
- Todo-comments highlights and navigates TODO/FIXME-style comments.
- Grug-far provides project-wide find-and-replace.
- Mini.ai provides extra text objects.
- Mini.files provides a lightweight file explorer.
- Mini.hipatterns highlights inline patterns.
- Mini.icons provides filetype and UI icons.
- Mini.pairs auto-inserts matching pairs.
- Ts-comments provides Treesitter-aware commenting.
- Nvim-web-devicons provides file and plugin icons.
- LazyVim inherited UI/theme features are available, including Tokyonight, Catppuccin, Lualine, and colorizer.

### Verification harness

- A Neovim verification harness exists.
- Verification resolves Neovim from PATH, Bob nightly, or Bob stable.
- Verification runs headless checks from the dotfiles repository root.
- Verification checks legacy agent keymaps stay removed.
- Verification checks required Pi, Codex, local, and global mappings exist.
- Verification checks Sidekick has no duplicate agent keymaps.
- Verification checks Pi/Codex primary ordering.
- Verification checks Pi tool registration.
- Verification checks named Pi command construction.
- Verification checks Sidekick registry parsing.
- Verification checks Sidekick branding lookup.
- Verification checks `<C-.>` local fallback.
- Verification can create a temporary real tmux Pi session.
- Verification checks tmux discovery and rehydration.
- Verification checks local picker visibility.
- Verification checks `SIDEKICK_BRANCH` metadata readback.
- Verification checks search snapshot capture.

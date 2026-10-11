# nvim plugin-config contract suite

## Purpose

This suite checks the small plugin-config contracts in `lua/plugins/`. It loads each spec file with `dofile`. It starts no plugin, no LSP, and no plugin manager. It writes nothing below `$HOME`. Each assert runs on the spec table or on a pure config function.

## Overview (merged PRs)

- #29 fixed a Java test crash. The `neotest-java` Gradle code returns a `Path` table where a string is expected, so `Path.new` fails on `raw_path:sub` and `Path:append` fails on a table concat. `java.lua` wraps both calls and coerces the table back to a string.
- #30 fixed the Neovide font error. The config no longer sets `guifont` at config time. The font applies only when Neovide attaches.
- #25 moved the Python pin to `basedpyright`. `pyright` must stay absent.
- #31 moved format-on-save control to the LazyVim handler. The conform opts must carry no `format_on_save` key.

## What the suite covers

- `java.lua`: the real `Path.new` / `Path:append` wraps run against a fake `neotest-java.model.path` that fails on both crash sites before the patch; a second patch run adds no wrapper.
- `neovide.lua`: `guifont` stays untouched at config time; `apply` sets the font, the input keys, and the Cmd maps; the noice spec disables its signature help and skips the font error message.
- `mason.lua`: `basedpyright`, `debugpy`, `clang-format`, and `jdtls` are pinned; `pyright` is absent; every entry is a string.
- `conform.lua`: no `format_on_save` key; the prettier `prepend_args` and the ruff command discovery run against a fixture tree; non-listed filetypes return nil.
- `lsp.lua`: the signatureHelp border wrap; the `lua_ls` settings shape.
- `c.lua`: clangd args, the clang-format map, treesitter pins, the DAP entry, the pure helpers `c_compile_args`, `c_source_and_binary`, and `show_build_errors` with stubbed `vim.fn`, and the FileType wiring for `<leader>C*` maps and `:Cbuild` commands.
- `build-files.lua`: the gradle, starpls, and groovy server shapes; the macOS JDK path is a presence check only.
- `jdtls.lua`: the root-marker list via a fake `jdtls.setup`; `check_bazel_bsp` warns once per Bazel root and stays silent for non-Bazel roots, `.bsp` roots, and a nil root.
- `obsidian.lua`: `note_id_func` makes kebab-case ids; `note_path_func` joins dir and id with an `.md` suffix; opts and keys keep shape.
- `blink-cmp.lua`: `enabled()` and `should_show_items()` run as pure gates over fake `vim.bo` and `vim.b`; no `git` provider exists (a nonexistent git source once broke `:checkhealth`).
- `spring-boot.lua`: the spec shape.

## How to run

Run `scripts/test-nvim-plugin-configs.sh` from the repository root. It finds nvim on `PATH`, then in `~/.local/bin`, then in `~/.local/share/bob`, and runs the spec with `nvim --headless -u NONE`. It prints one PASS line per case and exits non-zero when a case fails. A missing nvim prints SKIP and exits zero; set `STRICT=1` to turn that into a failure. The shared entry `scripts/test-nvim-headless.sh` also finds this spec by glob.

## Runtime and SLA

The entry finishes in under 40 ms on this host. The SLA is 60 s for the entry and 5 s for the spec. Every case stays deterministic: fixed fixture trees, stubbed `vim.fn`, no clock reads, no waits.

## Coverage result

Lua has no coverage tool, so this table is the inventory. "Part" means the suite runs the item through a stub or a fake module.

| File | Covered | Not covered |
|---|---|---|
| java.lua | import, Path wraps, adapter opts | nothing beyond the fake |
| neovide.lua | late font, apply, maps, noice opts | handler bodies; live attach |
| mason.lua | shape, four pins, pyright absent | other pins shape-checked |
| conform.lua | all gates and discovery fns | markdownlint `condition` |
| lsp.lua | handler wrap, lua_ls settings | real popup render |
| c.lua | args, formatters, DAP, helpers, wiring | build flows; `c_debug`; CUDA branch |
| build-files.lua | server shapes, JDK presence | groovy `root_dir` on real disk |
| jdtls.lua | markers, settings, warn-once, init | LspAttach callback body |
| obsidian.lua | ids, paths, opts, keys | action bodies; `helpers/` suite |
| blink-cmp.lua | gates, sources, keymap, signature | snippet loader bodies |
| spring-boot.lua | full shape | — |

`c.lua` carries no `-tags` build flag, so no such flag is asserted.

## Known gaps

- `c_build_sync` and `c_build_async` need `vim.system` and a cache write below `$HOME`; `c_debug` needs the real `dap` module.
- The jdtls and c.lua LspAttach callbacks need a live LSP client.
- The groovy server runs only on a host with the Mason jar. The suite checks the gate, not the server.

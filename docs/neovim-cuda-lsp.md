# Neovim CUDA LSP (clangd) — host requirements

## Symptom

Opening CUDA reference files (e.g. `reference/fast.cu/h100/matmul.cu` from the
H100 matmul professor lesson) in Neovim shows a wall of `clangd` / AST
diagnostics:

- `Cannot find CUDA installation; provide its path via '--cuda-path'`
- `Cannot find libdevice for sm_52`
- `'cuda.h' file not found`, `'cuda_runtime.h' file not found`
- `Unknown type name '__nv_bfloat16'`, `Use of undeclared identifier 'cudaSuccess'`

## Root cause

The captain's MacBook is **macOS Apple Silicon (arm64)**. NVIDIA does not ship a
CUDA Toolkit for macOS Apple Silicon — there is no `nvcc`, no `cuda.h`,
`cuda_runtime.h`, `cuda_bf16.h`, `cublas_v2.h`, and no `libdevice.bc`. clangd's
fallback driver also finds no `compile_commands.json` in the lesson tree, so it
builds the `.cu` file as plain C++ without CUDA includes. Even passing
`-x cuda -nocudainc -nocudalib` does not help: the user's explicit
`#include <cuda.h>` still cannot resolve because the headers do not exist on
this host.

This is **not** a Neovim/LSP config bug. filetype routing is correct
(`filetype=cuda` → clangd `languageId=cuda-cpp`), clangd attaches and
initializes, and the clangd binary (Mason 21.1.8) is fine.

## What works on the Mac (no fix needed)

clangd recovers from the missing CUDA headers and still builds a partial AST, so
these real LSP features work on macOS today, with zero config changes:

- **Document symbols** — 11 symbols for `matmul.cu` (functions, globals, the 12
  kernel dispatch cases).
- **Go-to-definition on local symbols** — `runKernel1` (called in `run_kernel`)
  resolves to `matmul/matmul_1.cuh:135`; the local `.cuh` includes resolve.
- **Hover on local symbols** — `void run_kernel(int kernel_num, ...)` returns a
  proper markdown signature.

## What cannot work on the Mac

Hover / go-to-def / completion / correct type info for the **CUDA API**
(`cudaMalloc`, `__nv_bfloat16`, `cublasGemmEx`, kernel-launch `<<<>>>` builtins
need the CUDA frontend headers and libdevice). There is no supported way to
install those on macOS Apple Silicon, and stubbing them in dotfiles would give
**incorrect** hover/type info (violating "LSP features must work, not be
silenced"). So the correct host for full CUDA LSP is the homelab/Linux.

## Durable dotfiles behavior

`nvim/.config/nvim/lua/plugins/clangd.lua` calls
`require("helpers.cuda_lsp").notify_if_unsupported(bufnr)` on every clangd
`cuda`-filetype `LspAttach`. On macOS Apple Silicon with no toolkit it emits one
`WARN` notification per Neovim session explaining the above and routing to the
homelab. It does **not** silence diagnostics and does **not** stop clangd from
attaching (so the local-symbol LSP above keeps working). On Linux with a
detected toolkit it is a no-op.

## Homelab / Linux requirements for full CUDA LSP

- NVIDIA driver + CUDA Toolkit installed (provides `nvcc`, `cuda.h`,
  `cuda_runtime.h`, `cuda_bf16.h`, `cublas_v2.h`, `libdevice.bc`).
- `clangd` on PATH (the repo's Mason-managed clangd or a system LLVM clangd).
- A compile database for the lesson tree, or clangd's Makefile fallback. The
  lesson ships a `Makefile` (`nvcc ... -gencode arch=compute_90a,code=sm_90a`);
  generate a compile database with:
  ```sh
  cd reference/fast.cu
  bear -- make matmul      # produces compile_commands.json
  # or: cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=1 ... ; ln -s build/compile_commands.json .
  ```
- Neovim with this dotfiles config (`XDG_CONFIG_HOME=dotfiles/nvim/.config`).

## Homelab validation command + success criteria

On the homelab, from the dotfiles repo root, with `CUDA_PATH` set and
`compile_commands.json` present in the lesson's `reference/fast.cu`:

```sh
repo="$HOME/path/to/dotfiles"
lesson="$HOME/path/to/vault/professor-lessons/h100-matmul-modal"
file="$lesson/reference/fast.cu/h100/matmul.cu"
cd "$lesson/reference/fast.cu"
XDG_CONFIG_HOME="$repo/nvim/.config" \
  nvim --headless "$file" \
    "+lua
      local b=0
      vim.wait(20000,function()
        for _,c in ipairs(vim.lsp.get_clients({bufnr=b})) do
          if c.name=='clangd' then return c.initialized end
        end return false end,100)
      local p={textDocument=vim.lsp.util.make_text_document_params(b)}
      local s=vim.lsp.buf_request_sync(b,'textDocument/documentSymbol',p,8000) or {}
      local n=0 for _,r in pairs(s) do n=n+(type(r.result)=='table' and #r.result or 0) end
      print('docSymbols='..n)
      local nd=0 for _,d in ipairs(vim.diagnostic.get(b)) do
        if d.severity==1 and (d.source=='clang') then nd=nd+1 end end
      print('clang_errors='..nd)
      vim.cmd('qa')"
```

**Success:** `docSymbols>=11` AND `clang_errors==0` (no `drv_no_cuda_*`,
`pp_file_not_found` for `cuda.h`, or `unknown_typename` for `__nv_bfloat16`).
On the Mac the same command yields `clang_errors>0` — that is the expected
graceful-failure signal, not a regression.

## Versions recorded (captain MacBook, 2026-08-26)

- macOS 15.7.4 (Darwin 24.6.0, arm64-apple-darwin)
- nvim NVIM v0.12.4
- clangd 21.1.8 (Mason) / Apple clangd 17.0.0 (CommandLineTools)
- nvcc: not installed; no CUDA Toolkit under /usr/local, /opt/homebrew,
  /Library/Developer, $HOME/.local, $HOME/.cache

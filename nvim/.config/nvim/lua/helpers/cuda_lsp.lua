-- CUDA LSP host-capability detection for clangd.
--
-- NVIDIA does not ship a CUDA Toolkit for macOS Apple Silicon, so .cu files
-- that use the CUDA API (cuda.h, cuda_runtime.h, cuda_bf16.h, cublas_v2.h,
-- libdevice) cannot get correct hover / go-to-def / type info on the Mac.
-- clangd still parses the file's own structure, so document symbols and
-- LOCAL-symbol navigation work there; only CUDA-API symbols stay unresolved
-- and clangd reports them as errors. This helper detects that condition and
-- notifies once per session, routing the captain to the homelab/Linux CUDA
-- toolkit for full CUDA LSP. It does NOT silence diagnostics — the Mac errors
-- are real "this symbol cannot resolve here" signals, not noise to hide.
--
-- Authoritative setup + homelab command: docs/neovim-cuda-lsp.md

local M = {}

local notified = {}

function M.on_macos_apple_silicon()
  local uname = vim.uv.os_uname()
  return uname.sysname == "Darwin" and uname.machine == "arm64"
end

-- True if a CUDA Toolkit is reachable: nvcc on PATH, CUDA_PATH/CUDA_HOME set
-- with cuda.h, or cuda.h under a common install root.
function M.toolkit_present()
  if vim.fn.executable("nvcc") == 1 then
    return true
  end
  local cuda_path = os.getenv("CUDA_PATH") or os.getenv("CUDA_HOME")
  if cuda_path and vim.fn.filereadable(cuda_path .. "/include/cuda.h") == 1 then
    return true
  end
  for _, root in ipairs({ "/usr/local/cuda", "/opt/cuda", "/Developer/NVIDIA" }) do
    if vim.fn.filereadable(root .. "/include/cuda.h") == 1 then
      return true
    end
  end
  return false
end

-- True only when the host can plausibly provide full CUDA LSP: Linux with a
-- detected toolkit. macOS is excluded regardless of toolkit presence — the
-- toolkit is not installable there in practice.
function M.host_supports_full_cuda()
  if vim.uv.os_uname().sysname == "Linux" then
    return M.toolkit_present()
  end
  return false
end

-- Notify once per Neovim session that full CUDA LSP needs the homelab/Linux
-- toolkit. Safe to call from a clangd LspAttach on every cuda buffer.
function M.notify_if_unsupported(bufnr)
  bufnr = bufnr or 0
  if M.host_supports_full_cuda() then
    return
  end
  if M.on_macos_apple_silicon() and not notified.mac then
    notified.mac = true
    vim.schedule(function()
      vim.notify(
        "CUDA toolkit not found on macOS Apple Silicon (NVIDIA ships none). "
          .. "clangd will flag CUDA API symbols (cudaMalloc, __nv_bfloat16, cublas*); "
          .. "document symbols and local-symbol go-to-def/hover still work. "
          .. "For full CUDA LSP, open these files on the homelab/Linux CUDA toolkit.",
        vim.log.levels.WARN
      )
    end)
  end
end

-- Test hook: clear the once-per-session guard.
function M._reset_notify_guard()
  notified = {}
end

return M

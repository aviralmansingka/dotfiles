#!/usr/bin/env bash
# Probe an attached Neovim session to confirm gopls is wired up for a Modal workspace.
# Usage: probe-gopls.sh [socket]
#   socket defaults to the most recently modified live nvim socket whose process cwd is under ~/modal.
#
# Pass criteria (all must hold):
#   - nvim-lspconfig loaded
#   - vim.lsp.config["gopls"].before_init is a function
#   - directoryFilters include "-bazel-bin" and "-bazel-modal" (workspace-dependent for the latter)
#   - attached gopls client has GOPACKAGESDRIVER set in settings.gopls.env
#
# Exits 0 on PASS, 1 on FAIL.

set -euo pipefail

socket="${1:-}"
if [[ -z "$socket" ]]; then
  socket="$(
    find /var/folders -name 'nvim.*.0' -type s 2>/dev/null \
      | while read -r s; do
          pid="${s##*nvim.}"; pid="${pid%.0}"
          if ps -p "$pid" >/dev/null 2>&1; then
            cwd="$(lsof -p "$pid" 2>/dev/null | awk '$4=="cwd"{print $NF}')"
            if [[ "$cwd" == "$HOME/modal"* ]]; then
              printf '%s\t%s\n' "$(stat -f %m "$s")" "$s"
            fi
          fi
        done \
      | sort -nr | head -1 | cut -f2-
  )"
fi

if [[ -z "$socket" ]]; then
  echo "probe-gopls: no live nvim socket found in a ~/modal cwd; pass one explicitly" >&2
  exit 1
fi

echo "probe-gopls: using socket $socket"

probe() {
  nvim --server "$socket" --remote-expr "luaeval('$1')"
}

# Single round trip — collect everything we need into one JSON blob.
expr='vim.json.encode({
  lspconfig_loaded = require("lazy.core.config").plugins["nvim-lspconfig"]._.loaded ~= nil,
  before_init = type((vim.lsp.config["gopls"] or {}).before_init),
  directoryFilters = (((vim.lsp.config["gopls"] or {}).settings or {}).gopls or {}).directoryFilters or vim.NIL,
  workspaceFiles = (((vim.lsp.config["gopls"] or {}).settings or {}).gopls or {}).workspaceFiles or vim.NIL,
  clients = vim.tbl_map(function(c)
    local gp = (c.config and c.config.settings and c.config.settings.gopls) or {}
    return {
      name = c.name,
      root_dir = c.root_dir,
      settings_env = gp.env or vim.NIL,
      client_directoryFilters = gp.directoryFilters or vim.NIL,
      client_workspaceFiles = gp.workspaceFiles or vim.NIL,
    }
  end, vim.lsp.get_clients({ name = "gopls" })),
})'
expr_oneline="$(printf '%s' "$expr" | tr -d '\n' | sed "s/'/''/g")"

raw="$(nvim --server "$socket" --remote-expr "luaeval('$expr_oneline')")"
echo "probe-gopls: raw=$raw"

# Parse via python for portability.
python3 - "$raw" <<'PY'
import json
import sys

raw = sys.argv[1]
data = json.loads(raw)

fails = []

if not data.get("lspconfig_loaded"):
    fails.append("nvim-lspconfig not loaded")

if data.get("before_init") != "function":
    fails.append(f"vim.lsp.config['gopls'].before_init is {data.get('before_init')!r}, expected 'function'")

dirs = data.get("directoryFilters") or []
if "-bazel-bin" not in dirs:
    fails.append(f"directoryFilters missing -bazel-bin: {dirs}")

clients = data.get("clients") or []
if not clients:
    fails.append("no gopls client attached (open a Go file under ~/modal first)")

for c in clients:
    env = c.get("settings_env") or {}
    gpd = env.get("GOPACKAGESDRIVER")
    root = c.get("root_dir") or ""
    client_dirs = c.get("client_directoryFilters") or []
    if root.startswith("/Users/aviral/modal") or "modal" in root:
        if not gpd:
            fails.append(f"client {c['name']} root={root} has no settings.gopls.env.GOPACKAGESDRIVER")
        elif "scripts/modal/gopackagesdriver.sh" not in gpd:
            fails.append(f"client {c['name']} GOPACKAGESDRIVER={gpd} (expected dotfiles launcher)")
        if "-bazel-modal" not in client_dirs:
            fails.append(f"Modal client but client.config directoryFilters lacks -bazel-modal: {client_dirs}")

if fails:
    print("FAIL")
    for f in fails:
        print(f"  - {f}")
    sys.exit(1)
print("PASS")
PY

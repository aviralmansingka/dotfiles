#!/bin/sh
set -eux

agent_cmd="${SIDECAR_AGENT_COMMAND:-${1:-codex}}"
prompt="${SIDECAR_AGENT_PROMPT:-${2:-}}"

if [ -n "${WORKTREE_PATH:-}" ] && [ -d "${WORKTREE_PATH:-}" ]; then
  cd "$WORKTREE_PATH"
elif git rev-parse --show-toplevel >/dev/null 2>&1; then
  cd "$(git rev-parse --show-toplevel)"
fi

if [ -n "$prompt" ]; then
  export SIDECAR_AGENT_PROMPT="$prompt"
  exec sh -lc 'exec '"$agent_cmd"' "$SIDECAR_AGENT_PROMPT"'
fi

exec sh -lc 'exec '"$agent_cmd"

#!/bin/bash

set -euo pipefail

if [[ -z "${MAIN_WORKTREE:-}" || -z "${WORKTREE_PATH:-}" ]]; then
  echo "MAIN_WORKTREE and WORKTREE_PATH must be set" >&2
  exit 1
fi

source_todos="$MAIN_WORKTREE/.todos"
target_todos="$WORKTREE_PATH/.todos"
source_start_hook="$MAIN_WORKTREE/.sidecar-start.sh"
target_start_hook="$WORKTREE_PATH/.sidecar-start.sh"

if [[ ! -d "$source_todos" ]]; then
  :
fi

if [[ -d "$source_todos" ]]; then
  if [[ -L "$target_todos" ]]; then
    existing_target="$(readlink "$target_todos")"
    if [[ "$existing_target" != "$source_todos" ]]; then
      rm "$target_todos"
      ln -s "$source_todos" "$target_todos"
    fi
  elif [[ -e "$target_todos" ]]; then
    rm -rf "$target_todos"
    ln -s "$source_todos" "$target_todos"
  else
    ln -s "$source_todos" "$target_todos"
  fi
fi

if [[ -f "$source_start_hook" ]]; then
  cp "$source_start_hook" "$target_start_hook"
  chmod +x "$target_start_hook"
fi

#!/bin/bash

set -euo pipefail

repo_arg="${1:-marcus/sidecar}"
repo_path="${SIDECAR_REPO_PATH:-$HOME/sidecar}"
output_path="${SIDECAR_BIN_PATH:-$HOME/.local/bin/sidecar}"
dotfiles_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$repo_path/.git" && ! -f "$repo_path/go.mod" ]]; then
  "$dotfiles_dir/scripts/ghq-worktree-clone.sh" "$repo_arg"
fi

if [[ ! -f "$repo_path/go.mod" ]]; then
  echo "expected a Sidecar checkout at $repo_path" >&2
  exit 1
fi

mkdir -p "$(dirname "$output_path")"

version="$(git -C "$repo_path" describe --tags --always --dirty 2>/dev/null || echo dev)"

(
  cd "$repo_path"
  go build \
    -ldflags "-X main.Version=$version" \
    -o "$output_path" \
    ./cmd/sidecar
)

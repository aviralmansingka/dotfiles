#!/bin/bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ghq-worktree-clone.sh [options] <repo>

Clone a repository as a bare ghq repo, create a stable main worktree under the
worktrees root, and create a symlink in the current directory named after the
repo.

Examples:
  ghq-worktree-clone.sh modal-labs/modal-client
  ghq-worktree-clone.sh git@github.com:modal-labs/modal-client.git
  ghq-worktree-clone.sh --branch feat/login modal-labs/modal-client
  ghq-worktree-clone.sh --worktrees-root ~/src/worktrees modal-labs/modal-client

Options:
  -b, --branch NAME         Create an additional feature worktree with this branch name
  -n, --name NAME           Override the local repo directory name under the worktrees root
      --main-worktree NAME  Name of the stable primary worktree (default: main)
      --worktrees-root DIR  Root directory for checked out worktrees (default: ~/worktrees)
  -h, --help                Show this help text
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

expand_path() {
  local path="$1"
  if [[ "$path" == "~/"* ]]; then
    printf '%s/%s\n' "$HOME" "${path#~/}"
  elif [[ "$path" == "~" ]]; then
    printf '%s\n' "$HOME"
  else
    printf '%s\n' "$path"
  fi
}

repo_query_from_input() {
  local repo="$1"

  repo="${repo#ssh://git@}"
  repo="${repo#git@}"
  repo="${repo#https://}"
  repo="${repo#http://}"

  if [[ "$repo" == *:* && "$repo" != */* ]]; then
    repo="${repo#*:}"
  fi

  repo="${repo#github.com/}"
  repo="${repo#gitlab.com/}"
  repo="${repo#bitbucket.org/}"
  repo="${repo#source.developers.google.com/}"

  if [[ "$repo" == *:* ]]; then
    repo="${repo#*:}"
  fi

  repo="${repo%.git}"
  repo="${repo#/}"

  printf '%s\n' "$repo"
}

default_branch_from_bare_repo() {
  local bare_repo="$1"
  local default_ref

  default_ref="$(git --git-dir="$bare_repo" symbolic-ref --quiet HEAD 2>/dev/null || true)"
  if [[ -n "$default_ref" ]]; then
    printf '%s\n' "${default_ref##refs/heads/}"
    return 0
  fi

  default_ref="$(git --git-dir="$bare_repo" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$default_ref" ]]; then
    printf '%s\n' "${default_ref##refs/remotes/origin/}"
    return 0
  fi

  default_ref="$(git --git-dir="$bare_repo" for-each-ref --format='%(refname)' refs/heads/main refs/heads/master refs/remotes/origin/main refs/remotes/origin/master | head -n 1)"
  if [[ -n "$default_ref" ]]; then
    default_ref="${default_ref##refs/heads/}"
    printf '%s\n' "${default_ref##refs/remotes/origin/}"
    return 0
  fi

  echo "Unable to determine default branch for $bare_repo" >&2
  exit 1
}

create_worktree_if_missing() {
  local bare_repo="$1"
  local path="$2"
  local branch_ref="$3"
  local branch_name="${4:-}"

  if [[ -d "$path/.git" || -f "$path/.git" ]]; then
    echo "Worktree already exists: $path"
    return 0
  fi

  mkdir -p "$(dirname "$path")"

  if [[ -n "$branch_name" ]]; then
    git --git-dir="$bare_repo" worktree add -b "$branch_name" "$path" "$branch_ref"
  else
    git --git-dir="$bare_repo" worktree add "$path" "$branch_ref"
  fi
}

create_symlink_if_missing() {
  local target_path="$1"
  local link_path="$2"

  if [[ -L "$link_path" ]]; then
    local existing_target
    existing_target="$(readlink "$link_path")"
    if [[ "$existing_target" == "$target_path" ]]; then
      echo "Symlink already exists: $link_path -> $target_path"
      return 0
    fi

    echo "Refusing to replace existing symlink: $link_path -> $existing_target" >&2
    exit 1
  fi

  if [[ -e "$link_path" ]]; then
    echo "Refusing to replace existing path: $link_path" >&2
    exit 1
  fi

  ln -s "$target_path" "$link_path"
}

install_sidecar_worktree_setup() {
  local worktree_path="$1"
  local setup_script="$worktree_path/.worktree-setup.sh"
  local git_exclude="$worktree_path/.git/info/exclude"
  local source_script="$HOME/dotfiles/scripts/sidecar-worktree-setup.sh"

  if [[ ! -f "$source_script" ]]; then
    return 0
  fi

  if [[ ! -f "$setup_script" ]]; then
    cp "$source_script" "$setup_script"
    chmod +x "$setup_script"
  fi

  if [[ -f "$git_exclude" ]] && ! grep -Fxq "/.worktree-setup.sh" "$git_exclude"; then
    printf '%s\n' "/.worktree-setup.sh" >> "$git_exclude"
  fi
}

resolve_base_ref() {
  local bare_repo="$1"
  local branch_name="$2"

  if git --git-dir="$bare_repo" show-ref --verify --quiet "refs/heads/$branch_name"; then
    printf '%s\n' "$branch_name"
    return 0
  fi

  if git --git-dir="$bare_repo" show-ref --verify --quiet "refs/remotes/origin/$branch_name"; then
    printf '%s\n' "origin/$branch_name"
    return 0
  fi

  echo "Unable to resolve base ref for branch: $branch_name" >&2
  exit 1
}

repo=""
feature_branch=""
repo_name_override=""
main_worktree_name="main"
worktrees_root="$HOME/worktrees"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--branch)
      feature_branch="${2:-}"
      shift 2
      ;;
    -n|--name)
      repo_name_override="${2:-}"
      shift 2
      ;;
    --main-worktree)
      main_worktree_name="${2:-}"
      shift 2
      ;;
    --worktrees-root)
      worktrees_root="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$repo" ]]; then
        echo "Only one repo may be specified" >&2
        usage >&2
        exit 1
      fi
      repo="$1"
      shift
      ;;
  esac
done

if [[ -z "$repo" ]]; then
  usage >&2
  exit 1
fi

require_cmd ghq
require_cmd git

worktrees_root="$(expand_path "$worktrees_root")"
repo_query="$(repo_query_from_input "$repo")"

if [[ -z "$repo_query" ]]; then
  echo "Failed to derive repo path from input: $repo" >&2
  exit 1
fi

repo_basename="${repo_query##*/}"
repo_dir_name="${repo_name_override:-$repo_basename}"
cwd_link_path="$PWD/$repo_dir_name"

echo "Cloning bare repo with ghq: $repo"
ghq get --bare "$repo"

bare_repo="$(ghq list -p "$repo_query" | head -n 1)"
if [[ -z "$bare_repo" ]]; then
  echo "Unable to resolve bare repo path from ghq for: $repo_query" >&2
  exit 1
fi

echo "Bare repo: $bare_repo"
echo "Fetching latest refs"
git --git-dir="$bare_repo" fetch origin --prune

default_branch="$(default_branch_from_bare_repo "$bare_repo")"
default_ref="$(resolve_base_ref "$bare_repo" "$default_branch")"

main_worktree_path="$worktrees_root/$repo_dir_name/$main_worktree_name"
create_worktree_if_missing "$bare_repo" "$main_worktree_path" "$default_ref"
create_symlink_if_missing "$main_worktree_path" "$cwd_link_path"
install_sidecar_worktree_setup "$main_worktree_path"

feature_worktree_path=""
if [[ -n "$feature_branch" ]]; then
  feature_worktree_path="$worktrees_root/$repo_dir_name/$feature_branch"
  create_worktree_if_missing "$bare_repo" "$feature_worktree_path" "$default_ref" "$feature_branch"
fi

echo
echo "Setup complete"
echo "  bare repo:      $bare_repo"
echo "  default branch: $default_branch"
echo "  main worktree:  $main_worktree_path"
echo "  cwd symlink:    $cwd_link_path"
if [[ -n "$feature_worktree_path" ]]; then
  echo "  feature tree:   $feature_worktree_path"
fi
echo
echo "Point Sidecar at: $main_worktree_path"

#!/usr/bin/env bash
# Open one review tab per case, with the before and after diagram side by side
#
# Usage:
#   scripts/viz-review-panes.sh --round 02 [--baseline 01] [--case <case>]
#                              [--bin /abs/rataflow-view] [--view N]
#
# Each tab gets two panes at natural zoom: the baseline round (left, "before")
# and the evaluated round (right, "after"). --view picks which view pair to
# show; panes.json records every available view so another pair can be opened
# later. Panes stay open for the human: this script closes nothing.
set -euo pipefail

die() { printf 'viz-review-panes: %s\n' "$*" >&2; exit 1; }

round='' baseline='01' only_case='' bin='' before_bin='' view=1 repo=$(pwd)
while [ $# -gt 0 ]; do
  case "$1" in
    --round) round=${2:?}; shift 2 ;;
    --baseline) baseline=${2:?}; shift 2 ;;
    --case) only_case=${2:?}; shift 2 ;;
    --bin) bin=${2:?}; shift 2 ;;
    --before-bin) before_bin=${2:?}; shift 2 ;;
    --view) view=${2:?}; shift 2 ;;
    --repo) repo=${2:?}; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$round" ] || die "--round is required"
[ "${HERDR_ENV:-}" = 1 ] || die "HERDR_ENV is not 1; review panes need Herdr"
command -v herdr >/dev/null || die "herdr is not on PATH"
command -v jq >/dev/null || die "jq is not on PATH"

round_dir="$repo/docs/visualize-eval/rounds/$round"
base_dir="$repo/docs/visualize-eval/rounds/$baseline"
[ -f "$round_dir/config.json" ] || die "no config.json in $round_dir"
[ -d "$base_dir" ] || die "no baseline round directory: $base_dir"
if [ -z "$bin" ]; then
  bin=$(jq -r '.binary_path // empty' "$round_dir/config.json")
fi
[ -n "$bin" ] || die "no --bin and no binary_path in config.json"
case "$bin" in /*) ;; *) die "--bin must be absolute, got: $bin" ;; esac
[ -x "$bin" ] || die "binary not executable: $bin"

# The before pane must use the baseline round's own binary, or the comparison
# would show the new renderer twice.
if [ -z "$before_bin" ]; then
  baseline_bin=$(jq -r '.binary_path // empty' "$base_dir/config.json" 2>/dev/null || true)
  for candidate in "$baseline_bin" "/tmp/visualize-eval/round-$baseline/bin/rataflow-view"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then before_bin=$candidate; break; fi
  done
fi
if [ -n "$before_bin" ]; then
  case "$before_bin" in /*) ;; *) die "--before-bin must be absolute, got: $before_bin" ;; esac
  [ -x "$before_bin" ] || die "before binary not executable: $before_bin"
fi

out_dir="$round_dir/human-review"
mkdir -p "$out_dir"
table='[]'
# A --case run updates that case's entry instead of dropping the others.
if [ -n "$only_case" ] && [ -f "$out_dir/panes.json" ]; then
  table=$(jq -c '.cases // []' "$out_dir/panes.json" 2>/dev/null || echo '[]')
fi

collect_specs() { # collect_specs <case-dir> -> final spec paths, view order preserved
  # generation.json is the authority on which spec is final and in what order.
  # Its paths are inconsistent across workers (repo-relative, case-relative,
  # round-relative), so resolve each against all three bases.
  local case_dir=$1 base repo_root parent spec candidate found=''
  repo_root=$repo
  parent=$(dirname "$case_dir")
  if [ -f "$case_dir/generation.json" ]; then
    found=$(while IFS= read -r spec; do
      [ -n "$spec" ] || continue
      for base in "$repo_root" "$case_dir" "$parent"; do
        candidate="$base/$spec"
        if [ -f "$candidate" ]; then printf '%s\n' "$candidate"; break; fi
      done
    done < <(jq -r '.views[]? | .spec // .spec_path // empty' "$case_dir/generation.json" 2>/dev/null))
  fi
  if [ -n "$found" ]; then
    printf '%s\n' "$found"
    return 0
  fi
  # No usable generation.json (some workers wrote null specs): scan the usual
  # spec homes and skip attempt, split and reference files.
  local dir
  for dir in "$case_dir/spec" "$case_dir/specs"; do
    [ -d "$dir" ] || continue
    find "$dir" -maxdepth 1 -name '*.json' 2>/dev/null \
      ! -name '*.split.json' ! -name '*reference*' ! -name '*attempt*' | sort -V
  done
}

view_of() { # view_of <list-index> <dir> -> the Nth spec, empty when absent
  local wanted=$1 dir=$2 index=0 path
  while IFS= read -r path; do
    if [ "$index" -eq "$((wanted - 1))" ]; then printf '%s' "$path"; return 0; fi
    index=$((index + 1))
  done < <(collect_specs "$dir")
  return 1
}

cases=$(jq -r '.cases[]' "$round_dir/config.json")
for case_id in $cases; do
  if [ -n "$only_case" ] && [ "$case_id" != "$only_case" ]; then
    continue
  fi
  after_dir="$round_dir/$case_id"
  before_dir="$base_dir/$case_id"
  after_spec=$(view_of "$view" "$after_dir" || true)
  before_spec=$(view_of "$view" "$before_dir" || true)
  [ -n "$after_spec" ] || { printf 'skip %s (no view %s after)\n' "$case_id" "$view" >&2; continue; }

  # Bind the tab to the workspace that owns this checkout. Without an
  # explicit --workspace, herdr attaches new tabs to the *focused*
  # workspace, which can be a different worktree than the one running
  # the review (seen in round 08: tabs landed in feat-learning-skills).
  repo_root=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$repo")
  repo_ws=$(herdr workspace list 2>/dev/null | jq -r \
    --arg root "$repo_root" \
    '.result.workspaces[]? | select(.worktree.checkout_path == $root) | .workspace_id' | head -1)
  ws_args=()
  [ -n "$repo_ws" ] && ws_args=(--workspace "$repo_ws")
  created=$(herdr tab create --label "r$round $case_id v$view" --cwd "$repo" --no-focus "${ws_args[@]}")
  tab=$(jq -r '.result.tab.tab_id // empty' <<<"$created")
  root=$(jq -r '.result.root_pane.pane_id // empty' <<<"$created")
  [ -n "$tab" ] && [ -n "$root" ] || die "could not create a tab for $case_id: $created"

  # Left: before, drawn by the baseline binary. Right: after, by the new one.
  if [ -n "$before_spec" ] && [ -n "$before_bin" ]; then
    herdr pane run "$root" "$before_bin" "$before_spec" >/dev/null
    herdr pane rename "$root" "before v$view" >/dev/null 2>&1 || true
  else
    herdr pane run "$root" "printf 'no renderable baseline view %s for %s\\n'" "$view" "$case_id" >/dev/null || true
  fi
  after_pane=$(herdr pane split "$root" --direction right --ratio 0.5 --cwd "$repo" --no-focus \
    | jq -r '.result.pane.pane_id // empty')
  [ -n "$after_pane" ] || die "could not split a pane for $case_id"
  herdr pane run "$after_pane" "$bin" "$after_spec" >/dev/null
  herdr pane rename "$after_pane" "after v$view" >/dev/null 2>&1 || true

  before_all=$(collect_specs "$before_dir" | jq -R . | jq -s .)
  after_all=$(collect_specs "$after_dir" | jq -R . | jq -s .)
  entry=$(jq -n --arg case "$case_id" --arg tab "$tab" --argjson view "$view" \
    --arg before "$before_spec" --arg after "$after_spec" \
    --arg bpanes "$root" --arg apanes "$after_pane" \
    --argjson before_all "$before_all" --argjson after_all "$after_all" \
    '{case: $case, tab_id: $tab, view: $view,
      before_spec: (if $before == "" then null else $before end), after_spec: $after,
      before_view_count: ($before_all | length), after_view_count: ($after_all | length),
      before_specs: $before_all, after_specs: $after_all,
      pane_ids: {before: $bpanes, after: $apanes}}')
  table=$(jq -c --argjson e "$entry" 'map(select(.case != $e.case)) + [$e]' <<<"$table")
  printf 'opened %-24s tab=%s before=%s after=%s\n' \
    "$case_id" "$tab" "$(basename "${before_spec:-none}")" "$(basename "$after_spec")"
done

jq -n --arg round "$round" --arg baseline "$baseline" --arg bin "$bin" \
  --argjson cases "$table" --arg opened "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{round: $round, baseline: $baseline, binary: $bin, opened_at: $opened,
    note: "Panes stay open for human review. Left pane is the baseline round, right pane is the evaluated round.",
    cases: $cases}' > "$out_dir/panes.json"

printf '\nreview tabs are open. Close one with: herdr tab close <tab-id>\n'
printf 'manifest: %s\n' "$out_dir/panes.json"

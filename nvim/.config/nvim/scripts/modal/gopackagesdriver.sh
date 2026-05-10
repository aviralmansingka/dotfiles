#!/usr/bin/env bash
# Modal-only Bazel go/packages driver launcher (tracks dotfiles instead of ~/modal/tools).
# Neovim sets GOPACKAGESDRIVER only when the Bazel root directory is named `modal`; this script is a
# second guardrail: it resolves the workspace upward and refuses other repo names.
#
# rules_go (bzlmod): https://github.com/bazelbuild/rules_go/blob/master/docs/editors.md

set -euo pipefail

start="${BUILD_WORKSPACE_DIRECTORY:-$(pwd)}"
dir="$(cd "$start" 2>/dev/null && pwd)"
if [[ -z "$dir" ]]; then
  dir="$(pwd)"
fi

for _ in {1..64}; do
  if [[ -f "$dir/MODULE.bazel" ]] || [[ -f "$dir/WORKSPACE" ]] || [[ -f "$dir/WORKSPACE.bazel" ]]; then
    base="$(basename "$dir")"
    if [[ "$base" != "modal" ]]; then
      echo "gopackagesdriver(dotfiles): Bazel root at ${dir} is not named modal (basename=${base})" >&2
      exit 1
    fi
    # tools/bazel is a Bazelisk wrapper: it expects $BAZEL_REAL to be set by
    # bazelisk before being exec'd (modal/tools/bazel:185 uses `set -u`).
    # Invoking it directly explodes with `BAZEL_REAL: unbound variable`, which
    # surfaces in gopls as `initial workspace load failed`. Go through bazelisk
    # instead — it sets BAZEL_REAL and re-execs tools/bazel correctly.
    cd "$dir"
    bazel_bin="$(command -v bazelisk || command -v bazel)"
    if [[ -z "$bazel_bin" ]]; then
      echo "gopackagesdriver(dotfiles): neither bazelisk nor bazel on PATH" >&2
      exit 1
    fi
    export GOPACKAGESDRIVER_BAZEL="${GOPACKAGESDRIVER_BAZEL:-$bazel_bin}"
    exec "$bazel_bin" run -- @rules_go//go/tools/gopackagesdriver ${1+"$@"}
  fi
  parent="$(dirname "$dir")"
  if [[ "$parent" == "$dir" ]]; then
    break
  fi
  dir="$parent"
done

echo "gopackagesdriver(dotfiles): no MODULE.bazel/WORKSPACE found above ${start}" >&2
exit 1

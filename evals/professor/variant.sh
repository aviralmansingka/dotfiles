#!/usr/bin/env bash
# evals/professor/variant.sh — materialize a professor skill variant from git.
#
# Usage: evals/professor/variant.sh <git-ref> <dest-dir>
#   evals/professor/variant.sh main /tmp/prof-old
#   evals/professor/variant.sh HEAD /tmp/prof-new
#
# Copies agents/.agents/skills/professor at <git-ref> into <dest-dir>, so two
# skill versions can run against the same task.

set -euo pipefail

ref=${1:?usage: variant.sh <git-ref> <dest-dir>}
dest=${2:?usage: variant.sh <git-ref> <dest-dir>}
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$repo" archive "$ref" agents/.agents/skills/professor | tar -x -C "$tmp"
rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
mv "$tmp/agents/.agents/skills/professor" "$dest"
echo "$dest"

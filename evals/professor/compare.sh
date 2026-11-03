#!/usr/bin/env bash
# evals/professor/compare.sh — run a task N times per variant, then summarize.
#
# Usage: evals/professor/compare.sh <task> <n> <variant-dir> [variant-dir...]
#
# Runs are interleaved (v1, v2, v1, v2, ...) so provider drift hits both arms
# about equally. Runs are sequential and cost one model session each; for a
# faster pass, dispatch each run as a parallel subagent that calls run.sh.

set -uo pipefail

if [ $# -lt 3 ]; then
	echo "usage: compare.sh <task> <n> <variant-dir> [variant-dir...]" >&2
	exit 2
fi

task=$1
n=$2
shift 2
variants=("$@")

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
runs=()

for _ in $(seq 1 "$n"); do
	for v in "${variants[@]}"; do
		out=$(EVAL_MAX_CALLS="${EVAL_MAX_CALLS:-80}" "$here/run.sh" "$task" "$v" 2>/dev/null | sed -n 's/^run: //p')
		[ -n "$out" ] && runs+=("$out")
	done
done

node "$here/summarize.mjs" "${runs[@]}"

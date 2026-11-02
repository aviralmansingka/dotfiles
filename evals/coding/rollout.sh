#!/usr/bin/env bash
# Run a model on eval tasks and grade the result.
#
#   rollout.sh list                       # task ids
#   rollout.sh one <task> <pi|codex>      # one worktree, one agent, one grade
#   rollout.sh matrix [--pool N] [--agents pi,codex]   # every task x agents, bounded pool
#
# Environment:
#   EVAL_ROLL_DIR   run directory (default: a fresh temp dir; printed at start)
#   MODEL_CODEX     codex model (default gpt-6.1-sol, no priority tier)
#   MODEL_PI        optional pi --model override (default: pi's configured model)
#   ROLLOUT_TIMEOUT per-run timeout in seconds (default 3600)
#   POOL            parallel runs for matrix mode (default 8)
#
# Each run appends one row to $EVAL_ROLL_DIR/results.csv:
#   agent,task,agent_rc,verify_rc,agent_seconds,grade_seconds,
#   tokens_in,tokens_out,tokens_cached,cost_usd,commits,diff,worktree
# Summarise with: uv run python evals/coding/costs.py $EVAL_ROLL_DIR/results.csv
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
manifest="$here/manifest.jsonl"
usage="$here/lib/usage.py"
PY=(uv run --offline --python 3.14 --no-project python)

ROLL=${EVAL_ROLL_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/eval-rollout-XXXXXX")}
MODEL_CODEX=${MODEL_CODEX:-gpt-6.1-sol}
MODEL_PI=${MODEL_PI:-}
MODEL_CLAUDE=${MODEL_CLAUDE:-}
TIMEOUT=${ROLLOUT_TIMEOUT:-3600}
POOL=${POOL:-8}
export EVAL_ROLL_DIR=$ROLL MODEL_CODEX MODEL_PI MODEL_CLAUDE ROLLOUT_TIMEOUT=$TIMEOUT
[ -n "${CODEX_HOME:-}" ] && export CODEX_HOME
[ -n "${CLAUDE_HOME:-}" ] && export CLAUDE_HOME
CLAUDE_KEY_FILE=${CLAUDE_KEY_FILE:-${CLAUDE_HOME:-}/.fireconnect/.api-key}
export CLAUDE_KEY_FILE

field() { "${PY[@]}" - "$1" "$2" "$manifest" <<'PYEOF'
import json, sys
task, key, path = sys.argv[1], sys.argv[2], sys.argv[3]
for line in open(path):
    if line.strip():
        row = json.loads(line)
        if row["id"] == task:
            value = row[key]
            print("\n".join(value) if isinstance(value, list) else value)
            break
else:
    sys.exit("unknown task: " + task)
PYEOF
}

list_tasks() { "${PY[@]}" - "$manifest" <<'PYEOF'
import json, sys
for line in open(sys.argv[1]):
    if line.strip():
        print(json.loads(line)["id"])
PYEOF
}

header() {
  echo "agent,task,agent_rc,verify_rc,agent_seconds,grade_seconds,tokens_in,tokens_out,tokens_cached,cost_usd,commits,diff,worktree"
}

run_one() {
  local task=$1 agent=$2
  local repo base wt logs log final rc grade rc_agent rc_verify seconds grade_seconds
  repo=$(field "$task" repo) || return 2
  base=$(field "$task" base_commit) || return 2
  wt="$ROLL/wt/$agent/$task"
  logs="$ROLL/logs"; mkdir -p "$logs" "$ROLL/sessions"
  log="$logs/$agent-$task.log"
  final="$logs/$agent-$task.final.md"

  if [ ! -d "$wt" ]; then
    mkdir -p "$(dirname "$wt")"
    git -C "$repo" worktree add --detach "$wt" "$base" >>"$log" 2>&1 \
      || { echo "$agent,$task,worktree-failed" >>"$ROLL/results.csv"; return 2; }
    # rack-bench briefs quote `.venv/bin/python`; give them the reference layout
    case "$repo" in *rack-bench) ( cd "$wt" && uv venv --python 3.14 >/dev/null 2>&1 ) ;; esac
  fi

  local started ended
  started=$(date +%s)
  if [ "$agent" = pi ]; then
    ( cd "$wt" && timeout "$TIMEOUT" pi -p \
        ${MODEL_PI:+--model "$MODEL_PI"} \
        --session-dir "$ROLL/sessions/pi-$task" --name "$task-pi" \
        "$(cat "$here/tasks/$task/prompt.md")" ) >>"$log" 2>&1
  elif [ "$agent" = claude ]; then
    [ -n "${CLAUDE_HOME:-}" ] || { echo "claude agent needs CLAUDE_HOME" >&2; return 2; }
    [ -r "$CLAUDE_KEY_FILE" ] || { echo "claude agent needs a Fireworks key at $CLAUDE_KEY_FILE" >&2; return 2; }
    ( cd "$wt" && HOME="$CLAUDE_HOME" ANTHROPIC_AUTH_TOKEN="$(cat "$CLAUDE_KEY_FILE")" \
        timeout "$TIMEOUT" claude -p --dangerously-skip-permissions \
        ${MODEL_CLAUDE:+--model "$MODEL_CLAUDE"} \
        "$(cat "$here/tasks/$task/prompt.md")" ) >>"$log" 2>&1
  else
    ( cd "$wt" && timeout "$TIMEOUT" codex exec \
        -C "$wt" -m "$MODEL_CODEX" \
        -c service_tier="auto" -c approval_policy="never" \
        -s workspace-write --skip-git-repo-check \
        -o "$final" - < "$here/tasks/$task/prompt.md" ) >>"$log" 2>&1
  fi
  rc_agent=$?
  ended=$(date +%s); seconds=$((ended - started))

  ( cd "$wt" && git add -A >/dev/null 2>&1 )
  local gstarted
  gstarted=$(date +%s)
  ( cd "$wt" && bash "$here/tasks/$task/verify.sh" ) >"$logs/$agent-$task.grade.log" 2>&1
  rc_verify=$?
  grade_seconds=$(( $(date +%s) - gstarted ))

  local usage_json tokens_in tokens_out tokens_cached cost commits diff
  case "$agent" in
    pi) usage_json=$("${PY[@]}" "$usage" pi "$ROLL/sessions/pi-$task" 2>/dev/null) ;;
    claude) usage_json=$("${PY[@]}" "$usage" claude "$CLAUDE_HOME/.claude" --model "${MODEL_CLAUDE:-}" 2>/dev/null) ;;
    *) usage_json=$("${PY[@]}" "$usage" codex "$wt" --run-dir "$ROLL" --model "$MODEL_CODEX" 2>/dev/null) ;;
  esac
  [ -n "${usage_json:-}" ] || usage_json='{"tokens_in":0,"tokens_out":0,"tokens_cached":0,"cost_usd":0}'
  tokens_in=$(printf '%s' "$usage_json" | "${PY[@]}" -c 'import json,sys; print(json.load(sys.stdin)["tokens_in"])')
  tokens_out=$(printf '%s' "$usage_json" | "${PY[@]}" -c 'import json,sys; print(json.load(sys.stdin)["tokens_out"])')
  tokens_cached=$(printf '%s' "$usage_json" | "${PY[@]}" -c 'import json,sys; print(json.load(sys.stdin)["tokens_cached"])')
  cost=$(printf '%s' "$usage_json" | "${PY[@]}" -c 'import json,sys; print(json.load(sys.stdin)["cost_usd"])')

  commits=$(git -C "$wt" rev-list --count "$base"..HEAD 2>/dev/null)
  diff=$(git -C "$wt" diff --cached --shortstat "$base" 2>/dev/null | tr -d '\n')

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"%s",%s\n' \
    "$agent" "$task" "$rc_agent" "$rc_verify" "$seconds" "$grade_seconds" \
    "$tokens_in" "$tokens_out" "$tokens_cached" "$cost" "${commits:-0}" "${diff:-no-diff}" "$wt" \
    >>"$ROLL/results.csv"
  printf '[%s] %-5s %-34s verify=%s %4ss %6s tok in/%6s out $%s\n' \
    "$(date +%H:%M:%S)" "$agent" "$task" "$rc_verify" "$seconds" "$tokens_in" "$tokens_out" "$cost"
}

prepare() {
  mkdir -p "$ROLL"/{wt,logs,sessions}
  [ -f "$ROLL/results.csv" ] || header >"$ROLL/results.csv"
}

case "${1:-}" in
  list) list_tasks ;;
  one)
    [ $# -eq 3 ] || { echo "usage: rollout.sh one <task> <pi|codex>" >&2; exit 2; }
    prepare; run_one "$2" "$3"
    ;;
  matrix)
    shift
    agents="pi codex"
    while [ $# -gt 0 ]; do
      case "$1" in
        --pool) shift; POOL=${1:-8} ;;
        --agents) shift; agents=$(printf '%s' "${1:-pi codex}" | tr ',' ' ') ;;
      esac
      shift
    done
    prepare
    echo "run dir: $ROLL (pool $POOL, timeout ${TIMEOUT}s, codex model $MODEL_CODEX)"
    for agent in $agents; do list_tasks | sed "s/^/$agent,/"; done \
      | xargs -P "$POOL" -I{} bash -c '
          IFS=, read -r a t <<< "{}"
          EVAL_ROLL_DIR="$EVAL_ROLL_DIR" MODEL_CODEX="$MODEL_CODEX" MODEL_PI="$MODEL_PI" \
            MODEL_CLAUDE="$MODEL_CLAUDE" CODEX_HOME="${CODEX_HOME:-}" CLAUDE_HOME="${CLAUDE_HOME:-}" \
            CLAUDE_KEY_FILE="$CLAUDE_KEY_FILE" ROLLOUT_TIMEOUT="$ROLLOUT_TIMEOUT" "$0" one "$t" "$a"' "$0"
    ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac

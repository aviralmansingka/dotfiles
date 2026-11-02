#!/usr/bin/env bash
# evals/professor/run.sh — run one professor eval task headless.
#
# Usage: evals/professor/run.sh <task> <skill-dir> [model]
#
#   task   name under evals/professor/tasks/ (no .json)
#   skill-dir  professor skill directory to load (a variant)
#   model      pi model pattern (default: fireworks glm-5p3-fast)
#
# Writes every artifact under evals/professor/runs/<stamp>-<task>-<tag>/:
#   professor/     the skill variant that ran, copied verbatim
#   task.json      the task definition
#   calls.jsonl    one row per instrument call (stubs.ts)
#   state.json     the user simulator's final state
#   stdout.txt     the professor's visible text
#   sessions/      the pi session file
#   meta.json      model, skill hash, git commit, date
#
# Three "continue" follow-ups follow the opening prompt. The skill parks for
# the learner after the probe report and after the plan; without them a headless
# run ends at the first park with no teaching.
#   score.json     metrics from score.mjs

set -uo pipefail

task=${1:?usage: run.sh <task> <skill-dir> [model]}
skill_dir=${2:?usage: run.sh <task> <skill-dir> [model]}
model=${3:-anthropic/claude-sonnet-4-5}

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)

task_file="$here/tasks/$task.json"
if [ ! -f "$task_file" ]; then
	echo "no task: $task_file" >&2
	exit 1
fi
if [ ! -f "$skill_dir/SKILL.md" ]; then
	echo "no SKILL.md in $skill_dir" >&2
	exit 1
fi

tag=$(basename "$skill_dir")
stamp=$(date +%Y%m%d-%H%M%S)-$(printf %04x $RANDOM)
out="$here/runs/$stamp-$task-$tag"
mkdir -p "$out/workspace" "$out/vault/2_knowledge/propositions"
cp -R "$skill_dir" "$out/professor"
cp "$task_file" "$out/task.json"

# The skill names the installed path (~/.agents/skills/professor/). Point the
# copy at itself, so the harness tests this variant and never the installed one.
python3 - "$out/professor" "$out/professor" <<'PY'
import pathlib, sys
root, dest = pathlib.Path(sys.argv[1]), sys.argv[2]
for f in root.glob("*.md"):
    text = f.read_text()
    new = text.replace("~/.agents/skills/professor/", dest + "/")
    if new != text:
        f.write_text(new)
PY

# Reproducibility header: a score with no model, skill hash, or commit cannot
# be compared with a later run.
skill_hash=$(cat "$out/professor"/*.md | shasum -a 256 | cut -d' ' -f1)
git_sha=$(git -C "$repo" rev-parse --short HEAD 2>/dev/null || echo none)
python3 - "$out/meta.json" "$model" "$skill_hash" "$git_sha" "$task" <<'META'
import json, sys, datetime
path, model, skill_hash, git_sha, task = sys.argv[1:]
json.dump({
    "model": model,
    "skillHash": skill_hash,
    "gitSha": git_sha,
    "task": task,
    "date": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
}, open(path, "w"), indent=2)
META

# Hermetic workspace: an empty professor-lessons tree and a private vault, so
# the real vault and its open arcs cannot leak into the run. A task may seed
# both: `vault` copies proposition notes, `workspace` copies a fixture tree.
mkdir -p "$out/workspace/professor-lessons"

has_vault=$(python3 -c 'import json,sys; print("yes" if json.load(open(sys.argv[1])).get("vault") else "")' "$task_file")
if [ -n "$has_vault" ]; then
	while IFS= read -r note; do
		[ -n "$note" ] || continue
		[ -f "$here/vault/$note" ] && cp "$here/vault/$note" "$out/vault/2_knowledge/propositions/"
	done < <(python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1])).get("vault", [])))' "$task_file")
fi

workspace_fixture=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("workspace",""))' "$task_file")
if [ -n "$workspace_fixture" ]; then
	cp -R "$here/fixtures/$workspace_fixture/." "$out/workspace/"
fi

topic=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["topic"])' "$task_file")
mode=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("mode",""))' "$task_file")

if [ "$mode" = "cold-start" ]; then
	topic_block="The learner just opened the pane and wrote: hi"
else
	topic_block="Topic: $topic"
fi

if [ "$mode" = "resume" ]; then
	record_block="This rollout is a resume. Read the existing professor-lessons session file in this directory and continue from it. Do not restart the goal grill."
elif [ -n "$has_vault" ]; then
	record_block="The vault holds proposition notes for this topic. Start with the status read."
else
	record_block="There is no existing record for this topic."
fi

prompt=$(cat <<EOF
$(cat "$out/professor/SKILL.md")

---

You are the professor agent in professor mode. Run the lesson directly with the learner in this session. Never launch a subagent; the researcher subagent is unavailable in this harness, so plan from what you already know and from the workspace.

The learner is a real person. Ask one question at a time with the tools. Start with the status read, then Phase 0. $record_block

The learner answers only through the quiz, explain, ask_user_question, and run-command tools. They cannot edit files or run commands by hand. Never ask them to. Work inside this directory only.

$topic_block
EOF
)

echo "run: $out"
cd "$out/workspace" || exit 1
EVAL_TASK="$out/task.json" \
EVAL_LOG="$out/calls.jsonl" \
EVAL_STATE="$out/state.json" \
EVAL_MAX_CALLS="${EVAL_MAX_CALLS:-80}" \
PI_VAULT_DIR="$out/vault" \
timeout "${EVAL_TIMEOUT:-900}" pi --print \
	--no-extensions -e "$here/stubs.ts" \
	--skill "$out/professor" \
	--tools read,bash,grep,find,ls,write,edit,quiz,explain,lesson,ask_user_question,run-command \
	--session-dir "$out/sessions" \
	--no-approve --no-mcp --model "$model" \
	-- "$prompt" "continue" "continue" "continue" >"$out/stdout.txt" 2>"$out/stderr.txt"
status=$?

node "$here/score.mjs" "$out" | tee "$out/score.txt"
echo "exit: $status (0 = clean)"

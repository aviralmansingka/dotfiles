#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "$0")/.." && pwd -P)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

origin="$test_dir/origin.git"
seed="$test_dir/seed"
runtime="$test_dir/runtime"
context=artifact-0123456789abcdef
mkdir -p "$runtime/fake"

git init --bare -q "$origin"
git clone -q "$origin" "$seed"
git -C "$seed" config user.name Test
git -C "$seed" config user.email test@example.com
mkdir -p "$seed/docs"
printf '<h1>Original artifact</h1>\n' > "$seed/artifact.html"
printf '# Source\n\nA concise source.\n' > "$seed/docs/source.md"
git -C "$seed" add artifact.html docs/source.md
git -C "$seed" commit -qm initial
git -C "$seed" branch -M main
git -C "$seed" push -qu origin main

fake_herdr="$test_dir/herdr"
cat > "$fake_herdr" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "workspace create")
    printf '{"result":{"workspace":{"workspace_id":"wA"},"root_pane":{"pane_id":"wA:p1","tab_id":"wA:t1","terminal_id":"term_A"}}}\n'
    ;;
  "workspace close")
    printf '{"result":{"closed":true}}\n'
    ;;
  "agent start")
    rm -f "$FAKE_STATE_DIR/first-prompt" "$FAKE_STATE_DIR/ready"
    printf '{"result":{"agent":{"name":"%s","workspace_id":"wA","pane_id":"wA:p1","tab_id":"wA:t1","terminal_id":"term_A"}}}\n' "$3"
    ;;
  "agent get")
    if [[ -f "$FAKE_STATE_DIR/ready" ]]; then
      session=',"agent_session":{"source":"herdr:codex","kind":"id","value":"session-A"}'
    else
      session=
    fi
    printf '{"result":{"agent":{"name":"artifact-06ff9a2d0ea93ec9","workspace_id":"wA","pane_id":"wA:p1","tab_id":"wA:t1","terminal_id":"term_A","foreground_cwd":"%s","interactive_ready":true,"agent_status":"idle"%s}}}\n' "$FAKE_WORKTREE" "$session"
    ;;
  "agent prompt")
    if [[ "$4" == Initialize* ]]; then
      if [[ -f "$FAKE_STATE_DIR/first-prompt" ]]; then
        touch "$FAKE_STATE_DIR/ready"
      else
        touch "$FAKE_STATE_DIR/first-prompt"
      fi
    else
      [[ "$4" == *"Changed artifact"* ]]
      [[ "$4" == *"A concise source."* ]]
      [[ "$4" == *"If and only if the user explicitly asks to change"* ]]
      [[ "$4" == *"Never read or write outside that worktree"* ]]
      token=$(printf '%s\n' "$4" | sed -n 's/^Reply token: //p')
      printf 'ARTIFACT_RESPONSE_%s_B\n  EGIN\nThe artifact says **Original artifact**.\nARTIFACT_RESPONSE_%s\n  _END\n' "$token" "$token" > "$FAKE_TERMINAL"
    fi
    printf '{"result":{"agent_status":"idle"}}\n'
    ;;
  "agent read")
    sed -n '1,$p' "$FAKE_TERMINAL"
    ;;
  *)
    printf 'unexpected fake Herdr command: %s\n' "$*" >&2
    exit 1
    ;;
esac
SH
chmod +x "$fake_herdr"

agent_env=(
  LAVISH_ARTIFACT_ROOT="$runtime/artifacts"
  LAVISH_ARTIFACT_AGENT_STATE="$runtime/state.json"
  LAVISH_HERDR_BIN="$fake_herdr"
  FAKE_STATE_DIR="$runtime/fake"
  FAKE_TERMINAL="$runtime/fake/terminal.txt"
)

env "${agent_env[@]}" "$repo_dir/scripts/lavish-artifact-agent" prepare \
  --context "$context" \
  --slug sample-artifact \
  --repo-url "$origin" \
  --branch main > "$test_dir/prepare.json"

worktree="$runtime/artifacts/_contexts/$context/worktree"
incoming="$runtime/artifacts/_contexts/$context/incoming"
rsync -a --exclude .git/ "$seed/" "$incoming/"

env "${agent_env[@]}" FAKE_WORKTREE="$worktree" \
  "$repo_dir/scripts/lavish-artifact-agent" activate \
  --context "$context" \
  --artifact-relative artifact.html \
  --source-relative docs/source.md > "$test_dir/activate.json"

env "${agent_env[@]}" FAKE_WORKTREE="$worktree" \
  "$repo_dir/scripts/lavish-artifact-agent" check --context "$context" > "$test_dir/check-clean.json"
before=$(GIT_OPTIONAL_LOCKS=0 git -C "$worktree" status --porcelain=v1)

printf '<h1>Changed artifact</h1>\n<p>New explanation.</p>\n' > "$worktree/artifact.html"
env "${agent_env[@]}" FAKE_WORKTREE="$worktree" \
  "$repo_dir/scripts/lavish-artifact-agent" check --context "$context" > "$test_dir/check-changed.json"
after=$(GIT_OPTIONAL_LOCKS=0 git -C "$worktree" status --porcelain=v1)
[[ "$after" == ' M artifact.html' ]]

printf 'What does the heading say?\n' | env "${agent_env[@]}" FAKE_WORKTREE="$worktree" \
  "$repo_dir/scripts/lavish-artifact-agent" chat --context "$context" > "$test_dir/chat.json"
env "${agent_env[@]}" FAKE_WORKTREE="$worktree" \
  "$repo_dir/scripts/lavish-artifact-agent" history --context "$context" > "$test_dir/history.json"
env "${agent_env[@]}" FAKE_WORKTREE="$worktree" \
  "$repo_dir/scripts/lavish-artifact-agent" retire --context "$context" > "$test_dir/retire.json"

context_b=artifact-1111111111111111
context_c=artifact-2222222222222222
env "${agent_env[@]}" "$repo_dir/scripts/lavish-artifact-agent" prepare \
  --context "$context_b" --slug concurrent-b --repo-url "$origin" --branch main > "$test_dir/prepare-b.json" &
pid_b=$!
env "${agent_env[@]}" "$repo_dir/scripts/lavish-artifact-agent" prepare \
  --context "$context_c" --slug concurrent-c --repo-url "$origin" --branch main > "$test_dir/prepare-c.json" &
pid_c=$!
wait "$pid_b"
wait "$pid_c"

uv run python - "$test_dir" "$context" "$before" "$after" \
  "$repo_dir/scripts/lavish-artifact-agent" "$runtime/state.json" <<'PY'
import json
import runpy
import sys
from pathlib import Path

root = Path(sys.argv[1])
context = sys.argv[2]
before, after = sys.argv[3:5]
prepare = json.loads((root / "prepare.json").read_text())
activate = json.loads((root / "activate.json").read_text())
clean = json.loads((root / "check-clean.json").read_text())
changed = json.loads((root / "check-changed.json").read_text())
chat = json.loads((root / "chat.json").read_text())
history = json.loads((root / "history.json").read_text())
retire = json.loads((root / "retire.json").read_text())
module = runpy.run_path(sys.argv[5])
state_path = Path(sys.argv[6])
state = json.loads(state_path.read_text())

assert prepare["context_id"] == context
assert activate["workspace_label"] == "Artifact-sample-artifact"
assert activate["workspace_id"] == "wA"
assert activate["pane_id"] == "wA:p1"
assert clean["artifact_changed_since_launch"] is False
assert changed["artifact_changed_since_launch"] is True
assert changed["artifact_added_lines"] == 2
assert changed["artifact_removed_lines"] == 1
assert before == ""
assert after == " M artifact.html"
assert "Original artifact" in chat["answer"]
assert [message["role"] for message in history["messages"]] == ["user", "assistant"]
assert history["workspace"] == "Artifact-sample-artifact"
assert retire == {"context_id": context, "retired": True}
assert not (state_path.parent / "artifacts/_contexts" / context).exists()
assert set(state) == {"artifact-1111111111111111", "artifact-2222222222222222"}
assert module["reflow_terminal_wraps"](
    "First wrapped\n  paragraph.\n\n```python\ndef f():\n    return 1\n```\n\n- long item\n  continuation\n- next\n\n> quoted\n  continuation\n\nLast wrapped\nline."
) == "First wrapped paragraph.\n\n```python\ndef f():\n    return 1\n```\n\n- long item continuation\n- next\n\n> quoted continuation\n\nLast wrapped line."
PY

echo "lavish-artifact-agent: ok"

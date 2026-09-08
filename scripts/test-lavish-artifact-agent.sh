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
  "workspace list")
    if [[ -n "${FAKE_PORT_REPO_CHECKOUT:-}" ]]; then
      printf '{"result":{"workspaces":[{"workspace_id":"wRepo","label":"Port repository","number":1,"worktree":{"checkout_path":"%s","is_linked_worktree":false,"repo_key":"repo-port"}}]}}\n' "$FAKE_PORT_REPO_CHECKOUT"
    elif [[ -n "${FAKE_OTHER_REPO_CHECKOUT:-}" ]]; then
      printf '{"result":{"workspaces":[{"workspace_id":"wRepo","label":"Repository","number":1,"worktree":{"checkout_path":"%s","is_linked_worktree":false,"repo_key":"repo-a"}},{"workspace_id":"wOther","label":"Other clone","number":2,"worktree":{"checkout_path":"%s","is_linked_worktree":false,"repo_key":"repo-b"}}]}}\n' "$FAKE_REPO_CHECKOUT" "$FAKE_OTHER_REPO_CHECKOUT"
    else
      printf '{"result":{"workspaces":[{"workspace_id":"wRepo","label":"Repository","number":1,"worktree":{"checkout_path":"%s","is_linked_worktree":false,"repo_key":"repo-a"}}]}}\n' "$FAKE_REPO_CHECKOUT"
    fi
    ;;
  "workspace close")
    printf '{"result":{"closed":true}}\n'
    ;;
  "tab close")
    printf '%s\n' "$*" >> "$FAKE_CLOSE_LOG"
    printf '{"result":{"closed":true}}\n'
    ;;
  "tab create")
    printf '%s\n' "$*" >> "$FAKE_CREATE_LOG"
    printf '{"result":{"tab":{"tab_id":"wRepo:tArtifact","workspace_id":"wRepo"},"root_pane":{"pane_id":"wRepo:pArtifact","tab_id":"wRepo:tArtifact","terminal_id":"term_A"}}}\n'
    ;;
  "agent start")
    rm -f "$FAKE_STATE_DIR/first-prompt" "$FAKE_STATE_DIR/ready"
    printf '{"result":{"agent":{"name":"%s","workspace_id":"wRepo","pane_id":"wRepo:pArtifact","tab_id":"wRepo:tArtifact","terminal_id":"term_A"}}}\n' "$3"
    ;;
  "agent get")
    if [[ -f "$FAKE_STATE_DIR/ready" ]]; then
      session=',"agent_session":{"source":"herdr:codex","kind":"id","value":"session-A"}'
    else
      session=
    fi
    printf '{"result":{"agent":{"name":"artifact-06ff9a2d0ea93ec9","workspace_id":"wRepo","pane_id":"wRepo:pArtifact","tab_id":"wRepo:tArtifact","terminal_id":"term_A","foreground_cwd":"%s","interactive_ready":true,"agent_status":"idle"%s}}}\n' "$FAKE_WORKTREE" "$session"
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
  FAKE_REPO_CHECKOUT="$seed"
  FAKE_CLOSE_LOG="$runtime/fake/closed.log"
  FAKE_CREATE_LOG="$runtime/fake/created.log"
)

env "${agent_env[@]}" "$repo_dir/scripts/lavish-artifact-agent" prepare \
  --context "$context" \
  --slug sample-artifact \
  --repo-url "$origin" \
  --branch main > "$test_dir/prepare.json"
env "${agent_env[@]}" "$repo_dir/scripts/lavish-artifact-agent" prepare \
  --context "$context" \
  --slug sample-artifact \
  --repo-url "$origin" \
  --branch main > "$test_dir/prepare-retry.json"
cmp "$test_dir/prepare.json" "$test_dir/prepare-retry.json"

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
grep -Fx 'tab close wRepo:tArtifact' "$runtime/fake/closed.log" >/dev/null

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

other_seed="$test_dir/other-seed"
git clone -q "$origin" "$other_seed"
ambiguous_context=artifact-8888888888888888
env "${agent_env[@]}" "$repo_dir/scripts/lavish-artifact-agent" prepare \
  --context "$ambiguous_context" --slug ambiguous --repo-url "$origin" --branch main \
  > "$test_dir/prepare-ambiguous.json"
ambiguous_incoming="$runtime/artifacts/_contexts/$ambiguous_context/incoming"
rsync -a --exclude .git/ "$seed/" "$ambiguous_incoming/"
if env "${agent_env[@]}" FAKE_OTHER_REPO_CHECKOUT="$other_seed" \
  "$repo_dir/scripts/lavish-artifact-agent" activate \
  --context "$ambiguous_context" --artifact-relative artifact.html \
  > "$test_dir/activate-ambiguous.json"; then
  echo "same-origin repositories were silently disambiguated" >&2
  exit 1
fi
[[ $(wc -l < "$runtime/fake/created.log") -eq 1 ]]

port_context=artifact-9999999999999999
env "${agent_env[@]}" "$repo_dir/scripts/lavish-artifact-agent" prepare \
  --context "$port_context" --slug port-collision --repo-url "$origin" --branch main \
  > "$test_dir/prepare-port.json"
port_incoming="$runtime/artifacts/_contexts/$port_context/incoming"
rsync -a --exclude .git/ "$seed/" "$port_incoming/"
git -C "$other_seed" remote set-url origin ssh://git@example.com:2200/org/repo.git
uv run python - "$runtime/state.json" "$port_context" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
state = json.loads(path.read_text())
state[sys.argv[2]]["repo_url"] = "ssh://git@example.com:2222/org/repo.git"
path.write_text(json.dumps(state))
PY
if env "${agent_env[@]}" FAKE_PORT_REPO_CHECKOUT="$other_seed" \
  "$repo_dir/scripts/lavish-artifact-agent" activate \
  --context "$port_context" --artifact-relative artifact.html \
  > "$test_dir/activate-port.json"; then
  echo "different SSH ports shared a repository identity" >&2
  exit 1
fi
[[ $(wc -l < "$runtime/fake/created.log") -eq 1 ]]

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
assert activate["workspace_label"] == "Repository"
assert activate["workspace_id"] == "wRepo"
assert activate["tab_label"] == "Artifact-sample-artifact"
assert activate["tab_id"] == "wRepo:tArtifact"
assert activate["pane_id"] == "wRepo:pArtifact"
assert clean["artifact_changed_since_launch"] is False
assert changed["artifact_changed_since_launch"] is True
assert changed["artifact_added_lines"] == 2
assert changed["artifact_removed_lines"] == 1
assert before == ""
assert after == " M artifact.html"
assert "Original artifact" in chat["answer"]
assert [message["role"] for message in history["messages"]] == ["user", "assistant"]
assert history["workspace"] == "Repository"
assert retire == {"context_id": context, "retired": True}
assert not (state_path.parent / "artifacts/_contexts" / context).exists()
assert set(state) == {
    "artifact-1111111111111111",
    "artifact-2222222222222222",
    "artifact-8888888888888888",
    "artifact-9999999999999999",
}
ambiguous = json.loads((root / "activate-ambiguous.json").read_text())
assert "Multiple Herdr repositories match" in ambiguous["error"]
assert state["artifact-8888888888888888"]["phase"] == "prepared"
port = json.loads((root / "activate-port.json").read_text())
assert "No Herdr workspace" in port["error"]
assert state["artifact-9999999999999999"]["phase"] == "prepared"

path_worktree = root / "path-worktree"
path_worktree.mkdir()
(path_worktree / "inside.html").write_text("inside")
outside = root / "outside.html"
outside.write_text("outside")
(path_worktree / "escaped.html").symlink_to(outside)
assert module["contained_file"](path_worktree, "inside.html", "artifact path").read_text() == "inside"
try:
    module["contained_file"](path_worktree, "escaped.html", "artifact path")
except module["ArtifactAgentError"] as error:
    assert "outside" in str(error)
else:
    raise AssertionError("out-of-worktree symlink was accepted")

assert module["normalize_repo_url"]("git@github.com:Owner/Repo.git") == \
    module["normalize_repo_url"]("https://github.com/Owner/Repo")
assert module["normalize_repo_url"]("git@example.com:org/repo.git") == \
    module["normalize_repo_url"]("ssh://git@example.com:22/org/repo")
assert module["normalize_repo_url"]("https://example.com:443/org/repo.git") == \
    module["normalize_repo_url"]("https://example.com/org/repo")
assert module["normalize_repo_url"]("ssh://git@example.com:2222/org/repo.git") != \
    module["normalize_repo_url"]("ssh://git@example.com:2200/org/repo.git")
workspace_globals = module["workspace_for_repository"].__globals__
workspace_globals["herdr_json"] = lambda args, **kwargs: {"workspaces": [
    {
        "workspace_id": "linked",
        "number": 1,
        "worktree": {
            "checkout_path": "/repos/linked",
            "is_linked_worktree": True,
            "repo_key": "repo-one",
        },
    },
    {
        "workspace_id": "primary",
        "number": 2,
        "worktree": {
            "checkout_path": "/repos/primary",
            "is_linked_worktree": False,
            "repo_key": "repo-one",
        },
    },
]}
workspace_globals["run"] = lambda args, **kwargs: type(
    "Result", (), {"stdout": "https://github.com/Owner/Repo.git\n"}
)()
assert module["workspace_for_repository"]("git@github.com:Owner/Repo.git")["workspace_id"] == "primary"
workspace_globals["herdr_json"] = lambda args, **kwargs: {"workspaces": []}
try:
    module["workspace_for_repository"]("git@github.com:Owner/Repo.git")
except module["ArtifactAgentError"] as error:
    assert "No Herdr workspace" in str(error)
else:
    raise AssertionError("missing source workspace was accepted")

agent_globals = module["start_agent"].__globals__
agent_globals["STATE_FILE"] = state_path
agent_globals["CONTEXT_ROOT"] = state_path.parent / "artifacts/_contexts"
initializing_context = "artifact-0000000000000000"
initializing_record = {
    "context_id": initializing_context,
    "slug": "initializing",
    "phase": "prepared",
    "repo_url": "git@github.com:example/repository.git",
    "worktree": str(root / "initializing-worktree"),
    "replies": str(root / "initializing-replies"),
}
state[initializing_context] = initializing_record
agent_globals["save_state"](state)
close_calls = []
agent_globals["workspace_for_repository"] = lambda repo_url: {
    "workspace_id": "workspace-source",
    "label": "Source",
}
def fail_tab_create(args, **kwargs):
    if args[:2] == ["tab", "create"]:
        raise module["ArtifactAgentError"]("tab creation failed")
    close_calls.append(args)
    return {}
agent_globals["herdr_json"] = fail_tab_create
try:
    module["start_agent"](initializing_record, state)
except module["ArtifactAgentError"]:
    pass
else:
    raise AssertionError("tab creation failure was swallowed")
assert initializing_record["phase"] == "prepared"
assert "workspace_id" not in initializing_record
assert close_calls == []

def fail_after_create(args, **kwargs):
    if args[:2] == ["tab", "create"]:
        return {
            "tab": {"tab_id": "tab-created"},
            "root_pane": {"pane_id": "pane-created"},
        }
    if args[:2] == ["agent", "start"]:
        raise module["ArtifactAgentError"]("initialization failed")
    if args[:2] == ["tab", "close"]:
        close_calls.append(args)
        raise module["ArtifactAgentError"]("close failed")
    raise AssertionError(args)
agent_globals["herdr_json"] = fail_after_create
try:
    module["start_agent"](initializing_record, state)
except module["ArtifactAgentError"]:
    pass
else:
    raise AssertionError("initialization failure was swallowed")
saved_initializing = json.loads(state_path.read_text())[initializing_context]
assert saved_initializing["phase"] == "retiring"
assert saved_initializing["workspace_id"] == "workspace-source"
assert saved_initializing["tab_id"] == "tab-created"
assert close_calls == [["tab", "close", "tab-created"]]
malformed_tab = {
    "session_container": "tab",
    "workspace_id": "workspace-source",
}
try:
    module["close_started_session"](malformed_tab)
except module["ArtifactAgentError"] as error:
    assert "refusing to close" in str(error)
else:
    raise AssertionError("malformed artifact tab could close its source workspace")
state.pop(initializing_context)
agent_globals["save_state"](state)

pending_context = "artifact-3333333333333333"
pending_root = root / "pending-contexts"
pending_state = root / "pending-state.json"
(pending_root / pending_context).mkdir(parents=True)
pending_state.write_text(json.dumps({pending_context: {
    "context_id": pending_context,
    "phase": "active",
    "workspace_id": "workspace-pending",
}}))
agent_globals["CONTEXT_ROOT"] = pending_root
agent_globals["STATE_FILE"] = pending_state
def fail_close(args, **kwargs):
    raise module["ArtifactAgentError"]("close failed")
agent_globals["herdr_json"] = fail_close
try:
    module["retire_context"](pending_context)
except module["ArtifactAgentError"]:
    pass
else:
    raise AssertionError("retirement failure was swallowed")
assert json.loads(pending_state.read_text())[pending_context]["phase"] == "retiring"
later_context = "artifact-4444444444444444"
(pending_root / later_context).mkdir()
pending_data = json.loads(pending_state.read_text())
pending_data[later_context] = {
    "context_id": later_context,
    "phase": "retiring",
    "workspace_id": "workspace-later",
}
pending_state.write_text(json.dumps(pending_data))
def timeout_then_close(args, **kwargs):
    if args[-1] == "workspace-pending":
        raise module["subprocess"].TimeoutExpired(args, 120)
    return {}
agent_globals["herdr_json"] = timeout_then_close
pending = module["command_retire_pending"](None)
assert pending["retired"] == [later_context]
assert pending_context in pending["errors"]
assert later_context not in json.loads(pending_state.read_text())
agent_globals["herdr_json"] = lambda args, **kwargs: {}
pending = module["command_retire_pending"](None)
assert pending == {"retired": [pending_context], "errors": {}}
assert json.loads(pending_state.read_text()) == {}
assert not (pending_root / pending_context).exists()
assert module["cleanup_context"](pending_context) == {
    "context_id": pending_context,
    "cleaned": True,
}

prepared_context = "artifact-5555555555555555"
(prepared_root := pending_root / prepared_context).mkdir()
pending_state.write_text(json.dumps({prepared_context: {
    "context_id": prepared_context,
    "phase": "prepared",
}}))
original_rmtree = agent_globals["shutil"].rmtree
def fail_remove(path, *args, **kwargs):
    if Path(path).resolve() == prepared_root.resolve():
        raise PermissionError("remove failed")
    return original_rmtree(path, *args, **kwargs)
agent_globals["shutil"].rmtree = fail_remove
try:
    module["cleanup_context"](prepared_context)
except module["ArtifactAgentError"]:
    pass
else:
    raise AssertionError("failed prepared cleanup was accepted")
assert json.loads(pending_state.read_text())[prepared_context]["phase"] == "cleanup-pending"
agent_globals["shutil"].rmtree = original_rmtree
assert module["cleanup_context"](prepared_context) == {
    "context_id": prepared_context,
    "cleaned": True,
}
assert json.loads(pending_state.read_text()) == {}
assert not prepared_root.exists()

unknown_context = "artifact-7777777777777777"
(unknown_root := pending_root / unknown_context).mkdir()
def fail_unknown(path, *args, **kwargs):
    if Path(path).resolve() == unknown_root.resolve():
        raise PermissionError("remove failed")
    return original_rmtree(path, *args, **kwargs)
agent_globals["shutil"].rmtree = fail_unknown
try:
    module["cleanup_context"](unknown_context)
except module["ArtifactAgentError"]:
    pass
else:
    raise AssertionError("failed unknown cleanup was accepted")
assert json.loads(pending_state.read_text())[unknown_context]["phase"] == "cleanup-pending"
agent_globals["shutil"].rmtree = original_rmtree
assert module["cleanup_context"](unknown_context)["cleaned"] is True

active_context = "artifact-6666666666666666"
(active_root := pending_root / active_context).mkdir()
pending_state.write_text(json.dumps({active_context: {
    "context_id": active_context,
    "phase": "active",
    "workspace_id": "workspace-active",
}}))
assert module["cleanup_context"](active_context) == {
    "context_id": active_context,
    "retired": True,
}
assert json.loads(pending_state.read_text()) == {}
assert not active_root.exists()

assert module["reflow_terminal_wraps"](
    "First wrapped\n  paragraph.\n\n```python\ndef f():\n    return 1\n```\n\n- long item\n  continuation\n  - nested item\n    continuation\n- next\n\n> quoted\n  continuation\n\nLast wrapped\nline."
) == "First wrapped paragraph.\n\n```python\ndef f():\n    return 1\n```\n\n- long item continuation\n  - nested item continuation\n- next\n\n> quoted continuation\n\nLast wrapped line."
PY

echo "lavish-artifact-agent: ok"

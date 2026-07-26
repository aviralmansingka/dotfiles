#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd -P)
observer="$repo/scripts/vault-hunter-observe"
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
run_id=observe-test

cd "$repo"
jq -cn --arg root "$root" --arg run_id "$run_id" '{
  action:"create",
  root:$root,
  run:{
    schema_version:1,
    run_id:$run_id,
    invoked_at:"2026-07-26T12:00:00Z",
    updated_at:"2026-07-26T12:00:00Z",
    task:{id:"T01",title:"Observe Test",path:"task.md",feature_path:"feature.md",kind:"task"},
    participants:[],
    lifecycle:[{observation_id:"started",observed_at:"2026-07-26T12:00:01Z",kind:"run",goal_id:"run",state:"active",detail:"test"}],
    evidence:[{observation_id:"checked",observed_at:"2026-07-26T12:00:02Z",verifier_id:"V01",state:"passed",command:"true",exit_status:0,implementation_tree:"",artifact_sha256:"",detail:"test"}]
  }
}' | go run ./cmd/vault-hunter-registry >/dev/null

export VAULT_HUNTER_STATE_DIR=$root
"$observer" --help >/dev/null 2>&1
"$observer" list --json | jq -e --arg id "$run_id" 'length == 1 and .[0].run_id == $id' >/dev/null
"$observer" run "$run_id" --json | jq -e --arg id "$run_id" 'length == 1 and .[0].run_id == $id' >/dev/null
"$observer" record "$run_id" | jq -e --arg id "$run_id" '.run_id == $id' >/dev/null
"$observer" registry "$run_id" | jq -e --arg id "$run_id" '.run_id == $id' >/dev/null
"$observer" journey "$run_id" | jq -e 'length == 1 and .[0].stage == "run"' >/dev/null
"$observer" evidence "$run_id" | jq -e 'length == 1 and .[0].verifier_id == "V01"' >/dev/null
"$observer" atlas "$run_id" --snapshot --width 80 --height 24 | grep -q "Run $run_id"

set +e
"$observer" run missing --json >/dev/null 2>&1
status=$?
set -e
[[ $status -eq 66 ]]

echo "vault-hunter-observe commands: PASS"

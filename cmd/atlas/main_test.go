package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestHelpSurface(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := execute([]string{"--help"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit = %d, stderr = %q", code, stderr.String())
	}
	if stdout.String() != usageText {
		t.Fatalf("help mismatch:\n%s", stdout.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("unexpected stderr: %q", stderr.String())
	}
}

func TestLegacyCommandsAreRejected(t *testing.T) {
	for _, args := range [][]string{{"status"}, {"describe"}, {"get", "evidence"}, {"--run-id", "run-a"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := execute(args, &stdout, &stderr); code == 0 {
				t.Fatal("legacy form unexpectedly succeeded")
			}
			if stdout.Len() != 0 {
				t.Fatalf("legacy stdout = %q, want empty", stdout.String())
			}
			if stderr.Len() == 0 || !strings.Contains(stderr.String(), "usage: atlas") {
				t.Fatalf("legacy stderr = %q, want usage", stderr.String())
			}
		})
	}
}

func TestCapabilitiesEnvelope(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := execute([]string{"capabilities", "--output", "json"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit = %d, stderr = %q", code, stderr.String())
	}
	var got map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("json: %v\n%s", err, stdout.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("unexpected stderr: %q", stderr.String())
	}
	if got["api_version"] != "atlas/v1" || got["kind"] != "Capabilities" {
		t.Fatalf("envelope = %#v", got)
	}
	meta, ok := got["meta"].(map[string]any)
	if !ok || len(meta) != 0 {
		t.Fatalf("meta = %#v, want empty object", got["meta"])
	}
	data, ok := got["data"].(map[string]any)
	if !ok {
		t.Fatalf("data = %#v", got["data"])
	}
	if _, ok := data["agent_tools"].([]any); !ok {
		t.Fatalf("agent_tools = %#v", data["agent_tools"])
	}
}

func TestObserveAndGetRunsUseAtlasNameSelectors(t *testing.T) {
	root := t.TempDir()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []vaultregistry.CreateRequest{
		testV2Request("run-a", "release-check", "Build Atlas"),
		testV2Request("run-b", "nightly-check", "Another Run"),
	} {
		if _, err := producer.CreateRun(request); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("VAULT_HUNTER_STATE_DIR", root)
	t.Setenv("ATLAS_VAULT_ROOT", root)

	var observeStdout, observeStderr bytes.Buffer
	if code := execute([]string{"observe", "--name", "release-check"}, &observeStdout, &observeStderr); code != 0 {
		t.Fatalf("observe exit = %d stderr = %q", code, observeStderr.String())
	}
	if !strings.Contains(observeStdout.String(), "run-a\tBuild Atlas") {
		t.Fatalf("observe stdout = %q", observeStdout.String())
	}

	var getStdout, getStderr bytes.Buffer
	if code := execute([]string{"get", "runs", "--id", "run-b"}, &getStdout, &getStderr); code != 0 {
		t.Fatalf("get exit = %d stderr = %q", code, getStderr.String())
	}
	var envelope map[string]any
	if err := json.Unmarshal(getStdout.Bytes(), &envelope); err != nil {
		t.Fatalf("get json: %v", err)
	}
	data := envelope["data"].(map[string]any)
	if data["id"] != "run-b" || data["name"] != "nightly-check" {
		t.Fatalf("data = %#v", data)
	}
}

func testV2Request(runID, name, title string) vaultregistry.CreateRequest {
	observedAt := "2026-07-28T00:00:00Z"
	startedAt := observedAt
	return vaultregistry.CreateRequest{
		Run: vaultregistry.Run{
			SchemaVersion: 2,
			RunID:         runID,
			Name:          name,
			RunKind:       vaultregistry.RunKindHunter,
			WorkReference: &vaultregistry.WorkReference{ID: "T18", Title: title, Path: "tasks/18.md", FeaturePath: "features/atlas.md", Kind: "task"},
			State:         vaultregistry.RunStateActive,
			Stage:         "invoked",
			InvokedAt:     observedAt,
			UpdatedAt:     observedAt,
		},
		InitialDriver: vaultregistry.Observation{
			ObservationID:  "driver-" + runID,
			Kind:           vaultregistry.KindRegisteredParticipant,
			State:          vaultregistry.StateActive,
			GoalID:         "T18.V01",
			Title:          "Driver",
			Summary:        "Registered by cmd/atlas tests.",
			ObservedAt:     observedAt,
			CorrelationID:  runID,
			StartedAt:      &startedAt,
			Actor:          vaultregistry.Identity{Kind: "participant", ID: "driver"},
			Source:         vaultregistry.Identity{Kind: "test", ID: "cmd-atlas"},
			RedactionClass: "internal",
			Payload: vaultregistry.ObservationPayload{RegisteredParticipant: &vaultregistry.RegisteredParticipantPayload{
				ParticipantID: "driver",
				Role:          "driver",
				AgentSession:  vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: runID},
			}},
		},
	}
}

func TestSelectorConflictsFailClosed(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := execute([]string{"observe", "run-a", "--name", "other"}, &stdout, &stderr)
	if code == 0 {
		t.Fatal("selector conflict unexpectedly succeeded")
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", stdout.String())
	}
	if !strings.Contains(stderr.String(), "selector accepts exactly one") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestHiddenRenderRunUsesAtlasBinary(t *testing.T) {
	root := t.TempDir()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := producer.CreateRun(testV2Request("run-a", "release-check", "Build Atlas")); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if code := execute([]string{"render", "run", "--id", "run-a", "--state-dir", root}, &stdout, &stderr); code != 0 {
		t.Fatalf("render exit = %d stderr = %q", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "Run run-a") {
		t.Fatalf("render stdout = %q", stdout.String())
	}
}

func TestT18V04HiddenRenderRunRendersRetiredRuns(t *testing.T) {
	root := t.TempDir()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	created, err := producer.CreateRun(testCompanionRequest("run-retired", "retired-render", "Retired render", "ws-retired"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := producer.Retire(created.RunID, created.Revision); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if code := execute([]string{"render", "run", "--id", "run-retired", "--state-dir", root}, &stdout, &stderr); code != 0 {
		t.Fatalf("retired render exit = %d stderr = %q", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "Run run-retired") {
		t.Fatalf("retired render stdout = %q", stdout.String())
	}
}

func TestT18V04ReviveForcedSelectorsAcrossActiveAndRetired(t *testing.T) {
	for _, tc := range []struct {
		name      string
		args      []string
		wantRunID string
		wantErr   string
	}{
		{name: "forced id prefers active id across namespaces", args: []string{"admin", "companion", "revive", "--id", "selector-shared"}, wantRunID: "selector-shared"},
		{name: "forced name finds retired name across namespaces", args: []string{"admin", "companion", "revive", "--name", "selector-shared"}, wantRunID: "retired-collision"},
		{name: "positional stays ambiguous across id and name namespaces", args: []string{"admin", "companion", "revive", "selector-shared"}, wantErr: "ambiguous run selector"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			producer, err := vaultregistry.OpenProducer(root)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := producer.CreateRun(testCompanionRequest("selector-shared", "active-collision", "Active collision", "ws-active")); err != nil {
				t.Fatal(err)
			}
			retired, err := producer.CreateRun(testCompanionRequest("retired-collision", "selector-shared", "Retired collision", "ws-retired"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := producer.Retire(retired.RunID, retired.Revision); err != nil {
				t.Fatal(err)
			}
			t.Setenv("VAULT_HUNTER_STATE_DIR", root)

			binDir, logPath := installReviveHerdr(t)
			t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

			var stdout, stderr bytes.Buffer
			code := execute(tc.args, &stdout, &stderr)
			if tc.wantErr != "" {
				if code == 0 {
					t.Fatalf("execute(%v) unexpectedly succeeded: %s", tc.args, stdout.String())
				}
				if !strings.Contains(stderr.String(), tc.wantErr) {
					t.Fatalf("stderr = %q, want substring %q", stderr.String(), tc.wantErr)
				}
				if stdout.Len() != 0 {
					t.Fatalf("stdout = %q, want empty", stdout.String())
				}
				return
			}
			if code != 0 {
				t.Fatalf("execute(%v) exit = %d stderr = %q", tc.args, code, stderr.String())
			}
			var envelope map[string]any
			if err := json.Unmarshal(stdout.Bytes(), &envelope); err != nil {
				t.Fatalf("revive json: %v\n%s", err, stdout.String())
			}
			data := envelope["data"].(map[string]any)
			run := data["run"].(map[string]any)
			if run["id"] != tc.wantRunID {
				t.Fatalf("revived run = %#v, want id %q", run, tc.wantRunID)
			}
			logBytes, err := os.ReadFile(logPath)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(logBytes), "\"pane\", \"run\"") || !strings.Contains(string(logBytes), tc.wantRunID) {
				t.Fatalf("revive log missing pane run for %q:\n%s", tc.wantRunID, logBytes)
			}
		})
	}
}

func testCompanionRequest(runID, name, title, workspaceID string) vaultregistry.CreateRequest {
	observedAt := "2026-07-28T00:00:00Z"
	startedAt := observedAt
	herdr := &vaultregistry.HerdrIdentity{WorkspaceID: workspaceID, TabID: "tab-" + runID, PaneID: "pane-" + runID, TerminalID: "term-" + runID}
	return vaultregistry.CreateRequest{
		Run: vaultregistry.Run{
			SchemaVersion: 2,
			RunID:         runID,
			Name:          name,
			RunKind:       vaultregistry.RunKindHunter,
			WorkReference: &vaultregistry.WorkReference{ID: "T18", Title: title, Path: "tasks/18.md", FeaturePath: "features/atlas.md", Kind: "task"},
			State:         vaultregistry.RunStateActive,
			Stage:         "awaiting-parent",
			InvokedAt:     observedAt,
			UpdatedAt:     observedAt,
		},
		InitialDriver: vaultregistry.Observation{
			ObservationID:  "driver-" + runID,
			Kind:           vaultregistry.KindRegisteredParticipant,
			State:          vaultregistry.StateActive,
			GoalID:         "T18.V04",
			Title:          "Driver",
			Summary:        "Registered by cmd/atlas tests.",
			ObservedAt:     observedAt,
			CorrelationID:  runID,
			StartedAt:      &startedAt,
			Actor:          vaultregistry.Identity{Kind: "participant", ID: "driver-" + runID},
			Source:         vaultregistry.Identity{Kind: "test", ID: "cmd-atlas"},
			RedactionClass: "internal",
			Payload: vaultregistry.ObservationPayload{RegisteredParticipant: &vaultregistry.RegisteredParticipantPayload{
				ParticipantID: "driver-" + runID,
				Role:          "driver",
				AgentSession:  vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: runID},
				Herdr:         herdr,
			}},
		},
	}
}

func installReviveHerdr(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	logPath := filepath.Join(dir, "commands.jsonl")
	statePath := filepath.Join(dir, "state.json")
	script := filepath.Join(dir, "herdr")
	const source = `#!/usr/bin/env python3
import json
import os
import shlex
import sys

state_path = os.environ["TEST_HERDR_STATE"]
if os.path.exists(state_path):
    with open(state_path, encoding="utf-8") as handle:
        state = json.load(handle)
else:
    state = {}

with open(os.environ["TEST_HERDR_LOG"], "a", encoding="utf-8") as handle:
    handle.write(json.dumps(sys.argv[1:]) + "\n")

argv = sys.argv[1:]
result = None
if argv[:2] == ["agent", "list"]:
    result = {"type": "agent_list", "agents": []}
elif argv[:2] == ["tab", "list"]:
    workspace = argv[argv.index("--workspace") + 1]
    tabs = []
    if state.get("workspace_id") == workspace:
        tabs.append({"workspace_id": workspace, "tab_id": state["tab_id"], "label": state["label"], "pane_count": 1})
    result = {"type": "tab_list", "tabs": tabs}
elif argv[:2] == ["pane", "list"]:
    workspace = argv[argv.index("--workspace") + 1]
    panes = []
    if state.get("workspace_id") == workspace:
        panes.append({"workspace_id": workspace, "tab_id": state["tab_id"], "pane_id": state["pane_id"], "terminal_id": state["terminal_id"]})
    result = {"type": "pane_list", "panes": panes}
elif argv[:2] == ["tab", "create"]:
    workspace = argv[argv.index("--workspace") + 1]
    label = argv[argv.index("--label") + 1]
    state = {
        "workspace_id": workspace,
        "label": label,
        "tab_id": "created-tab",
        "pane_id": "created-pane",
        "terminal_id": "created-terminal",
    }
    with open(state_path, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
    result = {
        "type": "tab_created",
        "tab": {"workspace_id": workspace, "tab_id": state["tab_id"], "label": label, "pane_count": 1},
        "root_pane": {"workspace_id": workspace, "tab_id": state["tab_id"], "pane_id": state["pane_id"], "terminal_id": state["terminal_id"]},
    }
elif argv[:2] == ["pane", "run"]:
    state["pane_run"] = argv[3]
    with open(state_path, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
    result = {"type": "pane_run", "pane_id": argv[2]}
elif argv[:2] == ["pane", "process-info"]:
    pane_id = argv[argv.index("--pane") + 1]
    processes = []
    command = state.get("pane_run", "")
    if pane_id == state.get("pane_id") and command:
        wrapped = shlex.split(command)
        processes = [{"argv": wrapped}, {"argv": wrapped[4:]}]
    result = {"type": "pane_process_info", "process_info": {"pane_id": pane_id, "foreground_processes": processes}}
elif argv[:2] == ["tab", "close"]:
    result = {"type": "tab_closed", "tab_id": argv[2]}
else:
    raise SystemExit(f"unexpected herdr argv: {argv}")

print(json.dumps({"id": "fake", "result": result}))
`
	if err := os.WriteFile(script, []byte(source), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TEST_HERDR_LOG", logPath)
	t.Setenv("TEST_HERDR_STATE", statePath)
	return dir, logPath
}

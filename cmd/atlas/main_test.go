package main

import (
	"bytes"
	"encoding/json"
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

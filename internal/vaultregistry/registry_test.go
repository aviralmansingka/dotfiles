package vaultregistry_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT01V01RestartUpdateAndUnknownFields(t *testing.T) {
	root := t.TempDir()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	exit := 0
	run := vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         "task_run-01",
		InvokedAt:     "2026-07-26T07:00:00Z",
		UpdatedAt:     "2026-07-26T07:00:00Z",
		Task: vaultregistry.Task{
			ID: "T01", Title: "Build the Run Registry POC", Path: "tasks/01.md",
			FeaturePath: "features/vault-hunter-atlas.md", Kind: "task",
			Unknown: unknown("task_future", `{"nested":{"kept":true}}`),
		},
		Participants: []vaultregistry.Participant{{
			ParticipantID: "driver", ObservedAt: "2026-07-26T07:00:01Z", Role: "producer", GoalID: "goal-1",
			Herdr: &vaultregistry.HerdrIdentity{
				WorkspaceID: "ws", TabID: "tab", PaneID: "pane", TerminalID: "term",
				Unknown: unknown("herdr_future", `{"level":2}`),
			},
			AgentSession: &vaultregistry.AgentSession{
				Source: "codex", Kind: "session", Value: "session-1",
				Unknown: unknown("session_future", `["a",{"b":1}]`),
			},
			Unknown: unknown("participant_future", `{"enabled":true}`),
		}},
		Lifecycle: []vaultregistry.Lifecycle{{
			ObservationID: "life-1", ObservedAt: "2026-07-26T07:00:02Z", Kind: "recorded",
			GoalID: "goal-1", State: "in-progress", Detail: "observation only",
			Unknown: unknown("lifecycle_future", `{"owner":"driver"}`),
		}},
		Evidence: []vaultregistry.Evidence{{
			ObservationID: "evidence-1", ObservedAt: "2026-07-26T07:00:03Z", VerifierID: "T01.V01",
			State: "running", Command: "scripts/verify-vault-hunter-atlas T01.V01", ExitStatus: &exit,
			ImplementationTree: "tree-1", ArtifactSHA256: strings.Repeat("a", 64), Detail: "observation only",
			Unknown: unknown("evidence_future", `{"attempt":1}`),
		}},
		Unknown: unknown("run_future", `{"deep":{"values":[1,2,3]}}`),
	}

	created, err := producer.Create(run)
	if err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 {
		t.Fatalf("create revision = %d, want 1", created.Revision)
	}

	reopenedProducer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}
	fromProducer, err := reopenedProducer.Get(run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	fromReader, err := reader.Get(run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(created, fromProducer) || !reflect.DeepEqual(created, fromReader) {
		t.Fatalf("reopened values differ\ncreated: %#v\nproducer: %#v\nreader: %#v", created, fromProducer, fromReader)
	}

	beforeParticipants := append([]vaultregistry.Participant(nil), fromReader.Participants...)
	beforeLifecycle := append([]vaultregistry.Lifecycle(nil), fromReader.Lifecycle...)
	beforeEvidence := append([]vaultregistry.Evidence(nil), fromReader.Evidence...)
	updated, err := reopenedProducer.Update(run.RunID, 1, func(next *vaultregistry.Run) error {
		next.UpdatedAt = "2026-07-26T07:01:00Z"
		next.Participants = append(next.Participants, vaultregistry.Participant{
			ParticipantID: "reviewer", ObservedAt: "2026-07-26T07:01:01Z", Role: "reviewer",
		})
		next.Lifecycle = append(next.Lifecycle, vaultregistry.Lifecycle{
			ObservationID: "life-2", ObservedAt: "2026-07-26T07:01:02Z", Kind: "recorded", State: "verifying",
		})
		next.Evidence = append(next.Evidence, vaultregistry.Evidence{
			ObservationID: "evidence-2", ObservedAt: "2026-07-26T07:01:03Z", VerifierID: "T01.V01", State: "passed",
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 {
		t.Fatalf("update revision = %d, want 2", updated.Revision)
	}
	if !reflect.DeepEqual(updated.Participants[:1], beforeParticipants) ||
		!reflect.DeepEqual(updated.Lifecycle[:1], beforeLifecycle) ||
		!reflect.DeepEqual(updated.Evidence[:1], beforeEvidence) {
		t.Fatal("update did not preserve history prefixes")
	}
	finalReader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := finalReader.Get(run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(updated, reloaded) {
		t.Fatalf("updated value did not survive restart\nupdated: %#v\nreloaded: %#v", updated, reloaded)
	}

	path := filepath.Join(root, "runs", run.RunID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 || data[len(data)-1] != '\n' {
		t.Fatal("persisted JSON lacks trailing newline")
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("run mode = %v, err = %v; want 0600", info.Mode().Perm(), err)
	}
	for _, marker := range []string{
		"run_future", "task_future", "participant_future", "herdr_future",
		"session_future", "lifecycle_future", "evidence_future",
	} {
		if !strings.Contains(string(data), `"`+marker+`"`) {
			t.Fatalf("persisted JSON lost nested unknown field %q", marker)
		}
	}
}

func unknown(key, value string) map[string]json.RawMessage {
	return map[string]json.RawMessage{key: json.RawMessage(value)}
}

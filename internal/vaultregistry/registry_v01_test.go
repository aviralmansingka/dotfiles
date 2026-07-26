package vaultregistry_test

import (
	"errors"
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

	path := filepath.Join(root, "runs", run.RunID+".json")
	beforeRetarget, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopenedProducer.Update(run.RunID, 1, func(next *vaultregistry.Run) error {
		next.Task.ID = "T02"
		next.Task.Path = "tasks/02.md"
		return nil
	}); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("Task retarget error = %v, want ErrMalformed", err)
	}
	afterRetarget, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(afterRetarget, beforeRetarget) {
		t.Fatal("rejected Task retarget changed persisted bytes")
	}
	afterRetargetRun, err := reader.Get(run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(afterRetargetRun, created) {
		t.Fatalf("rejected Task retarget changed persisted value\ncreated: %#v\nafter: %#v", created, afterRetargetRun)
	}

	rejectedMutations := []struct {
		name   string
		mutate func(*vaultregistry.Run)
	}{
		{"InvokedAt change", func(next *vaultregistry.Run) {
			next.InvokedAt = "2026-07-26T07:00:01Z"
		}},
		{"Run unknown erase", func(next *vaultregistry.Run) {
			next.Unknown = nil
		}},
		{"Run unknown replace", func(next *vaultregistry.Run) {
			next.Unknown = unknown("run_future", `{"replacement":true}`)
		}},
		{"Task unknown erase", func(next *vaultregistry.Run) {
			next.Task.Unknown = nil
		}},
		{"Task unknown replace", func(next *vaultregistry.Run) {
			next.Task.Unknown = unknown("task_future", `{"replacement":true}`)
		}},
	}
	for _, tc := range rejectedMutations {
		t.Run(tc.name, func(t *testing.T) {
			mutationRoot := t.TempDir()
			mutationProducer, err := vaultregistry.OpenProducer(mutationRoot)
			if err != nil {
				t.Fatal(err)
			}
			mutationCreated, err := mutationProducer.Create(run)
			if err != nil {
				t.Fatal(err)
			}
			mutationReader, err := vaultregistry.OpenReader(mutationRoot)
			if err != nil {
				t.Fatal(err)
			}
			mutationPath := filepath.Join(mutationRoot, "runs", run.RunID+".json")
			beforeMutation, err := os.ReadFile(mutationPath)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := mutationProducer.Update(run.RunID, mutationCreated.Revision, func(next *vaultregistry.Run) error {
				tc.mutate(next)
				return nil
			}); !errors.Is(err, vaultregistry.ErrMalformed) {
				t.Fatalf("Update error = %v, want ErrMalformed", err)
			}
			afterMutation, err := os.ReadFile(mutationPath)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(afterMutation, beforeMutation) {
				t.Fatal("rejected mutation changed persisted bytes")
			}
			afterMutationRun, err := mutationReader.Get(run.RunID)
			if err != nil {
				t.Fatal(err)
			}
			if afterMutationRun.Revision != mutationCreated.Revision {
				t.Fatalf("rejected mutation revision = %d, want %d", afterMutationRun.Revision, mutationCreated.Revision)
			}
			if !reflect.DeepEqual(afterMutationRun, mutationCreated) {
				t.Fatalf("rejected mutation changed persisted value\ncreated: %#v\nafter: %#v", mutationCreated, afterMutationRun)
			}
		})
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

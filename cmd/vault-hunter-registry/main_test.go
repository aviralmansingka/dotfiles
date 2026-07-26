package main

import (
	"errors"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestCreateAndIdempotentAppend(t *testing.T) {
	producer, err := vaultregistry.OpenProducer(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         "vh-T01-1",
		InvokedAt:     "2026-07-26T12:00:00Z",
		UpdatedAt:     "2026-07-26T12:00:00Z",
		Task: vaultregistry.Task{
			ID: "T01", Title: "Test", Path: "task.md", FeaturePath: "feature.md", Kind: "task",
		},
	}
	created, err := create(producer, &run)
	if err != nil || created.Revision != 1 {
		t.Fatalf("create: revision=%d err=%v", created.Revision, err)
	}
	participant := vaultregistry.Participant{
		ParticipantID: "subagent-run-1", ObservedAt: "2026-07-26T12:01:00Z", Role: "observer", GoalID: "context",
		AgentSession: &vaultregistry.AgentSession{Source: "pi-subagents", Kind: "async-run", Value: "run-1"},
	}
	lifecycle := vaultregistry.Lifecycle{
		ObservationID: "subagent-run-1-started", ObservedAt: participant.ObservedAt, Kind: "worker", GoalID: "context", State: "active",
	}
	req := request{Action: "append", RunID: run.RunID, UpdatedAt: participant.ObservedAt, Participant: &participant, Lifecycle: &lifecycle}
	first, err := appendObservation(producer, req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := appendObservation(producer, req)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != 2 || second.Revision != 2 || len(second.Participants) != 1 || len(second.Lifecycle) != 1 {
		t.Fatalf("append was not idempotent: first=%d second=%d participants=%d lifecycle=%d", first.Revision, second.Revision, len(second.Participants), len(second.Lifecycle))
	}
}

func TestAppendRejectsIdentityCollisionsAndKeepsNewestUpdateTime(t *testing.T) {
	producer, err := vaultregistry.OpenProducer(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := vaultregistry.Run{
		SchemaVersion: 1, RunID: "vh-T01-1", InvokedAt: "2026-07-26T12:00:00Z", UpdatedAt: "2026-07-26T12:00:00Z",
		Task: vaultregistry.Task{ID: "T01", Title: "Test", Path: "task.md", FeaturePath: "feature.md", Kind: "task"},
	}
	if _, err := create(producer, &run); err != nil {
		t.Fatal(err)
	}
	lifecycle := vaultregistry.Lifecycle{ObservationID: "event-1", ObservedAt: "2026-07-26T12:02:00Z", Kind: "worker", State: "done", Detail: "original"}
	if _, err := appendObservation(producer, request{RunID: run.RunID, UpdatedAt: lifecycle.ObservedAt, Lifecycle: &lifecycle}); err != nil {
		t.Fatal(err)
	}
	conflict := lifecycle
	conflict.State = "failed"
	if _, err := appendObservation(producer, request{RunID: run.RunID, UpdatedAt: lifecycle.ObservedAt, Lifecycle: &conflict}); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("expected lifecycle collision, got %v", err)
	}
	evidence := vaultregistry.Evidence{ObservationID: "evidence-1", ObservedAt: "2026-07-26T12:01:00Z", VerifierID: "V01", State: "passed"}
	got, err := appendObservation(producer, request{RunID: run.RunID, UpdatedAt: evidence.ObservedAt, Evidence: &evidence})
	if err != nil {
		t.Fatal(err)
	}
	if got.UpdatedAt != lifecycle.ObservedAt {
		t.Fatalf("updated_at regressed to %s", got.UpdatedAt)
	}
	evidenceConflict := evidence
	evidenceConflict.State = "failed"
	if _, err := appendObservation(producer, request{RunID: run.RunID, UpdatedAt: evidence.ObservedAt, Evidence: &evidenceConflict}); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("expected evidence collision, got %v", err)
	}
	participant := vaultregistry.Participant{ParticipantID: "agent-1", ObservedAt: "2026-07-26T12:03:00Z", Role: "reviewer"}
	if _, err := appendObservation(producer, request{RunID: run.RunID, UpdatedAt: participant.ObservedAt, Participant: &participant}); err != nil {
		t.Fatal(err)
	}
	participantConflict := participant
	participantConflict.Role = "writer"
	if _, err := appendObservation(producer, request{RunID: run.RunID, UpdatedAt: participant.ObservedAt, Participant: &participantConflict}); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("expected participant collision, got %v", err)
	}
}

func TestCreateRejectsDifferentIdentity(t *testing.T) {
	producer, err := vaultregistry.OpenProducer(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := vaultregistry.Run{
		SchemaVersion: 1, RunID: "vh-T01-1", InvokedAt: "2026-07-26T12:00:00Z", UpdatedAt: "2026-07-26T12:00:00Z",
		Task: vaultregistry.Task{ID: "T01", Title: "Test", Path: "task.md", FeaturePath: "feature.md", Kind: "task"},
	}
	if _, err := create(producer, &run); err != nil {
		t.Fatal(err)
	}
	run.Task.Path = "other.md"
	if _, err := create(producer, &run); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
}

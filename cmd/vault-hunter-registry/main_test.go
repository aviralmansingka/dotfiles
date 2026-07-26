package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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
	req := request{RunID: run.RunID, UpdatedAt: participant.ObservedAt, Participant: &participant, Lifecycle: &lifecycle}
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

func TestListUsesReaderAndDoesNotCreateState(t *testing.T) {
	root := filepath.Join(t.TempDir(), "absent")
	input := bytes.NewBufferString(`{"action":"list","root":"` + root + `"}`)
	var output bytes.Buffer
	if err := serve(input, &output); err != nil {
		t.Fatal(err)
	}
	if output.String() != "[]\n" {
		t.Fatalf("list output = %q, want []", output.String())
	}
	if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("list created state: %v", err)
	}
}

func TestAdministrationRequestsAreStrictBeforeOpeningStorage(t *testing.T) {
	root := filepath.Join(t.TempDir(), "absent")
	for _, input := range []string{
		`{"action":"list","root":"` + root + `","run_id":"wrong"}`,
		`{"action":"get","root":"` + root + `","namespace":"retired"}`,
		`{"action":"get","root":"` + root + `","run_id":"run","namespace":"unknown"}`,
		`{"action":"get_retired","root":"` + root + `","run_id":"run"}`,
		`{"action":"retire","root":"` + root + `","run_id":"run","expected_revision":"1"}`,
		`{"action":"retire","root":"` + root + `","run_id":"run","expected_revision":1,"extra":true}`,
		`{"action":"list","root":"` + root + `"}{"action":"list","root":"` + root + `"}`,
	} {
		var output bytes.Buffer
		if err := serve(bytes.NewBufferString(input), &output); !errors.Is(err, errMalformedRequest) {
			t.Fatalf("serve(%s) error = %v, want malformed request", input, err)
		}
		if output.Len() != 0 {
			t.Fatalf("malformed request emitted output %q", output.String())
		}
		if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("malformed request opened storage: %v", err)
		}
	}
}

func TestRetireAndExplicitRetiredGetKeepActiveGetSeparate(t *testing.T) {
	root := t.TempDir()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	run := vaultregistry.Run{
		SchemaVersion: 1, RunID: "retire-me", InvokedAt: "2026-07-26T12:00:00Z", UpdatedAt: "2026-07-26T12:00:00Z",
		Task: vaultregistry.Task{ID: "T09", Title: "Retire", Path: "task.md", FeaturePath: "feature.md", Kind: "task"},
	}
	created, err := producer.Create(run)
	if err != nil {
		t.Fatal(err)
	}

	var retiredOutput bytes.Buffer
	retireInput := `{"action":"retire","root":"` + root + `","run_id":"retire-me","expected_revision":1}`
	if err := serve(bytes.NewBufferString(retireInput), &retiredOutput); err != nil {
		t.Fatal(err)
	}
	var retired vaultregistry.Run
	if err := json.Unmarshal(retiredOutput.Bytes(), &retired); err != nil {
		t.Fatal(err)
	}
	if retired.RunID != created.RunID || retired.Revision != created.Revision {
		t.Fatalf("retire response = %#v, want %#v", retired, created)
	}

	var activeOutput bytes.Buffer
	activeInput := `{"action":"get","root":"` + root + `","run_id":"retire-me"}`
	if err := serve(bytes.NewBufferString(activeInput), &activeOutput); !errors.Is(err, vaultregistry.ErrNotFound) {
		t.Fatalf("active get error = %v, want not found", err)
	}
	var explicitOutput bytes.Buffer
	explicitInput := `{"action":"get","root":"` + root + `","run_id":"retire-me","namespace":"retired"}`
	if err := serve(bytes.NewBufferString(explicitInput), &explicitOutput); err != nil {
		t.Fatal(err)
	}
	var explicit vaultregistry.Run
	if err := json.Unmarshal(explicitOutput.Bytes(), &explicit); err != nil {
		t.Fatal(err)
	}
	if explicit.RunID != created.RunID || explicit.Revision != created.Revision {
		t.Fatalf("retired get response = %#v, want %#v", explicit, created)
	}
}

func TestListErrorEmitsNoPartialOutput(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "runs"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "runs", "broken.json"), []byte("{not-json\n"), 0600); err != nil {
		t.Fatal(err)
	}
	input := bytes.NewBufferString(`{"action":"list","root":"` + root + `","filter":{"task_id":"NO-MATCH"}}`)
	var output bytes.Buffer
	if err := serve(input, &output); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("serve error = %v, want ErrMalformed", err)
	}
	if output.Len() != 0 {
		t.Fatalf("list error emitted partial output %q", output.String())
	}
}

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

func TestAppendObservationCommandWritesStrictV2AndReplaysIdempotently(t *testing.T) {
	root := t.TempDir()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	started := "2026-07-28T12:00:00Z"
	session := vaultregistry.AgentSession{Source: "herdr:pi", Kind: "path", Value: "/tmp/driver.jsonl"}
	driver := vaultregistry.Observation{
		ObservationID: "driver-started", Kind: vaultregistry.KindRegisteredParticipant, State: vaultregistry.StateActive,
		GoalID: "run", Title: "driver started", Summary: "driver started.", ObservedAt: started, CorrelationID: "crew-v2",
		Actor:  vaultregistry.Identity{Kind: "participant", ID: "driver", AgentSession: &session},
		Source: vaultregistry.Identity{Kind: "producer", ID: "test"}, RedactionClass: "internal", StartedAt: &started,
		Payload: vaultregistry.ObservationPayload{RegisteredParticipant: &vaultregistry.RegisteredParticipantPayload{
			ParticipantID: "driver", Role: "driver", AgentSession: session,
		}},
	}
	run := vaultregistry.Run{
		SchemaVersion: 2, RunID: "crew-v2", Name: "crew-v2", RunKind: vaultregistry.RunKindHunter,
		WorkReference: &vaultregistry.WorkReference{ID: "T01", Title: "Crew", Path: "task.md", FeaturePath: "feature.md", Kind: "task"},
		Revision:      0, State: vaultregistry.RunStateActive, Stage: "invoked", InvokedAt: started, UpdatedAt: started,
	}
	created, err := producer.CreateRun(vaultregistry.CreateRequest{Run: run, InitialDriver: driver})
	if err != nil {
		t.Fatal(err)
	}
	observed := "2026-07-28T12:01:00Z"
	childSession := vaultregistry.AgentSession{Source: "herdr:pi", Kind: "path", Value: "/tmp/child.jsonl"}
	observation := vaultregistry.Observation{
		ObservationID: "child-started", Kind: vaultregistry.KindRegisteredParticipant, State: vaultregistry.StateActive,
		GoalID: "G01", Title: "child started", Summary: "child started.", ObservedAt: observed, CorrelationID: run.RunID,
		Actor:  vaultregistry.Identity{Kind: "participant", ID: "child", AgentSession: &childSession},
		Source: vaultregistry.Identity{Kind: "producer", ID: "vault-hunter-crew"}, RedactionClass: "internal", StartedAt: &observed,
		Payload: vaultregistry.ObservationPayload{RegisteredParticipant: &vaultregistry.RegisteredParticipantPayload{
			ParticipantID: "child", Role: "verifier-builder", AgentSession: childSession,
		}},
	}
	request := map[string]any{
		"action": "append_observation", "root": root, "run_id": run.RunID,
		"expected_revision": created.Revision, "updated_at": observed, "observation": observation,
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var firstOutput bytes.Buffer
	if err := serve(bytes.NewReader(encoded), &firstOutput); err != nil {
		t.Fatal(err)
	}
	var first vaultregistry.Run
	if err := json.Unmarshal(firstOutput.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.Revision != 2 || len(first.Observations) != 2 {
		t.Fatalf("first append = revision %d observations %d", first.Revision, len(first.Observations))
	}
	var replayOutput bytes.Buffer
	if err := serve(bytes.NewReader(encoded), &replayOutput); err != nil {
		t.Fatal(err)
	}
	var replay vaultregistry.Run
	if err := json.Unmarshal(replayOutput.Bytes(), &replay); err != nil {
		t.Fatal(err)
	}
	if replay.Revision != first.Revision || len(replay.Observations) != len(first.Observations) {
		t.Fatalf("replay changed Run: %#v", replay)
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
		`{"action":"append_observation","root":"` + root + `","run_id":"run","updated_at":"2026-07-28T00:00:00Z","observation":{}}`,
		`{"action":"append_observation","root":"` + root + `","run_id":"run","expected_revision":1,"updated_at":"2026-07-28T00:00:00Z","observation":{},"extra":true}`,
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

func TestRetireMissingRegistryDoesNotCreateState(t *testing.T) {
	for _, existing := range []bool{false, true} {
		root := filepath.Join(t.TempDir(), "registry")
		if existing {
			if err := os.MkdirAll(filepath.Join(root, "runs"), 0750); err != nil {
				t.Fatal(err)
			}
		}
		input := `{"action":"retire","root":"` + root + `","run_id":"missing","expected_revision":1}`
		var output bytes.Buffer
		if err := serve(bytes.NewBufferString(input), &output); !errors.Is(err, vaultregistry.ErrNotFound) {
			t.Fatalf("retire missing Registry error = %v, want ErrNotFound", err)
		}
		if output.Len() != 0 {
			t.Fatalf("retire missing Registry emitted output %q", output.String())
		}
		if !existing {
			if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("retire created absent Registry: %v", err)
			}
			continue
		}
		entries, err := os.ReadDir(root)
		if err != nil || len(entries) != 1 || entries[0].Name() != "runs" {
			t.Fatalf("retire changed empty Registry: entries=%v err=%v", entries, err)
		}
		for _, path := range []string{root, filepath.Join(root, "runs")} {
			info, err := os.Stat(path)
			if err != nil || info.Mode().Perm() != 0750 {
				t.Fatalf("retire changed %s mode: %v, %v", path, info, err)
			}
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

func TestT20V02ReaderAdapterSelectorsAndParticipantFilter(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "runs"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"t20-v02-version-1.json", "t20-v02-reconciled-version-2.json"} {
		data, err := os.ReadFile(filepath.Join("../../scripts/fixtures/vault-hunter-registry-v2", name))
		if err != nil {
			t.Fatal(err)
		}
		var identity struct {
			RunID string `json:"run_id"`
		}
		if err := json.Unmarshal(data, &identity); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "runs", identity.RunID+".json"), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "registry.lock"), nil, 0600); err != nil {
		t.Fatal(err)
	}

	var exact bytes.Buffer
	if err := serve(bytes.NewBufferString(`{"action":"get","root":"`+root+`","run_id":"shared-selector"}`), &exact); err != nil {
		t.Fatal(err)
	}
	var run vaultregistry.Run
	if err := json.Unmarshal(exact.Bytes(), &run); err != nil || run.RunID != "t20-v02-reconciled-version-2" {
		t.Fatalf("name get = %#v, %v", run, err)
	}

	var listed bytes.Buffer
	input := `{"action":"list","root":"` + root + `","filter":{"participant_id":"v1-driver","agent_session":{"source":"pi","kind":"session","value":"v1-session"}}}`
	if err := serve(bytes.NewBufferString(input), &listed); err != nil {
		t.Fatal(err)
	}
	var summaries []vaultregistry.RunSummary
	if err := json.Unmarshal(listed.Bytes(), &summaries); err != nil || len(summaries) != 1 || summaries[0].RunID != "t20-v02-version-1" {
		t.Fatalf("filtered list = %#v, %v", summaries, err)
	}
}

func TestT20V01AtomicCreateAdapter(t *testing.T) {
	fixture, err := os.ReadFile("../../scripts/fixtures/vault-hunter-registry-v2/t20-v01-hunter-create.json")
	if err != nil {
		t.Fatal(err)
	}
	var request map[string]any
	if err := json.Unmarshal(fixture, &request); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	request["action"], request["root"] = "create", root
	encode := func(value any) []byte {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}

	var first bytes.Buffer
	if err := serve(bytes.NewReader(encode(request)), &first); err != nil {
		t.Fatal(err)
	}
	golden, err := os.ReadFile("../../scripts/goldens/vault-hunter-registry-v2/t20-v01-hunter-response.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first.Bytes(), golden) {
		t.Fatalf("response differs from golden\nactual: %s\ngolden: %s", first.Bytes(), golden)
	}
	path := filepath.Join(root, "runs", "run-hunter-043.json")
	stable, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	var replay bytes.Buffer
	if err := serve(bytes.NewReader(encode(request)), &replay); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(replay.Bytes(), golden) || !bytes.Equal(after, stable) {
		t.Fatal("adapter replay wrote bytes or changed response")
	}

	conflict := map[string]any{}
	if err := json.Unmarshal(encode(request), &conflict); err != nil {
		t.Fatal(err)
	}
	driver := conflict["initial_driver"].(map[string]any)
	payload := driver["payload"].(map[string]any)
	participant := payload["registered_participant"].(map[string]any)
	participant["participant_id"] = "different-driver"
	var output bytes.Buffer
	if err := serve(bytes.NewReader(encode(conflict)), &output); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("conflicting adapter replay error = %v, want ErrConflict", err)
	}
	after, _ = os.ReadFile(path)
	if output.Len() != 0 || !bytes.Equal(after, stable) {
		t.Fatal("failed adapter create emitted output or changed Run bytes")
	}
}

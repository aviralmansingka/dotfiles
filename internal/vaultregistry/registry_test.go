package vaultregistry_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
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

func TestT01V02RejectsPartialParticipantIdentities(t *testing.T) {
	cases := []struct {
		name   string
		change func(*vaultregistry.Participant)
	}{
		{"herdr_workspace", func(p *vaultregistry.Participant) {
			p.Herdr = &vaultregistry.HerdrIdentity{TabID: "tab", PaneID: "pane", TerminalID: "term"}
		}},
		{"herdr_tab", func(p *vaultregistry.Participant) {
			p.Herdr = &vaultregistry.HerdrIdentity{WorkspaceID: "ws", PaneID: "pane", TerminalID: "term"}
		}},
		{"herdr_pane", func(p *vaultregistry.Participant) {
			p.Herdr = &vaultregistry.HerdrIdentity{WorkspaceID: "ws", TabID: "tab", TerminalID: "term"}
		}},
		{"herdr_terminal", func(p *vaultregistry.Participant) {
			p.Herdr = &vaultregistry.HerdrIdentity{WorkspaceID: "ws", TabID: "tab", PaneID: "pane"}
		}},
		{"session_source", func(p *vaultregistry.Participant) {
			p.AgentSession = &vaultregistry.AgentSession{Kind: "session", Value: "session-1"}
		}},
		{"session_kind", func(p *vaultregistry.Participant) {
			p.AgentSession = &vaultregistry.AgentSession{Source: "codex", Value: "session-1"}
		}},
		{"session_value", func(p *vaultregistry.Participant) {
			p.AgentSession = &vaultregistry.AgentSession{Source: "codex", Kind: "session"}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name+"/create", func(t *testing.T) {
			root := t.TempDir()
			producer, err := vaultregistry.OpenProducer(root)
			if err != nil {
				t.Fatal(err)
			}
			run := baseRun("partial_create")
			run.Participants = []vaultregistry.Participant{baseParticipant()}
			tc.change(&run.Participants[0])
			if _, err := producer.Create(run); !errors.Is(err, vaultregistry.ErrMalformed) {
				t.Fatalf("Create error = %v, want ErrMalformed", err)
			}
		})
		t.Run(tc.name+"/read", func(t *testing.T) {
			root := t.TempDir()
			runs := filepath.Join(root, "runs")
			if err := os.MkdirAll(runs, 0700); err != nil {
				t.Fatal(err)
			}
			run := baseRun("partial_read")
			run.Revision = 1
			run.Participants = []vaultregistry.Participant{baseParticipant()}
			tc.change(&run.Participants[0])
			before, err := json.Marshal(run)
			if err != nil {
				t.Fatal(err)
			}
			before = append(before, '\n')
			path := filepath.Join(runs, run.RunID+".json")
			if err := os.WriteFile(path, before, 0600); err != nil {
				t.Fatal(err)
			}
			reader, err := vaultregistry.OpenReader(root)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := reader.Get(run.RunID); !errors.Is(err, vaultregistry.ErrMalformed) {
				t.Fatalf("Get error = %v, want ErrMalformed", err)
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(after, before) {
				t.Fatal("failed read changed source bytes")
			}
		})
	}
}

func TestT01V02ConcurrentUpdateAndAtomicRead(t *testing.T) {
	root := t.TempDir()
	first, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}
	old, err := first.Create(baseRun("concurrent_run"))
	if err != nil {
		t.Fatal(err)
	}
	newA := old
	newA.Revision = 2
	newA.UpdatedAt = "2026-07-26T08:01:00Z"
	newA.Unknown = unknown("winner", `"A"`)
	newB := newA
	newB.Unknown = unknown("winner", `"B"`)

	start := make(chan struct{})
	done := make(chan struct{})
	readerReady := make(chan struct{})
	results := make(chan error, 2)
	var writers sync.WaitGroup
	for i, producer := range []*vaultregistry.Producer{first, second} {
		writers.Add(1)
		go func(i int, producer *vaultregistry.Producer) {
			defer writers.Done()
			<-start
			_, err := producer.Update(old.RunID, old.Revision, func(next *vaultregistry.Run) error {
				next.UpdatedAt = "2026-07-26T08:01:00Z"
				next.Unknown = unknown("winner", []string{`"A"`, `"B"`}[i])
				return nil
			})
			results <- err
		}(i, producer)
	}

	readErr := make(chan error, 1)
	go func() {
		ready := false
		for {
			got, err := reader.Get(old.RunID)
			if err != nil {
				readErr <- err
				return
			}
			if !ready {
				close(readerReady)
				ready = true
			}
			if !reflect.DeepEqual(got, old) && !reflect.DeepEqual(got, newA) && !reflect.DeepEqual(got, newB) {
				readErr <- errors.New("reader observed neither complete old nor complete new document")
				return
			}
			select {
			case <-done:
				readErr <- nil
				return
			default:
			}
		}
	}()
	<-readerReady
	close(start)

	writers.Wait()
	close(done)
	close(results)
	var successes, conflicts int
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, vaultregistry.ErrConflict):
			conflicts++
		default:
			t.Fatalf("update error = %v, want nil or ErrConflict", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes = %d, conflicts = %d; want 1 each", successes, conflicts)
	}
	if err := <-readErr; err != nil {
		t.Fatal(err)
	}
	final, err := reader.Get(old.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(final, newA) && !reflect.DeepEqual(final, newB) {
		t.Fatalf("committed document = %#v, want one complete revision 2 document", final)
	}
}

func TestT01V02ClassifiedReadsPreserveBytes(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "runs"), 0700); err != nil {
		t.Fatal(err)
	}
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		id   string
		data []byte
		want error
	}{
		{"malformed", []byte(`{"schema_version":`), vaultregistry.ErrMalformed},
		{"unsupported", []byte("{\"schema_version\":2}\n"), vaultregistry.ErrUnsupportedVersion},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			path := filepath.Join(root, "runs", tc.id+".json")
			if err := os.WriteFile(path, tc.data, 0600); err != nil {
				t.Fatal(err)
			}
			_, err := reader.Get(tc.id)
			if !errors.Is(err, tc.want) {
				t.Fatalf("Get error = %v, want %v", err, tc.want)
			}
			after, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if !reflect.DeepEqual(after, tc.data) {
				t.Fatal("failed read changed source bytes")
			}
		})
	}
}

func baseRun(id string) vaultregistry.Run {
	return vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         id,
		InvokedAt:     "2026-07-26T08:00:00Z",
		UpdatedAt:     "2026-07-26T08:00:00Z",
		Task: vaultregistry.Task{
			ID: "T01", Title: "Build the Run Registry POC", Path: "tasks/01.md",
			FeaturePath: "features/vault-hunter-atlas.md", Kind: "task",
		},
	}
}

func baseParticipant() vaultregistry.Participant {
	return vaultregistry.Participant{
		ParticipantID: "driver",
		ObservedAt:    "2026-07-26T08:00:01Z",
		Role:          "producer",
	}
}

func unknown(key, value string) map[string]json.RawMessage {
	return map[string]json.RawMessage{key: json.RawMessage(value)}
}

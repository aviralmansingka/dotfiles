package vaultregistry_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT01V02RejectsPartialParticipantIdentities(t *testing.T) {
	for _, tc := range partialIdentityCases() {
		t.Run(tc.name+"/create", func(t *testing.T) { rejectPartialCreate(t, tc.change) })
		t.Run(tc.name+"/read", func(t *testing.T) { rejectPartialRead(t, tc.change) })
	}
}

type identityCase struct {
	name   string
	change func(*vaultregistry.Participant)
}

func partialIdentityCases() []identityCase {
	return []identityCase{
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
}

func rejectPartialCreate(t *testing.T, change func(*vaultregistry.Participant)) {
	producer, err := vaultregistry.OpenProducer(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := baseRun("partial_create")
	run.Participants = []vaultregistry.Participant{baseParticipant()}
	change(&run.Participants[0])
	if _, err := producer.Create(run); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("Create error = %v, want ErrMalformed", err)
	}
}

func rejectPartialRead(t *testing.T, change func(*vaultregistry.Participant)) {
	runs := filepath.Join(t.TempDir(), "runs")
	if err := os.MkdirAll(runs, 0700); err != nil {
		t.Fatal(err)
	}
	run := baseRun("partial_read")
	run.Revision = 1
	run.Participants = []vaultregistry.Participant{baseParticipant()}
	change(&run.Participants[0])
	before, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	before = append(before, '\n')
	path := filepath.Join(runs, run.RunID+".json")
	if err = os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	reader, err := vaultregistry.OpenReader(filepath.Dir(runs))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reader.Get(run.RunID); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("Get error = %v, want ErrMalformed", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !reflect.DeepEqual(after, before) {
		t.Fatalf("failed read changed source bytes: %v", err)
	}
}

func TestT01V02ConcurrentUpdateAndAtomicRead(t *testing.T) {
	root := t.TempDir()
	first := mustProducer(t, root)
	second := mustProducer(t, root)
	reader := mustReader(t, root)
	old, err := first.Create(baseRun("concurrent_run"))
	if err != nil {
		t.Fatal(err)
	}
	newA, newB := winningRuns(old)
	start, done := make(chan struct{}), make(chan struct{})
	results := startWriters(first, second, old, start)
	readErr, ready := watchReads(reader, old, newA, newB, done)
	<-ready
	close(start)
	checkWriterResults(t, results)
	close(done)
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

func winningRuns(old vaultregistry.Run) (vaultregistry.Run, vaultregistry.Run) {
	newA := old
	newA.Revision = 2
	newA.UpdatedAt = "2026-07-26T08:01:00Z"
	newA.Unknown = unknown("winner", `"A"`)
	newB := newA
	newB.Unknown = unknown("winner", `"B"`)
	return newA, newB
}

func startWriters(first, second *vaultregistry.Producer, old vaultregistry.Run, start <-chan struct{}) <-chan error {
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
	go func() {
		writers.Wait()
		close(results)
	}()
	return results
}

func watchReads(reader *vaultregistry.Reader, old, newA, newB vaultregistry.Run, done <-chan struct{}) (<-chan error, <-chan struct{}) {
	readErr := make(chan error, 1)
	ready := make(chan struct{})
	go func() {
		firstRead := true
		for {
			got, err := reader.Get(old.RunID)
			if err != nil {
				readErr <- err
				return
			}
			if firstRead {
				close(ready)
				firstRead = false
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
	return readErr, ready
}

func checkWriterResults(t *testing.T, results <-chan error) {
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
}

func mustProducer(t *testing.T, root string) *vaultregistry.Producer {
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	return producer
}

func mustReader(t *testing.T, root string) *vaultregistry.Reader {
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}
	return reader
}

func TestT01V02ClassifiedReadsPreserveBytes(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "runs"), 0700); err != nil {
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
			assertClassifiedRead(t, root, tc.id, tc.data, tc.want)
		})
	}
}

func assertClassifiedRead(t *testing.T, root, id string, data []byte, want error) {
	path := filepath.Join(root, "runs", id+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	_, err := mustReader(t, root).Get(id)
	if !errors.Is(err, want) {
		t.Fatalf("Get error = %v, want %v", err, want)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, data) {
		t.Fatal("failed read changed source bytes")
	}
}

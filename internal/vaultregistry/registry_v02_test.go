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

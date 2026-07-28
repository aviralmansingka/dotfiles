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
	cases := []struct {
		id   string
		data []byte
		want error
	}{
		{"malformed", []byte(`{"schema_version":`), vaultregistry.ErrMalformed},
		{"unsupported", []byte("{\"schema_version\":3}\n"), vaultregistry.ErrUnsupportedVersion},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			root := t.TempDir()
			if err := os.MkdirAll(filepath.Join(root, "runs"), 0700); err != nil {
				t.Fatal(err)
			}
			assertClassifiedRead(t, root, tc.id, tc.data, tc.want)
		})
	}
}

func assertClassifiedRead(t *testing.T, root, id string, data []byte, want error) {
	mustRegistryLock(t, root)
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

func TestT01ListDeterministicSummariesAndFilters(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	for _, run := range []vaultregistry.Run{
		listRun("z-run", "T02", "features/two.md", "2026-07-26T12:00:00Z", vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: "z"}),
		listRun("a-run", "T01", "features/one.md", "2026-07-26T10:00:00Z", vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: "a"}),
		listRun("m-run", "T01", "features/one.md", "2026-07-26T11:00:00Z", vaultregistry.AgentSession{Source: "codex", Kind: "session", Value: "m"}),
	} {
		if _, err := producer.Create(run); err != nil {
			t.Fatal(err)
		}
	}
	reader := mustReader(t, root)
	all, err := reader.ListSummaries(vaultregistry.ListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if got := summaryIDs(all); !reflect.DeepEqual(got, []string{"a-run", "m-run", "z-run"}) {
		t.Fatalf("List order = %v", got)
	}
	if all[0].Task.ID != "T01" || all[0].Revision != 1 || all[0].UpdatedAt != "2026-07-26T10:00:00Z" {
		t.Fatalf("summary = %#v", all[0])
	}

	cases := []struct {
		name   string
		filter vaultregistry.ListFilter
		want   []string
	}{
		{"task exact", vaultregistry.ListFilter{TaskID: "T01"}, []string{"a-run", "m-run"}},
		{"task not prefix", vaultregistry.ListFilter{TaskID: "T0"}, []string{}},
		{"feature exact", vaultregistry.ListFilter{FeaturePath: "features/two.md"}, []string{"z-run"}},
		{"session exact", vaultregistry.ListFilter{AgentSession: &vaultregistry.AgentSession{Source: "codex", Kind: "session", Value: "m"}}, []string{"m-run"}},
		{"from inclusive", vaultregistry.ListFilter{UpdatedAtFrom: "2026-07-26T11:00:00Z"}, []string{"m-run", "z-run"}},
		{"to inclusive", vaultregistry.ListFilter{UpdatedAtTo: "2026-07-26T11:00:00Z"}, []string{"a-run", "m-run"}},
		{"closed range", vaultregistry.ListFilter{UpdatedAtFrom: "2026-07-26T11:00:00Z", UpdatedAtTo: "2026-07-26T11:00:00Z"}, []string{"m-run"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := reader.ListSummaries(tc.filter)
			if err != nil {
				t.Fatal(err)
			}
			if ids := summaryIDs(got); !reflect.DeepEqual(ids, tc.want) {
				t.Fatalf("List IDs = %v, want %v", ids, tc.want)
			}
		})
	}
}

func listRun(id, taskID, featurePath, updatedAt string, session vaultregistry.AgentSession) vaultregistry.Run {
	run := baseRun(id)
	run.UpdatedAt = updatedAt
	run.Task.ID = taskID
	run.Task.FeaturePath = featurePath
	participant := baseParticipant()
	participant.AgentSession = &session
	run.Participants = []vaultregistry.Participant{participant}
	return run
}

func summaryIDs(summaries []vaultregistry.RunSummary) []string {
	ids := make([]string, 0, len(summaries))
	for _, summary := range summaries {
		ids = append(ids, summary.RunID)
	}
	return ids
}

func TestT01ListRejectsMalformedAndUnsupportedRecords(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want error
	}{
		{"malformed", []byte(`{"schema_version":`), vaultregistry.ErrMalformed},
		{"unsupported", []byte(`{"schema_version":3}`), vaultregistry.ErrUnsupportedVersion},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			runs := filepath.Join(root, "runs")
			if err := os.Mkdir(runs, 0700); err != nil {
				t.Fatal(err)
			}
			mustRegistryLock(t, root)
			if err := os.WriteFile(filepath.Join(runs, tc.name+".json"), tc.data, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := mustReader(t, root).ListSummaries(vaultregistry.ListFilter{TaskID: "does-not-match"}); !errors.Is(err, tc.want) {
				t.Fatalf("List error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestT01ListRejectsInvalidFilters(t *testing.T) {
	filters := []vaultregistry.ListFilter{
		{AgentSession: &vaultregistry.AgentSession{Source: "pi", Kind: "session"}},
		{UpdatedAtFrom: "yesterday"},
		{UpdatedAtFrom: "2026-07-27T00:00:00Z", UpdatedAtTo: "2026-07-26T00:00:00Z"},
	}
	reader := mustReader(t, t.TempDir())
	for _, filter := range filters {
		if _, err := reader.ListSummaries(filter); !errors.Is(err, vaultregistry.ErrMalformed) {
			t.Fatalf("List error = %v, want ErrMalformed", err)
		}
	}
}

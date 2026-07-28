package vaultregistry_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT09V01ListSummariesAreBoundedSortedAndConjunctive(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	for _, run := range []vaultregistry.Run{
		t09ListRun("run-z", "T10", "features/other.md", "2026-07-26T12:00:00Z", "session-alpha"),
		t09ListRun("run-a", "T09", "features/atlas.md", "2026-07-26T10:30:00Z", "session-alpha"),
		t09ListRun("run-m", "T09", "features/atlas.md", "2026-07-26T11:00:00Z", "session-beta"),
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
	if got := t09SummaryIDs(all); !reflect.DeepEqual(got, []string{"run-a", "run-m", "run-z"}) {
		t.Fatalf("summary order = %v", got)
	}
	encoded, err := json.Marshal(all[0])
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"participants", "lifecycle", "evidence", "run_future", "task_future"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("bounded summary contains %q: %s", forbidden, encoded)
		}
	}

	filter := vaultregistry.ListFilter{
		TaskID:           "T09",
		FeaturePath:      "features/atlas.md",
		AgentSession:     &vaultregistry.AgentSession{Source: "pi", Kind: "id", Value: "session-alpha"},
		UpdatedAtFrom:    "2026-07-26T10:30:00Z",
		UpdatedAtThrough: "2026-07-26T10:30:00Z",
	}
	got, err := reader.ListSummaries(filter)
	if err != nil {
		t.Fatal(err)
	}
	if ids := t09SummaryIDs(got); !reflect.DeepEqual(ids, []string{"run-a"}) {
		t.Fatalf("conjunctive inclusive filter IDs = %v", ids)
	}
	filter.TaskID = "T10"
	got, err = reader.ListSummaries(filter)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("no-match summaries = %#v, want non-nil empty slice", got)
	}
}

func t09ListRun(id, taskID, featurePath, updatedAt, sessionValue string) vaultregistry.Run {
	run := baseRun(id)
	run.UpdatedAt = updatedAt
	run.Task.ID = taskID
	run.Task.FeaturePath = featurePath
	run.Task.Unknown = unknown("task_future", `true`)
	run.Unknown = unknown("run_future", `{"kept":true}`)
	participant := baseParticipant()
	participant.AgentSession = &vaultregistry.AgentSession{Source: "pi", Kind: "id", Value: sessionValue}
	run.Participants = []vaultregistry.Participant{participant}
	return run
}

func mustRegistryLock(t *testing.T, root string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, "registry.lock"), nil, 0600); err != nil {
		t.Fatal(err)
	}
}

func t09SummaryIDs(summaries []vaultregistry.RunSummary) []string {
	ids := make([]string, len(summaries))
	for i := range summaries {
		ids[i] = summaries[i].RunID
	}
	return ids
}

func TestT09V01ListSummariesValidatesActiveRecordsBeforeFiltering(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want error
	}{
		{name: "broken", data: []byte("{not-json\n"), want: vaultregistry.ErrMalformed},
		{name: "future", data: []byte("{\"schema_version\":2}\n"), want: vaultregistry.ErrMalformed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			runs := filepath.Join(root, "runs")
			if err := os.Mkdir(runs, 0700); err != nil {
				t.Fatal(err)
			}
			mustRegistryLock(t, root)
			path := filepath.Join(runs, tc.name+".json")
			if err := os.WriteFile(path, tc.data, 0600); err != nil {
				t.Fatal(err)
			}
			_, err := mustReader(t, root).ListSummaries(vaultregistry.ListFilter{TaskID: "NO-MATCH"})
			if !errors.Is(err, tc.want) || !strings.Contains(err.Error(), tc.name+".json") {
				t.Fatalf("ListSummaries error = %v, want path-bearing %v", err, tc.want)
			}
		})
	}
}

func TestT09V01ListSummariesRejectsSymlinkAndIgnoresInactiveEntries(t *testing.T) {
	root := t.TempDir()
	runs := filepath.Join(root, "runs")
	if err := os.Mkdir(runs, 0700); err != nil {
		t.Fatal(err)
	}
	mustRegistryLock(t, root)
	if err := os.WriteFile(filepath.Join(runs, ".run-pending.tmp"), []byte("not JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runs, "README.txt"), []byte("ignored"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(runs, "ignored.json"), 0700); err != nil {
		t.Fatal(err)
	}
	got, err := mustReader(t, root).ListSummaries(vaultregistry.ListFilter{})
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("inactive entries: summaries=%#v err=%v", got, err)
	}

	target := filepath.Join(root, "target.json")
	if err := os.WriteFile(target, []byte("{}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(runs, "linked.json")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	_, err = mustReader(t, root).ListSummaries(vaultregistry.ListFilter{TaskID: "NO-MATCH"})
	if !errors.Is(err, vaultregistry.ErrMalformed) || !strings.Contains(err.Error(), "linked.json") {
		t.Fatalf("symlink error = %v, want path-bearing ErrMalformed", err)
	}
}

func TestT09V01ListSummariesValidatesFilterWithoutCreatingState(t *testing.T) {
	root := filepath.Join(t.TempDir(), "absent")
	reader := mustReader(t, root)
	got, err := reader.ListSummaries(vaultregistry.ListFilter{})
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("absent summaries=%#v err=%v", got, err)
	}
	if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("absent Registry was created: %v", err)
	}

	invalid := []vaultregistry.ListFilter{
		{AgentSession: &vaultregistry.AgentSession{Source: "pi", Kind: "id"}},
		{UpdatedAtFrom: "not-rfc3339"},
		{UpdatedAtThrough: "not-rfc3339"},
		{UpdatedAtFrom: "2026-07-26T12:00:00Z", UpdatedAtThrough: "2026-07-26T11:00:00Z"},
	}
	for _, filter := range invalid {
		if _, err := reader.ListSummaries(filter); !errors.Is(err, vaultregistry.ErrMalformed) {
			t.Fatalf("filter %#v error = %v, want ErrMalformed", filter, err)
		}
	}
	if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("invalid list created Registry: %v", err)
	}
}

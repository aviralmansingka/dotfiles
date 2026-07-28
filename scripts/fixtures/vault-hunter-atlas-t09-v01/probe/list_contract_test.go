//go:build t09v01

package probe

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT09V01FullRunsAndBoundedSummariesRemainSeparate(t *testing.T) {
	root := os.Getenv("T09_V01_STATE_DIR")
	if root == "" {
		t.Fatal("T09_V01_STATE_DIR is required")
	}
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}

	runs, err := reader.List()
	if err != nil {
		t.Fatal(err)
	}
	if got := runIDs(runs); !reflect.DeepEqual(got, []string{"run-a", "run-m", "run-z"}) {
		t.Fatalf("Reader.List Run IDs = %v", got)
	}
	if len(runs[0].Participants) != 2 || len(runs[0].Lifecycle) != 1 || len(runs[0].Evidence) != 1 || len(runs[0].Unknown) != 1 || len(runs[0].Task.Unknown) != 1 {
		t.Fatalf("Reader.List no longer returns the complete Run: %#v", runs[0])
	}

	summaries, err := reader.ListSummaries(vaultregistry.ListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	got, err := json.Marshal(summaries)
	if err != nil {
		t.Fatal(err)
	}
	const want = `[{"schema_version":1,"run_id":"run-a","revision":7,"invoked_at":"2026-07-26T10:00:00Z","updated_at":"2026-07-26T10:30:00Z","task":{"id":"T09","title":"List active Runs","path":"features/vault-hunter-atlas/tasks/09-list.md","feature_path":"features/vault-hunter-atlas/feature.md","kind":"task"}},{"schema_version":1,"run_id":"run-m","revision":3,"invoked_at":"2026-07-26T10:45:00Z","updated_at":"2026-07-26T11:00:00Z","task":{"id":"T09","title":"List active Runs","path":"features/vault-hunter-atlas/tasks/09-list.md","feature_path":"features/vault-hunter-atlas/feature.md","kind":"task"}},{"schema_version":1,"run_id":"run-z","revision":1,"invoked_at":"2026-07-26T11:45:00Z","updated_at":"2026-07-26T12:00:00Z","task":{"id":"T10","title":"Another Task","path":"features/other/tasks/10.md","feature_path":"features/other/feature.md","kind":"task"}}]`
	assertJSONEqual(t, got, []byte(want))
}

func runIDs(runs []vaultregistry.Run) []string {
	ids := make([]string, len(runs))
	for i := range runs {
		ids[i] = runs[i].RunID
	}
	return ids
}

func assertJSONEqual(t *testing.T, got, want []byte) {
	t.Helper()
	var gotValue, wantValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("decode got: %v: %s", err, got)
	}
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("decode want: %v", err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("summary JSON = %s, want %s", got, want)
	}
}

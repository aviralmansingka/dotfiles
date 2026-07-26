package atlas

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT06V01CanonicalAggregation(t *testing.T) {
	root := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t06-v01")
	reader, err := vaultregistry.OpenReader(filepath.Join(root, "state"))
	if err != nil {
		t.Fatal(err)
	}
	runs, err := reader.List()
	if err != nil {
		t.Fatal(err)
	}
	project, err := DiscoverProject(filepath.Join(root, "vault"), "1_projects/pi-agent", runs)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(project.Features), 4; got != want {
		t.Fatalf("features = %d, want %d", got, want)
	}

	var atlas FeatureProjection
	for _, feature := range project.Features {
		if feature.Name == "vault-hunter-atlas" {
			atlas = feature
		}
	}
	if atlas.Status != Active {
		t.Fatalf("blocked child inferred Feature status %s, want Active", atlas.Status)
	}
	if got, want := len(atlas.Tasks), 4; got != want {
		t.Fatalf("deduplicated tasks = %d, want %d", got, want)
	}
	want := []Status{Done, Active, Blocked, Pending}
	for i, status := range want {
		if atlas.Tasks[i].Status != status {
			t.Errorf("task %d status = %s, want %s", i, atlas.Tasks[i].Status, status)
		}
	}
	if !atlas.Tasks[3].NoteMissing {
		t.Error("missing authoritative Task note was not retained")
	}

	diagnostics := strings.Join(project.Diagnostics, "\n")
	for _, text := range []string{"malformed Task checklist entry", "duplicate Task link", "conflicting duplicate checkboxes", "missing Task note", "[x] conflicts"} {
		if !strings.Contains(diagnostics, text) {
			t.Errorf("missing diagnostic %q:\n%s", text, diagnostics)
		}
	}
	frame := project.Render()
	for _, id := range []string{"T01", "T02", "T03", "T06"} {
		if got := strings.Count(frame, "vault-hunter-atlas/"+id+" "); got != 1 {
			t.Errorf("%s rendered %d times, want once", id, got)
		}
	}
	if !strings.Contains(frame, "PROJECT C — DENSE TRIAGE TABLE") {
		t.Error("Project C rendering label missing")
	}
}

func TestT06V01NewestUnfinishedRunAndRecordedOrder(t *testing.T) {
	path := "tasks/one.md"
	runs := []vaultregistry.Run{
		{RunID: "older", UpdatedAt: "2026-01-01T00:00:00Z", Task: vaultregistry.Task{Path: path}, Lifecycle: []vaultregistry.Lifecycle{{ObservedAt: "2026-01-01T00:00:00Z", State: "blocked"}}},
		{RunID: "newer-a", UpdatedAt: "2026-01-02T00:00:00Z", Task: vaultregistry.Task{Path: path}, Lifecycle: []vaultregistry.Lifecycle{{ObservedAt: "2026-01-02T00:00:00Z", State: "blocked"}, {ObservedAt: "2026-01-02T00:00:00Z", State: "active"}}},
		{RunID: "newer-z", UpdatedAt: "2026-01-02T00:00:00Z", Task: vaultregistry.Task{Path: path}, Lifecycle: []vaultregistry.Lifecycle{{ObservedAt: "2026-01-02T00:00:00Z", State: "done"}}},
	}
	run, stage := selectedRun(runs, path, false)
	if run == nil || run.RunID != "newer-a" || stage != "active" {
		t.Fatalf("selected %v/%q, want newer-a/active", run, stage)
	}
}

package atlas

import (
	"os"
	"path/filepath"
	"regexp"
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
	for _, want := range []struct {
		id, title, path string
	}{
		{"T01", "Define Atlas contract", "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/01-contract.md"},
		{"T06", "Project + Feature views", "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/06-views.md"},
	} {
		var got TaskProjection
		for _, task := range atlas.Tasks {
			if task.ID == want.id {
				got = task
			}
		}
		if got.ID != want.id || got.Title != want.title || got.Path != want.path {
			t.Errorf("canonical %s projection = %#v, want title %q path %q", want.id, got, want.title, want.path)
		}
	}
	if task, ok := project.Task("1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/06-views.md"); !ok || task.ID != "T06" {
		t.Fatalf("canonical T06 aggregate lookup = %#v/%v, want T06/true", task, ok)
	}

	diagnostics := strings.Join(project.Diagnostics, "\n")
	for _, text := range []string{"malformed Task checklist entry", "duplicate Task link", "conflicting duplicate checkboxes", "missing Task note", "[x] conflicts", "Task link outside selected Project"} {
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
	if strings.Contains(frame, "T99") {
		t.Error("checklist beneath a later H1/H2 boundary was parsed as Tasks")
	}
	if !strings.Contains(frame, "PROJECT C — DENSE TRIAGE TABLE") {
		t.Error("Project C rendering label missing")
	}
}

func TestT06V01RejectsNoncanonicalTaskRows(t *testing.T) {
	root := t.TempDir()
	path := "1_projects/pi-agent/themes/theme/features/feature/feature.md"
	file := filepath.Join(root, filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\nstatus: pending\n---\n## Tasks\n- [ ] prefix T01 [[tasks/one.md|One]].\n- [ ] T02 [[tasks/two.md|Two]]. trailing\n"
	if err := os.WriteFile(file, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	feature, err := DiscoverFeature(root, path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(feature.Features) != 1 || len(feature.Features[0].Tasks) != 0 {
		t.Fatalf("noncanonical rows produced %#v, want one Feature with 0 Tasks", feature.Features)
	}
	diagnostics := strings.Join(feature.Diagnostics, "\n")
	for _, row := range []string{"prefix T01 [[tasks/one.md|One]].", "T02 [[tasks/two.md|Two]]. trailing"} {
		if !strings.Contains(diagnostics, "malformed Task checklist entry: "+row) {
			t.Errorf("missing malformed diagnostic for %q:\n%s", row, diagnostics)
		}
	}
}

func TestT06V01RejectsNoncanonicalScopes(t *testing.T) {
	root := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t06-v01", "vault")
	for _, target := range []string{
		"1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/../vault-hunter-atlas/feature.md",
		"1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/feature.md",
		"1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/FEATURE.md",
	} {
		if _, err := DiscoverFeature(root, target, nil); err == nil {
			t.Errorf("DiscoverFeature(%q) accepted a noncanonical target", target)
		}
	}
	for _, target := range []string{"pi-agent", "1_projects/pi-agent/themes", "1_projects/../1_projects/pi-agent"} {
		if _, err := DiscoverProject(root, target, nil); err == nil {
			t.Errorf("DiscoverProject(%q) accepted a noncanonical target", target)
		}
	}
}

func TestT06V02SelectsRegisteredTaskByCanonicalPath(t *testing.T) {
	root := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t06-v02")
	reader, err := vaultregistry.OpenReader(filepath.Join(root, "state"))
	if err != nil {
		t.Fatal(err)
	}
	runs, err := reader.List()
	if err != nil {
		t.Fatal(err)
	}
	projection, err := DiscoverFeature(filepath.Join(root, "vault"), "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md", runs)
	if err != nil {
		t.Fatal(err)
	}
	task, ok := projection.Task("1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/../tasks/02-compact.md")
	if !ok {
		t.Fatal("registered Task selection not found")
	}
	if task.ID != "T02" || task.RunID != "atlas-rich-run" {
		t.Fatalf("selected Task/run = %s/%s, want T02/atlas-rich-run", task.ID, task.RunID)
	}
	if task.Status != Active {
		t.Fatalf("completed Run changed Task status to %s, want Active from authoritative note", task.Status)
	}
}

func TestT06V02RegistryTaskPathBoundaries(t *testing.T) {
	root := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t06-v02")
	vaultRoot, err := filepath.Abs(filepath.Join(root, "vault"))
	if err != nil {
		t.Fatal(err)
	}
	const taskPath = "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/02-compact.md"
	absoluteTask := filepath.Join(vaultRoot, filepath.FromSlash(taskPath))

	tests := []struct {
		name, path string
		wantRun    bool
	}{
		{name: "relative", path: taskPath, wantRun: true},
		{name: "clean absolute under root", path: filepath.Join(vaultRoot, "1_projects", "pi-agent", "themes", "pi-customization", "features", "vault-hunter-atlas", "tasks", "..", "tasks", "02-compact.md"), wantRun: true},
		{name: "absolute outside root", path: filepath.Join(filepath.Dir(vaultRoot), "outside", filepath.Base(absoluteTask))},
		{name: "relative escape", path: "../" + taskPath},
		{name: "empty", path: ""},
		{name: "vault root", path: vaultRoot},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runs := []vaultregistry.Run{{RunID: "atlas-rich-run", Task: vaultregistry.Task{Path: test.path}}}
			projection, err := DiscoverFeature(vaultRoot, "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md", runs)
			if err != nil {
				t.Fatal(err)
			}
			task, ok := projection.Task(taskPath)
			if !ok {
				t.Fatal("canonical Task selection not found")
			}
			if got := task.RunID != ""; got != test.wantRun {
				t.Fatalf("RunID = %q, matched = %v, want %v for %q", task.RunID, got, test.wantRun, test.path)
			}
		})
	}

	if volume := filepath.VolumeName(vaultRoot); volume != "" {
		other := "Z:" + string(filepath.Separator) + filepath.FromSlash(taskPath)
		if filepath.VolumeName(other) != volume {
			t.Run("different volume", func(t *testing.T) {
				runs := []vaultregistry.Run{{RunID: "other-volume", Task: vaultregistry.Task{Path: other}}}
				projection, err := DiscoverFeature(vaultRoot, "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md", runs)
				if err != nil {
					t.Fatal(err)
				}
				task, ok := projection.Task(taskPath)
				if !ok || task.RunID != "" {
					t.Fatalf("different-volume Task/run = %#v/%v, want empty RunID", task, ok)
				}
			})
		}
	}
}

func TestT06V02RegistryFeaturePathBoundaries(t *testing.T) {
	vaultRoot := t.TempDir()
	const featurePath = "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md"
	featureFile := filepath.Join(vaultRoot, filepath.FromSlash(featurePath))
	if err := os.MkdirAll(filepath.Dir(featureFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(featureFile, []byte("---\nstatus: pending\n---\n## Tasks\n- [ ] T01 [[tasks/01.md|Pending]].\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	type featureBoundary struct {
		name, path string
		wantRun    bool
	}
	tests := []featureBoundary{
		{name: "relative", path: featurePath, wantRun: true},
		{name: "clean absolute under root", path: filepath.Join(vaultRoot, "1_projects", "pi-agent", "themes", "pi-customization", "features", "vault-hunter-atlas", "tasks", "..", "feature.md"), wantRun: true},
		{name: "absolute outside root", path: filepath.Join(filepath.Dir(vaultRoot), "outside", "feature.md")},
		{name: "relative escape", path: "../" + featurePath},
		{name: "empty", path: ""},
		{name: "vault root", path: vaultRoot},
	}
	if volume := filepath.VolumeName(vaultRoot); volume != "" {
		other := "Z:" + string(filepath.Separator) + filepath.FromSlash(featurePath)
		if filepath.VolumeName(other) != volume {
			tests = append(tests, featureBoundary{name: "different volume", path: other})
		}
	}

	for _, test := range tests {
		for _, stage := range []string{"blocked", "active"} {
			t.Run(test.name+"/"+stage, func(t *testing.T) {
				runs := []vaultregistry.Run{{
					RunID: "feature-run",
					Task:  vaultregistry.Task{Kind: "feature", FeaturePath: test.path},
					Lifecycle: []vaultregistry.Lifecycle{{
						ObservedAt: "2026-07-26T12:00:00Z",
						State:      stage,
					}},
				}}
				projection, err := DiscoverFeature(vaultRoot, featurePath, runs)
				if err != nil {
					t.Fatal(err)
				}
				want := Pending
				if test.wantRun {
					want = Blocked
					if stage == "active" {
						want = Active
					}
				}
				if got := projection.Features[0].Status; got != want {
					t.Fatalf("Feature status = %s, want %s for %q", got, want, test.path)
				}
			})
		}
	}
}

func TestT06V03SelectsUnregisteredTaskByCanonicalPath(t *testing.T) {
	root := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t06-v03")
	projection, err := DiscoverFeature(filepath.Join(root, "vault"), "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md", nil)
	if err != nil {
		t.Fatal(err)
	}
	task, ok := projection.Task("1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/../tasks/06-atlas-views.md")
	if !ok {
		t.Fatal("unregistered Task selection not found")
	}
	if task.ID != "T06" || task.RunID != "" {
		t.Fatalf("selected Task/run = %s/%s, want T06/<empty>", task.ID, task.RunID)
	}
}

func TestT06V01NewestUnfinishedRunAndRecordedOrder(t *testing.T) {
	path := "tasks/one.md"
	runs := []vaultregistry.Run{
		{RunID: "lexically-later", UpdatedAt: "2026-01-02T00:30:00+01:00", Task: vaultregistry.Task{Path: path}, Lifecycle: []vaultregistry.Lifecycle{{ObservedAt: "2026-01-01T23:30:00Z", State: "blocked"}}},
		{RunID: "newer-a", UpdatedAt: "2026-01-02T00:00:00.1Z", Task: vaultregistry.Task{Path: path}, Lifecycle: []vaultregistry.Lifecycle{{ObservedAt: "2026-01-02T01:00:00+01:00", State: "blocked"}, {ObservedAt: "2026-01-02T00:00:00Z", State: "active"}}},
		{RunID: "newer-z", UpdatedAt: "2026-01-02T00:00:00.100+00:00", Task: vaultregistry.Task{Path: path}, Lifecycle: []vaultregistry.Lifecycle{{ObservedAt: "2026-01-02T00:00:00Z", State: "done"}}},
	}
	run, stage := selectedRun(runs, path, false)
	if run == nil || run.RunID != "newer-z" || stage != "active" {
		t.Fatalf("selected %v/%q, want registered newer-z/status active", run, stage)
	}
}

func TestT06V04ColorPolicy(t *testing.T) {
	tests := []struct {
		name                         string
		mode                         string
		snapshot, terminal, dumb, no bool
		want                         bool
	}{
		{name: "auto terminal", mode: "auto", terminal: true, want: true},
		{name: "auto redirected", mode: "auto"},
		{name: "auto dumb", mode: "auto", terminal: true, dumb: true},
		{name: "auto no color", mode: "auto", terminal: true, no: true},
		{name: "always redirected", mode: "always", want: true},
		{name: "always no color", mode: "always", no: true, want: true},
		{name: "snapshot overrides always", mode: "always", snapshot: true, terminal: true},
		{name: "never terminal", mode: "never", terminal: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ColorEnabled(test.mode, test.snapshot, test.terminal, test.dumb, test.no); got != test.want {
				t.Fatalf("ColorEnabled() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestT06V04ColorDoesNotChangeFeatureText(t *testing.T) {
	root := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t06-v01")
	reader, err := vaultregistry.OpenReader(filepath.Join(root, "state"))
	if err != nil {
		t.Fatal(err)
	}
	runs, err := reader.List()
	if err != nil {
		t.Fatal(err)
	}
	projection, err := DiscoverFeature(filepath.Join(root, "vault"), "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md", runs)
	if err != nil {
		t.Fatal(err)
	}
	colored := projection.RenderColor(true)
	if !strings.Contains(colored, "\x1b[38;2;242;133;52mFEATURE ATLAS\x1b[0m") || !strings.Contains(colored, "\x1b[38;2;128;170;158mregistered → ") {
		t.Fatalf("semantic true-color tokens missing:\n%q", colored)
	}
	plain := regexp.MustCompile(`\x1b\[[0-9;]*m`).ReplaceAllString(colored, "")
	if plain != projection.Render() {
		t.Fatalf("ANSI-stripped color render changed plain frame\n--- got ---\n%s\n--- want ---\n%s", plain, projection.Render())
	}
}

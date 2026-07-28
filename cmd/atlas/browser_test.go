package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	atlaspkg "github.com/aviral/dotfiles/internal/atlas"
	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT18V03BrowserNavigation(t *testing.T) {
	model := newBrowserModel([]browserEntry{{
		runID:          "run-041",
		runName:        "registry-list-and-retire",
		projectName:    "pi-agent",
		featureName:    "vault-hunter-atlas",
		taskID:         "T09",
		taskStatus:     "in-progress",
		projectPreview: "project-preview",
		featurePreview: "feature-preview",
		taskPreview:    "task-preview",
		run: vaultregistry.Run{RunID: "run-041", Task: vaultregistry.Task{ID: "T09", Title: "List active Runs"}, Lifecycle: []vaultregistry.Lifecycle{{
			ObservationID: "life-1", ObservedAt: "2026-07-27T14:00:00Z", GoalID: "T09.V01", Kind: "verifier", State: "active", Detail: "browser run preview",
		}}},
	}, {
		runID:       "run-042",
		runName:     "pending-review",
		projectName: "pi-agent",
		featureName: "vault-hunter-atlas",
		taskID:      "T10",
		taskStatus:  "in-progress",
		run:         vaultregistry.Run{RunID: "run-042", Task: vaultregistry.Task{ID: "T10", Title: "Pending review"}},
	}})
	model.width, model.height = 140, 32
	if !strings.Contains(model.View(), "vault-hunter journal") {
		t.Fatalf("initial browser preview = %q", model.View())
	}

	next, cmd := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}})
	if cmd != nil {
		t.Fatal("browser scheduled unexpected command")
	}
	model = next.(browserModel)
	if !strings.Contains(model.View(), "project-preview") {
		t.Fatalf("project preview = %q", model.View())
	}
	model = browserUpdate(t, model, 'f')
	if !strings.Contains(model.View(), "feature-preview") {
		t.Fatalf("feature preview = %q", model.View())
	}
	model = browserUpdate(t, model, 't')
	if !strings.Contains(model.View(), "task-preview") {
		t.Fatalf("task preview = %q", model.View())
	}
	model = browserUpdate(t, model, 'j')
	if model.selected != 1 {
		t.Fatalf("selected = %d, want 1", model.selected)
	}
	model = browserUpdate(t, model, 'k')
	if model.selected != 0 {
		t.Fatalf("selected = %d, want 0", model.selected)
	}
	model = browserUpdate(t, model, 'r')
	if !strings.Contains(model.View(), "vault-hunter journal") {
		t.Fatalf("run preview = %q", model.View())
	}

	_, quit := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	if quit == nil {
		t.Fatal("q did not request quit")
	}
	if _, ok := quit().(tea.QuitMsg); !ok {
		t.Fatal("q returned non-quit command")
	}
}

func TestBrowserHierarchyRowsShowLifecycleStatus(t *testing.T) {
	entries := []browserEntry{{
		runID: "run-active-123", taskID: "task-browser", projectName: "pi-agent", featureName: "vault-hunter-atlas",
		taskName: "Build Atlas Browser", taskStatus: "in-progress", run: vaultregistry.Run{Revision: 12, Lifecycle: []vaultregistry.Lifecycle{{GoalID: "T18.V02", State: "active"}}},
	}, {
		runID: "run-done-456", taskID: "task-journal", projectName: "pi-agent", featureName: "vault-hunter-atlas",
		taskName: "Build Execution Journal", taskStatus: "done", run: vaultregistry.Run{Revision: 8},
	}, {
		runID: "run-failed-789", taskID: "task-sync", projectName: "neovim", featureName: "agent-context-management",
		taskName: "Sync Context", taskStatus: "in-progress", run: vaultregistry.Run{Revision: 3, Lifecycle: []vaultregistry.Lifecycle{{GoalID: "T03.V04", State: "failed"}}},
	}}
	model := newBrowserModel(entries).withColor(true)
	model.width, model.height = 140, 32
	view := model.View()
	for _, want := range []string{"pi-agent", "vault-hunter-atlas", "Build Atlas Browser", "V02", "neovim", "Sync Context", "V04", "48;2;69;64;60m"} {
		if !strings.Contains(view, want) {
			t.Fatalf("view missing %q: %q", want, view)
		}
	}
	if strings.Index(view, "pi-agent") > strings.Index(view, "vault-hunter-atlas") || strings.Index(view, "vault-hunter-atlas") > strings.Index(view, "Build Atlas Browser") {
		t.Fatalf("hierarchy order is not Project, Feature, Run: %q", view)
	}
	if strings.Contains(view, "48;2;50;48;47m") || strings.Contains(view, "48;2;60;56;54m") {
		t.Fatalf("unselected hierarchy rows use a background: %q", view)
	}
}

func TestBrowserGroupsRunsUnderOneTask(t *testing.T) {
	model := newBrowserModel([]browserEntry{
		{runID: "run-1", taskID: "task", taskName: "Task", projectName: "p", featureName: "f"},
		{runID: "run-2", taskID: "task", taskName: "Task", projectName: "p", featureName: "f"},
	})
	if got := model.visibleEntries(); len(got) != 1 {
		t.Fatalf("visible task rows = %d, want 1", len(got))
	}
	view := strings.Join(model.leftPane(20), "\n")
	if strings.Count(view, "Task") != 1 || !strings.Contains(view, "run-1") || !strings.Contains(view, "run-2") {
		t.Fatalf("runs were not grouped beneath Task: %q", view)
	}
}

func TestBrowserCtrlDTogglesDoneOnlyFeature(t *testing.T) {
	model := newBrowserModel([]browserEntry{
		{taskID: "a-done", taskName: "A done", taskStatus: "done", projectName: "p", featureName: "a"},
		{taskID: "b-active", taskName: "B active", taskStatus: "in-progress", projectName: "p", featureName: "b"},
	})
	visible := model.visibleEntries()
	if len(visible) != 2 || visible[0].taskID != "" || visible[0].featureName != "a" {
		t.Fatalf("done-only Feature is not selectable: %#v", visible)
	}
	next, _ := model.Update(tea.KeyMsg{Type: tea.KeyCtrlD})
	visible = next.(browserModel).visibleEntries()
	if len(visible) != 2 || visible[0].taskID != "a-done" {
		t.Fatalf("done-only Feature did not expand locally: %#v", visible)
	}
}

func TestBrowserCtrlDTogglesDoneWithinSelectedFeature(t *testing.T) {
	model := newBrowserModel([]browserEntry{
		{taskID: "a-active", taskName: "A active", taskStatus: "in-progress", projectName: "p", featureName: "a"},
		{taskID: "a-done", taskName: "A done", taskStatus: "done", projectName: "p", featureName: "a"},
		{taskID: "a-next", taskName: "A next", taskStatus: "pending-work", projectName: "p", featureName: "a"},
		{taskID: "b-done", taskName: "B done", taskStatus: "done", projectName: "p", featureName: "b"},
	})
	if got := model.visibleEntries(); len(got) != 3 || got[0].taskID != "a-active" || got[1].taskID != "a-next" || got[2].featureName != "b" || got[2].taskID != "" {
		t.Fatalf("default visible = %#v", got)
	}
	next, _ := model.Update(tea.KeyMsg{Type: tea.KeyCtrlD})
	model = next.(browserModel)
	got := model.visibleEntries()
	if len(got) != 4 || got[1].taskID != "a-done" {
		t.Fatalf("feature-local expanded visible = %#v", got)
	}
	for _, entry := range got {
		if entry.taskID == "b-done" {
			t.Fatalf("Ctrl-D expanded another Feature: %#v", got)
		}
	}
}

func TestCanonicalPendingStatusIsNotStarted(t *testing.T) {
	styles := newBrowserStyles()
	view := strings.Join(renderBrowserTask(browserEntry{taskName: "Pending", taskStatus: "pending"}, nil, false, 80, false, styles, "└─ ", "   └─ "), "\n")
	if !strings.Contains(view, "○ Pending") || !strings.Contains(view, "not started") {
		t.Fatalf("canonical pending Task rendered incorrectly: %q", view)
	}
	featureJSON := `{"data":{"name":"feature","tasks":[{"id":"task","local_id":"T1","name":"Pending","status":"pending"}]}}`
	focus := renderFeatureFocus(browserEntry{featurePreview: featureJSON}, nil, 80, 20, false)
	if !strings.Contains(focus, "1 next") || strings.Contains(focus, "1 complete") {
		t.Fatalf("canonical pending Task classified incorrectly: %q", focus)
	}
}

func TestPendingFeatureTaskIsUnfilledAndUnhighlighted(t *testing.T) {
	lines := renderFeatureTask(featureTask{LocalID: "T14", Name: "Harden Journal", Status: "pending-work"}, nil, "selected-run", 80, true, newBrowserStyles())
	view := strings.Join(lines, "\n")
	if !strings.Contains(view, "○") {
		t.Fatalf("pending Task lacks empty circle: %q", view)
	}
	if strings.Contains(view, "48;2;69;64;60m") {
		t.Fatalf("pending Task inherited selected background: %q", view)
	}
}

func TestFeaturePreviewFocusesNowNextAndStages(t *testing.T) {
	featureJSON := `{"data":{"name":"vault-hunter-atlas","tasks":[{"id":"task-active","local_id":"T11","name":"Build Browser","status":"in-progress"},{"id":"task-next","local_id":"T14","name":"Harden Journal","status":"pending-work"},{"id":"task-done","local_id":"T08","name":"Execution Journal","status":"done"}]}}`
	entries := []browserEntry{{runID: "run-11", taskID: "task-active", taskName: "Build Browser", featurePreview: featureJSON, run: vaultregistry.Run{Revision: 2, Lifecycle: []vaultregistry.Lifecycle{{GoalID: "T11.V01", State: "done"}, {GoalID: "T11.V02", State: "active"}}}}}
	view := renderFeatureFocus(entries[0], entries, 80, 24, false)
	for _, want := range []string{"1 now · 1 next · 1 complete", "NOW · 1", "T11 · Build Browser", "activate ✓ ─ baseline ✓ ─ converge ● ─ review ○ ─ land ○ ─ cleanup ○", "NEXT · 1", "T14 · Harden Journal", "activate ○ ─ baseline ○ ─ converge ○ ─ review ○ ─ land ○ ─ cleanup ○"} {
		if !strings.Contains(view, want) {
			t.Fatalf("feature view missing %q: %q", want, view)
		}
	}
	if strings.Contains(view, "Execution Journal") {
		t.Fatalf("completed Task was not collapsed: %q", view)
	}
}

func TestT18V03WatchEmitsCompleteEnvelopes(t *testing.T) {
	fixture := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t18-v02")
	t.Setenv("ATLAS_VAULT_ROOT", filepath.Join(fixture, "vault"))
	t.Setenv("VAULT_HUNTER_STATE_DIR", filepath.Join(fixture, "state"))
	t.Setenv("ATLAS_WATCH_FAKE_TIMES", "2026-07-27T14:00:00Z,2026-07-27T14:00:01Z")
	defer t.Setenv("ATLAS_WATCH_FAKE_TIMES", "")

	var stdout, stderr bytes.Buffer
	if code := execute([]string{"get", "runs", "--watch"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit = %d, stderr = %q", code, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q", stderr.String())
	}
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("lines = %d, want 2\n%s", len(lines), stdout.String())
	}
	var first, second map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatalf("first line json: %v", err)
	}
	if err := json.Unmarshal([]byte(lines[1]), &second); err != nil {
		t.Fatalf("second line json: %v", err)
	}
	for _, envelope := range []map[string]any{first, second} {
		if got := mapKeys(envelope); got != "api_version,data,kind,meta" {
			t.Fatalf("keys = %s, want exact envelope", got)
		}
		if envelope["kind"] != "RunList" {
			t.Fatalf("kind = %#v", envelope["kind"])
		}
	}
	firstJSON, _ := json.Marshal(first["data"])
	secondJSON, _ := json.Marshal(second["data"])
	if string(firstJSON) != string(secondJSON) {
		t.Fatalf("watch emitted a delta\nfirst=%s\nsecond=%s", firstJSON, secondJSON)
	}
	if first["meta"].(map[string]any)["observed_at"] != "2026-07-27T14:00:00Z" || second["meta"].(map[string]any)["observed_at"] != "2026-07-27T14:00:01Z" {
		t.Fatalf("observed_at mismatch: %#v %#v", first["meta"], second["meta"])
	}
	if strings.Contains(stdout.String(), "\x1b") || strings.Contains(stdout.String(), "ATLAS") {
		t.Fatalf("watch stdout contains prose or ANSI: %q", stdout.String())
	}
}

func TestT18V03BrowserCompletenessIgnoresMachineByteCap(t *testing.T) {
	vaultRoot := t.TempDir()
	stateRoot := t.TempDir()
	const taskPath = "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/18-build-atlas.md"
	const pendingTaskPath = "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/19-not-started.md"
	const featurePath = "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md"
	writeBrowserFile(t, vaultRoot, "1_projects/pi-agent/README.md", "---\nworking_directory: /worktrees/dotfiles\nrepository: git@github.com:aviralmansingka/dotfiles\n---\n# pi-agent\n")
	writeBrowserFile(t, vaultRoot, "1_projects/pi-agent/themes/pi-customization/theme.md", "---\ndescription: Customize Pi Agent and its surrounding workflows.\n---\n# pi-customization\n")
	writeBrowserFile(t, vaultRoot, featurePath, "---\ndescription: Provide a unified Atlas interface.\n---\n# vault-hunter-atlas\n")
	writeBrowserFile(t, vaultRoot, taskPath, "---\nstatus: in-progress\n---\n# T18: Build Atlas\n\n## Intent\nRender Atlas.\n")
	writeBrowserFile(t, vaultRoot, pendingTaskPath, "---\nstatus: pending-work\n---\n# T19: Not Started\n\n## Intent\nShow pending work.\n")
	producer, err := vaultregistry.OpenProducer(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 6; i++ {
		runID := fmt.Sprintf("run-%02d", i)
		if _, err := producer.CreateRun(browserRunRequest(runID, fmt.Sprintf("browser-%02d", i), taskPath, featurePath)); err != nil {
			t.Fatal(err)
		}
	}
	reader, err := vaultregistry.OpenReader(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("ATLAS_MAX_COLLECTION_BYTES", "1")
	listEnvelope, err := atlaspkg.BuildEnvelope(vaultRoot, stateRoot, "runs", atlaspkg.MachineSelector{}, atlaspkg.MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	listData := listEnvelope.Data.([]map[string]any)
	if !listEnvelope.Meta["truncated"].(bool) || listEnvelope.Meta["count"].(int) != 6 || len(listData) >= 6 {
		t.Fatalf("bounded run list = %#v", listEnvelope)
	}
	entries, err := buildBrowserEntries(vaultRoot, stateRoot, reader, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 7 {
		t.Fatalf("browser entries = %d, want six Runs plus one unstarted Task: %#v", len(entries), entries)
	}
	foundPending := false
	for _, entry := range entries {
		if entry.taskID == pendingTaskPath && entry.runID == "" {
			foundPending = true
		}
	}
	if !foundPending {
		t.Fatalf("browser omitted unstarted Task beyond machine byte cap: %#v", entries)
	}
}

func TestBrowserSkipsUnrenderableRunsWithWarning(t *testing.T) {
	vaultRoot := t.TempDir()
	stateRoot := t.TempDir()
	const taskPath = "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/18-build-atlas.md"
	const featurePath = "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md"
	writeBrowserFile(t, vaultRoot, "1_projects/pi-agent/README.md", "---\nworking_directory: /worktrees/dotfiles\nrepository: git@example.test/dotfiles\n---\n# pi-agent\n")
	writeBrowserFile(t, vaultRoot, "1_projects/pi-agent/themes/pi-customization/theme.md", "---\n---\n# pi-customization\n")
	writeBrowserFile(t, vaultRoot, featurePath, "---\n---\n# vault-hunter-atlas\n")
	writeBrowserFile(t, vaultRoot, taskPath, "---\nstatus: in-progress\n---\n# T18: Build Atlas\n")
	producer, err := vaultregistry.OpenProducer(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := producer.CreateRun(browserRunRequest("renderable", "renderable", taskPath, featurePath)); err != nil {
		t.Fatal(err)
	}
	unsupported := browserRunRequest("feature-run", "feature-run", featurePath, featurePath)
	if _, err := producer.CreateRun(unsupported); err != nil {
		t.Fatal(err)
	}
	reader, err := vaultregistry.OpenReader(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	var warnings bytes.Buffer
	entries, err := buildBrowserEntries(vaultRoot, stateRoot, reader, &warnings)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].runID != "renderable" {
		t.Fatalf("entries = %#v", entries)
	}
	warning := warnings.String()
	if !strings.Contains(warning, "skipping unrenderable run feature-run") || !strings.Contains(warning, featurePath) {
		t.Fatalf("warning = %q", warning)
	}
}

func browserUpdate(t *testing.T, model browserModel, key rune) browserModel {
	t.Helper()
	next, cmd := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{key}})
	if cmd != nil {
		t.Fatalf("%q scheduled unexpected command", string(key))
	}
	updated, ok := next.(browserModel)
	if !ok {
		t.Fatalf("Update returned %T", next)
	}
	return updated
}

func writeBrowserFile(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func browserRunRequest(runID, name, taskPath, featurePath string) vaultregistry.CreateRequest {
	observedAt := "2026-07-28T00:00:00Z"
	startedAt := observedAt
	return vaultregistry.CreateRequest{
		Run: vaultregistry.Run{
			SchemaVersion: 2,
			RunID:         runID,
			Name:          name,
			RunKind:       vaultregistry.RunKindHunter,
			WorkReference: &vaultregistry.WorkReference{ID: "T18", Title: "Build Atlas", Path: taskPath, FeaturePath: featurePath, Kind: "task"},
			State:         vaultregistry.RunStateActive,
			Stage:         "invoked",
			InvokedAt:     observedAt,
			UpdatedAt:     observedAt,
		},
		InitialDriver: vaultregistry.Observation{
			ObservationID:  "driver-" + runID,
			Kind:           vaultregistry.KindRegisteredParticipant,
			State:          vaultregistry.StateActive,
			GoalID:         "T18.V03",
			Title:          "Driver",
			Summary:        "Registered by browser tests.",
			ObservedAt:     observedAt,
			CorrelationID:  runID,
			StartedAt:      &startedAt,
			Actor:          vaultregistry.Identity{Kind: "participant", ID: "driver"},
			Source:         vaultregistry.Identity{Kind: "test", ID: "cmd-atlas-browser"},
			RedactionClass: "internal",
			Payload: vaultregistry.ObservationPayload{RegisteredParticipant: &vaultregistry.RegisteredParticipantPayload{
				ParticipantID: "driver",
				Role:          "driver",
				AgentSession:  vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: runID},
			}},
		},
	}
}

func mapKeys(value map[string]any) string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return ""
	}
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[j] < keys[i] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}
	return strings.Join(keys, ",")
}

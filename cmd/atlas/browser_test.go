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
		taskID:      "T09",
		run:         vaultregistry.Run{RunID: "run-042", Task: vaultregistry.Task{ID: "T09", Title: "Pending review"}},
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
	const featurePath = "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md"
	writeBrowserFile(t, vaultRoot, "1_projects/pi-agent/README.md", "---\nworking_directory: /worktrees/dotfiles\nrepository: git@github.com:aviralmansingka/dotfiles\n---\n# pi-agent\n")
	writeBrowserFile(t, vaultRoot, "1_projects/pi-agent/themes/pi-customization/theme.md", "---\ndescription: Customize Pi Agent and its surrounding workflows.\n---\n# pi-customization\n")
	writeBrowserFile(t, vaultRoot, featurePath, "---\ndescription: Provide a unified Atlas interface.\n---\n# vault-hunter-atlas\n")
	writeBrowserFile(t, vaultRoot, taskPath, "---\nstatus: in-progress\n---\n# T18: Build Atlas\n\n## Intent\nRender Atlas.\n")
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
	if len(entries) != 6 || entries[0].runID != "run-01" || entries[len(entries)-1].runID != "run-06" {
		t.Fatalf("browser entries = %#v", entries)
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

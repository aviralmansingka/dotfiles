package main

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

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

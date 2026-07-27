// Throwaway prototype test: checks that the three expanded board structures answer the styling question without becoming production surface.
package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestPrototypeSmoke(t *testing.T) {
	exitZero := 0
	run := vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         "prototype-run",
		Revision:      7,
		InvokedAt:     "2026-02-20T10:00:00Z",
		UpdatedAt:     "2026-02-20T10:09:00Z",
		Task: vaultregistry.Task{
			ID: "T22", Title: "Expanded Operations Board", Kind: "prototype",
		},
		Lifecycle: []vaultregistry.Lifecycle{
			{ObservationID: "o1", ObservedAt: "2026-02-20T10:01:00Z", GoalID: "G01", Kind: "review", State: "done", Detail: "Reviewed the recorded shape."},
			{ObservationID: "o2", ObservedAt: "2026-02-20T10:02:00Z", GoalID: "G02", Kind: "verifier", State: "pending"},
			{ObservationID: "o3", ObservedAt: "2026-02-20T10:04:00Z", GoalID: "G02", Kind: "verifier", State: "active", Detail: "Comparing board structures."},
			{ObservationID: "o4", ObservedAt: "2026-02-20T10:03:30Z", GoalID: "G03", Kind: "future-kind", State: "literal-unknown"},
		},
		Evidence: []vaultregistry.Evidence{
			{ObservationID: "e1", ObservedAt: "2026-02-20T10:03:00Z", VerifierID: "G02", State: "passed", Command: "go test ./cmd/vault-hunter-atlas-prototype", ExitStatus: &exitZero, Detail: "Smoke evidence."},
		},
		Participants: []vaultregistry.Participant{
			{ParticipantID: "writer", ObservedAt: "2026-02-20T10:03:00Z", GoalID: "G02", Role: "prototype-writer"},
		},
	}

	m, err := newModel([]vaultregistry.Run{run}, "", 0, "never")
	if err != nil {
		t.Fatal(err)
	}
	m.width, m.height = 120, 32
	views := make([]string, 3)
	for variant := range views {
		m.variant = variant
		views[variant] = m.View()
		assertBounded(t, views[variant], 120, 32)
		for _, wanted := range []string{"prototype-run", "G02", variantNames[variant]} {
			if !strings.Contains(strings.ToLower(views[variant]), strings.ToLower(wanted)) {
				t.Fatalf("variant %s does not identify %q", variantNames[variant], wanted)
			}
		}
	}
	if views[0] == views[1] || views[0] == views[2] || views[1] == views[2] {
		t.Fatal("variant frames must be pairwise distinct")
	}

	m.variant = 0
	m = updateModel(t, m, tea.KeyMsg{Type: tea.KeyTab})
	if m.variant != 1 {
		t.Fatalf("Tab variant = %d, want 1", m.variant)
	}
	m = updateModel(t, m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'3'}})
	if m.variant != 2 {
		t.Fatalf("3 variant = %d, want 2", m.variant)
	}

	m.goal = 1
	m.showDetail = false
	m = updateModel(t, m, tea.WindowSizeMsg{Width: 119, Height: 31})
	diagnostic := m.View()
	wantDiagnostic := "× Operations Board needs 120×32; current 119×31\nResize terminal · q quit"
	if diagnostic != wantDiagnostic {
		t.Fatalf("undersized diagnostic:\n%q\nwant:\n%q", diagnostic, wantDiagnostic)
	}
	assertBounded(t, diagnostic, 119, 31)
	m = updateModel(t, m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	m = updateModel(t, m, tea.KeyMsg{Type: tea.KeyTab})
	m = updateModel(t, m, tea.KeyMsg{Type: tea.KeyEnter})
	m = updateModel(t, m, tea.WindowSizeMsg{Width: 120, Height: 32})
	if m.goal != 1 || m.variant != 2 || m.showDetail {
		t.Fatalf("recovery lost state: goal=%d variant=%d detail=%v", m.goal, m.variant, m.showDetail)
	}
	assertBounded(t, m.View(), 120, 32)
}

func updateModel(t *testing.T, m model, msg tea.Msg) model {
	t.Helper()
	updated, _ := m.Update(msg)
	result, ok := updated.(model)
	if !ok {
		t.Fatalf("Update returned %T, want model", updated)
	}
	return result
}

func assertBounded(t *testing.T, view string, width, height int) {
	t.Helper()
	lines := strings.Split(view, "\n")
	if len(lines) > height {
		t.Fatalf("frame has %d rows, maximum %d", len(lines), height)
	}
	for row, line := range lines {
		if got := lipgloss.Width(line); got > width {
			t.Fatalf("row %d has width %d, maximum %d: %q", row, got, width, line)
		}
	}
}

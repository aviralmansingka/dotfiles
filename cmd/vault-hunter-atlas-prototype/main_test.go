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

func TestSubagentDetailsAreHumanizedInEveryVariant(t *testing.T) {
	tests := []struct {
		name    string
		kind    string
		state   string
		detail  string
		want    []string
		notWant []string
	}{
		{
			name:   "started",
			kind:   "subagent/started",
			state:  "running",
			detail: `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-secret","parent_session_id":"session-secret","agent":"scout","task_sha256":"task-secret","cwd":"/tmp/prototype"}`,
			want:   []string{"◉ scout is working…", "cwd prototype"},
		},
		{
			name:   "successful finished hash only",
			kind:   "subagent/finished",
			state:  "completed",
			detail: `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-secret","parent_session_id":"session-secret","agent":"writer","model":"gpt-test","result_sha256":"abcdef0123456789","duration_ms":1500,"exit_status":0,"tool_count":3,"usage":{"total_tokens":1234,"cost":0.125,"turns":4},"error":""}`,
			want:   []string{"✓ writer completed", "model gpt-test", "duration 1.5s", "3 tools · 4 turns", "1234 tokens · $0.1250", "output sha abcdef012345"},
		},
		{
			name:   "failed",
			kind:   "subagent/finished",
			state:  "failed",
			detail: `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-secret","parent_session_id":"session-secret","agent":"reviewer","duration_ms":20,"exit_status":7,"tool_count":1,"usage":{"total_tokens":20,"cost":0,"turns":1},"error":"timed out"}`,
			want:   []string{"× reviewer failed", "error timed out", "exit 7"},
		},
		{
			name:    "future multiline output",
			kind:    "subagent/finished",
			state:   "completed",
			detail:  `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-secret","parent_session_id":"session-secret","agent":"writer","result_sha256":"hash-must-not-stand-in-for-output","duration_ms":40,"exit_status":0,"tool_count":1,"usage":{"total_tokens":20,"cost":0.01,"turns":1},"output":"First actual line with enough prose to wrap within the narrow dossier.\nSecond actual line."}`,
			want:    []string{"✓ writer completed", "Output", "First actual line", "dossier.", "Second actual line."},
			notWant: []string{"output sha"},
		},
		{
			name:   "plain detail",
			kind:   "note",
			state:  "active",
			detail: "A plain lifecycle note remains visible.",
			want:   []string{"A plain lifecycle note remains"},
		},
		{
			name:    "unknown json",
			kind:    "subagent/finished",
			state:   "completed",
			detail:  `{"schema":"some-future-schema/v9","tool_call_id":"do-not-show","payload":"a very long structured value that must not spread across the board"}`,
			want:    []string{"structured detail recorded"},
			notWant: []string{"some-future-schema", "very long structured value"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			run := vaultregistry.Run{
				SchemaVersion: 1,
				RunID:         "agent-presentation",
				Revision:      1,
				InvokedAt:     "2026-02-20T10:00:00Z",
				UpdatedAt:     "2026-02-20T10:01:00Z",
				Task:          vaultregistry.Task{ID: "T22", Title: "Agent output presentation", Kind: "prototype"},
				Lifecycle: []vaultregistry.Lifecycle{{
					ObservationID: "agent-observation",
					ObservedAt:    "2026-02-20T10:01:00Z",
					GoalID:        "subagent/test",
					Kind:          test.kind,
					State:         test.state,
					Detail:        test.detail,
				}},
			}
			m, err := newModel([]vaultregistry.Run{run}, "", 0, "never")
			if err != nil {
				t.Fatal(err)
			}
			m.width, m.height = 120, 32
			for variant := range variantNames {
				m.variant = variant
				view := m.View()
				assertBounded(t, view, 120, 32)
				for _, wanted := range test.want {
					if !strings.Contains(view, wanted) {
						t.Errorf("%s view does not contain %q:\n%s", variantNames[variant], wanted, view)
					}
				}
				unwantedValues := append([]string{`"schema"`, "tool_call_id", "parent_session_id", "task-secret"}, test.notWant...)
				if strings.HasPrefix(strings.TrimSpace(test.detail), "{") {
					unwantedValues = append(unwantedValues, test.detail)
				}
				for _, unwanted := range unwantedValues {
					if strings.Contains(view, unwanted) {
						t.Errorf("%s view exposes %q:\n%s", variantNames[variant], unwanted, view)
					}
				}
			}
		})
	}
}

func TestStateGlyphMappings(t *testing.T) {
	tests := map[string]string{
		"running": "◉", "active": "◉", "activated": "◉", "in-progress": "◉",
		"completed": "✓", "done": "✓", "passed": "✓", "success": "✓", "accepted": "✓",
		"failed": "×", "error": "×", "rejected": "×",
		"pending": "○", "queued": "○",
		"blocked": "!", "interrupted": "!",
		"awaiting-human-evaluation": "◇", "resuming": "↻", "literal-unknown": "?",
	}
	for state, wanted := range tests {
		if got := stateGlyph(state); got != wanted {
			t.Errorf("stateGlyph(%q) = %q, want %q", state, got, wanted)
		}
	}
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

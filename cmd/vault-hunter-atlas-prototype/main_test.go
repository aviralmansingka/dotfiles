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

func TestTrailTreeGroupsConsecutiveSubagentInvocations(t *testing.T) {
	run := prototypeRun()
	run.Lifecycle = []vaultregistry.Lifecycle{
		agentObservation("start-1", "2026-02-20T10:01:00Z", "subagent/started", "running", `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-one","agent":"context-builder","cwd":"/tmp/task-one"}`),
		agentObservation("finish-1", "2026-02-20T10:01:50Z", "subagent/finished", "completed", `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-one","agent":"context-builder","model":"gpt-5.6-luna","result_sha256":"d2c34561abcdef","duration_ms":49500,"exit_status":0,"tool_count":10,"usage":{"total_tokens":51400,"cost":0.0272,"turns":7}}`),
		agentObservation("start-2", "2026-02-20T10:02:00Z", "subagent/started", "running", `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-two","agent":"context-builder","cwd":"/tmp/task-two"}`),
	}
	run.Participants = []vaultregistry.Participant{
		{ParticipantID: "headless-first", ObservedAt: "2026-02-20T10:01:01Z", GoalID: "subagent/context-builder", Role: "context-builder"},
		{ParticipantID: "headless-second", ObservedAt: "2026-02-20T10:02:01Z", GoalID: "subagent/context-builder", Role: "context-builder"},
	}

	view, m := prototypeView(t, run, 0)
	assertBounded(t, view, 120, 32)
	for _, wanted := range []string{
		"└─ ▶ ▾ ◉ subagent/context-builder",
		"├─ ✓ context-builder · completed · 49.5s",
		"│  ├─ model gpt-5.6-luna",
		"10 tools · 7 turns · 51.4k tokens · $0.0272",
		"participant headless-first",
		"Result digest d2c34561…",
		"└─ ◉ context-builder · working…",
		"participant headless-second",
		"└─ cwd task-two",
	} {
		if !strings.Contains(view, wanted) {
			t.Errorf("trail tree does not contain %q:\n%s", wanted, view)
		}
	}
	if strings.Count(view, "context-builder · completed") != 1 || strings.Count(view, "context-builder · working…") != 1 {
		t.Fatalf("invocation summaries were duplicated:\n%s", view)
	}
	if strings.Index(view, "context-builder · completed") > strings.Index(view, "context-builder · working…") {
		t.Fatalf("invocations are not chronological:\n%s", view)
	}
	assertNoRawSubagentFields(t, view)

	collapsed := updateModel(t, m, tea.KeyMsg{Type: tea.KeyEnter}).View()
	assertBounded(t, collapsed, 120, 32)
	if !strings.Contains(collapsed, "▶ ▸ ◉ subagent/context-builder") {
		t.Fatalf("collapsed goal has no disclosure marker:\n%s", collapsed)
	}
	for _, hidden := range []string{"context-builder · completed", "headless-first", "cwd task-two"} {
		if strings.Contains(collapsed, hidden) {
			t.Errorf("collapsed goal retains %q:\n%s", hidden, collapsed)
		}
	}
}

func TestAgentFailuresAndFutureOutputStayVisibleUnderPressure(t *testing.T) {
	run := prototypeRun()
	run.Lifecycle = []vaultregistry.Lifecycle{
		agentObservation("start-failed", "2026-02-20T10:01:00Z", "subagent/started", "running", `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-failed","agent":"context-builder","cwd":"/tmp/task-failed"}`),
		agentObservation("finish-failed", "2026-02-20T10:01:03Z", "subagent/finished", "failed", `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-failed","agent":"context-builder","duration_ms":3200,"exit_status":7,"tool_count":2,"usage":{"total_tokens":900,"cost":0.001,"turns":2},"error":"Timed out while reading the bounded context and the complete error remains visible."}`),
		agentObservation("start-output", "2026-02-20T10:02:00Z", "subagent/started", "running", `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-output","agent":"context-builder","cwd":"/tmp/task-output"}`),
		agentObservation("finish-output", "2026-02-20T10:02:05Z", "subagent/finished", "completed", `{"schema":"vault-hunter-subagent/v1","tool_call_id":"call-output","agent":"context-builder","result_sha256":"hash-must-not-be-called-output","duration_ms":5000,"exit_status":0,"tool_count":3,"usage":{"total_tokens":1234,"cost":0.0125,"turns":4},"output":"First actual output line is deliberately long enough to wrap across the available nested tree width without clipping any meaningful report text, including this retained ending.\nSecond actual output line is preserved."}`),
	}
	run.Participants = []vaultregistry.Participant{{ParticipantID: "headless-failed", ObservedAt: "2026-02-20T10:01:01Z", GoalID: "subagent/context-builder", Role: "context-builder"}}

	for _, variant := range []int{0, 2} {
		view, _ := prototypeView(t, run, variant)
		assertBounded(t, view, 120, 32)
		for _, wanted := range []string{
			"× context-builder · failed · 3.2s",
			"Error · exit 7",
			"complete error remains visible.",
			"✓ context-builder · completed · 5s",
			"Output",
			"First actual output line",
			"including this retained ending.",
			"Second actual output line is preserved.",
		} {
			if !strings.Contains(view, wanted) {
				t.Errorf("%s view does not contain %q:\n%s", variantNames[variant], wanted, view)
			}
		}
		if strings.Contains(view, "Result digest hash-must") {
			t.Errorf("%s substitutes a digest for actual output:\n%s", variantNames[variant], view)
		}
		assertNoRawSubagentFields(t, view)
	}

	timeView, _ := prototypeView(t, run, 1)
	assertBounded(t, timeView, 120, 32)
	for _, wanted := range []string{"Output", "First actual output line", "Second actual output line is"} {
		if !strings.Contains(timeView, wanted) {
			t.Errorf("time river dossier lost %q:\n%s", wanted, timeView)
		}
	}
}

func TestPlainObservationsAreHumanizedWrappedAndCollapsible(t *testing.T) {
	exitZero := 0
	run := prototypeRun()
	run.Lifecycle = []vaultregistry.Lifecycle{
		{ObservationID: "review", ObservedAt: "2026-02-20T10:01:00Z", GoalID: "plain-goal", Kind: "review", State: "done", Detail: "Reviewed a meaningful lifecycle narrative that stays readable instead of becoming a raw tag chain."},
		{ObservationID: "future", ObservedAt: "2026-02-20T10:03:00Z", GoalID: "plain-goal", Kind: "future-kind", State: "literal-unknown", Detail: `{"schema":"some-future-schema/v9","payload":"must remain hidden"}`},
	}
	run.Evidence = []vaultregistry.Evidence{{ObservationID: "evidence", ObservedAt: "2026-02-20T10:02:00Z", VerifierID: "plain-goal", State: "passed", Command: "go test ./cmd/vault-hunter-atlas-prototype", ExitStatus: &exitZero, Detail: "Evidence detail remains human-readable and wrapped."}}

	view, m := prototypeView(t, run, 0)
	assertBounded(t, view, 120, 32)
	for _, wanted := range []string{
		"▶ ▾ ? plain-goal · future-kind · literal-unknown",
		"10:01:00  ✓ Review",
		"Reviewed a meaningful lifecycle narrative",
		"10:02:00  ✓ Verification passed · exit 0",
		"Evidence detail remains human-readable and wrapped.",
		"10:03:00  ? future-kind · literal-unknown",
		"Structured detail recorded",
	} {
		if !strings.Contains(view, wanted) {
			t.Errorf("plain trace does not contain %q:\n%s", wanted, view)
		}
	}
	for _, unwanted := range []string{"plain-goal · review · done", "some-future-schema", "must remain hidden"} {
		if strings.Contains(view, unwanted) {
			t.Errorf("plain trace exposes %q:\n%s", unwanted, view)
		}
	}

	collapsed := updateModel(t, m, tea.KeyMsg{Type: tea.KeyEnter}).View()
	if !strings.Contains(collapsed, "▶ ▸ ? plain-goal · future-kind · literal-unknown") || strings.Contains(collapsed, "Reviewed a meaningful lifecycle") {
		t.Fatalf("plain goal did not collapse cleanly:\n%s", collapsed)
	}
	assertBounded(t, collapsed, 120, 32)
}

func prototypeRun() vaultregistry.Run {
	return vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         "agent-presentation",
		Revision:      1,
		InvokedAt:     "2026-02-20T10:00:00Z",
		UpdatedAt:     "2026-02-20T10:04:00Z",
		Task:          vaultregistry.Task{ID: "T22", Title: "Agent tree presentation", Kind: "prototype"},
	}
}

func agentObservation(id, at, kind, state, detail string) vaultregistry.Lifecycle {
	return vaultregistry.Lifecycle{ObservationID: id, ObservedAt: at, GoalID: "subagent/context-builder", Kind: kind, State: state, Detail: detail}
}

func prototypeView(t *testing.T, run vaultregistry.Run, variant int) (string, model) {
	t.Helper()
	m, err := newModel([]vaultregistry.Run{run}, "", variant, "never")
	if err != nil {
		t.Fatal(err)
	}
	m.width, m.height = 120, 32
	return m.View(), m
}

func assertNoRawSubagentFields(t *testing.T, view string) {
	t.Helper()
	for _, unwanted := range []string{"vault-hunter-subagent/v1", "tool_call_id", `"schema"`, "subagent/started", "subagent/finished", "call-one", "call-two"} {
		if strings.Contains(view, unwanted) {
			t.Errorf("view exposes %q:\n%s", unwanted, view)
		}
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

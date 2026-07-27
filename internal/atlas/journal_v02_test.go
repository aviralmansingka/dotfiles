package atlas

import (
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT08V02BoundedJournalInteraction(t *testing.T) {
	run := journalInteractionRun()

	t.Run("all event and category navigation is strict and bounded", func(t *testing.T) {
		m := NewJournalModel(run, 80, 24)
		if cmd := m.Init(); cmd != nil {
			t.Fatal("journal scheduled a command")
		}
		assertJournalSelection(t, m, "verifier-last")

		for _, key := range []tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'j'}}, {Type: tea.KeyDown}} {
			m = journalUpdate(t, m, key)
			assertJournalSelection(t, m, "verifier-last")
		}
		m = journalUpdate(t, m, runeKey('g'))
		assertJournalSelection(t, m, "life-first")
		for _, key := range []tea.KeyMsg{{Type: tea.KeyRunes, Runes: []rune{'k'}}, {Type: tea.KeyUp}} {
			m = journalUpdate(t, m, key)
			assertJournalSelection(t, m, "life-first")
		}
		m = journalUpdate(t, m, runeKey('j'))
		assertJournalSelection(t, m, "evidence-a")
		m = journalUpdate(t, m, tea.KeyMsg{Type: tea.KeyDown})
		assertJournalSelection(t, m, "verifier-a")
		m = journalUpdate(t, m, runeKey('G'))
		assertJournalSelection(t, m, "verifier-last")

		m = journalUpdate(t, m, runeKey('g'))
		m = journalUpdate(t, m, runeKey('v'))
		assertJournalSelection(t, m, "verifier-a")
		m = journalUpdate(t, m, runeKey('v'))
		assertJournalSelection(t, m, "verifier-last")
		m = journalUpdate(t, m, runeKey('v'))
		assertJournalSelection(t, m, "verifier-last")
		m = journalUpdate(t, m, runeKey('V'))
		assertJournalSelection(t, m, "verifier-a")
		m = journalUpdate(t, m, runeKey('V'))
		assertJournalSelection(t, m, "verifier-a")

		m = journalUpdate(t, m, runeKey('g'))
		for _, want := range []string{"evidence-a", "evidence-b", "evidence-c", "evidence-c"} {
			m = journalUpdate(t, m, runeKey('e'))
			assertJournalSelection(t, m, want)
		}
		for _, want := range []string{"evidence-b", "evidence-a", "evidence-a"} {
			m = journalUpdate(t, m, runeKey('E'))
			assertJournalSelection(t, m, want)
		}
	})

	t.Run("detail toggles and quit keys are exact", func(t *testing.T) {
		m := NewJournalModel(run, 100, 30)
		expanded := m.View()
		if !strings.Contains(expanded, "Selected Event Detail") || !strings.Contains(expanded, "verifier-last-detail") {
			t.Fatal("initial selected-event detail is not expanded")
		}
		m = journalUpdate(t, m, tea.KeyMsg{Type: tea.KeyEnter})
		if strings.Contains(m.View(), "Selected Event Detail") || strings.Contains(m.View(), "verifier-last-detail") {
			t.Fatal("Enter did not collapse selected-event detail")
		}
		m = journalUpdate(t, m, tea.KeyMsg{Type: tea.KeyEnter})
		if m.View() != expanded {
			t.Fatal("second Enter did not restore selected-event detail")
		}
		for _, key := range []tea.KeyMsg{
			runeKey('q'),
			{Type: tea.KeyEsc},
			{Type: tea.KeyCtrlC},
		} {
			_, cmd := NewJournalModel(run, 80, 24).Update(key)
			if cmd == nil {
				t.Fatalf("%v did not request quit", key)
			}
			if _, ok := cmd().(tea.QuitMsg); !ok {
				t.Fatalf("%v returned a non-quit command", key)
			}
		}
	})

	t.Run("empty journal navigation and detail are no-ops", func(t *testing.T) {
		m := NewJournalModel(vaultregistry.Run{}, 80, 24)
		before := m.View()
		if !strings.Contains(before, "no recorded journal events") || strings.Contains(before, "> ") {
			t.Fatalf("unexpected empty journal:\n%s", before)
		}
		for _, key := range []tea.KeyMsg{
			runeKey('j'), {Type: tea.KeyDown}, runeKey('k'), {Type: tea.KeyUp},
			runeKey('g'), runeKey('G'), runeKey('v'), runeKey('V'),
			runeKey('e'), runeKey('E'), {Type: tea.KeyEnter},
		} {
			m = journalUpdate(t, m, key)
			if m.View() != before {
				t.Fatalf("%v changed empty journal", key)
			}
		}
	})

	t.Run("resize preserves a visible bounded selection", func(t *testing.T) {
		var lifecycle []vaultregistry.Lifecycle
		for i := 0; i < 40; i++ {
			lifecycle = append(lifecycle, vaultregistry.Lifecycle{
				ObservationID: fmt.Sprintf("life-%02d", i),
				ObservedAt:    fmt.Sprintf("2026-07-26T10:%02d:00Z", i),
				GoalID:        fmt.Sprintf("goal-%02d", i),
				Kind:          "checkpoint",
				State:         "done",
				Detail:        fmt.Sprintf("detail-%02d", i),
			})
		}
		m := NewJournalModel(vaultregistry.Run{Lifecycle: lifecycle}, 80, 24)
		assertJournalSelection(t, m, "life-39")
		m = journalUpdate(t, m, runeKey('g'))
		assertJournalSelection(t, m, "life-00")
		for _, size := range []tea.WindowSizeMsg{{Width: 100, Height: 30}, {Width: 80, Height: 24}} {
			m = journalUpdate(t, m, size)
			assertJournalSelection(t, m, "life-00")
			assertJournalBounds(t, m.View(), size.Width, size.Height)
		}
		m = journalUpdate(t, m, runeKey('G'))
		assertJournalSelection(t, m, "life-39")
		m = journalUpdate(t, m, tea.WindowSizeMsg{Width: 79, Height: 23})
		if got := m.View(); got != "terminal too small; minimum 80×24" {
			t.Fatalf("79x23 view = %q", got)
		}
		m = journalUpdate(t, m, tea.WindowSizeMsg{Width: 1, Height: 1})
		assertJournalBounds(t, m.View(), 1, 1)
		m = journalUpdate(t, m, tea.WindowSizeMsg{Width: 80, Height: 24})
		assertJournalSelection(t, m, "life-39")
		assertJournalBounds(t, m.View(), 80, 24)
	})
}

func journalInteractionRun() vaultregistry.Run {
	exit := 1
	return vaultregistry.Run{
		Lifecycle: []vaultregistry.Lifecycle{
			{ObservationID: "life-first", ObservedAt: "2026-07-26T10:00:00Z", GoalID: "first", Kind: "checkpoint", State: "done"},
			{ObservationID: "verifier-a", ObservedAt: "2026-07-26T10:02:00Z", GoalID: "T08.V01", Kind: "verifier", State: "done"},
			{ObservationID: "review", ObservedAt: "2026-07-26T10:04:00Z", GoalID: "review", Kind: "review", State: "done"},
			{ObservationID: "verifier-last", ObservedAt: "2026-07-26T10:06:00Z", GoalID: "T08.V02", Kind: "verifier", State: "active", Detail: "verifier-last-detail"},
		},
		Evidence: []vaultregistry.Evidence{
			{ObservationID: "evidence-a", ObservedAt: "2026-07-26T10:01:00Z", VerifierID: "T08.V01", State: "passed"},
			{ObservationID: "evidence-b", ObservedAt: "2026-07-26T10:03:00Z", VerifierID: "T08.V01", State: "failed", ExitStatus: &exit},
			{ObservationID: "evidence-c", ObservedAt: "2026-07-26T10:05:00Z", VerifierID: "T08.V02", State: "recorded"},
		},
	}
}

func runeKey(key rune) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{key}}
}

func journalUpdate(t *testing.T, m JournalModel, msg tea.Msg) JournalModel {
	t.Helper()
	next, cmd := m.Update(msg)
	if cmd != nil {
		t.Fatalf("%T unexpectedly scheduled a command", msg)
	}
	got, ok := next.(JournalModel)
	if !ok {
		t.Fatalf("Update returned %T, want atlas.JournalModel", next)
	}
	return got
}

func assertJournalSelection(t *testing.T, m JournalModel, observationID string) {
	t.Helper()
	view := m.View()
	var selected []string
	for _, line := range strings.Split(view, "\n") {
		if strings.HasPrefix(line, "> ") {
			selected = append(selected, line)
		}
	}
	if len(selected) != 1 || !strings.Contains(selected[0], observationID) {
		t.Fatalf("selected marker = %q, want %q visible exactly once", selected, observationID)
	}
}

func assertJournalBounds(t *testing.T, frame string, width, height int) {
	t.Helper()
	lines := strings.Split(frame, "\n")
	if len(lines) > height {
		t.Fatalf("frame has %d rows, want at most %d", len(lines), height)
	}
	for row, line := range lines {
		if cells := lipgloss.Width(line); cells > width {
			t.Fatalf("row %d has %d display cells, want at most %d", row+1, cells, width)
		}
	}
}

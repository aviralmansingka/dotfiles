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
		if !strings.Contains(expanded, "selected recorded observation · lifecycle") ||
			!strings.Contains(expanded, "observation ID · verifier-last") ||
			!strings.Contains(expanded, "detail · verifier-last-detail") {
			t.Fatal("initial D selected-event card is not expanded")
		}
		m = journalUpdate(t, m, tea.KeyMsg{Type: tea.KeyEnter})
		if strings.Contains(m.View(), "selected recorded observation") {
			t.Fatal("Enter did not collapse D selected-event card")
		}
		m = journalUpdate(t, m, tea.KeyMsg{Type: tea.KeyEnter})
		if m.View() != expanded {
			t.Fatal("second Enter did not restore D selected-event card")
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
		if !strings.Contains(before, "no recorded journal events") ||
			!strings.Contains(before, "0 lifecycle · 0 evidence · 0 total") ||
			strings.Contains(before, "selected recorded observation") {
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
		assertJournalWindow(t, m.View(), []string{"detail-00", "detail-01"}, "(0 earlier, 38 later)")
		m = journalUpdate(t, m, tea.WindowSizeMsg{Width: 100, Height: 30})
		assertJournalSelection(t, m, "life-00")
		assertJournalWindow(t, m.View(), []string{"detail-00", "detail-01", "detail-02", "detail-03"}, "(0 earlier, 36 later)")
		assertJournalBounds(t, m.View(), 100, 30)
		m = journalUpdate(t, m, tea.WindowSizeMsg{Width: 80, Height: 24})
		assertJournalSelection(t, m, "life-00")
		assertJournalWindow(t, m.View(), []string{"detail-00", "detail-01"}, "(0 earlier, 38 later)")
		assertJournalBounds(t, m.View(), 80, 24)
		m = journalUpdate(t, m, runeKey('G'))
		assertJournalSelection(t, m, "life-39")
		assertJournalWindow(t, m.View(), []string{"detail-38", "detail-39"}, "(38 earlier, 0 later)")

		m = journalUpdate(t, m, tea.KeyMsg{Type: tea.KeyEnter})
		assertJournalSelection(t, m, "life-39")
		assertJournalWindow(t, m.View(), []string{"detail-36", "detail-37", "detail-38", "detail-39"}, "(36 earlier, 0 later)")
		if strings.Contains(m.View(), "selected recorded observation") {
			t.Fatal("collapsed D card remained visible")
		}
		m = journalUpdate(t, m, tea.WindowSizeMsg{Width: 100, Height: 30})
		assertJournalWindow(t, m.View(),
			[]string{"detail-34", "detail-35", "detail-36", "detail-37", "detail-38", "detail-39"},
			"(34 earlier, 0 later)")
		m = journalUpdate(t, m, tea.KeyMsg{Type: tea.KeyEnter})
		assertJournalSelection(t, m, "life-39")
		assertJournalWindow(t, m.View(), []string{"detail-36", "detail-37", "detail-38", "detail-39"}, "(36 earlier, 0 later)")

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

func TestT08V02InteractiveColorPreservesFaithfulComposition(t *testing.T) {
	colored := NewJournalModel(journalInteractionRun(), 80, 24).WithColor(true)
	plain := NewJournalModel(journalInteractionRun(), 80, 24)

	assertInteractiveJournalEquivalent(t, colored, plain, "initial")
	for _, step := range []struct {
		name string
		msg  tea.Msg
	}{
		{"evidence jump", runeKey('E')},
		{"detail collapse", tea.KeyMsg{Type: tea.KeyEnter}},
		{"detail expand", tea.KeyMsg{Type: tea.KeyEnter}},
		{"wide resize", tea.WindowSizeMsg{Width: 134, Height: 32}},
	} {
		colored = journalUpdate(t, colored, step.msg)
		plain = journalUpdate(t, plain, step.msg)
		assertInteractiveJournalEquivalent(t, colored, plain, step.name)
	}
}

func assertInteractiveJournalEquivalent(t *testing.T, colored, plain JournalModel, state string) {
	t.Helper()
	got := colored.View()
	if !strings.Contains(got, "\x1b[38;2;") {
		t.Errorf("%s attached-terminal frame contains no semantic true-color SGR", state)
	} else {
		assertExpectedJournalSGR(t, got)
	}
	if stripped := stripJournalANSI(got); stripped != plain.View() {
		t.Errorf("%s attached-terminal frame changed approved plain D composition", state)
	}
	if footer := strings.Split(stripJournalANSI(got), "\n"); footer[len(footer)-1] != journalFooter(colored.width) {
		t.Errorf("%s attached-terminal footer = %q, want %q", state, footer[len(footer)-1], journalFooter(colored.width))
	}
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
	if len(m.events) == 0 {
		t.Fatalf("selected observation = none, want %q", observationID)
	}
	event := m.events[m.selected]
	got := ""
	if event.lifecycle != nil {
		got = event.lifecycle.ObservationID
	} else {
		got = event.evidence.ObservationID
	}
	if got != observationID {
		t.Fatalf("selected observation = %q, want %q", got, observationID)
	}
	if !strings.Contains(m.View(), "· selected") {
		t.Fatalf("selected observation %q is not visible in D rail", observationID)
	}
}

func assertJournalWindow(t *testing.T, view string, details []string, omission string) {
	t.Helper()
	assertVisibleJournalDetails(t, view, details, nil)
	if !strings.Contains(view, omission) {
		t.Errorf("D viewport missing omission %q", omission)
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

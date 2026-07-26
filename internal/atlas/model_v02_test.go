package atlas

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT02V02KeyboardResizeAndMotion(t *testing.T) {
	run := vaultregistry.Run{
		RunID: "run", Task: vaultregistry.Task{ID: "T02", Title: "Atlas"},
		Lifecycle: []vaultregistry.Lifecycle{
			{GoalID: "one", Kind: "verifier", State: "done", ObservedAt: "2026-07-26T10:00:00Z", Detail: "first detail"},
			{GoalID: "two", Kind: "verifier", State: "active", ObservedAt: "2026-07-26T10:01:00Z", Detail: "second detail"},
			{GoalID: "three", Kind: "review", State: "pending", ObservedAt: "2026-07-26T10:02:00Z", Detail: "third detail"},
		},
	}

	t.Run("navigation clamps and detail toggles", func(t *testing.T) {
		m := NewModel(run, 100, 30)
		if m.selected != 1 {
			t.Fatalf("initial selection = %d, want 1", m.selected)
		}
		m = update(t, m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
		m = update(t, m, tea.KeyMsg{Type: tea.KeyDown})
		if m.selected != 2 {
			t.Fatalf("Down wrapped past last goal to %d", m.selected)
		}
		m = update(t, m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
		m = update(t, m, tea.KeyMsg{Type: tea.KeyUp})
		m = update(t, m, tea.KeyMsg{Type: tea.KeyUp})
		if m.selected != 0 {
			t.Fatalf("Up wrapped past first goal to %d", m.selected)
		}
		before := m.View()
		m = update(t, m, tea.KeyMsg{Type: tea.KeyEnter})
		after := m.View()
		if before == after || strings.Contains(after, "first detail") {
			t.Fatal("Enter did not collapse the selected detail")
		}
		m = update(t, m, tea.KeyMsg{Type: tea.KeyEnter})
		if m.View() != before {
			t.Fatal("second Enter did not restore the detail")
		}
	})

	t.Run("quit keys return Bubble Tea quit command", func(t *testing.T) {
		for _, key := range []tea.KeyMsg{
			{Type: tea.KeyRunes, Runes: []rune{'q'}},
			{Type: tea.KeyEsc},
			{Type: tea.KeyCtrlC},
		} {
			_, cmd := NewModel(run, 80, 24).Update(key)
			if cmd == nil {
				t.Fatalf("%v did not request quit", key)
			}
			if _, ok := cmd().(tea.QuitMsg); !ok {
				t.Fatalf("%v returned a non-quit command", key)
			}
		}
	})

	t.Run("sizes are bounded and resize preserves selection", func(t *testing.T) {
		m := NewModel(run, 100, 30)
		m = update(t, m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
		for _, size := range []tea.WindowSizeMsg{{Width: 100, Height: 30}, {Width: 80, Height: 24}} {
			m = update(t, m, size)
			assertBounds(t, m.View(), size.Width, size.Height)
		}
		m = update(t, m, tea.WindowSizeMsg{Width: 79, Height: 23})
		if got := m.View(); got != "terminal too small; minimum 80×24" {
			t.Fatalf("79x23 view = %q", got)
		}
		if m.selected != 2 {
			t.Fatalf("too-small resize changed selection to %d", m.selected)
		}
		m = update(t, m, tea.WindowSizeMsg{Width: 80, Height: 24})
		if m.selected != 2 || !strings.Contains(m.View(), "▶ ● three") {
			t.Fatal("supported-size recovery did not preserve selection")
		}
	})

	t.Run("motion changes only one activity glyph", func(t *testing.T) {
		t.Setenv("VAULT_HUNTER_REDUCED_MOTION", "")
		m := NewModel(run, 80, 24)
		cmd := m.Init()
		if cmd == nil {
			t.Fatal("default interactive model did not schedule animation")
		}
		before := m.View()
		msg := make(chan tea.Msg, 1)
		go func() { msg <- cmd() }()
		select {
		case tick := <-msg:
			m = update(t, m, tick)
		case <-time.After(time.Second):
			t.Fatal("animation command did not produce a tick")
		}
		after := m.View()
		if runeDifferences(before, after) != 1 {
			t.Fatalf("animation changed more than one glyph:\n%s", after)
		}
	})

	t.Run("reduced motion is static", func(t *testing.T) {
		t.Setenv("VAULT_HUNTER_REDUCED_MOTION", "1")
		m := NewModel(run, 80, 24)
		if cmd := m.Init(); cmd != nil {
			t.Fatal("reduced-motion model scheduled animation")
		}
		if m.View() != m.View() {
			t.Fatal("reduced-motion frames differ")
		}
	})
}

func update(t *testing.T, m Model, msg tea.Msg) Model {
	t.Helper()
	next, _ := m.Update(msg)
	got, ok := next.(Model)
	if !ok {
		t.Fatalf("Update returned %T, want atlas.Model", next)
	}
	return got
}

func assertBounds(t *testing.T, frame string, width, height int) {
	t.Helper()
	lines := strings.Split(frame, "\n")
	if len(lines) > height {
		t.Fatalf("frame has %d rows, want at most %d", len(lines), height)
	}
	for i, line := range lines {
		if lipgloss.Width(line) > width {
			t.Fatalf("row %d has display width %d, want at most %d", i+1, lipgloss.Width(line), width)
		}
	}
}

func runeDifferences(a, b string) int {
	ar, br := []rune(a), []rune(b)
	if len(ar) != len(br) {
		return max(len(ar), len(br))
	}
	different := 0
	for i := range ar {
		if ar[i] != br[i] {
			different++
		}
	}
	return different
}

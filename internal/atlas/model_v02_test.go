package atlas

import (
	"fmt"
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
		m = update(t, m, tea.WindowSizeMsg{Width: 1, Height: 1})
		tiny := m.View()
		assertBounds(t, tiny, 1, 1)
		if tiny == "" || m.View() != tiny {
			t.Fatal("1x1 projection is empty or nondeterministic")
		}
		m = update(t, m, tea.WindowSizeMsg{Width: 80, Height: 24})
		if m.selected != 2 || !strings.Contains(m.View(), "▶ ● three") {
			t.Fatal("supported-size recovery did not preserve selection")
		}
	})

	t.Run("long goal list keeps selection visible without wrapping", func(t *testing.T) {
		var lifecycle []vaultregistry.Lifecycle
		for i := 0; i < 30; i++ {
			state := "done"
			if i == 29 {
				state = "active"
			}
			lifecycle = append(lifecycle, vaultregistry.Lifecycle{
				GoalID: fmt.Sprintf("goal-%02d", i), Kind: "verifier", State: state,
				ObservedAt: fmt.Sprintf("2026-07-26T10:%02d:00Z", i),
			})
		}
		m := NewModel(vaultregistry.Run{Lifecycle: lifecycle}, 80, 24)
		assertSelectedGoalVisible(t, m, "goal-29")
		for range lifecycle {
			m = update(t, m, tea.KeyMsg{Type: tea.KeyUp})
		}
		if m.selected != 0 {
			t.Fatalf("long-list Up wrapped to %d", m.selected)
		}
		assertSelectedGoalVisible(t, m, "goal-00")
		for range lifecycle {
			m = update(t, m, tea.KeyMsg{Type: tea.KeyDown})
		}
		if m.selected != 29 {
			t.Fatalf("long-list Down wrapped to %d", m.selected)
		}
		assertSelectedGoalVisible(t, m, "goal-29")
	})

	t.Run("long journey keeps current context visible", func(t *testing.T) {
		longRun := vaultregistry.Run{}
		for i := 0; i < 24; i++ {
			longRun.Lifecycle = append(longRun.Lifecycle, vaultregistry.Lifecycle{
				GoalID: "long", Kind: "verifier", State: "active",
				ObservedAt: fmt.Sprintf("2026-07-26T10:%02d:00Z", i),
				Detail:     fmt.Sprintf("journey-%02d", i),
			})
		}
		exit := 1
		longRun.Evidence = []vaultregistry.Evidence{{
			VerifierID: "long", ObservedAt: "2026-07-26T10:24:00Z",
			State: "red", Detail: "tail-evidence", ExitStatus: &exit,
		}}
		longRun.Participants = []vaultregistry.Participant{{
			ParticipantID: "tail-participant", GoalID: "long", Role: "verifier",
			ObservedAt: "2026-07-26T10:25:00Z",
		}}
		view := NewModel(longRun, 100, 30).View()
		assertBounds(t, view, 100, 30)
		for _, want := range []string{"journey-23", "tail-evidence", "tail-participant"} {
			if !strings.Contains(view, want) {
				t.Errorf("long journey omitted current context %q", want)
			}
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

func assertSelectedGoalVisible(t *testing.T, m Model, goalID string) {
	t.Helper()
	view := m.View()
	assertBounds(t, view, m.width, m.height)
	selected := ""
	for _, line := range strings.Split(view, "\n") {
		if strings.Contains(line, "▶") {
			selected = line
		}
	}
	if strings.Count(view, "▶") != 1 || !strings.Contains(selected, goalID) {
		t.Errorf("selected goal %q is not visible exactly once", goalID)
	}
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

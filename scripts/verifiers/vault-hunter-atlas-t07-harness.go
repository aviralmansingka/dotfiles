package main

import (
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/aviral/dotfiles/internal/atlas"
	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type checks struct {
	failures int
}

func (c *checks) want(ok bool, format string, args ...any) {
	if ok {
		return
	}
	fmt.Fprintf(os.Stderr, "T07.V02: "+format+"\n", args...)
	c.failures++
}

func (c *checks) drive(model atlas.Model, msg tea.Msg) (atlas.Model, tea.Cmd) {
	next, cmd := model.Update(msg)
	updated, ok := next.(atlas.Model)
	c.want(ok, "Update returned %T, want atlas.Model", next)
	if !ok {
		return model, cmd
	}
	return updated, cmd
}

func (c *checks) frame(model atlas.Model, width, height int, label string) string {
	first := model.ExpandedView()
	c.want(first == model.ExpandedView(), "%s frame is nondeterministic", label)
	lines := strings.Split(first, "\n")
	c.want(len(lines) <= height, "%s frame has %d rows, want at most %d", label, len(lines), height)
	for i, line := range lines {
		c.want(lipgloss.Width(line) <= width, "%s row %d has %d cells, want at most %d", label, i+1, lipgloss.Width(line), width)
	}
	return first
}

func selected(view, goal string) bool {
	return strings.Contains(view, "VERIFIER LEDGER · Goal "+goal+" ·")
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: vault-hunter-atlas-t07-harness <state-dir>")
		os.Exit(2)
	}
	reader, err := vaultregistry.OpenReader(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	run, err := reader.Get("atlas-t07-rich")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	var c checks
	model := atlas.NewModel(run, 160, 48)
	initial := c.frame(model, 160, 48, "initial 160x48")
	c.want(selected(initial, "T07.V01"), "initial active Goal is not selected and visible")

	first, _ := c.drive(model, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	c.want(selected(c.frame(first, 160, 48, "k to first"), "checkpoint-one"), "k did not select the first normalized Goal")
	first, _ = c.drive(first, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	firstView := c.frame(first, 160, 48, "k clamped at first")
	first, _ = c.drive(first, tea.KeyMsg{Type: tea.KeyUp})
	c.want(c.frame(first, 160, 48, "Up clamped at first") == firstView, "k/Up did not clamp at the first Goal")

	last, _ := c.drive(first, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	last, _ = c.drive(last, tea.KeyMsg{Type: tea.KeyDown})
	c.want(selected(c.frame(last, 160, 48, "Down to last"), "review"), "j/Down did not select the last normalized Goal")
	last, _ = c.drive(last, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	lastView := c.frame(last, 160, 48, "j clamped at last")
	last, _ = c.drive(last, tea.KeyMsg{Type: tea.KeyDown})
	c.want(c.frame(last, 160, 48, "Down clamped at last") == lastView, "j/Down did not clamp at the last Goal")

	detail := "behavioral baseline red with wide text 東京 and deterministic truncation"
	beforeCount := strings.Count(initial, detail)
	c.want(beforeCount >= 2, "initial selected-Goal detail is not visible in timeline and ledger")
	collapsed, _ := c.drive(model, tea.KeyMsg{Type: tea.KeyEnter})
	collapsedView := c.frame(collapsed, 160, 48, "detail collapsed")
	c.want(selected(collapsedView, "T07.V01"), "Enter changed the selected Goal")
	c.want(strings.Count(collapsedView, detail) == beforeCount-1, "Enter did not collapse only the selected-Goal detail")
	restored, _ := c.drive(collapsed, tea.KeyMsg{Type: tea.KeyEnter})
	c.want(c.frame(restored, 160, 48, "detail restored") == initial, "second Enter did not restore selected-Goal detail")

	for _, key := range []tea.KeyMsg{
		{Type: tea.KeyRunes, Runes: []rune{'q'}},
		{Type: tea.KeyEsc},
		{Type: tea.KeyCtrlC},
	} {
		_, cmd := c.drive(model, key)
		c.want(cmd != nil, "%q did not request quit", key.String())
		if cmd != nil {
			_, ok := cmd().(tea.QuitMsg)
			c.want(ok, "%q returned a non-quit command", key.String())
		}
	}

	resized := collapsed
	for _, size := range []tea.WindowSizeMsg{{Width: 160, Height: 48}, {Width: 120, Height: 32}} {
		resized, _ = c.drive(resized, size)
		view := c.frame(resized, size.Width, size.Height, fmt.Sprintf("%dx%d", size.Width, size.Height))
		c.want(selected(view, "T07.V01"), "%dx%d resize lost the selected Goal", size.Width, size.Height)
		c.want(strings.Count(view, detail) == beforeCount-1, "%dx%d resize lost collapsed detail state", size.Width, size.Height)
	}
	resized, _ = c.drive(resized, tea.WindowSizeMsg{Width: 119, Height: 31})
	tooSmall := c.frame(resized, 119, 31, "119x31")
	c.want(tooSmall == "terminal too small; minimum 120×32", "below-minimum frame = %q", tooSmall)
	resized, _ = c.drive(resized, tea.WindowSizeMsg{Width: 160, Height: 48})
	recovered := c.frame(resized, 160, 48, "recovered 160x48")
	c.want(selected(recovered, "T07.V01"), "recovery lost the selected Goal")
	c.want(strings.Count(recovered, detail) == beforeCount-1, "recovery lost collapsed detail state")

	if c.failures != 0 {
		fmt.Fprintf(os.Stderr, "T07.V02: %d behavioral assertion(s) failed\n", c.failures)
		os.Exit(1)
	}
}

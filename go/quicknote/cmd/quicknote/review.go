package main

import (
	"errors"
	"fmt"
	"image/color"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
)

// A capture is one pending fleeting note waiting to become an atomic note.
type capture struct {
	Path   string
	Slug   string
	Title  string
	Detail []string
	Age    time.Duration // how long the thought has waited
	At     time.Time     // when it was captured, from the frontmatter
	Due    string
}

// queue reads the pending captures: every fleeting note whose review_due has
// arrived, oldest first, so nothing rots at the bottom.
func queue(vault string, now time.Time) ([]capture, error) {
	dir := filepath.Join(vault, "0_inbox", fleetingTag)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	today := now.Format("2006-01-02")
	var out []capture
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		c, err := readCapture(path)
		if err != nil {
			return nil, err
		}
		// A snoozed note stays out of the queue until its day arrives.
		if c.Due != "" && c.Due > today {
			continue
		}
		// Age comes from the capture time; an older note without one falls back
		// to the file's own modification time.
		captured := c.At
		if captured.IsZero() {
			if info, err := entry.Info(); err == nil {
				captured = info.ModTime()
			}
		}
		if !captured.IsZero() {
			c.Age = now.Sub(captured)
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Age > out[j].Age })
	return out, nil
}

// readCapture pulls the thought, its detail, and the snooze date out of a note.
func readCapture(path string) (capture, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return capture{}, err
	}
	c := capture{Path: path, Slug: strings.TrimSuffix(filepath.Base(path), ".md")}
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "captured:"):
			value := strings.TrimSpace(strings.TrimPrefix(trimmed, "captured:"))
			if at, err := time.Parse(time.RFC3339, value); err == nil {
				c.At = at
			}
		case strings.HasPrefix(trimmed, "review_due:"):
			c.Due = strings.TrimSpace(strings.TrimPrefix(trimmed, "review_due:"))
		case strings.HasPrefix(trimmed, "> [!FLEETING]"):
			c.Title = strings.TrimSpace(strings.TrimPrefix(trimmed, "> [!FLEETING]"))
		case strings.HasPrefix(trimmed, ">"):
			if body := strings.TrimSpace(strings.TrimPrefix(trimmed, ">")); body != "" {
				c.Detail = append(c.Detail, body)
			}
		}
	}
	if c.Title == "" {
		c.Title = c.Slug
	}
	return c, nil
}

// snooze parks a capture until a later day, in the same frontmatter the
// processing pass reads.
func snooze(path string, until time.Time) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	due := "review_due: " + until.Format("2006-01-02")
	replaced, inserted := false, false
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "review_due:") {
			lines[i] = due
			replaced = true
			break
		}
	}
	if !replaced {
		for i, line := range lines {
			if strings.TrimSpace(line) == "---" && i > 0 {
				lines = append(lines[:i], append([]string{due}, lines[i:]...)...)
				inserted = true
				break
			}
		}
	}
	if !replaced && !inserted {
		lines = append([]string{"---", due, "---"}, lines...)
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
}

// atomicBody is the note a capture becomes: the insight in its own words, with
// the thought it came from kept as a callout so the trail stays whole.
func atomicBody(slug, title string, c capture, now time.Time) string {
	var quoted strings.Builder
	fmt.Fprintf(&quoted, "> [!CAPTURE] %s", c.Title)
	for _, line := range c.Detail {
		quoted.WriteString("\n> " + line)
	}
	return "---\nid: " + slug + "\naliases: []\ntags: [atomic]\ncreated: " +
		now.Format("2006-01-02") + "\nup:\n---\n\n# " + strings.TrimSpace(title) +
		"\n\n" + quoted.String() + "\n"
}

// promote writes the atomic note beside your other knowledge notes and reports
// its path. The capture itself is retired by the caller once the editor closes.
func promote(vault string, c capture, title string, now time.Time) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", errors.New("an atomic note needs a title")
	}
	dir := filepath.Join(vault, "2_knowledge")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := filepath.Join(dir, slug(title))
	path := base + ".md"
	for i := 2; ; i++ {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			break
		} else if err != nil {
			return "", err
		}
		path = fmt.Sprintf("%s-%d.md", base, i)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(atomicBody(slug(title), title, c, now)); err != nil {
		return "", err
	}
	return path, nil
}

// editorCommand is the editor a promotion opens: yours, not a built-in.
func editorCommand(path string) *exec.Cmd {
	editor := os.Getenv("VISUAL")
	if editor == "" {
		editor = os.Getenv("EDITOR")
	}
	if editor == "" {
		editor = "nvim"
	}
	return exec.Command(editor, path)
}

type editorDoneMsg struct {
	capture capture
	path    string
	err     error
}

type reviewModel struct {
	vault   string
	items   []capture
	idx     int
	w, h    int
	typing  bool
	input   textinput.Model
	confirm bool
	status  string
	problem string
	blurred bool
	quit    bool
}

func newReview(vault string) *reviewModel {
	m := &reviewModel{vault: vault, w: 80, h: 24}
	m.input = newInput("the insight, in your own words", "")
	return m
}

// The processing list uses the same palette and the same blur lift as the
// capture box, so the two surfaces read as one tool.
func (m *reviewModel) light(c color.Color) color.Color {
	if !m.blurred {
		return c
	}
	return lift(c)
}

func (m *reviewModel) paint(c color.Color, s string) string {
	return lg.NewStyle().Foreground(m.light(c)).Render(s)
}

func (m *reviewModel) refresh() {
	items, err := queue(m.vault, time.Now())
	if err != nil {
		m.problem = err.Error()
		return
	}
	m.items = items
	if m.idx >= len(m.items) {
		m.idx = max(0, len(m.items)-1)
	}
}

func (m *reviewModel) current() (capture, bool) {
	if m.idx < 0 || m.idx >= len(m.items) {
		return capture{}, false
	}
	return m.items[m.idx], true
}

func (m *reviewModel) Init() tea.Cmd {
	m.refresh()
	return textinput.Blink
}

func (m *reviewModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.w, m.h = msg.Width, msg.Height
		return m, nil
	case tea.BlurMsg:
		m.blurred = true
		return m, nil
	case tea.FocusMsg:
		m.blurred = false
		return m, nil
	case editorDoneMsg:
		if msg.err != nil {
			m.problem = "editor: " + msg.err.Error()
			return m, nil
		}
		// The thought now lives inside the atomic note, so the capture retires.
		if err := os.Remove(msg.capture.Path); err != nil {
			m.problem = err.Error()
			return m, nil
		}
		m.status = "promoted → " + relPath(msg.path)
		m.refresh()
		return m, nil
	case tea.KeyPressMsg:
		return m.key(msg)
	}
	return m, nil
}

func (m *reviewModel) key(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if m.typing {
		switch msg.String() {
		case "esc":
			m.typing = false
			return m, nil
		case "enter":
			c, ok := m.current()
			if !ok {
				m.typing = false
				return m, nil
			}
			path, err := promote(m.vault, c, m.input.Value(), time.Now())
			if err != nil {
				m.problem = err.Error()
				return m, nil
			}
			m.typing = false
			return m, tea.ExecProcess(editorCommand(path), func(err error) tea.Msg {
				return editorDoneMsg{capture: c, path: path, err: err}
			})
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		return m, cmd
	}
	if m.confirm {
		switch msg.String() {
		case "y":
			if c, ok := m.current(); ok {
				if err := os.Remove(c.Path); err != nil {
					m.problem = err.Error()
				} else {
					m.status = "deleted " + c.Slug
				}
				m.refresh()
			}
			m.confirm = false
			return m, nil
		case "n", "esc":
			m.confirm = false
			return m, nil
		}
		return m, nil
	}
	switch msg.String() {
	case "q", "esc", "ctrl+c":
		m.quit = true
		return m, tea.Quit
	case "j", "down":
		if m.idx < len(m.items)-1 {
			m.idx++
		}
	case "k", "up":
		if m.idx > 0 {
			m.idx--
		}
	case "g":
		m.idx = 0
	case "G":
		m.idx = max(0, len(m.items)-1)
	case "p":
		if c, ok := m.current(); ok {
			m.typing = true
			m.input.SetValue("")
			m.input.Placeholder = c.Title
			m.input.Focus()
			m.status = ""
		}
	case "s", "S":
		if c, ok := m.current(); ok {
			days := 3
			if msg.String() == "S" {
				days = 14
			}
			if err := snooze(c.Path, time.Now().AddDate(0, 0, days)); err != nil {
				m.problem = err.Error()
			} else {
				m.status = fmt.Sprintf("snoozed %dd · %s", days, c.Title)
				m.refresh()
			}
		}
	case "d":
		m.confirm = true
	case "o":
		if c, ok := m.current(); ok {
			return m, tea.ExecProcess(editorCommand(c.Path), func(error) tea.Msg { return nil })
		}
	}
	return m, nil
}

func (m *reviewModel) View() tea.View {
	v := tea.NewView(m.frame())
	v.AltScreen = true
	v.ReportFocus = true
	return v
}

func (m *reviewModel) frame() string {
	return lg.NewStyle().MaxWidth(m.w).MaxHeight(m.h).Render(m.screen())
}

func (m *reviewModel) screen() string {
	if m.typing {
		return m.prompt()
	}
	inner := clamp(m.w-8, 40, 96)
	// The box fills the layer the action opened: head, list, and footer sit in
	// fixed rows, and the list takes the rest, so the frame never floats in
	// empty space.
	rows := max(1, m.h-8)
	head := padRight(m.paint(green, "REVIEW"), inner-6) + m.paint(muted, fmt.Sprintf("%d", len(m.items)))

	var list []string
	if len(m.items) == 0 {
		list = append(list, m.paint(muted, "nothing to process."))
		list = append(list, m.paint(muted, "capture a thought and press Cmd+Shift+N."))
	} else {
		start := clamp(m.idx-rows/2, 0, max(0, len(m.items)-rows))
		for i := start; i < start+rows && i < len(m.items); i++ {
			c := m.items[i]
			age := fmt.Sprintf("%dd", int(c.Age.Hours()/24))
			title := c.Title
			budget := inner - 6
			if len([]rune(title)) > budget {
				title = string([]rune(title)[:budget-1]) + "…"
			}
			if i == m.idx {
				list = append(list, m.paint(green, "▌ ")+lg.NewStyle().Foreground(m.light(ink)).Bold(true).
					Render(padRight(title, inner-4)+age))
			} else {
				list = append(list, "  "+m.paint(muted, padRight(title, inner-4)+age))
			}
		}
	}
	for len(list) < rows {
		list = append(list, "")
	}

	lines := append([]string{head, ""}, list...)
	lines = append(lines, "", m.footer(inner))
	box := lg.NewStyle().Border(lg.RoundedBorder()).BorderForeground(m.light(mid)).
		Padding(0, 1).Render(strings.Join(lines, "\n"))
	return lg.NewStyle().Padding(1, 2).Render(box)
}

func (m *reviewModel) footer(inner int) string {
	switch {
	case m.confirm:
		return m.paint(amber, "delete this capture?") + m.paint(mid, " · ") + m.paint(muted, "y / n")
	case m.problem != "":
		return m.paint(amber, fit(m.problem, inner))
	case m.status != "":
		return m.paint(muted, fit(m.status, inner))
	}
	hints := []string{"j/k", "p promote", "s/S snooze", "d delete", "o open", "q quit"}
	return m.paint(muted, fit(strings.Join(hints, " · "), inner))
}

// prompt is the one line that turns a capture into an atomic note.
func (m *reviewModel) prompt() string {
	inner := clamp(m.w-8, 40, 96)
	c, _ := m.current()
	lines := []string{
		m.paint(green, "PROMOTE"),
		"",
		m.paint(muted, fit(c.Title, inner)),
		"",
		fit(m.input.View(), inner),
		"",
		m.paint(muted, "enter create in 2_knowledge/ · esc back"),
	}
	box := lg.NewStyle().Border(lg.RoundedBorder()).BorderForeground(m.light(green)).
		Padding(0, 1).Render(strings.Join(lines, "\n"))
	return lg.NewStyle().Padding(1, 2).Render(box)
}

// runReview opens the processing pass. render prints one frame instead, which is
// how the layout is judged without a terminal.
func runReview(vault string, render bool, width, height int) (*reviewModel, error) {
	m := newReview(vault)
	m.w, m.h = width, height
	m.refresh()
	if render {
		fmt.Println(m.frame())
		return m, nil
	}
	final, err := tea.NewProgram(m).Run()
	if err != nil {
		return m, err
	}
	out, ok := final.(*reviewModel)
	if !ok {
		return m, nil
	}
	return out, nil
}

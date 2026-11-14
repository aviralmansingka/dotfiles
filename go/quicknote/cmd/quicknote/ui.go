package main

import (
	"fmt"
	"image/color"
	"path/filepath"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
)

// The accent is the warm gruvbox green, and chipBg is that green blended a
// quarter of the way off the background: the pill Obsidian draws.
var (
	ink    = lg.Color("#d4be98")
	muted  = lg.Color("#928374")
	green  = lg.Color("#a9b665")
	amber  = lg.Color("#e78a4e")
	bg     = lg.Color("#282828")
	mid    = lg.Color("#504945")
	chipBg = lg.Color("#484c37")
)

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// fit clips every line to n columns, so a widget can never widen the frame.
func fit(s string, n int) string {
	cut := lg.NewStyle().MaxWidth(n)
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = cut.Render(line)
	}
	return strings.Join(lines, "\n")
}

// fitMiddle keeps both ends of a long path, so the filename stays readable when
// the card is narrow.
func fitMiddle(s string, n int) string {
	r := []rune(s)
	if len(r) <= n || n <= 1 {
		return s
	}
	keep := n - 1
	head := (keep + 1) / 2
	tail := keep - head
	return string(r[:head]) + "…" + string(r[len(r)-tail:])
}

func padRight(s string, n int) string {
	gap := n - lg.Width(s)
	if gap <= 0 {
		return s
	}
	return s + strings.Repeat(" ", gap)
}

type model struct {
	input   textinput.Model // the title: the thought itself
	detail  textinput.Model // optional extra text, revealed by the first Tab
	shown   bool            // whether the detail field is on screen
	onBody  bool            // focus is in the detail field
	w, h    int
	vault   string
	dry     bool
	blurred bool
	warn    bool
	done    bool
	result  Result
}

func newModel(dry bool, title, vault string) *model {
	m := &model{vault: vault, dry: dry, w: 64, h: 11}
	m.input = newInput("what just happened?", title)
	m.detail = newInput("add as much detail as you like", "")
	// A thin bar keeps the detail row reading as part of the title, not a peer.
	m.detail.Prompt = "▏ "
	m.input.Focus()
	// Only the field that owns the keys may draw a cursor.
	m.detail.Blur()
	m.style()
	return m
}

func newInput(placeholder, value string) textinput.Model {
	in := textinput.New()
	in.Placeholder = placeholder
	in.CharLimit = 0
	in.Prompt = "▌ "
	in.SetValue(value)
	return in
}

// style paints both inputs. The focused field takes the accent prompt, so the
// small box still says where the keys go.
func (m *model) style() {
	for _, field := range []struct {
		in      *textinput.Model
		focused bool
	}{{&m.input, !m.onBody}, {&m.detail, m.onBody}} {
		prompt := mid
		if field.focused {
			prompt = green
		}
		s := textinput.Styles{
			Focused: textinput.StyleState{
				Text:        lg.NewStyle().Foreground(m.light(ink)),
				Placeholder: lg.NewStyle().Foreground(m.light(muted)),
				Prompt:      lg.NewStyle().Foreground(m.light(prompt)),
			},
			Cursor: textinput.CursorStyle{Color: m.light(green), Shape: tea.CursorBlock, Blink: true},
		}
		s.Blurred = s.Focused
		field.in.SetStyles(s)
	}
}

// lift brightens one color, so a dimmed pane keeps its contrast.
func lift(c color.Color) color.Color {
	r, g, b, _ := c.RGBA()
	up := func(v uint32) uint8 {
		x := float64(v >> 8)
		return uint8(x + (255-x)*0.22)
	}
	return lg.Color(fmt.Sprintf("#%02x%02x%02x", up(r), up(g), up(b)))
}

// light compensates for the dimming Rex applies to an unfocused block. Every
// color the pane draws passes through here, so the whole frame dims and lifts as
// one instead of some elements losing contrast before others.
func (m *model) light(c color.Color) color.Color {
	if !m.blurred {
		return c
	}
	return lift(c)
}

func (m *model) paint(c color.Color, s string) string {
	return lg.NewStyle().Foreground(m.light(c)).Render(s)
}

// cardWidth is the text width the card draws to.
func cardWidth(w int) int { return clamp(w-8, 26, 56) }

func (m *model) layout() {
	width := cardWidth(m.w) - lg.Width(m.input.Prompt)
	m.input.SetWidth(width)
	m.detail.SetWidth(width)
}

func (m *model) Init() tea.Cmd { return textinput.Blink }

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.w, m.h = msg.Width, msg.Height
		m.layout()
		return m, nil
	case tea.BlurMsg:
		m.blurred = true
		m.style()
		return m, nil
	case tea.FocusMsg:
		m.blurred = false
		m.style()
		return m, nil
	case tea.KeyPressMsg:
		switch msg.String() {
		case "ctrl+c", "esc":
			return m, tea.Quit
		case "enter":
			if strings.TrimSpace(m.input.Value()) == "" {
				m.warn = true
				m.onBody = false
				m.focus()
				return m, nil
			}
			m.submit()
			return m, tea.Quit
		case "tab":
			// The first Tab adds the detail field and goes there. After that Tab
			// swaps between the two fields.
			if !m.shown {
				m.shown = true
				m.onBody = true
			} else {
				m.onBody = !m.onBody
			}
			m.focus()
			return m, nil
		}
	}
	m.warn = false
	var cmd tea.Cmd
	if m.onBody {
		m.detail, cmd = m.detail.Update(msg)
	} else {
		m.input, cmd = m.input.Update(msg)
	}
	return m, cmd
}

// focus puts the keys in one field and blurs the other, so the box never draws
// two cursors at once.
func (m *model) focus() {
	if m.onBody {
		m.input.Blur()
		m.detail.Focus()
	} else {
		m.detail.Blur()
		m.input.Focus()
	}
	m.style()
}

// submit writes the note. The title names the file; the detail becomes the rest
// of the callout.
func (m *model) submit() {
	res, err := Append(m.vault, Entry{Title: m.input.Value(), Body: m.detail.Value()}, m.dry)
	if err != nil {
		m.warn = true
		return
	}
	m.result = res
	m.done = true
}

func (m *model) View() tea.View {
	v := tea.NewView(m.frame())
	v.AltScreen = true
	// Focus reporting is what lets a blurred pane lift its own colors.
	v.ReportFocus = true
	return v
}

// frame draws the pane. It paints no background and clips to the terminal, so
// nothing of ours can sit at a different value than the pane around it.
func (m *model) frame() string {
	return lg.NewStyle().MaxWidth(m.w).MaxHeight(m.h).Render(m.card())
}

// destination previews the note path as the title is typed.
func (m *model) destination(n int) string {
	if strings.TrimSpace(m.input.Value()) == "" {
		return fitMiddle(relPath(filepath.Join(m.vault, "0_inbox", fleetingTag))+"/", n)
	}
	path := relPath(noteFile(m.vault, Entry{Title: m.input.Value()}))
	if len([]rune(path)) > n {
		path = strings.TrimPrefix(path, "~/vault/")
	}
	return fitMiddle(path, n)
}

// card is a rounded panel: title and count, the title input, the detail input
// once it exists, the note type chip, where the note lands, and the keys.
func (m *model) card() string {
	inner := cardWidth(m.w)
	count := fmt.Sprintf("%d", len([]rune(m.input.Value())))
	border, title := mid, muted
	if m.input.Value() != "" && !m.blurred {
		border = green
	}
	if !m.blurred {
		title = green
	}
	head := padRight(m.paint(title, "CAPTURE"), inner-lg.Width(count)) + m.paint(muted, count)

	lines := []string{head, fit(m.input.View(), inner)}
	if m.shown {
		lines = append(lines, fit(m.detail.View(), inner))
	}

	// The capture carries one fixed type tag, so the chip reports it instead of
	// asking. Topic tags are written later, while processing.
	chip := lg.NewStyle().Background(m.light(chipBg)).Foreground(m.light(green)).
		Render(" #" + fleetingTag + " ")

	// The arrow costs two columns, so the path budget is the rest of the row.
	where := m.paint(green, "→") + " " + m.paint(muted, m.destination(inner-2))
	next := "tab detail"
	if m.shown {
		next = "tab title"
	}
	hint := m.paint(muted, "enter save") + m.paint(mid, " · ") + m.paint(muted, next) +
		m.paint(mid, " · ") + m.paint(muted, "esc cancel")
	if m.warn {
		hint = m.paint(amber, "a title is required")
	}

	lines = append(lines, "", fit(chip, inner), fit(where, inner), fit(hint, inner))
	box := lg.NewStyle().Border(lg.RoundedBorder()).BorderForeground(m.light(border)).
		Padding(0, 1).Render(strings.Join(lines, "\n"))
	return lg.NewStyle().Padding(1, 2).Render(box)
}

// runUI opens the capture box. render prints one frame instead, which is how a
// design is judged without a terminal.
func runUI(dry bool, title, vault string, render, blurred bool, width, height int) (*model, error) {
	m := newModel(dry, title, vault)
	m.w, m.h = width, height
	m.blurred = blurred
	m.style()
	m.layout()
	if render {
		fmt.Println(m.frame())
		return m, nil
	}
	final, err := tea.NewProgram(m).Run()
	if err != nil {
		return m, err
	}
	out, ok := final.(*model)
	if !ok {
		return m, nil
	}
	return out, nil
}

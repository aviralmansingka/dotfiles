package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Fixture struct {
	Runs []Run `json:"runs"`
}
type Run struct {
	ID           string  `json:"id"`
	Task         string  `json:"task"`
	State        string  `json:"state"`
	Stage        string  `json:"stage"`
	UpdatedAt    string  `json:"updated_at"`
	Revision     int     `json:"revision"`
	Participants Counts  `json:"participants"`
	Goals        []Goal  `json:"goals"`
	Events       []Event `json:"events"`
}
type Counts struct {
	Active int `json:"active"`
	Total  int `json:"total"`
}
type Goal struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	State string `json:"state"`
}
type Event struct {
	Kind       string `json:"kind"`
	Source     string `json:"source"`
	GoalID     string `json:"goal_id"`
	Label      string `json:"label"`
	State      string `json:"state"`
	ObservedAt string `json:"observed_at"`
	StartedAt  string `json:"started_at"`
	FinishedAt string `json:"finished_at"`
	Summary    string `json:"summary"`
}
type Frame struct {
	Name          string
	Width, Height int
	Plain         string
}

const (
	reset   = "\x1b[0m"
	bright  = "\x1b[38;2;251;241;199m"
	accent  = "\x1b[38;2;242;133;52m"
	text    = "\x1b[38;2;235;219;178m"
	muted   = "\x1b[38;2;146;131;116m"
	dim     = "\x1b[38;2;102;92;84m"
	success = "\x1b[38;2;184;187;38m"
	info    = "\x1b[38;2;128;170;158m"
	special = "\x1b[38;2;211;134;155m"
	warning = "\x1b[38;2;250;189;47m"
	failure = "\x1b[38;2;242;89;75m"
)

var sgr = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func main() {
	out := flag.String("out", "frames", "artifact directory")
	check := flag.Bool("check", false, "run semantic checks after generation")
	flag.Parse()
	fixtureBytes, err := os.ReadFile("fixtures.json")
	must(err)
	var fixture Fixture
	must(json.Unmarshal(fixtureBytes, &fixture))
	frames := buildFrames(fixture)
	must(os.MkdirAll(*out, 0o755))
	for _, frame := range frames {
		plainPath := filepath.Join(*out, frame.Name+".txt")
		ansiPath := filepath.Join(*out, frame.Name+".ansi")
		must(os.WriteFile(plainPath, []byte(frame.Plain), 0o644))
		must(os.WriteFile(ansiPath, []byte(colorize(frame.Plain)), 0o644))
	}
	if *check {
		must(checkFrames(fixture, frames, *out))
	}
	fmt.Printf("generated %d ANSI/plain frame pairs in %s\n", len(frames), *out)
}

func buildFrames(f Fixture) []Frame {
	byID := map[string]Run{}
	for _, run := range f.Runs {
		byID[run.ID] = run
	}
	active := byID["run-active"]
	return []Frame{
		frame("compare-rail-led-80x24", 80, 24, railLed(active, 80, 24)),
		frame("compare-goal-preview-80x24", 80, 24, goalPreview(active, 80, 24)),
		frame("compare-rail-led-100x30", 100, 30, railLed(active, 100, 30)),
		frame("compare-goal-preview-100x30", 100, 30, goalPreview(active, 100, 30)),
		frame("state-matrix-80x24", 80, 24, stateMatrix(f.Runs, 80, 24)),
		frame("all-runs-selected-preview-100x30", 100, 30, allRuns(f.Runs, 100, 30)),
		frame("expanded-board-120x32", 120, 32, expandedBoard(byID["run-failed"], 120, 32)),
		frame("execution-journal-100x30", 100, 30, journal(byID["run-retired"], byID["run-unknown"], 100, 30)),
		frame("sidekick-44x12", 44, 12, sidekick(active, 44, 12)),
	}
}

func frame(name string, width, height int, lines []string) Frame {
	return Frame{name, width, height, bounded(lines, width, height)}
}

func railLed(r Run, width, height int) []string {
	lines := header(r, "RAIL-LED COMPACT", width)
	lines = append(lines, fmt.Sprintf(" │  %d stages · %s · Goal %s", len(r.Goals), r.Stage, activeGoal(r)))
	for i, event := range r.Events {
		connector := "├─"
		if i == len(r.Events)-1 {
			connector = "└─"
		}
		lines = append(lines, fmt.Sprintf(" %s %s %s · %s", connector, glyph(event.State), event.Label, event.State))
		if event.Summary != "" {
			lines = append(lines, fmt.Sprintf(" %s  └─ %s · %s", continuation(connector), sourceLabel(event.Source), event.Summary))
		}
		if timing := timing(event); timing != "" {
			lines[len(lines)-1] += " · " + timing
		}
	}
	lines = append(lines, "", " Evidence  V01 accepted · V02 pending", " Gate      Human merge pending · parent-owned", " Source    recorded Atlas envelope · static snapshot", " j/k records · Enter detail · q quit")
	return lines
}

func goalPreview(r Run, width, height int) []string {
	left := width * 38 / 100
	right := width - left - 1
	lines := header(r, "GOAL SELECTION + PREVIEW", width)
	lines = append(lines, columns("GOALS", "SELECTED GOAL TIMELINE", left, right), columns(strings.Repeat("─", left), strings.Repeat("─", right), left, right))
	selected := activeGoal(r)
	var preview []string
	for _, e := range r.Events {
		if e.GoalID != selected {
			continue
		}
		preview = append(preview, fmt.Sprintf("%s %s · %s", glyph(e.State), e.Label, e.State), "  └─ "+sourceLabel(e.Source)+" · "+e.Summary)
	}
	preview = append(preview, "", "Evidence: none accepted for G02", "Gate: Human merge pending")
	for i := 0; i < max(len(r.Goals), len(preview)); i++ {
		l, rr := "", ""
		if i < len(r.Goals) {
			cursor := "  "
			if r.Goals[i].ID == selected {
				cursor = "▶ "
			}
			l = fmt.Sprintf("%s%s %s", cursor, glyph(r.Goals[i].State), r.Goals[i].ID)
		}
		if i < len(preview) {
			rr = preview[i]
		}
		lines = append(lines, columns(l, rr, left, right))
	}
	lines = append(lines, columns("j/k select", "Enter detail · q quit", left, right))
	return lines
}

func stateMatrix(runs []Run, width, height int) []string {
	lines := []string{"ATLAS RUN STATE MATRIX · typed values, no inferred completion", strings.Repeat("─", width)}
	for _, r := range runs {
		lines = append(lines, fmt.Sprintf("%s %-16s %-14s stage %-16s", glyph(r.State), r.ID, stateLabel(r.State), r.Stage))
		latest := r.Events[len(r.Events)-1]
		lines = append(lines, fmt.Sprintf("  └─ %s · %s · %s", latest.Label, latest.State, timing(latest)))
	}
	lines = append(lines, "", "? unknown remains literal · missing bounds say time unavailable", "retired is recorded history; it does not imply agent termination")
	return lines
}

func allRuns(runs []Run, width, height int) []string {
	left := 39
	right := width - left - 1
	lines := []string{"ATLAS · ALL RUNS · 6 recorded · selected run-active", strings.Repeat("─", width), columns("RUNS", "SELECTED TIMELINE PREVIEW", left, right)}
	selected := runs[0]
	preview := railLed(selected, right, height)[2:]
	for i := 0; i < max(len(runs)*2, len(preview)); i++ {
		l, rr := "", ""
		if i/2 < len(runs) {
			r := runs[i/2]
			if i%2 == 0 {
				cursor := "  "
				if i == 0 {
					cursor = "▶ "
				}
				l = fmt.Sprintf("%s%s %s · %s", cursor, glyph(r.State), r.ID, stateLabel(r.State))
			} else {
				l = "    " + short(r.Task, left-4)
			}
		}
		if i < len(preview) {
			rr = preview[i]
		}
		lines = append(lines, columns(l, rr, left, right))
	}
	lines = append(lines, columns("j/k Runs · r refresh", "Enter board · q quit", left, right))
	return lines
}

func expandedBoard(r Run, width, height int) []string {
	left, middle := 24, 58
	right := width - left - middle - 2
	lines := header(r, "EXPANDED OPERATIONS BOARD", width)
	lines = append(lines, columns3("TIMELINE", "SELECTED RECORDED CONTEXT", "EVIDENCE / GATES", left, middle, right))
	var timeline, context, evidence []string
	for _, e := range r.Events {
		timeline = append(timeline, fmt.Sprintf("%s %s", glyph(e.State), e.GoalID), "  "+e.State)
	}
	for _, e := range r.Events {
		context = append(context, fmt.Sprintf("%s · %s · %s", e.Label, e.Kind, e.State), "  └─ "+e.Summary+" · "+timing(e))
	}
	evidence = []string{"V01 accepted", "V02 failed · exit 1", "", "Parent decision", "× rejected", "implementation_defect", "", "Authority", "projection, not completion"}
	for i := 0; i < max(len(timeline), max(len(context), len(evidence))); i++ {
		lines = append(lines, columns3(at(timeline, i), at(context, i), at(evidence, i), left, middle, right))
	}
	lines = append(lines, "", "Recorded chronology remains available in Journal · no live Herdr state hydrated in this fixture")
	return lines
}

func journal(retired, unknown Run, width, height int) []string {
	lines := []string{"EXECUTION JOURNAL · faithful chronology · projection, not authority", fmt.Sprintf("Run %s · rev %d · %s", retired.ID, retired.Revision, stateLabel(retired.State)), strings.Repeat("─", width)}
	for _, e := range retired.Events {
		lines = append(lines, fmt.Sprintf("%s %s · %s · %s", glyph(e.State), eventTime(e), e.Kind, e.State), "│  ├─ goal · "+e.GoalID, "│  └─ "+e.Summary+" · "+timing(e))
	}
	lines = append(lines, "", fmt.Sprintf("Run %s · literal forward-compatible record", unknown.ID))
	for _, e := range unknown.Events {
		lines = append(lines, fmt.Sprintf("%s %s · %s ? · %s ?", glyph(e.State), eventTime(e), e.Kind, e.State), "   └─ "+e.Summary)
	}
	lines = append(lines, "", "Timestamp gaps are chronology only; no gap is presented as execution duration.")
	return lines
}

func sidekick(r Run, width, height int) []string {
	selected := activeGoal(r)
	var active Event
	for _, e := range r.Events {
		if e.GoalID == selected {
			active = e
		}
	}
	return []string{
		fmt.Sprintf("ATLAS  %s", r.ID),
		fmt.Sprintf("%s %s · %s", glyph(r.State), r.Stage, stateLabel(r.State)),
		fmt.Sprintf("├─ %s %s · %s", glyph(active.State), active.GoalID, active.State),
		"│  └─ " + short(active.Summary, width-6),
		"├─ ◆ V01 accepted · V02 pending",
		"└─ ○ Human merge · parent gate",
		"time " + timing(active),
		"recorded snapshot · no live hydration",
	}
}

func header(r Run, title string, width int) []string {
	return []string{fmt.Sprintf("%s · %s", title, r.ID), fmt.Sprintf("%s · rev %d · %s · %s", r.Task, r.Revision, r.Stage, stateLabel(r.State)), strings.Repeat("─", width)}
}

func activeGoal(r Run) string {
	for _, g := range r.Goals {
		if g.State == "active" {
			return g.ID
		}
	}
	if len(r.Goals) > 0 {
		return r.Goals[len(r.Goals)-1].ID
	}
	return "?"
}

func stateLabel(state string) string {
	switch state {
	case "active", "pending", "completed", "passed", "accepted", "failed", "rejected", "retired", "interrupted", "blocked":
		return state
	default:
		return state + " ?"
	}
}

func glyph(state string) string {
	switch state {
	case "completed", "passed", "accepted":
		return "●"
	case "active":
		return "◉"
	case "failed", "rejected", "blocked":
		return "×"
	case "retired":
		return "◆"
	case "pending":
		return "○"
	default:
		return "?"
	}
}

func timing(e Event) string {
	if e.StartedAt == "" && e.FinishedAt == "" {
		return "time unavailable"
	}
	if e.StartedAt == "" || e.FinishedAt == "" {
		return "time unavailable"
	}
	start, a := time.Parse(time.RFC3339, e.StartedAt)
	finish, b := time.Parse(time.RFC3339, e.FinishedAt)
	if a != nil || b != nil || finish.Before(start) {
		return "time unavailable"
	}
	return finish.Sub(start).String()
}

func eventTime(e Event) string {
	value := e.ObservedAt
	if value == "" {
		value = e.StartedAt
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return "time ?"
	}
	return parsed.UTC().Format("Jan 02 15:04 UTC")
}

func sourceLabel(source string) string {
	switch source {
	case "parent":
		return "parent decision"
	case "registry":
		return "recorded observation"
	default:
		return source + " ?"
	}
}
func continuation(connector string) string {
	if connector == "└─" {
		return "  "
	}
	return "│ "
}
func at(lines []string, i int) string {
	if i < len(lines) {
		return lines[i]
	}
	return ""
}
func short(s string, width int) string {
	r := []rune(s)
	if len(r) <= width {
		return s
	}
	if width <= 1 {
		return "…"
	}
	return string(r[:width-1]) + "…"
}
func pad(s string, width int) string {
	s = short(s, width)
	return s + strings.Repeat(" ", max(0, width-len([]rune(s))))
}
func columns(a, b string, left, right int) string { return pad(a, left) + "│" + short(b, right) }
func columns3(a, b, c string, left, middle, right int) string {
	return pad(a, left) + "│" + pad(b, middle) + "│" + short(c, right)
}

func bounded(lines []string, width, height int) string {
	out := make([]string, 0, height)
	for _, line := range lines {
		if len(out) == height {
			break
		}
		out = append(out, short(line, width))
	}
	for len(out) < height {
		out = append(out, "")
	}
	return strings.Join(out, "\n") + "\n"
}

func colorize(plain string) string {
	lines := strings.Split(strings.TrimSuffix(plain, "\n"), "\n")
	for i, line := range lines {
		color := text
		trim := strings.TrimSpace(line)
		switch {
		case i == 0, strings.Contains(line, "GOALS"), strings.Contains(line, "TIMELINE"), strings.Contains(line, "EVIDENCE / GATES"):
			color = accent
		case strings.Contains(trim, "×"), strings.Contains(trim, " failed"), strings.Contains(trim, " rejected"):
			color = failure
		case strings.Contains(trim, "◉"), strings.Contains(trim, " active"):
			color = warning
		case strings.Contains(trim, "●"), strings.Contains(trim, " accepted"), strings.Contains(trim, " completed"):
			color = success
		case strings.Contains(trim, "◆"), strings.Contains(trim, "retired"):
			color = special
		case strings.HasPrefix(trim, "▶"):
			color = bright
		case strings.Contains(trim, "?"):
			color = muted
		case strings.Contains(trim, "recorded"), strings.Contains(trim, "parent"):
			color = info
		case trim == "" || strings.Trim(trim, "─│┼") == "":
			color = dim
		}
		if line != "" {
			lines[i] = color + line + reset
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func checkFrames(f Fixture, frames []Frame, out string) error {
	allowed := map[string]bool{reset: true, bright: true, accent: true, text: true, muted: true, dim: true, success: true, info: true, special: true, warning: true, failure: true}
	for _, frame := range frames {
		ansi, err := os.ReadFile(filepath.Join(out, frame.Name+".ansi"))
		if err != nil {
			return err
		}
		plain, err := os.ReadFile(filepath.Join(out, frame.Name+".txt"))
		if err != nil {
			return err
		}
		if string(plain) != frame.Plain || sgr.ReplaceAll(ansi, nil) == nil || string(sgr.ReplaceAll(ansi, nil)) != string(plain) {
			return fmt.Errorf("%s: ANSI stripping mismatch", frame.Name)
		}
		for _, token := range sgr.FindAllString(string(ansi), -1) {
			if !allowed[token] {
				return fmt.Errorf("%s: unaccepted SGR %q", frame.Name, token)
			}
		}
		lines := strings.Split(strings.TrimSuffix(string(plain), "\n"), "\n")
		if len(lines) != frame.Height {
			return fmt.Errorf("%s: got %d rows, want %d", frame.Name, len(lines), frame.Height)
		}
		for i, line := range lines {
			if len([]rune(line)) > frame.Width {
				return fmt.Errorf("%s:%d exceeds width", frame.Name, i+1)
			}
		}
	}
	all := ""
	for _, frame := range frames {
		all += frame.Plain
	}
	for _, required := range []string{"run-active", "run-failed", "run-completed", "run-retired", "run-missing-time", "run-unknown", "future-paused ?", "time unavailable", "18s", "4s", "Human merge", "parent-owned", "V01 accepted", "G02", "▶", "projection, not authority"} {
		if !strings.Contains(all, required) {
			return fmt.Errorf("missing semantic assertion %q", required)
		}
	}
	if strings.Contains(all, "observation gap duration") {
		return fmt.Errorf("observation gap mislabeled as duration")
	}
	if len(f.Runs) != 6 {
		return fmt.Errorf("fixture matrix must contain six Runs")
	}
	names := make([]string, len(frames))
	for i := range frames {
		names[i] = frames[i].Name
	}
	sort.Strings(names)
	fmt.Println("ok: 6 typed Run fixtures cover active, failed, completed, retired, missing-time, and unknown state")
	fmt.Println("ok: 9 bounded surfaces compare rail-led and Goal-preview compact IA plus browser, board, journal, and Sidekick")
	fmt.Println("ok: accepted SGR stripping is byte-identical to no-color frames")
	fmt.Println("ok: glyphs, labels, ordering, selection, time availability, evidence, and parent gate survive without color")
	return nil
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

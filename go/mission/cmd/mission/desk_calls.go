package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode"

	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"mission.local/prototype/internal/domain/mission"
)

type deskCall struct {
	id, agent, tool, summary, state, output string
	at                                      time.Time
	attempt                                 int
}

type piCallContent struct {
	Type, ID, Name, Text string
	Arguments            map[string]json.RawMessage
}
type piCallEntry struct {
	Type, ID, Cwd, Timestamp string
	Message                  struct {
		Role, ToolCallID string
		Content          []piCallContent
		IsError          bool
		DurationMs       int
		Timestamp        int64
	}
}

func terminalText(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\n':
			return r
		case r == '\t':
			return ' '
		case unicode.IsControl(r) || unicode.Is(unicode.Cf, r):
			return -1
		default:
			return r
		}
	}, ansi.Strip(s))
}

func callSummary(block piCallContent) string {
	for _, key := range []string{"command", "path", "pattern", "query", "name"} {
		var s string
		if json.Unmarshal(block.Arguments[key], &s) == nil && s != "" {
			return clean(terminalText(s))
		}
	}
	return block.Name
}

func stamp(s string) time.Time { t, _ := time.Parse(time.RFC3339Nano, s); return t }

// Read the existing Pi transcript only. The ledger continues to store metadata,
// and rendering a call never copies its arguments or results to the vault.
func readDeskCalls(path, id, cwd, agent string, a mission.Attempt, live bool) ([]deskCall, bool) {
	if id == "" || filepath.Ext(path) != ".jsonl" {
		return nil, false
	}
	st, e := os.Stat(path)
	if e != nil || !st.Mode().IsRegular() || st.Size() > 16<<20 {
		return nil, false
	}
	b, e := readBounded(path, 16<<20)
	if e != nil {
		return nil, false
	}
	sc := bufio.NewScanner(bytes.NewReader(b))
	sc.Buffer(make([]byte, 4096), 16<<20)
	var head piCallEntry
	if !sc.Scan() || json.Unmarshal(sc.Bytes(), &head) != nil || head.Type != "session" || head.ID != id ||
		(cwd != "" && filepath.Clean(head.Cwd) != filepath.Clean(cwd)) {
		return nil, false
	}
	start, end := stamp(a.Started), stamp(a.Ended)
	var calls []deskCall
	ids := map[string]int{}
	for sc.Scan() {
		var entry piCallEntry
		if json.Unmarshal(sc.Bytes(), &entry) != nil || entry.Type != "message" {
			continue
		}
		msg := entry.Message
		at := stamp(entry.Timestamp)
		if msg.Timestamp > 0 {
			at = time.UnixMilli(msg.Timestamp)
		}
		if at.IsZero() || at.Before(start) || (!end.IsZero() && at.After(end)) {
			continue
		}
		switch msg.Role {
		case "assistant":
			for _, block := range msg.Content {
				if block.Type != "toolCall" || block.ID == "" {
					continue
				}
				if _, exists := ids[block.ID]; exists {
					continue
				}
				ids[block.ID] = len(calls)
				state := "Unfinished"
				if live {
					state = "Running"
				}
				calls = append(calls, deskCall{
					id: a.ID + "/" + id + "/" + block.ID, agent: agent, tool: block.Name, summary: callSummary(block),
					at: at, attempt: a.Sequence, state: state,
				})
			}
		case "toolResult":
			i, ok := ids[msg.ToolCallID]
			if !ok {
				continue
			}
			call := &calls[i]
			call.state = "Done"
			if msg.IsError {
				call.state = "Failed"
			} else if msg.DurationMs > 0 {
				call.state = fmt.Sprintf("Done · %.1fs", float64(msg.DurationMs)/1000)
			}
			var out strings.Builder
			for _, block := range msg.Content {
				if block.Type == "text" && out.Len() < 32<<10 {
					text := []rune(terminalText(block.Text))
					out.WriteString(string(text[:min(len(text), 8192)]))
					if len(text) > 8192 {
						out.WriteString("\n…")
					}
					out.WriteByte('\n')
				} else if block.Type == "image" {
					out.WriteString("[Image result · view in Pi]\n")
				}
			}
			call.output = strings.TrimRight(out.String(), "\n")
		}
	}
	return calls, true
}

type deskChild struct {
	SessionFile, SessionID string
	Running                bool
}

func childCalls(path, id string, a mission.Attempt, seen map[string]bool, depth int) []deskCall {
	// Pi already owns this index. Limit recursion and deduplicate resumed sessions.
	if id == "." || !filepath.IsLocal(id) || filepath.Base(id) != id || depth >= 4 || len(seen) >= 32 {
		return nil
	}
	reg := filepath.Join(filepath.Dir(path), "artifacts", id, "subagent-registry.json")
	st, e := os.Stat(reg)
	if e != nil || !st.Mode().IsRegular() || st.Size() > 256<<10 {
		return nil
	}
	b, e := readBounded(reg, 256<<10)
	var children map[string]deskChild
	if e != nil || json.Unmarshal(b, &children) != nil {
		return nil
	}
	var out []deskCall
	for name, child := range children {
		if len(seen) >= 32 {
			break
		}
		if seen[child.SessionID] || child.SessionID == "" {
			continue
		}
		calls, ok := readDeskCalls(child.SessionFile, child.SessionID, "", name, a, mission.Active(a) && child.Running)
		if !ok {
			continue
		}
		seen[child.SessionID] = true
		out = append(out, calls...)
		out = append(out, childCalls(child.SessionFile, child.SessionID, a, seen, depth+1)...)
	}
	return out
}

func recordedDeskCalls(a mission.Attempt) []deskCall {
	var out []deskCall
	ids := map[string]int{}
	for _, e := range a.Events {
		fields := strings.Fields(e.Summary)
		id := e.ID
		if len(fields) >= 3 && fields[0] == "Tool" && fields[1] == "call" {
			id = fields[2]
		}
		if e.Type == "tool-start" {
			ids[id] = len(out)
			state := "Unfinished"
			if mission.Active(a) {
				state = "Running"
			}
			out = append(out, deskCall{id: a.ID + "/" + a.SessionID + "/" + id, agent: a.Agent, tool: e.Tool, summary: e.Summary, state: state, at: stamp(e.At), attempt: a.Sequence})
		} else if i, ok := ids[id]; e.Type == "tool-end" && ok {
			out[i].state = "Done"
			if strings.HasSuffix(e.Summary, " failed") {
				out[i].state = "Failed"
			}
		}
	}
	return out
}

func loadDeskCalls(s *Store, r mission.Record, step string) []deskCall {
	var out []deskCall
	for _, a := range r.State.Attempts {
		if a.Step != step {
			continue
		}
		path := a.SessionFile
		calls, found := readDeskCalls(path, a.SessionID, a.Cwd, a.Agent, a, mission.Active(a))
		if !found && a.Transcript != "" {
			if p, e := s.path(r.Mission.Repo, r.Mission.Slug, a.Transcript); e == nil {
				calls, found = readDeskCalls(p, a.SessionID, a.Cwd, a.Agent, a, false)
			}
		}
		recorded := make(map[string]deskCall)
		for _, call := range recordedDeskCalls(a) {
			recorded[call.id] = call
		}
		for i := range calls {
			if hook, ok := recorded[calls[i].id]; ok {
				if calls[i].state == "Running" && hook.state != "Running" {
					calls[i].state = hook.state
				}
				delete(recorded, calls[i].id)
			}
		}
		for _, call := range recorded {
			calls = append(calls, call)
		}
		out = append(out, calls...)
		if found && path != "" {
			out = append(out, childCalls(path, a.SessionID, a, map[string]bool{a.SessionID: true}, 0)...)
		}
	}
	slices.SortFunc(out, func(a, b deskCall) int {
		if t := a.at.Compare(b.at); t != 0 {
			return t
		}
		return strings.Compare(a.id, b.id)
	})
	return out
}

type deskCallsUpdate struct {
	request uint64
	calls   []deskCall
}

func (m *desk) pollNavigationCalls() tea.Cmd {
	if m.nav == nil || m.depth() < 2 || m.nav.loadingCalls {
		return nil
	}
	r, ok := m.current()
	if !ok {
		return nil
	}
	m.nav.loadingCalls = true
	s, step, request := m.store, m.nav.step, m.nav.callRequest
	return func() tea.Msg { return deskCallsUpdate{request, loadDeskCalls(s, r, step)} }
}

func (m *desk) applyNavigationCalls(out []deskCall) {
	// Keep an open output readable if its source vanishes on cleanup.
	if i := m.selectedCall(); i >= 0 && m.depth() == 3 {
		j := slices.IndexFunc(out, func(c deskCall) bool { return c.id == m.nav.call })
		if j < 0 {
			out = append(out, m.nav.calls[i])
		} else if out[j].output == "" && m.nav.calls[i].output != "" {
			out[j] = m.nav.calls[i]
		}
	}
	m.nav.calls = out
	if len(out) > 0 {
		if m.nav.follow {
			m.nav.call = out[len(out)-1].id
		} else if m.selectedCall() < 0 {
			m.nav.call = out[0].id
		}
	}
}

func (m *desk) selectedCall() int {
	return slices.IndexFunc(m.nav.calls, func(c deskCall) bool { return c.id == m.nav.call })
}

func (m *desk) stepHeading(r mission.Record, w int) string {
	i, e := stepIndex(r.Mission, m.nav.step)
	if e != nil {
		return "This step is unavailable.\n\n"
	}
	st := r.Mission.Steps[i]
	state := r.State.Steps[st.ID]
	out := deskRight(heading(st.ID+" · "+clean(st.Title)), status(state.Status), w) + "\n"
	if a, err := mission.FindAttempt(&r.State, state.Attempt); err == nil {
		meta := fmt.Sprintf("Attempt %03d · %s", a.Sequence, clean(a.Agent))
		if start := stamp(a.Started); !start.IsZero() {
			meta += " · " + start.Local().Format("15:04:05")
			if end := stamp(a.Ended); !end.IsZero() {
				meta += "–" + end.Local().Format("15:04:05")
			}
		}
		out += paint(muted, meta) + "\n"
	}
	return out + "\n"
}

func deskStepEvidence(r mission.Record, step string, w int) string {
	state := r.State.Steps[step]
	var lines []string
	if state.Evidence != "" {
		lines = append(lines, paint(ink, clean(state.Evidence)))
	}
	if a, err := mission.FindAttempt(&r.State, state.Attempt); err == nil && len(a.Verifications) > 0 {
		v := a.Verifications[len(a.Verifications)-1]
		for _, result := range v.Results {
			verdict := status(result.Verdict)
			lines = append(lines, deskRight("Direct check · "+clean(result.Check)+" · "+clean(result.Summary), verdict, w-2))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	out := "\n\n" + deskBar(" STEP EVIDENCE", w, muted)
	for _, line := range lines {
		out += "\n" + deskCard(" "+line, w)
	}
	return out
}

func (m *desk) feedStatus(r mission.Record) string {
	if a, err := mission.FindAttempt(&r.State, r.State.Active); err == nil &&
		a.Step == m.nav.step && mission.Active(*a) && a.SessionFile != "" {
		return paint(green, "● Feed live")
	}
	return paint(muted, "Recorded feed")
}

func (m *desk) navigationStep(r mission.Record, w, h int) string {
	evidence := deskStepEvidence(r, m.nav.step, w)
	if h-strings.Count(evidence, "\n") < 4 {
		evidence = ""
	}
	title := heading("TOOL CALLS") + paint(muted, fmt.Sprintf("  ·  %d recorded", len(m.nav.calls)))
	if m.nav.follow {
		title += paint(green, "  ·  Following latest")
	}
	out := deskRight(title, m.feedStatus(r), w) + "\n"
	if len(m.nav.calls) == 0 {
		message := "No tool calls recorded for this step."
		if m.nav.loadingCalls {
			message = "Reading Pi tool calls…"
		}
		return out + paint(muted, message) + evidence
	}
	if w >= 80 {
		out += deskBar(deskRight("  TIME      AGENT             TOOL          CALL", "RESULT", w-1), w, ink) + "\n"
		h--
	}
	var rows []deskRow
	for _, c := range m.nav.calls {
		prefix := "  "
		if c.id == m.nav.call {
			prefix = paint(yellow, "▌ ")
		}
		when := c.at.Local().Format("15:04:05")
		if c.at.IsZero() {
			when = "--:--:--"
		}
		label := prefix + paint(muted, when) + "  "
		if w >= 80 {
			label += paint(muted, deskColumn(c.agent, 16)) + "  "
		}
		label += paint(aqua, deskColumn(c.tool, 12)) + "  "
		end := deskCallStatus(c.state)
		line := deskRight(label+clean(c.summary), end, w)
		if c.id == m.nav.call {
			line = deskHighlight(line, w)
		}
		rows = append(rows, deskRow{line, c.id == m.nav.call})
	}
	return out + navWindow(rows, h-1-strings.Count(evidence, "\n")) + evidence
}

func (m *desk) callHeading(w int) string {
	i := m.selectedCall()
	if i < 0 {
		return "This tool call is unavailable.\n\n"
	}
	c := m.nav.calls[i]
	head := clean(c.tool) + " · " + clean(c.summary)
	meta := fmt.Sprintf("%s · Attempt %03d · %s", m.nav.step, c.attempt, clean(c.agent))
	if !c.at.IsZero() {
		meta += " · " + c.at.Local().Format("15:04:05")
	}
	return deskRight(heading(head), deskCallStatus(c.state), w) + "\n" + paint(muted, meta) + "\n\n"
}

func (m *desk) navigationOutput(r mission.Record, w, h int) string {
	i := m.selectedCall()
	if i < 0 {
		return ""
	}
	c := m.nav.calls[i]
	out := c.output
	if out == "" {
		out = "No text output recorded for this call."
	}
	if (c.tool == "bash" || c.tool == "shell") && c.summary != "" {
		out = "$ " + clean(c.summary) + "\n\n" + out
	}
	var lines []string
	for _, line := range strings.Split(out, "\n") {
		lines = append(lines, strings.Split(lg.Wrap(line, max(8, w-2), ""), "\n")...)
	}
	height := max(1, h-3)
	m.scroll = min(m.scroll, max(0, len(lines)-height))
	left := paint(muted, fmt.Sprintf("Selection held · Call %d/%d", i+1, len(m.nav.calls)))
	right := m.feedStatus(r)
	if added := len(m.nav.calls) - m.nav.outputCount; added > 0 {
		right += paint(green, fmt.Sprintf("  ·  %d new", added))
	}
	box := deskBar(" TOOL OUTPUT", w, ink)
	for _, line := range lines[m.scroll:min(len(lines), m.scroll+height)] {
		box += "\n" + deskCard(" "+line, w)
	}
	return box + "\n\n" + deskRight(left, right, w)
}

func deskCallStatus(state string) string {
	switch {
	case strings.HasPrefix(state, "Done"):
		return paint(green, "✓ "+state)
	case state == "Running":
		return paint(aqua, "◉ "+state)
	case state == "Failed":
		return paint(orange, "× "+state)
	default:
		return paint(muted, state)
	}
}

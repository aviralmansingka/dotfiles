package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	lg "charm.land/lipgloss/v2"

	"mission.local/prototype/internal/domain/mission"
)

func TestMissionDeskNavigationRetainsSelectionAndContext(t *testing.T) {
	s, handle := fixture(t)
	c := claimTest(t, s, handle)
	result(t, s, c, "Evidence for review")
	_, err := s.finish(handle, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, err)
	session := filepath.Join(t.TempDir(), "parent.jsonl")
	cwd := filepath.Dir(session)
	parent := fmt.Sprintf("{\"type\":\"session\",\"id\":\"parent\",\"cwd\":%q}\n", cwd)
	call := func(id, tool, stamp string) string {
		return fmt.Sprintf(`{"type":"message","timestamp":%q,"message":{"role":"assistant","content":[{"type":"toolCall","id":%q,"name":%q,"arguments":{"command":"go test ./..."}}]}}`+"\n", stamp, id, tool)
	}
	write := func(path, content string) {
		t.Helper()
		must(t, os.WriteFile(path, []byte(content), 0600))
	}
	parent += call("previous", "read", "2026-01-01T00:00:00Z")
	parent += call("tests", "bash", "2026-01-02T00:00:02Z")
	parent += `{"type":"message","timestamp":"2026-01-02T00:00:03Z","message":{"role":"toolResult","toolCallId":"tests","durationMs":1400,"content":[{"type":"text","text":"PASS\n\u001b]52;c;test\u0007ok"},{"type":"image"}]}}` + "\n"
	write(session, parent)
	child := filepath.Join(cwd, "child.jsonl")
	write(child, "{\"type\":\"session\",\"id\":\"child\"}\n"+call("child-call", "grep", "2026-01-02T00:00:01Z"))
	registry := filepath.Join(cwd, "artifacts", "parent")
	must(t, os.MkdirAll(registry, 0700))
	write(filepath.Join(registry, "subagent-registry.json"), fmt.Sprintf(`{"scout":{"sessionId":"child","sessionFile":%q}}`, child))
	_, err = s.mutate(handle, func(r *mission.Record) error {
		a := &r.State.Attempts[0]
		a.SessionID, a.SessionFile, a.Cwd = "parent", session, cwd
		a.Started, a.Ended = "2026-01-02T00:00:00Z", "2026-01-02T00:01:00Z"
		a.Verifications = append(a.Verifications, mission.Verification{Results: []mission.CheckResult{
			{Check: "go-test", Verdict: "passed", Summary: "go test ./... passed"},
		}})
		return nil
	})
	must(t, err)

	m := newNavigationDesk(s)
	m.refresh()
	key := func(code rune) tea.Cmd {
		_, cmd := m.Update(tea.KeyPressMsg{Code: code})
		return cmd
	}
	key('2')
	key('s')
	key(tea.KeyEnter)
	if m.depth() != 1 || m.nav.mode != 1 || !m.nav.recent {
		t.Fatal("Table did not open the selected mission")
	}
	key('[')
	if m.tab != detailTabs-1 {
		t.Fatal("Steps tab did not open")
	}
	cmd := key(tea.KeyEnter)
	if cmd == nil || m.depth() != 2 || m.nav.step != "S01" {
		t.Fatal("Enter did not open the selected step")
	}
	m.Update(cmd())
	if len(m.nav.calls) != 2 || m.nav.calls[0].agent != "scout" || m.nav.calls[1].state != "Done · 1.4s" {
		t.Fatalf("unexpected step feed: %+v", m.nav.calls)
	}
	stepFrame := stripANSI(m.render())
	for _, want := range []string{"TOOL CALLS", "STEP EVIDENCE", "Direct check · go-test", "go test ./... passed", "Recorded feed"} {
		if !strings.Contains(stepFrame, want) {
			t.Fatalf("step frame missing %q", want)
		}
	}
	key('f')
	key(tea.KeyEnter)
	write(session, parent+call("later", "write", "2026-01-02T00:00:04Z"))
	m.Update(m.pollNavigationCalls()())
	m.Update(deskPRs{handle: {Number: 452, Draft: true, Passed: 4, Total: 4}})
	if m.depth() != 3 || len(m.nav.calls) != 3 || m.selectedCall() != 1 {
		t.Fatal("expanded call selection moved when the feed refreshed")
	}
	for _, size := range [][2]int{{128, 42}, {80, 24}} {
		m.width, m.height = size[0], size[1]
		frame := m.render()
		for _, line := range strings.Split(frame, "\n") {
			if lg.Width(line) > m.width {
				t.Fatalf("frame overflows %d columns", m.width)
			}
		}
		out := stripANSI(frame)
		for _, want := range []string{"C01", "Proceed?", "Draft #452", "CI 4/4 passed", "PASS", "Image result", "1 new"} {
			if !strings.Contains(out, want) {
				t.Fatalf("expanded output missing %q:\n%s", want, out)
			}
		}
		if strings.Contains(out, "52;c;test") {
			t.Fatal("terminal control sequence leaked into output")
		}
		if strings.Index(out, "C01") > strings.Index(out, "TOOL OUTPUT") {
			t.Fatal("checkpoint must appear above scrollable output")
		}
	}
	key(tea.KeyEscape)
	if m.depth() != 2 || m.selectedCall() != 1 {
		t.Fatal("Escape did not restore the highlighted call")
	}
	key(tea.KeyEscape)
	if m.depth() != 1 || m.tab != detailTabs-1 || m.selectedStep != 0 {
		t.Fatal("Escape did not restore the selected step and tab")
	}
	key(tea.KeyEscape)
	r, _ := m.current()
	if m.depth() != 0 || m.nav.mode != 1 || r.Handle != handle {
		t.Fatal("Escape did not restore the selected mission in Table")
	}
}

func TestMissionDeskPRsMatchTheMissionBranch(t *testing.T) {
	s, handle := fixture(t)
	_, err := s.addRepo("origin", t.TempDir(), "git@github.com:example/mission.git")
	must(t, err)
	r, err := s.load(handle)
	must(t, err)
	r.Mission.Repo = "origin"
	r.State.Runtime = &mission.RuntimeBinding{Branch: "mission/test"}
	bin := t.TempDir()
	gh := `#!/bin/sh
[ "$4" = example/mission ] || exit 1
	printf '%s' '[{"number":12,"headRefName":"mission/test","state":"OPEN","statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS"},{"status":"COMPLETED","conclusion":"FAILURE"},{"status":"IN_PROGRESS"}]},{"number":13,"headRefName":"mission/test","isCrossRepository":true},{"number":14,"headRefName":"another-branch"},{"number":15,"headRefName":"mission/test","state":"CLOSED"}]'
`
	must(t, os.WriteFile(filepath.Join(bin, "gh"), []byte(gh), 0700))
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	missing := r
	missing.Handle = "origin/no-pr"
	missing.State.Runtime = &mission.RuntimeBinding{Branch: "mission/no-pr"}
	unavailable := missing
	unavailable.Handle = "dotfiles/no-lookup"
	unavailable.Mission.Repo = "dotfiles"
	prs := readDeskPRs(s, []mission.Record{r, missing, unavailable})().(deskPRs)
	if got := prs[handle]; got != (deskPR{Number: 12, State: "OPEN", Passed: 1, Failed: 1, Total: 3}) {
		t.Fatalf("unexpected PR status: %+v", got)
	}
	if got, known := prs[missing.Handle]; !known || got.Number != 0 {
		t.Fatalf("missing PR must be known: %+v", prs)
	}
	if _, known := prs[unavailable.Handle]; known {
		t.Fatal("unavailable lookup must not look like a missing PR")
	}
}

func TestMissionDeskHandoffAttention(t *testing.T) {
	s, handle := fixture(t)
	m := newNavigationDesk(s)
	r, err := s.load(handle)
	must(t, err)
	r.Mission.Kind = "implementation"
	r.State.Status = "done"
	for _, tc := range []struct {
		name  string
		prs   deskPRs
		lane  int
		badge string
	}{
		{"missing", deskPRs{handle: {}}, inboxAttention, "No PR found"},
		{"unavailable", nil, inboxHistory, "PR status unavailable"},
		{"draft", deskPRs{handle: {Number: 42, Draft: true}}, inboxAttention, "Draft #42"},
		{"failed", deskPRs{handle: {Number: 42, Failed: 1, Total: 1}}, inboxAttention, "1 failed"},
		{"ready", deskPRs{handle: {Number: 42, Passed: 1, Total: 1}}, inboxHandoff, "CI 1/1 passed"},
		{"pending", deskPRs{handle: {Number: 42, Passed: 1, Total: 2}}, inboxWorking, "pending"},
		{"no checks", deskPRs{handle: {Number: 42}}, inboxWorking, "No CI checks reported"},
		{"merged", deskPRs{handle: {Number: 42, State: "MERGED"}}, inboxHistory, "PR #42 merged"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m.nav.prs = tc.prs
			if got := m.inboxLane(r); got != tc.lane {
				t.Fatalf("lane = %d, want %d", got, tc.lane)
			}
			if out := stripANSI(m.missionContext(r, 80)); !strings.Contains(out, tc.badge) {
				t.Fatalf("badge missing %q: %s", tc.badge, out)
			}
		})
	}
}

func TestMissionDeskInboxSummarizesBackgroundWork(t *testing.T) {
	s, handle := fixture(t)
	r, err := s.load(handle)
	must(t, err)
	r.State.Status = "running"
	queued := r
	queued.Handle, queued.Mission.Title, queued.State.Status = "dotfiles/queued", "Queued example", "ready"
	m := newNavigationDesk(s)
	m.records = []mission.Record{r, queued}
	m.refreshNavigationList("")
	if out := stripANSI(m.render()); len(m.view) != 1 || !strings.Contains(out, "1 queued") || strings.Contains(out, "Queued example") {
		t.Fatal("default Inbox should summarize queued work")
	}
	m.Update(tea.KeyPressMsg{Code: '2'})
	if out := stripANSI(m.render()); len(m.view) != 2 || !strings.Contains(out, "Queued example") {
		t.Fatal("Table should expose the queued work")
	}
}

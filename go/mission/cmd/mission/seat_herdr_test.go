package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/platform"
)

// herdrFake is a Herdr server that records what deploy asked it to do. Tests
// read the call log instead of reaching the live server, so no test opens a
// workspace, a tab, or an agent.
type herdrFake struct {
	workspaces []string            // labels, in creation order
	tabs       map[string][]string // workspace label -> tab labels, in creation order
	paneIDs    map[string]string   // "workspace/tab" -> that tab's pane id
	tabIDs     map[string]string   // "workspace/tab" -> that tab's id
	calls      [][]string          // every argv, in order
	fail       map[string]error    // command line prefix -> the failure it answers
	next       int
	// starting is how many foreground polls a tab's still-starting shell
	// swallows before it answers; -1 swallows every one, so no shell ever owns
	// the pane. submits is how many Enters the seat must send before pi takes
	// the foreground, and shellForeground keeps the login shell there forever.
	starting        int
	submits         int
	shellForeground bool
	sessionFile     string // the Pi session file Herdr reports for a detected agent
	// typed holds what deploy wrote into each pane, and submitted marks the
	// panes whose Enter it sent.
	typed     map[string]string
	submitted map[string]int
}

func newHerdrFake() *herdrFake {
	return &herdrFake{tabs: map[string][]string{}, paneIDs: map[string]string{}, tabIDs: map[string]string{},
		fail: map[string]error{}, submits: 1, typed: map[string]string{}, submitted: map[string]int{}}
}

func (f *herdrFake) id(kind string) string {
	f.next++
	return fmt.Sprintf("%s:%02d", kind, f.next)
}

// call is the fake server: one Herdr command in, one result object out.
func (f *herdrFake) call(args ...string) (map[string]any, error) {
	f.calls = append(f.calls, args)
	for prefix, e := range f.fail {
		if strings.HasPrefix(strings.Join(args, " "), prefix) {
			return nil, e
		}
	}
	switch args[0] {
	case "workspace":
		switch args[1] {
		case "list":
			out := []any{}
			for _, label := range f.workspaces {
				out = append(out, map[string]any{"label": label, "workspace_id": "ws:" + label})
			}
			return map[string]any{"workspaces": out}, nil
		case "create":
			label := flagOf(args, "--label")
			tab := label + "/commander" // the root tab a workspace opens with
			tabID := f.tabID(label, tab)
			f.workspaces = append(f.workspaces, label)
			f.tabs[label] = append(f.tabs[label], tab)
			return map[string]any{
				"workspace": map[string]any{"workspace_id": "ws:" + label, "label": label},
				"tab":       map[string]any{"tab_id": tabID, "label": "1"},
				"root_pane": map[string]any{"pane_id": f.paneID(label, tab)},
			}, nil
		}
	case "tab":
		switch args[1] {
		case "rename":
			label, from := f.tabName(args[2])
			f.tabs[label] = f.rename(label, from, args[3])
			return map[string]any{"tab_id": args[2], "label": args[3]}, nil
		case "list":
			label := strings.TrimPrefix(flagOf(args, "--workspace"), "ws:")
			out := []any{}
			for _, tab := range f.tabs[label] {
				out = append(out, map[string]any{"tab_id": f.tabID(label, tab), "label": tab})
			}
			return map[string]any{"tabs": out}, nil
		case "create":
			label := strings.TrimPrefix(flagOf(args, "--workspace"), "ws:")
			tab := flagOf(args, "--label")
			// A fresh tab, with its own id and its own pane.
			delete(f.tabIDs, label+"/"+tab)
			delete(f.paneIDs, label+"/"+tab)
			f.tabs[label] = append(f.tabs[label], tab)
			return map[string]any{
				"tab":       map[string]any{"tab_id": f.tabID(label, tab), "label": tab},
				"root_pane": map[string]any{"pane_id": f.paneID(label, tab)},
			}, nil
		case "focus":
			return map[string]any{"tab_id": args[2]}, nil
		case "close":
			label, tab := f.tabName(args[2])
			kept := []string{}
			for _, t := range f.tabs[label] {
				if t != tab {
					kept = append(kept, t)
				}
			}
			f.tabs[label] = kept
			return map[string]any{"type": "ok"}, nil
		}
	case "pane":
		switch args[1] {
		case "list":
			label := strings.TrimPrefix(flagOf(args, "--workspace"), "ws:")
			out := []any{}
			for _, tab := range f.tabs[label] {
				out = append(out, map[string]any{"pane_id": f.paneID(label, tab), "tab_id": f.tabID(label, tab)})
			}
			return map[string]any{"panes": out}, nil
		case "process-info":
			pane := flagOf(args, "--pane")
			if !f.holds(pane) {
				return nil, fmt.Errorf(`{"error":{"code":"not_found","message":"pane %s does not exist"},"id":"cli:pane:process_info"}`, pane)
			}
			procs := []any{}
			if f.starting < 0 || f.starting > 0 {
				if f.starting > 0 {
					f.starting--
				}
				return map[string]any{"process_info": map[string]any{"pane_id": pane, "foreground_processes": procs}}, nil
			}
			if f.shellForeground || f.submitted[pane] < f.submits {
				procs = append(procs, map[string]any{"name": filepath.Base(loginShell()), "argv0": loginShell()})
			} else {
				procs = append(procs, map[string]any{"name": "node", "argv0": "pi", "path": "/opt/homebrew/bin/pi"})
			}
			return map[string]any{"process_info": map[string]any{"pane_id": pane, "foreground_processes": procs}}, nil
		case "send-text":
			f.typed[args[2]] += args[3]
			return map[string]any{"type": "ok"}, nil
		case "send-keys":
			f.submitted[args[2]]++
			return map[string]any{"type": "ok"}, nil
		case "get":
			return map[string]any{"pane": map[string]any{"pane_id": args[2], "agent": "pi",
				"agent_session": map[string]any{"value": f.sessionFile}}}, nil
		}
	}
	return nil, fmt.Errorf("deploy called an unexpected herdr command %q", strings.Join(args, " "))
}

// holds reports whether some tab still carries that pane.
func (f *herdrFake) holds(pane string) bool {
	for _, id := range f.paneIDs {
		if id == pane {
			return true
		}
	}
	return false
}

// workspaceOf is the workspace label whose tabs hold a tab's full name.
func (f *herdrFake) workspaceOf(name string) string {
	label, _, _ := strings.Cut(name, "/")
	return label
}

// tabName splits a tab id back into its workspace and label.
func (f *herdrFake) tabName(tabID string) (string, string) {
	for key, id := range f.tabIDs {
		if id == tabID {
			label, tab, _ := strings.Cut(key, "/")
			return label, tab
		}
	}
	return "", ""
}

// tabLabel is the last label a tab id was known by.
func (f *herdrFake) tabLabel(tabID string) string {
	_, tab := f.tabName(tabID)
	return tab
}

func (f *herdrFake) rename(workspace, from, to string) []string {
	out := []string{}
	for _, tab := range f.tabs[workspace] {
		if tab == from {
			tab = to
			delete(f.tabIDs, workspace+"/"+from)
			delete(f.paneIDs, workspace+"/"+from)
		}
		out = append(out, tab)
	}
	return out
}

func (f *herdrFake) tabID(workspace, tab string) string {
	key := workspace + "/" + tab
	if id, ok := f.tabIDs[key]; ok {
		return id
	}
	f.next++
	id := fmt.Sprintf("tab:%02d", f.next)
	f.tabIDs[key] = id
	return id
}

func (f *herdrFake) paneID(workspace, tab string) string {
	key := workspace + "/" + tab
	if id, ok := f.paneIDs[key]; ok {
		return id
	}
	f.next++
	id := fmt.Sprintf("pane:%02d", f.next)
	f.paneIDs[key] = id
	return id
}

// seats counts the tabs one label names in a workspace.
func (f *herdrFake) seats(workspace, label string) int {
	n := 0
	for _, tab := range f.tabs[workspace] {
		if tab == label {
			n++
		}
	}
	return n
}

// steps is what deploy asked Herdr, in order: a command name for every call, so
// a test reads the seat's whole conversation.
func (f *herdrFake) steps() []string {
	out := []string{}
	for _, c := range f.calls {
		switch c[0] {
		case "workspace", "tab":
			out = append(out, c[0]+" "+c[1])
		case "pane":
			out = append(out, "pane "+c[1])
		default:
			out = append(out, c[0])
		}
	}
	return out
}

// callOf returns the arguments of the first call of one command, and nil when
// deploy made none.
func (f *herdrFake) callOf(command ...string) []string {
	prefix := strings.Join(command, " ")
	for _, c := range f.calls {
		if strings.HasPrefix(strings.Join(c, " "), prefix) {
			return c
		}
	}
	return nil
}

// callsOf returns every call that starts with the given command words.
func (f *herdrFake) callsOf(command ...string) [][]string {
	prefix := strings.Join(command, " ")
	out := [][]string{}
	for _, c := range f.calls {
		if strings.HasPrefix(strings.Join(c, " "), prefix) {
			out = append(out, c)
		}
	}
	return out
}

// used reports whether deploy made one call of that command.
func (f *herdrFake) used(command ...string) bool { return f.callOf(command...) != nil }

// flagOf reads one flag's value from a Herdr command line.
func flagOf(args []string, name string) string {
	for i, a := range args {
		if a == name && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

// forget clears the call record, so a test reads only the steps it cares about.
func (f *herdrFake) forget() { f.calls = nil }

// resolved is the path the record holds: launch resolves the file's parent, so a
// temp directory behind a symlink (/var on macOS) reads back as /private/var.
func resolved(t *testing.T, path string) string {
	t.Helper()
	parent, e := filepath.EvalSymlinks(filepath.Dir(path))
	must(t, e)
	return filepath.Join(parent, filepath.Base(path))
}

// fakeHerdr installs the recording server for one test.
func fakeHerdr(t *testing.T) *herdrFake {
	t.Helper()
	f := newHerdrFake()
	swap := herdrAPI
	herdrAPI = f.call
	t.Cleanup(func() { herdrAPI = swap })
	return f
}

// execLine is the last line deploy wrote into a pane: the exec line that turns
// a waiting shell into the captain. The newline that submits it is its own write.
func (f *herdrFake) execLine() string {
	out := ""
	for _, text := range f.typed {
		if text != "\n" {
			out = text
		}
	}
	return out
}

// The first press seats everything in Herdr: the army workspace with its
// commander tab, the captain's tab in the mission worktree on the human's login
// shell, and the exec line that turns that shell into the captain. The plan's
// labels are the same ones a Rex deployment uses, and deploy never reaches Rex.
func TestDeploySeatsHerdr(t *testing.T) {
	s, h, _ := piFixture(t)
	rex := fakeRex(t)
	f := fakeHerdr(t)
	p, e := s.plan(h, "herdr", "")
	must(t, e)

	d, e := s.deploy(h, "herdr")
	must(t, e)
	// Same plan, same geometry: one army session, one captain window, one
	// subagent session, whichever mux seats them.
	if d.Mux != "herdr" || d.Session != p.Session || d.CaptainWindow != p.CaptainWindow || d.SubagentSession != p.SubagentSession {
		t.Fatalf("deployment = %+v, plan = %+v", d, p)
	}
	if !d.SessionCreated || d.Focused {
		t.Fatalf("deployment = %+v", d)
	}
	// The chosen adapter seats, and only it: a herdr deployment makes no Rex call.
	if len(rex.calls) != 0 {
		t.Fatalf("a herdr deployment called rex: %v", rex.calls)
	}
	// The army workspace, its commander tab, then the captain's tab: the shell
	// answers, the exec line is written, the Enter that submits it is its own
	// call, and only then does pi take the foreground.
	want := []string{"workspace list", "workspace create", "tab rename", "tab create",
		"pane process-info", "pane send-text", "pane send-keys", "pane process-info", "pane get"}
	if got := f.steps(); strings.Join(got, ", ") != strings.Join(want, ", ") {
		t.Fatalf("calls = %v", got)
	}
	army := f.callOf("workspace", "create")
	if flagOf(army, "--label") != p.Session {
		t.Fatalf("the army workspace is labeled %q, want %q: %v", flagOf(army, "--label"), p.Session, army)
	}
	if flagOf(army, "--cwd") != p.Cwd {
		t.Fatalf("the army workspace opens in %q, want the mission worktree %q", flagOf(army, "--cwd"), p.Cwd)
	}
	rename := f.callOf("tab", "rename")
	if rename[len(rename)-1] != p.CommanderWindow {
		t.Fatalf("the army's root tab is renamed %q, want %q", rename[len(rename)-1], p.CommanderWindow)
	}
	tab := f.callOf("tab", "create")
	if flagOf(tab, "--workspace") != "ws:"+p.Session || flagOf(tab, "--label") != p.CaptainWindow {
		t.Fatalf("captain tab = %v", tab)
	}
	if flagOf(tab, "--cwd") != p.Cwd {
		t.Fatalf("the captain's tab opens in %q, want %q", flagOf(tab, "--cwd"), p.Cwd)
	}
	// The exec line keeps the plan's argv and brief, and carries the mission's
	// subagent session: Herdr has no session object, so that label travels in the
	// seat itself. A Herdr pane already knows its own workspace and pane, so the
	// line carries no seat identity of its own.
	line := f.execLine()
	for _, want := range []string{
		"'PI_SUBAGENT_SESSION=" + p.SubagentSession + "'",
		"'PI_SUBAGENT_CWD=" + p.Cwd + "'",
		shellQuote(p.CaptainArgv[0]),
		"'--tools'",
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("the exec line does not carry %q:\n%s", want, line)
		}
	}
	if !strings.HasPrefix(line, "exec env ") || strings.Contains(line, "REX_") {
		t.Fatalf("the Herdr exec line carries a Rex seat identity:\n%s", line)
	}
	if !strings.HasSuffix(strings.TrimSpace(line), "keep this session and worktree for later steps.'") {
		t.Fatalf("the brief is not the last argument:\n%s", line)
	}
	if strings.Contains(line, "PATH=") {
		t.Fatalf("the exec line hand-rolls a PATH:\n%s", line)
	}
	// The seat's own pane and tab come back, so a reader knows where the captain
	// runs.
	if d.CaptainWindowID == "" || d.Pane == "" {
		t.Fatalf("the deployment reports no seat: %+v", d)
	}
	if !d.Acknowledged || d.Ack != p.Ack {
		t.Fatalf("acknowledged=%v ack=%q want %q", d.Acknowledged, d.Ack, p.Ack)
	}
	r, e := s.load(h)
	must(t, e)
	if r.State.Runtime.LaunchAck != p.Ack || r.State.Runtime.LaunchID != d.LaunchID {
		t.Fatalf("runtime launch ack=%q id=%q", r.State.Runtime.LaunchAck, r.State.Runtime.LaunchID)
	}
	if n := f.seats(p.Session, p.CaptainWindow); n != 1 {
		t.Fatalf("deploy left %d captain tabs", n)
	}
}

// A deployment records the Pi session file Herdr reports for the captain it
// seated, on the intent that reserved it, so a later attach adopts that session
// instead of starting another.
func TestDeployHerdrRecordsTheReportedSession(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeHerdr(t)
	f.sessionFile = filepath.Join(t.TempDir(), "captain.jsonl")
	_, e := s.launch(h, "", "")
	must(t, e)
	d, e := s.deploy(h, "herdr")
	must(t, e)
	if d.SessionFile != f.sessionFile {
		t.Fatalf("the deployment reports session file %q, want %q", d.SessionFile, f.sessionFile)
	}
	r, e := s.load(h)
	must(t, e)
	if want := resolved(t, f.sessionFile); r.State.Runtime.SessionFile != want {
		t.Fatalf("the record holds session file %q, want %q", r.State.Runtime.SessionFile, want)
	}
}

// A repeat press finds the captain still running in its tab and focuses that
// tab: Herdr liveness is the pane's own foreground process, so a captain that
// just took the seat is never mistaken for a dead one.
func TestDeployHerdrFocusesTheLiveCaptain(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeHerdr(t)
	first, e := s.deploy(h, "herdr")
	must(t, e)
	f.forget()

	second, e := s.deploy(h, "herdr")
	must(t, e)
	if !second.Focused || second.CaptainWindowID != first.CaptainWindowID {
		t.Fatalf("second deployment = %+v", second)
	}
	want := "workspace list tab list pane list pane process-info tab focus"
	if got := strings.Join(f.steps(), " "); got != want {
		t.Fatalf("a repeat press called %v", got)
	}
	if focused := f.callOf("tab", "focus")[2]; focused != first.CaptainWindowID {
		t.Fatalf("deploy focused %q, the live captain was in %q", focused, first.CaptainWindowID)
	}
	if n := f.seats("army", "captain-test-mission"); n != 1 {
		t.Fatalf("a repeat press left %d captain tabs", n)
	}
	if second.Acknowledged {
		t.Fatal("a repeat press wrote a second ack")
	}
}

// A tab with the captain's label is not a seat when no captain runs in it: the
// dead tab is closed, and a fresh one is seated below. One label never names two
// tabs.
func TestDeployHerdrReplacesADeadSeat(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeHerdr(t)
	first, e := s.deploy(h, "herdr")
	must(t, e)
	stale := first.CaptainWindowID
	f.submitted[first.Pane] = 0 // the captain exited; the tab and its shell stay
	f.forget()

	d, e := s.deploy(h, "herdr")
	must(t, e)
	if d.Focused {
		t.Fatalf("a dead seat was focused: %+v", d)
	}
	if !f.used("tab", "close") || !f.used("tab", "create") {
		t.Fatalf("a dead seat was not replaced: %v", f.steps())
	}
	if closed := f.callOf("tab", "close")[2]; closed != stale {
		t.Fatalf("deploy closed %q, the dead tab was %q", closed, stale)
	}
	if n := f.seats("army", d.CaptainWindow); n != 1 {
		t.Fatalf("deploy left %d captain tabs", n)
	}
	if d.CaptainWindowID == stale {
		t.Fatalf("the fresh seat kept the dead tab: %+v", d)
	}
	if !d.Acknowledged && d.Ack == "" {
		t.Fatalf("a replaced seat was not acked: %+v", d)
	}
}

// Herdr's seat has the same two waits as Rex's: the tab's shell must own the
// pane before anything is written, and a shell that reads its Enter late gets one
// more, never a second tab.
func TestDeployHerdrWaitsForTheShellAndRetriesTheSubmitOnce(t *testing.T) {
	fastSeat(t)
	s, h, _ := piFixture(t)
	f := fakeHerdr(t)
	f.starting = 1
	f.submits = 2
	d, e := s.deploy(h, "herdr")
	must(t, e)
	steps := f.steps()
	typed := -1
	for i, step := range steps {
		if step == "pane send-text" {
			typed = i
		}
	}
	// Nothing is typed until the shell answers: the first poll lands while the
	// shell is still starting, and the second is the one that owns the pane.
	if typed < 2 || steps[typed-1] != "pane process-info" || steps[typed-2] != "pane process-info" {
		t.Fatalf("the seat typed into a shell that had not answered: %v", steps)
	}
	if steps[0] != "workspace list" || steps[1] != "workspace create" || steps[2] != "tab rename" || steps[3] != "tab create" {
		t.Fatalf("the seat did not seat the army first: %v", steps)
	}
	if n := len(f.callsOf("tab", "create")); n != 1 {
		t.Fatalf("the retried seat opened %d tabs", n)
	}
	if n := len(f.callsOf("pane", "send-keys")); n != 2 {
		t.Fatalf("the seat submitted %d times, want the line's submit and one retry", n)
	}
	if d.CaptainWindowID == "" || d.Pane == "" {
		t.Fatalf("deployment = %+v", d)
	}
}

// A pane whose shell never starts is not a place to type: the seat names the
// pane and stops, instead of writing a line no shell will ever read.
func TestDeployHerdrRefusesToWriteIntoAShellThatNeverStarts(t *testing.T) {
	fastSeat(t)
	s, h, _ := piFixture(t)
	f := fakeHerdr(t)
	f.starting = -1
	_, e := s.deploy(h, "herdr")
	wantCode(t, e, "herdr_error")
	pane := f.callOf("tab", "create")
	if pane == nil {
		t.Fatal("the seat opened no tab")
	}
	if !strings.Contains(e.Error(), "the seat's shell never started") {
		t.Fatalf("the failure does not say what happened: %v", e)
	}
	if f.used("pane", "send-text") {
		t.Fatalf("the seat wrote into a pane with no shell: %s", f.typed)
	}
	if n := f.seats("army", "captain-test-mission"); n != 1 {
		t.Fatalf("the failed seat left %d tabs", n)
	}
	if r, e := s.load(h); e != nil || r.State.Runtime.LaunchAck != "" {
		t.Fatalf("a failed seat acknowledged the launch: %+v %v", r.State.Runtime, e)
	}
}

// A pane that never becomes pi is not a seated captain: the seat retries the
// Enter once, then fails with the pane, the tab, and what the foreground still
// reports, and it never opens a second tab.
func TestDeployHerdrFailsWhenPiNeverTakesTheSeat(t *testing.T) {
	fastSeat(t)
	s, h, _ := piFixture(t)
	f := fakeHerdr(t)
	f.shellForeground = true
	_, e := s.deploy(h, "herdr")
	wantCode(t, e, "herdr_error")
	pane := f.paneID("army", "captain-test-mission")
	tab := f.tabID("army", "captain-test-mission")
	for _, want := range []string{pane, tab, filepath.Base(loginShell()), "after the submit was sent twice"} {
		if !strings.Contains(e.Error(), want) {
			t.Fatalf("the failure does not report %q: %v", want, e)
		}
	}
	if n := len(f.callsOf("pane", "send-keys")); n != 2 {
		t.Fatalf("the seat submitted %d times, want the line's submit and one retry", n)
	}
	if n := f.seats("army", "captain-test-mission"); n != 1 {
		t.Fatalf("the failed seat left %d tabs", n)
	}
}

// The command path: `mission deploy --mux herdr` reaches the same seats, and the
// default mux stays Rex.
func TestDeployCommandSeatsTheChosenMux(t *testing.T) {
	s, h, _ := piFixture(t)
	rex := fakeRex(t)
	f := fakeHerdr(t)
	a, e := platform.ParseArgs([]string{"deploy", h, "--mux", "herdr", "--json"})
	must(t, e)
	v, e := cmdDeploy(a, s)
	must(t, e)
	d := v.(Deployment)
	if d.Mux != "herdr" || !d.SessionCreated || d.CaptainWindowID == "" {
		t.Fatalf("deployment = %+v", d)
	}
	if len(rex.calls) != 0 {
		t.Fatalf("--mux herdr called rex: %v", rex.calls)
	}
	if !f.used("tab", "create") {
		t.Fatal("the command seated no captain")
	}
}

// One plan, two muxes: the same army session, captain window, and subagent
// session, and the same captain argv and brief. What differs is only the seat's
// own identity in the exec line, because a Rex block must be told which block it
// is while a Herdr pane already knows its own workspace and pane.
func TestDeploySeatsTheSamePlanInEitherMux(t *testing.T) {
	rexStore, rexHandle, _ := piFixture(t)
	rexFakeServer := fakeRex(t)
	rexPlan, e := rexStore.plan(rexHandle, "rex", "")
	must(t, e)
	rexDeployment, e := rexStore.deploy(rexHandle, "rex")
	must(t, e)

	herdrStore, herdrHandle, _ := piFixture(t)
	herdrFakeServer := fakeHerdr(t)
	herdrPlan, e := herdrStore.plan(herdrHandle, "herdr", "")
	must(t, e)
	herdrDeployment, e := herdrStore.deploy(herdrHandle, "herdr")
	must(t, e)

	for _, want := range [][2]string{
		{rexDeployment.Session, herdrDeployment.Session},
		{rexDeployment.CaptainWindow, herdrDeployment.CaptainWindow},
		{rexDeployment.SubagentSession, herdrDeployment.SubagentSession},
	} {
		if want[0] != want[1] {
			t.Fatalf("the two muxes disagree on a plan label: rex %q, herdr %q", want[0], want[1])
		}
	}
	if rexPlan.Session != armySession || herdrPlan.Session != armySession {
		t.Fatalf("plans = %+v %+v", rexPlan, herdrPlan)
	}
	if rexDeployment.CaptainWindow != seatLabel(captainPrefix, "test-mission") || herdrDeployment.CaptainWindow != seatLabel(captainPrefix, "test-mission") {
		t.Fatalf("captain windows = %q %q", rexDeployment.CaptainWindow, herdrDeployment.CaptainWindow)
	}
	// The captain itself is the same in both seats: one exec line builder over
	// one plan, so each seat is exactly what that builder makes of its own plan.
	// Only the seat identity around the argv is the mux's. Rex names the session
	// label, because mission identities are labels; it does not name REX_BLOCK,
	// because Rex sets that in the block's own environment, and a window command
	// cannot carry an id that does not exist until the window has been created.
	rexLine, herdrLine := rexFakeServer.execLine(), herdrFakeServer.execLine()
	// Deploy re-renders the brief with the intent it reserved, so the plan a seat
	// is built from is the plan with that intent in it.
	rexSeated := rexPlan
	rexSeated.CaptainBrief = captainPrompt(rexHandle, rexPlan.SubagentSession, rexDeployment.LaunchID)
	if want := seatExecLine(rexSeated, "REX_SESSION="+armySession); rexLine != want {
		t.Fatalf("the rex seat is not the shared exec line:\n got %s\nwant %s", rexLine, want)
	}
	herdrSeated := herdrPlan
	herdrSeated.CaptainBrief = captainPrompt(herdrHandle, herdrPlan.SubagentSession, herdrDeployment.LaunchID)
	if want := seatExecLine(herdrSeated); herdrLine != want {
		t.Fatalf("the herdr seat is not the shared exec line:\n got %s\nwant %s", herdrLine, want)
	}
	if !strings.Contains(rexLine, "'REX_SESSION=army'") || strings.Contains(rexLine, "REX_BLOCK") || strings.Contains(herdrLine, "REX_") {
		t.Fatalf("the seat identity is not the mux's own:\nrex   %s\nherdr %s", rexLine, herdrLine)
	}
	// One shape: the same argv and brief, and exactly the seat identity Rex needs
	// as an argument and Herdr supplies for itself.
	herdrArgs, rexArgs := strings.Split(herdrLine, " "), strings.Split(rexLine, " ")
	if len(rexArgs)-len(herdrArgs) != 1 {
		t.Fatalf("the two seats are different shapes:\nrex   %v\nherdr %v", rexArgs, herdrArgs)
	}
	if herdrArgs[len(herdrArgs)-1] != rexArgs[len(rexArgs)-1] {
		t.Fatalf("the two seats end with different briefs: %q, %q", herdrArgs[len(herdrArgs)-1], rexArgs[len(rexArgs)-1])
	}
	// The army's own geometry is the same decision in both muxes: one session
	// labeled army, opened with the commander window.
	rexArmy := rexFakeServer.argsFor("session.create")[0]
	if rexArmy["label"] != armySession {
		t.Fatalf("rex army session = %v", rexArmy)
	}
	if got := flagOf(herdrFakeServer.callOf("workspace", "create"), "--label"); got != armySession {
		t.Fatalf("herdr army workspace = %q", got)
	}
	if got := herdrFakeServer.callOf("tab", "rename"); got[len(got)-1] != commanderWindow {
		t.Fatalf("herdr commander tab = %v", got)
	}
}

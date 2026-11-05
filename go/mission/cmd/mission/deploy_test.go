package main

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// rexFake is a Rex server that records what deploy asked it to do. Tests read
// the call log instead of reaching the live server, so no test opens a session.
type rexFake struct {
	sessions []string            // labels, in creation order
	windows  map[string][]string // session label -> window labels
	calls    []string
	args     map[string]map[string]any
	log      [][2]any // every call, method then args, in order
	fail     map[string]error
	next     int
	// blocks gives each window's root block a fresh id, so a replaced window
	// never inherits the block of the window it replaced. dead marks the blocks
	// whose captain is gone: the window stays in the view, but its block answers
	// not_found, as the dead army seat did.
	blocks map[string]string // "session/window" -> that window's root block id
	ids    map[string]string // "session/window" -> that window's id
	dead   map[string]bool
}

func newRexFake() *rexFake {
	return &rexFake{windows: map[string][]string{}, args: map[string]map[string]any{}, fail: map[string]error{}, blocks: map[string]string{}, ids: map[string]string{}, dead: map[string]bool{}}
}

func (f *rexFake) id(kind string) string {
	f.next++
	return fmt.Sprintf("%s:%02d", kind, f.next)
}

func (f *rexFake) call(method string, a map[string]any) (map[string]any, error) {
	f.calls = append(f.calls, method)
	f.args[method] = a
	f.log = append(f.log, [2]any{method, a})
	if e := f.fail[method]; e != nil {
		return nil, e
	}
	switch method {
	case "session.list":
		out := []any{}
		for _, label := range f.sessions {
			out = append(out, map[string]any{"label": label, "session_id": f.sessionID(label)})
		}
		return map[string]any{"sessions": out}, nil
	case "session.create":
		label := text(a["label"])
		for k := range f.ids {
			if strings.HasPrefix(k, label+"/") {
				delete(f.ids, k)
			}
		}
		f.sessions = append(f.sessions, label)
		out := []any{}
		inits, _ := a["initial_windows"].([]any)
		for _, w := range inits {
			m, _ := w.(map[string]any)
			win := text(m["window_label"])
			f.windows[label] = append(f.windows[label], win)
			out = append(out, map[string]any{"window_id": f.windowID(label, win), "window_label": win})
		}
		return map[string]any{"session_id": f.sessionID(label), "initial_windows": out}, nil
	case "session.view":
		label := f.labelOf(text(a["session_id"]))
		out := []any{}
		for _, win := range f.windows[label] {
			out = append(out, map[string]any{
				"label":     win,
				"window_id": f.windowID(label, win),
				"layers": []any{map[string]any{
					"blocks": []any{map[string]any{"block_id": f.rootBlock(label, win)}},
				}},
			})
		}
		return map[string]any{"label": label, "windows": out}, nil
	case "block.method":
		// The API form of `rex block call <block> process`, and of the write that
		// replaces the seat's waiting shell with the captain.
		block := text(a["block_id"])
		if f.dead[block] || !f.holds(block) {
			return nil, fmt.Errorf("stream response \"control-2\" failed: block not found: %s (status=404 code=not_found)", block)
		}
		switch text(a["method"]) {
		case "process":
			return map[string]any{
				"last_exit":  nil,
				"foreground": map[string]any{"name": "node", "argv0": "pi", "path": "/opt/homebrew/bin/pi"},
			}, nil
		case "write":
			args, _ := a["args"].(map[string]any)
			return map[string]any{"bytes_written": len(text(args["data"]))}, nil
		}
		return nil, fmt.Errorf("deploy asked a block for %q", a["method"])
	case "session.close_window":
		label := f.labelOf(text(a["session_id"]))
		id, kept := text(a["window_id"]), []string{}
		for _, win := range f.windows[label] {
			if f.windowID(label, win) != id {
				kept = append(kept, win)
			}
		}
		f.windows[label] = kept
		return map[string]any{"revision": len(kept)}, nil
	case "session.new_window":
		label := f.labelOf(text(a["session_id"]))
		win := text(a["window_label"])
		// A fresh window, with its own id and its own block.
		delete(f.ids, label+"/"+win)
		delete(f.blocks, label+"/"+win)
		f.windows[label] = append(f.windows[label], win)
		block := f.rootBlock(label, win)
		return map[string]any{"window_id": f.windowID(label, win), "block_ids": []any{block}}, nil
	case "session.focus_window":
		return map[string]any{"window_id": text(a["window_id"])}, nil
	}
	return nil, fmt.Errorf("deploy called an unexpected method %q", method)
}

func (f *rexFake) sessionID(label string) string { return "session:" + label }

func (f *rexFake) labelOf(sessionID string) string { return strings.TrimPrefix(sessionID, "session:") }

// windowID is one window's id. Each window gets its own, so a window that
// replaced another is a different window, as it is in Rex.
func (f *rexFake) windowID(label, win string) string {
	key := label + "/" + win
	if id, ok := f.ids[key]; ok {
		return id
	}
	f.next++
	id := fmt.Sprintf("window:%02d", f.next)
	f.ids[key] = id
	return id
}

// rootBlock is the root block of one window: the block a captain runs in. Each
// window gets its own id once, so a window that replaced another has its own.
func (f *rexFake) rootBlock(label, win string) string {
	key := label + "/" + win
	if id, ok := f.blocks[key]; ok {
		return id
	}
	f.next++
	id := fmt.Sprintf("block:%02d", f.next)
	f.blocks[key] = id
	return id
}

// holds reports whether some window still carries that block.
func (f *rexFake) holds(block string) bool {
	for label, wins := range f.windows {
		for _, win := range wins {
			if f.rootBlock(label, win) == block {
				return true
			}
		}
	}
	return false
}

// seats counts the windows one label names in a session.
func (f *rexFake) seats(session, label string) int {
	n := 0
	for _, win := range f.windows[session] {
		if win == label {
			n++
		}
	}
	return n
}

// killCaptain makes the window's block dead: the window stays in the view, but
// its block answers not_found, exactly as the live army seat did.
func (f *rexFake) killCaptain(session, label string) string {
	block := f.rootBlock(session, label)
	f.dead[block] = true
	return block
}

// execLine is the last line deploy wrote into a block: the exec line that turns a
// waiting shell into the captain. Later writes win, because a replaced seat
// writes its own line into its own block.
func (f *rexFake) execLine() string {
	out := ""
	for _, a := range f.argsFor("block.method") {
		if text(a["method"]) != "write" {
			continue
		}
		args, _ := a["args"].(map[string]any)
		out = text(args["data"])
	}
	return out
}

// wroteTo is the block deploy seated the captain in, the target of that write.
func (f *rexFake) wroteTo() string {
	out := ""
	for _, a := range f.argsFor("block.method") {
		if text(a["method"]) == "write" {
			out = text(a["block_id"])
		}
	}
	return out
}

// argsFor returns the arguments of every call of one method, in order.
func (f *rexFake) argsFor(method string) []map[string]any {
	out := []map[string]any{}
	for _, c := range f.log {
		if c[0] == method {
			out = append(out, c[1].(map[string]any))
		}
	}
	return out
}

func (f *rexFake) used(method string) bool {
	for _, c := range f.calls {
		if c == method {
			return true
		}
	}
	return false
}

// fakeRex installs the recording server for one test.
func fakeRex(t *testing.T) *rexFake {
	t.Helper()
	f := newRexFake()
	swap := rexAPI
	rexAPI = f.call
	t.Cleanup(func() { rexAPI = swap })
	return f
}

// The first press seats everything: the army session with its commander, the
// mission's subagent session, and the captain window running the plan's argv and
// brief in the mission worktree. Then it acks with the plan's own token.
func TestDeploySeatsTheArmy(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	p, e := s.plan(h, "rex", "")
	must(t, e)

	d, e := s.deploy(h, "rex")
	must(t, e)
	if !d.SessionCreated || !d.SubagentCreated || d.Focused {
		t.Fatalf("deployment = %+v", d)
	}
	if d.Session != "army" || d.SubagentSession != "mission-test-mission" || d.CaptainWindow != "captain-test-mission" {
		t.Fatalf("labels = %s %s %s", d.Session, d.SubagentSession, d.CaptainWindow)
	}
	// The army comes first, with the commander seated; then the mission's own
	// session; then the captain window, last, so it takes the human's focus. The
	// window opens on a waiting shell, so one write turns it into the captain.
	want := []string{"session.list", "session.create", "session.create", "session.new_window", "block.method"}
	if strings.Join(f.calls, " ") != strings.Join(want, " ") {
		t.Fatalf("calls = %v", f.calls)
	}
	army := f.argsFor("session.create")[0]
	if army["label"] != "army" {
		t.Fatalf("first session = %v", army)
	}
	wins, _ := army["initial_windows"].([]any)
	if len(wins) != 1 {
		t.Fatalf("army windows = %v", wins)
	}
	if w, _ := wins[0].(map[string]any); w["window_label"] != "commander" {
		t.Fatalf("army window = %v", wins[0])
	}
	win := f.args["session.new_window"]
	if win["session_id"] != "session:army" || win["window_label"] != "captain-test-mission" {
		t.Fatalf("captain window = %v", win)
	}
	block, _ := win["layout"].(map[string]any)["block"].(map[string]any)
	opts, _ := block["options"].(map[string]any)
	// The window opens on the human's login shell, then one exec line replaces it
	// with the captain: the block id exists only after the window is created, and
	// the login shell supplies the human's PATH.
	argv, _ := opts["command"].([]string)
	if want := loginShellArgv(); len(argv) != len(want) || argv[0] != want[0] || argv[1] != "-l" {
		t.Fatalf("captain window command = %v, want the login shell %v", argv, want)
	}
	line := f.execLine()
	if line == "" || !strings.HasPrefix(line, "exec env ") {
		t.Fatalf("no exec line was written into the seat: %q", line)
	}
	if f.wroteTo() != f.rootBlock("army", p.CaptainWindow) {
		t.Fatalf("the exec line went to %q, not the seat's own block", f.wroteTo())
	}
	// The brief names the launch intent deploy reserved, not the derived ack
	// token: the record holds the same id, so the captain's attach matches.
	if !strings.HasPrefix(d.LaunchID, "launch-") || !strings.Contains(line, "launch_id="+d.LaunchID) {
		t.Fatalf("launch id %q, line = %q", d.LaunchID, line)
	}
	// The seat names the shell and opens it as a login shell. Naming it matters:
	// "none" makes Rex run the command through /usr/bin/login, and login reports
	// no cwd, so the mission extension cannot bind the seat to this plan.
	if opts["cwd"] != p.Cwd {
		t.Fatalf("captain cwd = %v, want the plan cwd %q", opts["cwd"], p.Cwd)
	}
	if want := filepath.Base(loginShell()); opts["shell"] != want {
		t.Fatalf("captain shell = %v, want the login shell %q: a named shell is the shape that reports a cwd", opts["shell"], want)
	}
	// The ack is the plan's derived token, recorded beside the intent it did not
	// replace, so a reader sees both what was reserved and what was seated.
	r, e := s.load(h)
	must(t, e)
	if !d.Acknowledged || d.Ack != p.Ack {
		t.Fatalf("acknowledged=%v ack=%q want %q", d.Acknowledged, d.Ack, p.Ack)
	}
	if r.State.Runtime.LaunchAck != p.Ack || r.State.Runtime.LaunchID != d.LaunchID {
		t.Fatalf("runtime launch ack=%q id=%q", r.State.Runtime.LaunchAck, r.State.Runtime.LaunchID)
	}
}

// An intent an adapter already reserved is the one the captain reads: deploy
// never mints a second one over it, so the brief names the id the record holds.
func TestDeployNamesTheReservedIntent(t *testing.T) {
	s, h, _ := piFixture(t)
	reserved, e := s.launch(h, "", "")
	must(t, e)
	want := reserved["runtime"].(*mission.RuntimeBinding).LaunchID
	f := fakeRex(t)
	d, e := s.deploy(h, "rex")
	must(t, e)
	if d.LaunchID != want || !strings.HasPrefix(want, "launch-") {
		t.Fatalf("deploy reserved %q, the record held %q", d.LaunchID, want)
	}
	line := f.execLine()
	if !strings.Contains(line, "launch_id="+want) {
		t.Fatalf("the exec line = %q", line)
	}
}

// The seat is two phases, because a block's id exists only after its window does.
// The window opens on the human's login shell; deploy reads the block id from the
// result and writes one exec line that starts pi with that id as its own
// REX_BLOCK, the session label it must deploy troopers in, and the mission's
// environment, PATH included through that login shell.
func TestDeploySeatsTheCaptainWithItsOwnBlock(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	p, e := s.plan(h, "rex", "")
	must(t, e)
	if _, e = s.deploy(h, "rex"); e != nil {
		t.Fatal(e)
	}
	block := f.rootBlock("army", p.CaptainWindow)
	if f.wroteTo() != block {
		t.Fatalf("the exec line went to %q, want the seat's own block %q", f.wroteTo(), block)
	}
	line := f.execLine()
	for _, want := range []string{
		"'REX_SESSION=army'",
		"'REX_BLOCK=" + block + "'",
		"'PI_SUBAGENT_SESSION=" + p.SubagentSession + "'",
		"'PI_SUBAGENT_CWD=" + p.Cwd + "'",
		shellQuote(p.CaptainArgv[0]),
		"'--tools'",
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("the exec line does not carry %q:\n%s", want, line)
		}
	}
	// The seat's PATH is the login shell's, so the exec line carries no PATH of its
	// own: a hand-rolled list is exactly what dropped `mission` and `rex`.
	if strings.Contains(line, "PATH=") {
		t.Fatalf("the exec line hand-rolls a PATH:\n%s", line)
	}
	// The brief stays the first message: it is the last argument pi receives, so
	// the line ends inside its last sentence.
	if !strings.HasSuffix(strings.TrimSpace(line), "keep this session and worktree for later steps.'") {
		t.Fatalf("the brief is not the last argument:\n%s", line)
	}
	// One line, with only the trailing newline that submits it: a shell reads each
	// line on its own, so a break would run the exec in parts.
	if strings.Contains(strings.TrimSuffix(line, "\n"), "\n") {
		t.Fatalf("the exec line spans lines, so the shell would run it in parts:\n%s", line)
	}
}

// The captain's block opens the human's login shell, so the exec line that
// replaces it starts pi with the human's own PATH. That is the fix for PATH
// parity: a captain seated from the multiplexer's minimal PATH lost `mission`
// (`spawn mission ENOENT`, mission tracking unavailable), lost `rex` (the
// subagent gate stayed closed, so no trooper could be deployed at all), and
// answered `mission deploy` with executable "pi" not found in PATH. The seat
// carries no PATH list of its own, so one machine's profile cannot drift from
// another's.
func TestDeploySeatsTheCaptainUnderTheLoginShell(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	p, e := s.plan(h, "rex", "")
	must(t, e)
	if _, e = s.deploy(h, "rex"); e != nil {
		t.Fatal(e)
	}
	win := f.args["session.new_window"]
	opts, _ := win["layout"].(map[string]any)["block"].(map[string]any)["options"].(map[string]any)
	argv, _ := opts["command"].([]string)
	if want := loginShellArgv(); len(argv) != len(want) || argv[0] != want[0] || argv[1] != want[1] {
		t.Fatalf("the captain's block runs %v, want the absolute login shell %v: no profile, no PATH", argv, want)
	}
	if !filepath.IsAbs(argv[0]) {
		t.Fatalf("the captain's block runs %q: a window resolves its command against rex's own PATH", argv[0])
	}
	if opts["shell"] != filepath.Base(loginShell()) {
		t.Fatalf("the captain's block names shell %v, want %q: an unnamed shell starts a login wrapper over the seat: %v", opts["shell"], filepath.Base(loginShell()), opts)
	}
	if _, ok := opts["path_prepend"]; ok {
		t.Fatalf("the captain's block prepends a PATH of its own: %v", opts)
	}
	block := f.rootBlock("army", p.CaptainWindow)
	line := f.execLine()
	for _, want := range []string{
		"'REX_SESSION=army'",
		"'REX_BLOCK=" + block + "'",
		"'PI_SUBAGENT_SESSION=" + p.SubagentSession + "'",
		"'PI_SUBAGENT_CWD=" + p.Cwd + "'",
		shellQuote(p.CaptainArgv[0]),
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("the seat's exec line does not carry %q:\n%s", want, line)
		}
	}
	// No PATH list: the login shell's profile owns PATH, and a hand-rolled copy is
	// what dropped `mission`, `rex`, and `pi` from the captain.
	if strings.Contains(line, "PATH=") {
		t.Fatalf("the exec line hand-rolls a PATH:\n%s", line)
	}
	// The pi in the line is the plan's absolute resolution, not a bare name the
	// captain's environment would have to find.
	if pi, e := exec.LookPath("pi"); e == nil {
		abs, e := filepath.Abs(pi)
		must(t, e)
		if p.CaptainArgv[0] != abs {
			t.Fatalf("the exec line starts %q, want the absolute %q", p.CaptainArgv[0], abs)
		}
	}
}

// $SHELL names the shell the captain's block opens, and a value the machine
// cannot run falls back to /bin/sh. A seat never starts a shell that is not
// there, because then no captain starts at all.
func TestLoginShellFollowsTheUsersShell(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	if got := loginShell(); got != "/bin/sh" {
		t.Fatalf("loginShell() = %q with SHELL=/bin/sh", got)
	}
	for _, bad := range []string{"", "zsh", "/nonexistent/zsh", "/tmp"} {
		t.Setenv("SHELL", bad)
		if got := loginShell(); got != "/bin/sh" {
			t.Fatalf("loginShell() = %q with SHELL=%q, want /bin/sh", got, bad)
		}
	}
	if argv := loginShellArgv(); len(argv) != 2 || argv[0] != "/bin/sh" || argv[1] != "-l" {
		t.Fatalf("loginShellArgv() = %v, want /bin/sh -l", argv)
	}
}

// A repeat press focuses the live captain window and creates nothing, so one
// mission never gets a second seat. Liveness is the block's own answer: the
// foreground process is still pi, so the seat is live.
func TestDeployFocusesTheLiveCaptain(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	first, e := s.deploy(h, "rex")
	must(t, e)
	f.calls = nil

	second, e := s.deploy(h, "rex")
	must(t, e)
	if !second.Focused || second.CaptainWindowID != first.CaptainWindowID {
		t.Fatalf("second deployment = %+v", second)
	}
	// The view says the window is there; the block says a captain still runs in
	// it, so the press focuses it and stops.
	want := "session.list session.view block.method session.focus_window"
	if strings.Join(f.calls, " ") != want {
		t.Fatalf("a repeat press called %v", f.calls)
	}
	if probe := f.args["block.method"]; probe["method"] != "process" || text(probe["block_id"]) != f.rootBlock("army", "captain-test-mission") {
		t.Fatalf("the liveness read = %v", probe)
	}
	if n := f.seats("army", "captain-test-mission"); n != 1 {
		t.Fatalf("a repeat press left %d captain windows", n)
	}
	if second.Acknowledged {
		t.Fatal("a repeat press wrote a second ack")
	}
}

// A window with the captain's label is not a seat when no captain runs in it.
// The label alone must not turn a dead window into a successful press.
func TestDeployDoesNotTreatADeadSeatAsASeat(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	_, e := s.deploy(h, "rex")
	must(t, e)
	stale := f.windowID("army", "captain-test-mission")
	dead := f.killCaptain("army", "captain-test-mission")
	f.calls = nil

	d, e := s.deploy(h, "rex")
	must(t, e)
	if d.Focused {
		t.Fatalf("a dead seat was focused: %+v", d)
	}
	if f.used("session.focus_window") {
		t.Fatalf("a dead seat was focused: %v", f.calls)
	}
	// The dead window is cleared, not kept beside a fresh seat.
	if !f.used("session.close_window") || !f.used("session.new_window") {
		t.Fatalf("a dead seat was not replaced: %v", f.calls)
	}
	if closed := text(f.args["session.close_window"]["window_id"]); closed != stale {
		t.Fatalf("deploy closed %q, the dead window was %q", closed, stale)
	}
	if fresh := f.rootBlock("army", "captain-test-mission"); f.dead[fresh] || fresh == dead {
		t.Fatalf("the fresh seat kept the dead block: %+v", d)
	}
	if n := f.seats("army", "captain-test-mission"); n != 1 {
		t.Fatalf("deploy left %d captain windows", n)
	}
}

// A dead seat leads to a fresh window that runs the captain, and only then to
// the ack: the press reports success because a captain was really seated.
func TestDeployReplacesADeadSeatAndAcks(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	first, e := s.deploy(h, "rex")
	must(t, e)
	f.killCaptain("army", "captain-test-mission")
	f.calls = nil

	d, e := s.deploy(h, "rex")
	must(t, e)
	// The first press already acknowledged this launch, so the replace carries
	// the same ack instead of writing a second one; what matters is that the
	// ack came after the fresh window, not before it.
	if d.Ack == "" {
		t.Fatalf("a replaced seat was not acked: %+v", d)
	}
	// Close the dead window, seat the fresh one, then ack. Nothing is focused.
	want := "session.list session.view block.method session.close_window session.new_window block.method"
	if strings.Join(f.calls, " ") != want {
		t.Fatalf("the replace called %v", f.calls)
	}
	if d.CaptainWindowID == first.CaptainWindowID || d.CaptainWindowID != f.windowID("army", "captain-test-mission") {
		t.Fatalf("the fresh seat = %q, the dead one was %q", d.CaptainWindowID, first.CaptainWindowID)
	}
	win := f.argsFor("session.new_window")[0]
	block, _ := win["layout"].(map[string]any)["block"].(map[string]any)
	argv, _ := block["options"].(map[string]any)["command"].([]string)
	if len(argv) != 2 || argv[0] != loginShell() || argv[1] != "-l" {
		t.Fatalf("the fresh window runs %v, want the login shell", argv)
	}
	line := f.execLine()
	if !strings.Contains(line, "launch_id="+d.LaunchID) {
		t.Fatalf("the fresh seat's exec line = %q", line)
	}
	if f.wroteTo() != f.rootBlock("army", "captain-test-mission") {
		t.Fatalf("the fresh exec line went to %q", f.wroteTo())
	}
	r, e := s.load(h)
	must(t, e)
	if r.State.Runtime.LaunchAck != d.Ack {
		t.Fatalf("the record holds ack %q, deploy reported %q", r.State.Runtime.LaunchAck, d.Ack)
	}
}

// A liveness read that fails for any reason other than a missing block stops
// deploy: a second captain must never be seated on a guess, and nothing is acked.
func TestDeployStopsBeforeTheAckWhenTheSeatCannotBeRead(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	first, e := s.deploy(h, "rex")
	must(t, e)
	f.calls = nil
	f.fail["block.method"] = fmt.Errorf("connection reset by peer")

	_, e = s.deploy(h, "rex")
	wantCode(t, e, "rex_error")
	if !strings.Contains(e.Error(), "connection reset by peer") {
		t.Fatalf("the error lost rex's message: %v", e)
	}
	if f.used("session.new_window") || f.used("session.focus_window") {
		t.Fatalf("a failed liveness read still seated or focused: %v", f.calls)
	}
	r, e := s.load(h)
	must(t, e)
	if r.State.Runtime.LaunchAck != first.Ack {
		t.Fatalf("a failed liveness read changed the ack: %+v", r.State.Runtime)
	}
}

// A failure part way leaves the record unacknowledged, and the intent it
// reserved stays, so a later press finishes the same deployment.
func TestDeployStopsBeforeTheAckWhenRexFails(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	f.fail["session.new_window"] = fmt.Errorf("session_not_found")
	_, e := s.deploy(h, "rex")
	wantCode(t, e, "rex_error")
	if !strings.Contains(e.Error(), "session_not_found") {
		t.Fatalf("the error lost rex's message: %v", e)
	}
	r, e := s.load(h)
	must(t, e)
	if r.State.Runtime.LaunchAck != "" {
		t.Fatalf("a failed deploy acknowledged the launch: %+v", r.State.Runtime)
	}
	reserved := r.State.Runtime.LaunchID
	if !strings.HasPrefix(reserved, "launch-") {
		t.Fatalf("a failed deploy reserved no intent: %+v", r.State.Runtime)
	}
	// The retry reuses that intent instead of reserving another, and the captain
	// it seats names it.
	delete(f.fail, "session.new_window")
	d, e := s.deploy(h, "rex")
	must(t, e)
	if d.LaunchID != reserved || !d.Acknowledged {
		t.Fatalf("the retry = %+v, want the intent %s", d, reserved)
	}
	argv, _ := f.args["session.new_window"]["layout"].(map[string]any)["block"].(map[string]any)["options"].(map[string]any)["command"].([]string)
	if out := f.execLine(); len(argv) != 2 || !strings.Contains(out, "launch_id="+reserved) {
		t.Fatalf("the retried seat runs %v with %q", argv, out)
	}
}

// Deploy describes nothing it cannot seat: no worktree, no seats.
func TestDeployNeedsAWorktree(t *testing.T) {
	s, h := fixture(t)
	f := fakeRex(t)
	_, e := s.deploy(h, "rex")
	wantCode(t, e, "worktree_required")
	if len(f.calls) != 0 {
		t.Fatalf("deploy touched rex without a worktree: %v", f.calls)
	}
}

// One adapter today. An unknown mux is named, not silently treated as rex.
func TestDeployRefusesAnotherMux(t *testing.T) {
	s, h := fixture(t)
	_, e := s.deploy(h, "tmux")
	wantCode(t, e, "mux_unsupported")
}

// A closed mission deploys nothing, and the error is the record's own.
func TestDeployRefusesAClosedMission(t *testing.T) {
	s, h, _ := piFixture(t)
	_, e := s.close(h, "retired for the deploy test", true)
	must(t, e)
	fakeRex(t)
	_, e = s.deploy(h, "rex")
	wantCode(t, e, "closed")
}

// The command path: `mission deploy` reaches the same seats, with rex as the
// default mux.
func TestDeployCommandUsesRexByDefault(t *testing.T) {
	s, h, _ := piFixture(t)
	f := fakeRex(t)
	a, e := platform.ParseArgs([]string{"deploy", h, "--json"})
	must(t, e)
	v, e := cmdDeploy(a, s)
	must(t, e)
	if d := v.(Deployment); d.Mux != "rex" || !d.SessionCreated {
		t.Fatalf("deployment = %+v", d)
	}
	if !f.used("session.new_window") {
		t.Fatal("the command seated no captain")
	}
}

package main

import (
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// tree is every file under root with its contents, so a read-only command can be
// proven to have written nothing.
func tree(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	e := filepath.WalkDir(root, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			return nil
		}
		b, e := os.ReadFile(p)
		if e != nil {
			return e
		}
		out[p] = string(b)
		return nil
	})
	must(t, e)
	return out
}

func TestPlanDescribesTheArmy(t *testing.T) {
	s, h, _ := piFixture(t)
	p, e := s.plan(h, "rex", "")
	must(t, e)
	if p.Handle != h || p.Repo != "dotfiles" || p.Slug != "test-mission" {
		t.Fatalf("identity = %s %s/%s", p.Handle, p.Repo, p.Slug)
	}
	if p.Mux != "rex" {
		t.Fatalf("mux = %q", p.Mux)
	}
	if p.Step != "S01" {
		t.Fatalf("step = %q, want S01", p.Step)
	}
	// The plan owns the rank vocabulary: one army session, the commander and the
	// captain as its windows, and one subagent session named after the mission.
	if p.Session != "army" {
		t.Fatalf("session = %q", p.Session)
	}
	if p.CommanderWindow != "commander" {
		t.Fatalf("commander window = %q", p.CommanderWindow)
	}
	if p.CaptainWindow != "captain-test-mission" {
		t.Fatalf("captain window = %q", p.CaptainWindow)
	}
	if p.SubagentSession != "mission-test-mission" {
		t.Fatalf("subagent session = %q, want %q", p.SubagentSession, seatLabel(subagentPrefix, p.Slug))
	}
	r, e := s.load(h)
	must(t, e)
	if p.Cwd != r.State.Runtime.Cwd || p.Branch != r.State.Runtime.Branch {
		t.Fatalf("worktree = %s on %s", p.Cwd, p.Branch)
	}
	// The captain starts as pi with an allowlist: the profile's five tools, and
	// nothing an editor or a shell would need. The first element is the resolved
	// binary, never the bare name: a window does not see this PATH.
	if want := []string{captainPi(), "--tools", captainLoadout}; !reflect.DeepEqual(p.CaptainArgv, want) {
		t.Fatalf("captain argv = %v", p.CaptainArgv)
	}
	for _, banned := range []string{"edit", "write", "bash"} {
		for _, tool := range strings.Split(captainLoadout, ",") {
			if tool == banned {
				t.Fatalf("captain loadout grants %q: %s", banned, captainLoadout)
			}
		}
	}
	// The brief is the launch prompt, and it names the token the captain attaches
	// with: the plan's own ack token when no adapter reserved one.
	if !strings.Contains(p.CaptainBrief, "handle="+h+", launch_id="+p.Ack) {
		t.Fatalf("brief does not name the ack token:\n%s", p.CaptainBrief)
	}
	if !strings.HasSuffix(p.CaptainBrief, "keep this session and worktree for later steps.") {
		t.Fatalf("brief = %q", p.CaptainBrief)
	}
	// The brief is the captain contract: the three duties are stated once, here,
	// and no profile keeps a second copy of them. It also states the authority
	// split: the captain runs its mandate without asking leave, sends its whole
	// briefing on a block, and writes no definition except a step and its checks.
	for _, duty := range []string{"hold the claim", "deploy a trooper for every step", "answer the commander", "never edit repository files", "You are autonomous", "state the block", "The commander answers with a few bullets", "never rewrite the mission brief", "never reset a step to weaken a check"} {
		if !strings.Contains(p.CaptainBrief, duty) {
			t.Fatalf("brief does not name %q:\n%s", duty, p.CaptainBrief)
		}
	}
	// The session clause is the captain's only way to place a trooper: the brief
	// names the plan's subagent session, and the captain passes that label as the
	// `session` argument of every subagent call, so no rank tab lands in the army
	// session. The label the brief names IS Plan.SubagentSession, so an adapter
	// that sets it in the environment and a captain that passes it by hand agree.
	if !strings.Contains(p.CaptainBrief, "session="+p.SubagentSession) {
		t.Fatalf("brief does not name the subagent session %q:\n%s", p.SubagentSession, p.CaptainBrief)
	}
	if p.SubagentSession != seatLabel(subagentPrefix, p.Slug) {
		t.Fatalf("subagent session = %q, want %q", p.SubagentSession, seatLabel(subagentPrefix, p.Slug))
	}
	if b, e := hex.DecodeString(strings.TrimPrefix(p.Ack, "ack-")); e != nil || len(b) != 8 {
		t.Fatalf("ack token = %q", p.Ack)
	}
}

// The acceptance point: the same mission answers with the same JSON twice.
func TestPlanIsDeterministic(t *testing.T) {
	s, h, _ := piFixture(t)
	first, e := s.plan(h, "rex", "")
	must(t, e)
	second, e := s.plan(h, "rex", "")
	must(t, e)
	a, e := json.Marshal(first)
	must(t, e)
	b, e := json.Marshal(second)
	must(t, e)
	if string(a) != string(b) {
		t.Fatalf("two plans differ:\n%s\n%s", a, b)
	}
}

// The other acceptance point: plan writes nothing. No worktree, no attempt, no
// launch record, and not one byte of the vault or the launch state changes.
func TestPlanWritesNothing(t *testing.T) {
	s, h, _ := piFixture(t)
	state := t.TempDir()
	t.Setenv("MISSION_STATE_DIR", state)
	before := tree(t, s.Repo.VaultPath())
	worktrees := filepath.Dir(mustRuntime(t, s, h).Cwd)
	beforeWorktrees := tree(t, worktrees)
	rec, e := s.load(h)
	must(t, e)
	attempts := len(rec.State.Attempts)

	_, e = s.plan(h, "rex", "")
	must(t, e)
	_, e = s.plan(h, "rex", "")
	must(t, e)

	if after := tree(t, s.Repo.VaultPath()); !reflect.DeepEqual(before, after) {
		t.Fatalf("plan changed the vault:\nbefore %v\nafter  %v", before, after)
	}
	if after := tree(t, worktrees); !reflect.DeepEqual(beforeWorktrees, after) {
		t.Fatalf("plan changed the worktree:\nbefore %v\nafter  %v", beforeWorktrees, after)
	}
	rec, e = s.load(h)
	must(t, e)
	if len(rec.State.Attempts) != attempts {
		t.Fatalf("plan claimed an attempt: %d -> %d", attempts, len(rec.State.Attempts))
	}
	if rec.State.Runtime.LaunchID != "" || rec.State.Active != "" {
		t.Fatalf("plan recorded a launch: launch_id=%q active=%q", rec.State.Runtime.LaunchID, rec.State.Active)
	}
	if _, e := os.Stat(launchFile(state, h)); e == nil {
		t.Fatal("plan wrote a launch request")
	}
}

func mustRuntime(t *testing.T, s *App, h string) *mission.RuntimeBinding {
	t.Helper()
	r, e := s.load(h)
	must(t, e)
	if r.State.Runtime == nil {
		t.Fatal("fixture has no worktree")
	}
	return r.State.Runtime
}

// A captain needs an existing checkout: a mission with no worktree describes
// nothing, and plan must not create one.
func TestPlanRequiresAWorktree(t *testing.T) {
	s, h := fixture(t)
	_, e := s.plan(h, "rex", "")
	wantCode(t, e, "worktree_required")
	if r, _ := s.load(h); r.State.Runtime != nil {
		t.Fatal("plan created a worktree")
	}
}

// A recorded worktree that is gone on disk is reported, not recreated.
func TestPlanRefusesAMissingWorktree(t *testing.T) {
	s, h, _ := piFixture(t)
	cwd := mustRuntime(t, s, h).Cwd
	must(t, os.RemoveAll(cwd))
	_, e := s.plan(h, "rex", "")
	wantCode(t, e, "worktree_missing")
	if !strings.Contains(e.Error(), cwd) || !strings.Contains(e.Error(), h) {
		t.Fatalf("the error names neither the checkout nor the mission: %v", e)
	}
	if _, e := os.Stat(cwd); e == nil {
		t.Fatal("plan recreated the missing worktree")
	}
}

func TestPlanRefusesAClosedMission(t *testing.T) {
	s, h, _ := piFixture(t)
	_, e := s.close(h, "retired for the plan test", true)
	must(t, e)
	_, e = s.plan(h, "rex", "")
	wantCode(t, e, "closed")
}

// An adapter that already reserved a launch intent gets its brief rendered with
// that id, so one owner of the prompt text serves both paths.
func TestPlanBriefNamesAReservedLaunch(t *testing.T) {
	s, h, _ := piFixture(t)
	plain, e := s.plan(h, "rex", "")
	must(t, e)
	reserved, e := s.plan(h, "rex", "launch-abc123")
	must(t, e)
	if !strings.Contains(reserved.CaptainBrief, "launch_id=launch-abc123") {
		t.Fatalf("brief = %q", reserved.CaptainBrief)
	}
	if reserved.Ack != plain.Ack {
		t.Fatalf("the reserved launch moved the ack token: %s -> %s", plain.Ack, reserved.Ack)
	}
	if reserved.CaptainWindow != plain.CaptainWindow || reserved.SubagentSession != plain.SubagentSession {
		t.Fatal("a reserved launch changed the rank vocabulary")
	}
}

// --mux is accepted, and the description stays neutral: the value is echoed and
// nothing else about the plan moves.
func TestPlanAcceptsAMuxWithoutDependingOnIt(t *testing.T) {
	s, h, _ := piFixture(t)
	a, e := platform.ParseArgs([]string{"plan", h, "--mux", "rex", "--json"})
	must(t, e)
	v, e := cmdPlan(a, s)
	must(t, e)
	p := v.(Plan)
	if p.Mux != "rex" || p.Session != "army" {
		t.Fatalf("plan = %+v", p)
	}
	other, e := s.plan(h, "herdr", "")
	must(t, e)
	if other.Mux != "herdr" || other.CaptainWindow != p.CaptainWindow || other.SubagentSession != p.SubagentSession || other.Ack != p.Ack {
		t.Fatalf("another mux changed the description: %+v", other)
	}
}

// captainProfile is the bundled interactive-subagents profile that describes a
// captain seat, and captainLoadout is the flag a launch passes. They are two
// copies of one five-tool list, so they drift the first time an edit touches one
// of them: this test reads the profile from the repository and fails when they
// disagree. The path is repo-relative, and go test runs a package binary in its
// own source directory.
const captainProfile = "../../../../pi/.pi/agent/extensions/interactive-subagents/agents/mission-captain.md"

// profileTools returns the `tools:` frontmatter entry of a bundled agent
// profile, split the way the interactive-subagents loader splits it
// (agent-definitions.mjs: one line, comma-separated, each item trimmed).
func profileTools(t *testing.T, path string) string {
	t.Helper()
	b, e := os.ReadFile(path)
	if e != nil {
		t.Fatalf("the captain profile is missing at %s: %v", path, e)
	}
	lines := strings.Split(string(b), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		t.Fatalf("%s does not open with frontmatter", path)
	}
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			break // end of frontmatter: a mention in the body is not a declaration
		}
		value, ok := strings.CutPrefix(line, "tools:")
		if !ok {
			continue
		}
		var list []string
		for _, tool := range strings.Split(value, ",") {
			if tool = strings.TrimSpace(tool); tool != "" {
				list = append(list, tool)
			}
		}
		return strings.Join(list, ",")
	}
	t.Fatalf("%s declares no tools list", path)
	return ""
}

// The captain's reach has two copies; this is the guard that keeps them one. The
// profile is what a human reads, and captainLoadout is what a launched seat
// actually gets, so a seat must never hold a tool its profile denies, and the
// profile must never promise one the launch withholds.
func TestCaptainProfileMatchesTheLoadout(t *testing.T) {
	profile := profileTools(t, captainProfile)
	if profile != captainLoadout {
		t.Fatalf("the captain profile and the launch allowlist disagree:\n  %s\n    tools: %s\n  captainLoadout\n    %s", captainProfile, profile, captainLoadout)
	}
	// A captain holds the claim and never edits repository files, so neither copy
	// may grant an editor or a shell.
	for _, banned := range []string{"edit", "write", "bash"} {
		for _, tool := range strings.Split(profile, ",") {
			if tool == banned {
				t.Fatalf("the captain profile grants %q: %s", banned, profile)
			}
		}
	}
	// The argv is the only channel that reaches a launched Pi, so it must carry
	// the same allowlist the profile declares.
	if want := []string{captainPi(), "--tools", profile}; !reflect.DeepEqual(captainArgv(), want) {
		t.Fatalf("captain argv = %v, want %v", captainArgv(), want)
	}
}

// TestCaptainArgvResolvesPiAbsolutely pins the reason the plan resolves pi here.
// A Rex server runs a window's command against its own PATH, which holds its app
// directory plus /usr/bin, /bin, /usr/sbin and /sbin. A bare pi is not there, so
// deploy fails before it seats anything:
//
//	creating "com.superlogical.terminal.shell": executable "pi" not found in
//	PATH "...Rex Server.app/Contents/MacOS:/usr/bin:/bin:/usr/sbin:/sbin"
//	(status=400 code=bad_request)
//
// So argv[0] must carry a path separator whenever pi resolves on this machine,
// and the flags after it must not change.
func TestCaptainArgvResolvesPiAbsolutely(t *testing.T) {
	path, e := exec.LookPath("pi")
	if e != nil {
		t.Skip("pi is not on PATH on this machine, so there is nothing to resolve")
	}
	abs, e := filepath.Abs(path)
	must(t, e)
	argv := captainArgv()
	if argv[0] != abs {
		t.Fatalf("captain argv[0] = %q, want the resolved binary %q", argv[0], abs)
	}
	if !strings.ContainsRune(argv[0], filepath.Separator) {
		t.Fatalf("captain argv[0] = %q: a window cannot resolve a bare name", argv[0])
	}
	if want := []string{"--tools", captainLoadout}; !reflect.DeepEqual(argv[1:], want) {
		t.Fatalf("captain flags = %v, want %v", argv[1:], want)
	}
}

func TestPlanNeedsAHandle(t *testing.T) {
	s, _ := fixture(t)
	_, e := s.plan("", "rex", "")
	wantCode(t, e, "invalid_handle")
}

// Labels are unbounded but a Rex tab label has room. A slug that does not fit
// loses its tail to a digest of the whole slug: the same mission always gets the
// same label, two long slugs never share one, and plan and deploy read the label
// from this one function.
func TestSeatLabelKeepsOneNameForOneMission(t *testing.T) {
	a := "fix-the-pane-width-when-a-sibling-closes-and-the-window-widens"
	b := "fix-the-pane-width-when-a-sibling-closes-and-the-window-shrinks"
	if len(a) < 54 {
		t.Fatalf("the fixture slug is too short to cut: %d", len(a))
	}
	ca, cb := seatLabel(captainPrefix, a), seatLabel(captainPrefix, b)
	if ca != seatLabel(captainPrefix, a) {
		t.Fatal("the same slug got two labels")
	}
	if ca == cb {
		t.Fatalf("two long slugs share the label %q", ca)
	}
	for _, l := range []string{ca, cb, seatLabel(subagentPrefix, a)} {
		if len(l) > labelRoom {
			t.Fatalf("label %q is %d characters", l, len(l))
		}
		if strings.HasSuffix(l, "-") {
			t.Fatalf("label %q ends in a dash", l)
		}
	}
	if l := seatLabel(captainPrefix, "rex-army"); l != "captain-rex-army" {
		t.Fatalf("a short slug was rewritten: %q", l)
	}
	// The label a plan carries is the label deploy seats: one owner, no drift.
	s, h, _ := piFixture(t)
	p, e := s.plan(h, "rex", "")
	must(t, e)
	if p.CaptainWindow != seatLabel(captainPrefix, p.Slug) || p.SubagentSession != seatLabel(subagentPrefix, p.Slug) {
		t.Fatalf("plan labels = %q %q", p.CaptainWindow, p.SubagentSession)
	}
}

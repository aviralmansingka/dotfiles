package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLaunchTargetFollowsTheHost(t *testing.T) {
	t.Setenv("HERDR_ENV", "1")
	if got, e := launchTarget(""); e != nil || got != "herdr" {
		t.Fatalf("inside Herdr the default is herdr, got %q %v", got, e)
	}
	t.Setenv("HERDR_ENV", "")
	if got, e := launchTarget(""); e != nil || got != "local" {
		t.Fatalf("outside Herdr the default is local, got %q %v", got, e)
	}
	if got, e := launchTarget("herdr"); e != nil || got != "herdr" {
		t.Fatalf("an explicit target wins, got %q %v", got, e)
	}
	_, e := launchTarget("rex")
	wantCode(t, e, "usage")
}

// fakeHerdr answers Herdr API calls from a table and records every command.
func fakeHerdr(calls *[][]string, replies map[string]map[string]any) herdrRun {
	return func(args ...string) (map[string]any, error) {
		*calls = append(*calls, args)
		key := args[0]
		if len(args) > 1 {
			key += " " + args[1]
		}
		return fallbackMap(replies[key]), nil
	}
}

func fallbackMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func TestHerdrLauncherStartsOneAgentInTheMissionWorkspace(t *testing.T) {
	var calls [][]string
	l := herdrLauncher{wait: 0, newID: func() string { return "session-one" }, call: fakeHerdr(&calls, map[string]map[string]any{
		"worktree open": {"already_open": false, "workspace": map[string]any{"workspace_id": "w-mission"},
			"root_pane": map[string]any{"pane_id": "w-mission:p1", "workspace_id": "w-mission"}},
		"agent start":  {},
		"agent prompt": {},
	})}
	got, e := l.Launch(LaunchPlan{Handle: "dotfiles/desk", Slug: "desk", Checkout: "/repo", Cwd: "/worktrees/mission-desk", Prompt: "attach"})
	must(t, e)
	if got.Workspace != "w-mission" || got.Pane != "w-mission:p1" || got.Target != "herdr" {
		t.Fatalf("receipt names the created surface, got %+v", got)
	}
	// The primary checkout anchors the call, and the worktree opens unfocused.
	if len(calls) < 3 || strings.Join(calls[0][:3], " ") != "worktree open --cwd" {
		t.Fatalf("first call opens the worktree from the anchor, got %v", calls)
	}
	if calls[0][3] != "/repo" || calls[0][5] != "/worktrees/mission-desk" {
		t.Fatalf("worktree open must name the anchor and the mission checkout, got %v", calls[0])
	}
	// A fresh workspace hosts the worker in its first tab; no extra tab is made.
	for _, c := range calls {
		if c[0] == "tab" {
			t.Fatalf("a fresh workspace needs no launch tab, got %v", c)
		}
	}
	// One agent start, named by the receipt id, then the task prompt.
	if strings.Join(calls[1][:3], " ") != "agent start pi" || !strings.Contains(strings.Join(calls[1], " "), "--session-id session-one") {
		t.Fatalf("one agent starts with the receipt id, got %v", calls[1])
	}
	if calls[2][0] != "agent" || calls[2][1] != "prompt" || calls[2][2] != "w-mission:p1" {
		t.Fatalf("the prompt goes to the created pane, got %v", calls[2])
	}
}

func TestHerdrLauncherTakesItsOwnTabInAnOpenWorkspace(t *testing.T) {
	var calls [][]string
	l := herdrLauncher{wait: 0, newID: func() string { return "session-two" }, call: fakeHerdr(&calls, map[string]map[string]any{
		"worktree open": {"already_open": true, "workspace": map[string]any{"workspace_id": "w-open"},
			"root_pane": map[string]any{"pane_id": "w-open:p1", "workspace_id": "w-open"}},
		"tab create": {"root_pane": map[string]any{"pane_id": "w-open:p2", "workspace_id": "w-open"}},
	})}
	got, e := l.Launch(LaunchPlan{Slug: "desk", Checkout: "/repo", Cwd: "/worktrees/mission-desk", Prompt: "attach"})
	must(t, e)
	if got.Pane != "w-open:p2" {
		t.Fatalf("the launch takes its own tab, got %+v", got)
	}
	if calls[1][0] != "tab" || calls[1][1] != "create" || !strings.Contains(strings.Join(calls[1], " "), "--label desk") {
		t.Fatalf("a parked workspace gets a labelled launch tab, got %v", calls[1])
	}
}

func TestLaunchersRecordTheAgentSessionFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	cwd := filepath.Join(t.TempDir(), "mission-desk")
	must(t, os.MkdirAll(sessionDir(cwd), 0o700))
	file := filepath.Join(sessionDir(cwd), "2026-01-01T00-00-00-000Z_session-three.jsonl")
	must(t, os.WriteFile(file, []byte("{}\n"), 0o600))
	if got := waitForSession(cwd, "session-three", time.Second); got != file {
		t.Fatalf("the receipt points at pi's session file, got %q", got)
	}
	if got := waitForSession(cwd, "session-absent", 0); got != "" {
		t.Fatalf("an absent session leaves the receipt open, got %q", got)
	}
}

func TestLocalLauncherStartsPiInTheCurrentPane(t *testing.T) {
	var got [][]string
	l := localLauncher{wait: 0, newID: func() string { return "session-local" }, start: func(cwd string, argv []string) error {
		got = append(got, append([]string{cwd}, argv...))
		return nil
	}}
	r, e := l.Launch(LaunchPlan{Cwd: "/worktrees/mission-desk", Prompt: "attach"})
	must(t, e)
	if len(got) != 1 {
		t.Fatalf("a local launch starts exactly one agent, got %v", got)
	}
	if got[0][0] != "/worktrees/mission-desk" || got[0][1] != "--session-id" || got[0][2] != "session-local" {
		t.Fatalf("the agent runs in the mission worktree with its own session, got %v", got[0])
	}
	if r.Target != "local" {
		t.Fatalf("receipt names the adapter, got %+v", r)
	}
}

// launchFixture prepares a mission whose worktree exists, so the launch port can
// reserve it without touching a real Herdr server.
func launchFixture(t *testing.T) (*Store, string) {
	t.Helper()
	s, h := fixture(t)
	root := t.TempDir()
	_, e := gitText(root, "init", "-b", "main")
	must(t, e)
	_, e = gitText(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture")
	must(t, e)
	_, e = s.addRepo("dotfiles", root, "")
	must(t, e)
	return s, h
}

func TestLaunchReservesOnceAndStartsOneAgent(t *testing.T) {
	s, h := launchFixture(t)
	var plans []LaunchPlan
	previous := launcherFor
	launcherFor = func(string) Launcher {
		return stubLauncher{plans: &plans, receipt: LaunchReceipt{Target: "herdr", Workspace: "w1", Pane: "w1:p1"}}
	}
	t.Cleanup(func() { launcherFor = previous })

	first, e := cmdLaunch(args{pos: []string{"launch", h}, flags: map[string][]string{"target": {"herdr"}, "root": {t.TempDir()}}}, s)
	must(t, e)
	out := first.(map[string]any)
	if acquired, _ := out["acquired"].(bool); !acquired || len(plans) != 1 {
		t.Fatalf("the first call acquires the launch once, got %+v plans=%v", out, plans)
	}
	if plans[0].LaunchID == "" || plans[0].Checkout == "" || plans[0].Cwd == "" {
		t.Fatalf("the plan names the reservation and both checkouts, got %+v", plans[0])
	}
	if !strings.Contains(plans[0].Prompt, plans[0].LaunchID) {
		t.Fatalf("the prompt carries the reservation so the agent attaches, got %q", plans[0].Prompt)
	}
	second, e := cmdLaunch(args{pos: []string{"launch", h}, flags: map[string][]string{"target": {"herdr"}, "root": {t.TempDir()}}}, s)
	must(t, e)
	out = second.(map[string]any)
	if acquired, _ := out["acquired"].(bool); acquired {
		t.Fatalf("a second call acquires nothing, got %+v", out)
	}
	if len(plans) != 1 {
		t.Fatalf("a second call starts nothing, got %d launches", len(plans))
	}
}

func TestLaunchRecordsTheStartedAgent(t *testing.T) {
	s, h := launchFixture(t)
	previous := launcherFor
	session := filepath.Join(t.TempDir(), "worker.jsonl")
	launcherFor = func(string) Launcher {
		return stubLauncher{receipt: LaunchReceipt{Target: "herdr", Workspace: "w1", Pane: "w1:p1", SessionFile: session}}
	}
	t.Cleanup(func() { launcherFor = previous })

	if _, e := cmdLaunch(args{pos: []string{"launch", h}, flags: map[string][]string{"root": {t.TempDir()}}}, s); e != nil {
		t.Fatal(e)
	}
	r, e := s.load(h)
	must(t, e)
	// The vault records the canonical path of the session file.
	dir, _ := filepath.EvalSymlinks(filepath.Dir(session))
	want := filepath.Join(dir, filepath.Base(session))
	if r.State.Runtime.SessionFile != want || r.State.Runtime.LaunchID == "" {
		t.Fatalf("the receipt records the created agent, got %+v", r.State.Runtime)
	}
}

func TestLaunchRefusesAnotherMachine(t *testing.T) {
	s, h := launchFixture(t)
	var plans []LaunchPlan
	previous := launcherFor
	launcherFor = func(string) Launcher { return stubLauncher{plans: &plans} }
	t.Cleanup(func() { launcherFor = previous })
	// Prepare the binding, then hand the mission to another host.
	_, e := s.workspace(h, "", "main", t.TempDir())
	must(t, e)
	_, e = s.mutate(h, func(r *Record) error {
		r.State.Runtime.Machine = "some-other-host"
		return nil
	})
	must(t, e)

	_, e = cmdLaunch(args{pos: []string{"launch", h}, flags: map[string][]string{"root": {t.TempDir()}}}, s)
	wantCode(t, e, "wrong_machine")
	if len(plans) != 0 {
		t.Fatalf("a foreign runtime starts nothing, got %v", plans)
	}
}

type stubLauncher struct {
	plans   *[]LaunchPlan
	receipt LaunchReceipt
	err     error
}

func (s stubLauncher) Target() string { return fallback(s.receipt.Target, "herdr") }

func (s stubLauncher) Launch(p LaunchPlan) (LaunchReceipt, error) {
	if s.plans != nil {
		*s.plans = append(*s.plans, p)
	}
	if s.receipt.Target == "" {
		s.receipt.Target = "herdr"
	}
	return s.receipt, s.err
}

package main

import "os"

func cmdClaim(a args, s *Store) (any, error) {
	return s.claim(a.at(1), a.get("agent"), a.get("session-id"), a.get("cwd"), false)
}

func cmdPickup(a args, s *Store) (any, error) {
	return s.pickup(a.get("repo"), a.get("agent"), a.get("session-id"), a.get("cwd"))
}

func cmdWorkspace(a args, s *Store) (any, error) {
	return s.workspace(a.at(1), a.get("cwd"), a.get("base"), a.get("root"))
}

func cmdAttach(a args, s *Store) (any, error) {
	return s.attach(a.at(1), PiAttachment{SessionID: a.get("session-id"), SessionFile: a.get("session-file"), Cwd: a.get("cwd"), Workspace: a.get("workspace"), Pane: a.get("pane"), Agent: a.get("agent"), LaunchID: a.get("launch-id"), Token: fallback(a.get("token"), os.Getenv("MISSION_TOKEN"))})
}

// cmdLaunch is the one launch port. A receipt call (--launch-id with
// --session-file) records the agent the adapter started; every other call
// reserves once, prepares the worktree, and lets the adapter start one agent.
func cmdLaunch(a args, s *Store) (any, error) {
	h := a.at(1)
	if f := a.get("session-file"); f != "" {
		return s.launch(h, f, a.get("launch-id"))
	}
	target, e := launchTarget(a.get("target"))
	if e != nil {
		return nil, e
	}
	// The reservation needs a bound worktree, so the checkout comes first. A
	// runtime bound to another machine is refused here, before any host action.
	prepared, e := s.workspace(h, "", a.get("base"), a.get("root"))
	if e != nil {
		return nil, e
	}
	reserved, e := s.launch(h, "", "")
	if e != nil {
		return nil, e
	}
	runtime, _ := reserved["runtime"].(*RuntimeBinding)
	if acquired, _ := reserved["acquired"].(bool); !acquired {
		return map[string]any{"acquired": false, "target": target, "runtime": runtime}, nil
	}
	repo, e := s.repo(prepared.Mission.Repo)
	if e != nil {
		return nil, e
	}
	plan := LaunchPlan{Handle: h, Slug: prepared.Mission.Slug, Checkout: repo.Bindings[machine()],
		Cwd: runtime.Cwd, LaunchID: runtime.LaunchID, Prompt: launchPrompt(h, runtime.LaunchID)}
	receipt, e := launcherFor(target).Launch(plan)
	if e != nil {
		// The reservation stays: inspect the host surface before a new attempt.
		return nil, e
	}
	if receipt.SessionFile != "" {
		if _, e = s.launch(h, receipt.SessionFile, runtime.LaunchID); e != nil {
			return nil, e
		}
	}
	r, e := s.load(h)
	if e != nil {
		return nil, e
	}
	return map[string]any{"acquired": true, "target": target, "launch": receipt, "runtime": r.State.Runtime}, nil
}

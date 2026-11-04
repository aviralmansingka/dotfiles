package main

import (
	"os"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func cmdClaim(a platform.Args, s *Store) (any, error) {
	return s.claim(a.At(1), a.Get("agent"), a.Get("session-id"), a.Get("cwd"), false)
}

func cmdPickup(a platform.Args, s *Store) (any, error) {
	return s.pickup(a.Get("repo"), a.Get("agent"), a.Get("session-id"), a.Get("cwd"))
}

func cmdWorkspace(a platform.Args, s *Store) (any, error) {
	return s.workspace(a.At(1), a.Get("cwd"), a.Get("base"), a.Get("root"))
}

func cmdAttach(a platform.Args, s *Store) (any, error) {
	return s.attach(a.At(1), mission.PiAttachment{SessionID: a.Get("session-id"), SessionFile: a.Get("session-file"), Cwd: a.Get("cwd"), Workspace: a.Get("workspace"), Pane: a.Get("pane"), Agent: a.Get("agent"), LaunchID: a.Get("launch-id"), Token: platform.Fallback(a.Get("token"), os.Getenv("MISSION_TOKEN"))})
}

func cmdLaunch(a platform.Args, s *Store) (any, error) {
	if a.Has("release") {
		return s.release(a.At(1), a.Get("launch-id"))
	}
	return s.launch(a.At(1), a.Get("session-file"), a.Get("launch-id"))
}

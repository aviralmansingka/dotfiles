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

func cmdLaunch(a args, s *Store) (any, error) {
	return s.launch(a.at(1), a.get("session-file"), a.get("launch-id"))
}

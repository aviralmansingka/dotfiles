package main

import (
	"encoding/json"
	"io"
	"os"
	"strconv"
)

func cmdProgress(a args, s *Store) (any, error) {
	return s.progress(fallback(a.at(1), os.Getenv("MISSION_HANDLE")), fallback(a.get("attempt"), os.Getenv("MISSION_ATTEMPT")), fallback(a.get("token"), os.Getenv("MISSION_TOKEN")), Progress{ID: a.get("event-id"), Status: a.get("status"), Summary: a.get("summary"), Next: a.get("next"), Blocker: a.get("blocker")}, a.flags["evidence"])
}

func cmdSettle(a args, s *Store) (any, error) {
	return s.settle(fallback(a.at(1), os.Getenv("MISSION_HANDLE")), fallback(a.get("attempt"), os.Getenv("MISSION_ATTEMPT")), fallback(a.get("token"), os.Getenv("MISSION_TOKEN")), a.get("session-id"))
}

func cmdHook(a args, s *Store) (any, error) {
	ev := Event{Type: a.at(1), ID: a.get("event-id"), SessionID: a.get("session-id"), SessionFile: a.get("session-file"), Tool: a.get("tool"), Summary: a.get("message"), Model: a.get("model"), Pane: a.get("pane"), Workspace: a.get("workspace"), Quiescent: a.has("quiescent")}
	if a.has("stdin") {
		b, e := io.ReadAll(io.LimitReader(os.Stdin, 65537))
		if e != nil {
			return nil, e
		}
		if len(b) > 65536 {
			return nil, problem("too_large", "hook input exceeds 64 KiB")
		}
		if e = json.Unmarshal(b, &ev); e != nil {
			return nil, e
		}
	}
	r, e := s.hook(fallback(a.get("handle"), os.Getenv("MISSION_HANDLE")), fallback(a.get("attempt"), os.Getenv("MISSION_ATTEMPT")), fallback(a.get("token"), os.Getenv("MISSION_TOKEN")), ev)
	if e != nil {
		return nil, e
	}
	return map[string]any{"handle": r.Handle, "revision": r.State.Revision, "attempt": fallback(a.get("attempt"), os.Getenv("MISSION_ATTEMPT")), "event_type": ev.Type}, nil
}

func cmdFinish(cmd string, a args, s *Store) (any, error) {
	return s.finish(fallback(a.at(1), os.Getenv("MISSION_HANDLE")), fallback(a.get("attempt"), os.Getenv("MISSION_ATTEMPT")), fallback(a.get("token"), os.Getenv("MISSION_TOKEN")), cmd == "fail", a.get("note"), false, 0)
}

func cmdCheckpoint(a args, s *Store) (any, error) {
	rev, e := strconv.Atoi(a.get("revision"))
	if e != nil || rev < 1 {
		return nil, problem("usage", "checkpoint requires a positive --revision from show")
	}
	return s.checkpoint(a.at(1), a.get("id"), a.get("decision"), a.get("note"), a.get("actor"), a.has("human"), rev)
}

func cmdRetry(a args, s *Store) (any, error) { return s.retry(a.at(1)) }

func cmdRepair(a args, s *Store) (any, error) { return s.repair(a.at(1)) }

func cmdRun(a args, s *Store) (any, error) {
	return runAgent(s, a.at(1), a.get("agent"), a.get("cwd"), a.command)
}

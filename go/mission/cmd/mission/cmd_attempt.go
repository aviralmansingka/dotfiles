package main

import (
	"encoding/json"
	"io"
	"os"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// cmdProgress carries an optional --actor: the trooper that reported. One call
// then appends both the structured progress and the trooper report, so the
// sitrep can name who finished what.
func cmdProgress(a platform.Args, s *Store) (any, error) {
	return s.progress(platform.Fallback(a.At(1), os.Getenv("MISSION_HANDLE")), platform.Fallback(a.Get("attempt"), os.Getenv("MISSION_ATTEMPT")), platform.Fallback(a.Get("token"), os.Getenv("MISSION_TOKEN")), a.Get("actor"), mission.Progress{ID: a.Get("event-id"), Status: a.Get("status"), Summary: a.Get("summary"), Next: a.Get("next"), Blocker: a.Get("blocker")}, a.Flags["evidence"])
}

func cmdSettle(a platform.Args, s *Store) (any, error) {
	return s.settle(platform.Fallback(a.At(1), os.Getenv("MISSION_HANDLE")), platform.Fallback(a.Get("attempt"), os.Getenv("MISSION_ATTEMPT")), platform.Fallback(a.Get("token"), os.Getenv("MISSION_TOKEN")), a.Get("session-id"))
}

func cmdHook(a platform.Args, s *Store) (any, error) {
	ev := mission.Event{Type: a.At(1), ID: a.Get("event-id"), SessionID: a.Get("session-id"), SessionFile: a.Get("session-file"), Tool: a.Get("tool"), Summary: a.Get("message"), Model: a.Get("model"), Pane: a.Get("pane"), Workspace: a.Get("workspace"), Quiescent: a.Has("quiescent")}
	if a.Has("stdin") {
		b, e := io.ReadAll(io.LimitReader(os.Stdin, 65537))
		if e != nil {
			return nil, e
		}
		if len(b) > 65536 {
			return nil, mission.Problem("too_large", "hook input exceeds 64 KiB")
		}
		if e = json.Unmarshal(b, &ev); e != nil {
			return nil, e
		}
	}
	r, e := s.hook(platform.Fallback(a.Get("handle"), os.Getenv("MISSION_HANDLE")), platform.Fallback(a.Get("attempt"), os.Getenv("MISSION_ATTEMPT")), platform.Fallback(a.Get("token"), os.Getenv("MISSION_TOKEN")), ev)
	if e != nil {
		return nil, e
	}
	return map[string]any{"handle": r.Handle, "revision": r.State.Revision, "attempt": platform.Fallback(a.Get("attempt"), os.Getenv("MISSION_ATTEMPT")), "event_type": ev.Type}, nil
}

func cmdFinish(cmd string, a platform.Args, s *Store) (any, error) {
	return s.finish(platform.Fallback(a.At(1), os.Getenv("MISSION_HANDLE")), platform.Fallback(a.Get("attempt"), os.Getenv("MISSION_ATTEMPT")), platform.Fallback(a.Get("token"), os.Getenv("MISSION_TOKEN")), cmd == "fail", a.Get("note"), false, 0)
}

func cmdRetry(a platform.Args, s *Store) (any, error) { return s.retry(a.At(1)) }

func cmdRepair(a platform.Args, s *Store) (any, error) { return s.repair(a.At(1)) }

// cmdAbandon ends an attempt whose process is gone. It reads no token: the
// commander, not the lost process, is the caller.
func cmdAbandon(a platform.Args, s *Store) (any, error) {
	return s.abandon(platform.Fallback(a.At(1), os.Getenv("MISSION_HANDLE")), a.Get("attempt"), a.Get("note"))
}

func cmdRun(a platform.Args, s *Store) (any, error) {
	return runAgent(s, a.At(1), a.Get("agent"), a.Get("cwd"), a.Command)
}

package platform

import (
	"strings"

	"mission.local/prototype/internal/domain/mission"
)

// Args holds one parsed command line.
type Args struct {
	Pos, Command []string
	Flags        map[string][]string
}

// ParseArgs turns one argument vector into Args.
func ParseArgs(argv []string) (Args, error) {
	a := Args{Flags: map[string][]string{}}
	booleans := map[string]bool{"json": true, "human": true, "stdin": true, "color": true, "no-color": true, "help": true, "reset": true}
	booleans["quiescent"] = true
	booleans["release"] = true
	booleans["force"] = true
	values := map[string]bool{"vault": true, "checkout": true, "remote": true, "title": true, "goal": true, "step": true, "checkpoint": true, "kind": true, "from": true, "repo": true, "agent": true, "session-id": true, "session-file": true, "cwd": true, "attempt": true, "token": true, "event-id": true, "tool": true, "message": true, "note": true, "id": true, "decision": true, "actor": true, "revision": true, "view": true, "width": true, "height": true, "model": true, "pane": true, "workspace": true}
	values["handle"] = true
	for _, k := range []string{"instructions", "acceptance", "checks", "output"} {
		values[k] = true
	}
	for _, k := range []string{"base", "root", "status", "summary", "next", "blocker", "evidence", "launch-id"} {
		values[k] = true
	}
	for i := 0; i < len(argv); i++ {
		v := argv[i]
		if v == "--" {
			a.Command = argv[i+1:]
			break
		}
		if !strings.HasPrefix(v, "--") {
			a.Pos = append(a.Pos, v)
			continue
		}
		k, val, eq := strings.Cut(strings.TrimPrefix(v, "--"), "=")
		if booleans[k] {
			if eq && val != "true" {
				return a, mission.Problem("usage", "--%s is a switch", k)
			}
			a.Flags[k] = []string{"true"}
			continue
		}
		if !values[k] {
			return a, mission.Problem("usage", "unknown option --%s", k)
		}
		if !eq {
			if i+1 >= len(argv) {
				return a, mission.Problem("usage", "--%s needs a value", k)
			}
			i++
			val = argv[i]
		}
		a.Flags[k] = append(a.Flags[k], val)
	}
	return a, nil
}

// Get returns the last value of one flag.
func (a Args) Get(k string) string {
	v := a.Flags[k]
	if len(v) == 0 {
		return ""
	}
	return v[len(v)-1]
}

// Has reports whether one flag carries a value.
func (a Args) Has(k string) bool { return a.Get(k) != "" }

// At returns one positional argument.
func (a Args) At(i int) string {
	if i >= len(a.Pos) {
		return ""
	}
	return a.Pos[i]
}

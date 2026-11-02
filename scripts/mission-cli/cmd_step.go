package main

import (
	"strconv"
	"strings"
)

func cmdSteps(a args, s *Store) (any, error) { return s.steps(a.at(1)) }

func cmdStep(a args, s *Store) (any, error) {
	switch a.at(1) {
	case "list":
		return s.steps(a.at(2))
	case "show":
		return s.step(a.at(2), a.at(3))
	case "edit":
		return editStepFromArgs(s, a)
	}
	return nil, problem("usage", "use step list, show, or edit")
}

func editStepFromArgs(s *Store, a args) (Record, error) {
	h, id := a.at(2), a.at(3)
	r, e := s.load(h)
	if e != nil {
		return r, e
	}
	idx, e := stepIndex(r.Mission, id)
	if e != nil {
		return r, e
	}
	st := r.Mission.Steps[idx]
	changed := false
	for _, field := range []struct {
		name   string
		target *string
	}{{"title", &st.Title}, {"agent", &st.Agent}, {"output", &st.Output}, {"instructions", &st.Instructions}, {"acceptance", &st.Acceptance}} {
		if _, ok := a.flags[field.name]; ok {
			*field.target = a.get(field.name)
			changed = true
		}
	}
	if _, ok := a.flags["checks"]; ok {
		st.Check = ""
		st.Checks = []string{}
		for _, raw := range a.flags["checks"] {
			for _, name := range strings.Split(raw, ",") {
				name = strings.TrimSpace(name)
				if name != "" {
					st.Checks = append(st.Checks, name)
				}
			}
		}
		changed = true
	}
	if !changed {
		return r, problem("usage", "provide --title, --instructions, --acceptance, --agent, --output, or --checks")
	}
	rev := r.State.Revision
	if a.has("revision") {
		rev, e = strconv.Atoi(a.get("revision"))
		if e != nil || rev < 1 {
			return r, problem("usage", "--revision must be a positive integer")
		}
	}
	return s.editStep(h, id, st, rev, a.has("reset"))
}

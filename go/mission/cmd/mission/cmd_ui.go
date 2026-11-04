package main

import (
	"fmt"
	"strconv"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// cmdUI runs the interactive mission desk. It owns the terminal, so it returns
// an exit code instead of a value for emit.
func cmdUI(a platform.Args, s *Store) int {
	if !platform.Terminal() {
		return emit(nil, mission.Problem("usage", "interactive UI requires a terminal; use list, show, next, or render"))
	}
	if e := runUI(s); e != nil {
		return emit(nil, e)
	}
	return 0
}

// cmdRender prints one static frame of the desk and returns an exit code.
func cmdRender(a platform.Args, s *Store) int {
	w := 128
	h := 42
	var e error
	if a.Has("width") {
		w, e = strconv.Atoi(a.Get("width"))
	}
	if e == nil && a.Has("height") {
		h, e = strconv.Atoi(a.Get("height"))
	}
	if e != nil {
		return emit(nil, e)
	}
	m := newDesk(s)
	m.width = w
	m.height = h
	m.refresh()
	if m.err != nil {
		return emit(nil, m.err)
	}
	if a.Has("handle") {
		found := false
		for i, r := range m.records {
			if r.Handle == a.Get("handle") {
				m.selected = i
				found = true
			}
		}
		if !found {
			return emit(nil, mission.Problem("not_found", "mission %s not found", a.Get("handle")))
		}
	}
	if a.Has("id") && len(m.records) > 0 {
		idx, err := stepIndex(m.records[m.selected].Mission, a.Get("id"))
		if err != nil {
			return emit(nil, err)
		}
		m.selectedStep = idx
	}
	if a.Get("view") == "attempts" {
		m.tab = 1
	}
	if a.Get("view") == "activity" {
		m.tab = 2
	}
	if a.Get("view") == "steps" {
		m.tab = 3
	}
	if a.Get("view") == "edit" {
		m.startStepEdit()
	}
	if a.Get("view") == "create" {
		m.startBuilder()
	}
	if a.Get("view") == "review" {
		m.startReview()
	}
	m.prepareFormRender()
	out := m.render()
	if !a.Has("color") || a.Has("no-color") {
		out = stripANSI(out)
	}
	fmt.Println(out)
	return 0
}

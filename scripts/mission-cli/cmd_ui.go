package main

import (
	"fmt"
	"strconv"
)

// cmdUI runs the interactive mission desk. It owns the terminal, so it returns
// an exit code instead of a value for emit.
func cmdUI(a args, s *Store) int {
	if !terminal() {
		return emit(nil, problem("usage", "interactive UI requires a terminal; use list, show, next, or render"))
	}
	if e := runUI(s); e != nil {
		return emit(nil, e)
	}
	return 0
}

// cmdRender prints one static frame of the desk and returns an exit code.
func cmdRender(a args, s *Store) int {
	w := 128
	var e error
	if a.has("width") {
		w, e = strconv.Atoi(a.get("width"))
	}
	if e != nil {
		return emit(nil, e)
	}
	m := newDesk(s)
	m.width = max(48, w)
	m.height = 42
	m.refresh()
	if m.err != nil {
		return emit(nil, m.err)
	}
	if a.has("handle") {
		found := false
		for i, r := range m.records {
			if r.Handle == a.get("handle") {
				m.selected = i
				found = true
			}
		}
		if !found {
			return emit(nil, problem("not_found", "mission %s not found", a.get("handle")))
		}
	}
	if a.has("id") && len(m.records) > 0 {
		idx, err := stepIndex(m.records[m.selected].Mission, a.get("id"))
		if err != nil {
			return emit(nil, err)
		}
		m.selectedStep = idx
	}
	if a.get("view") == "attempts" {
		m.tab = 1
	}
	if a.get("view") == "activity" {
		m.tab = 2
	}
	if a.get("view") == "steps" {
		m.tab = 3
	}
	if a.get("view") == "edit" {
		m.startStepEdit()
	}
	if a.get("view") == "create" {
		m.startBuilder()
	}
	if a.get("view") == "review" {
		m.startReview()
	}
	m.prepareFormRender()
	out := m.render()
	if !a.has("color") || a.has("no-color") {
		out = stripANSI(out)
	}
	fmt.Println(out)
	return 0
}

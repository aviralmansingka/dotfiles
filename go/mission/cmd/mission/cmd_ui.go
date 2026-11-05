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
	m := newNavigationDesk(s)
	m.width = w
	m.height = h
	m.refresh()
	if m.err != nil {
		return emit(nil, m.err)
	}
	if a.Has("filter") {
		idx, ok := filterIndex(a.Get("filter"))
		if !ok {
			return emit(nil, mission.Problem("usage", "unknown filter %s; use one of %s", a.Get("filter"), filterLabels()))
		}
		m.filter = idx
		m.refreshNavigationList("")
	}
	if a.Has("handle") {
		found := false
		for i, r := range m.view {
			if r.Handle == a.Get("handle") {
				m.selected = i
				found = true
			}
		}
		if !found {
			return emit(nil, mission.Problem("not_found", "mission %s is not in this view", a.Get("handle")))
		}
	}
	view := a.Get("view")
	if mode, ok := map[string]int{"inbox": 0, "table": 1, "repos": 2}[view]; ok {
		r, _ := m.current()
		m.nav.mode = mode
		m.refreshNavigationList(r.Handle)
	}
	views := map[string]int{"overview": 0, "troopers": 1, "attempts": 2, "activity": 3, "steps": 4}
	if tab, ok := views[view]; ok {
		m.enterNavigation()
		m.tab = tab
	}
	if view == "step" || view == "call" {
		m.enterNavigation()
	}
	if a.Has("id") {
		r, ok := m.current()
		if !ok {
			return emit(nil, mission.Problem("not_found", "no mission selected"))
		}
		idx, err := stepIndex(r.Mission, a.Get("id"))
		if err != nil {
			return emit(nil, err)
		}
		m.selectedStep = idx
	}
	if view == "step" || view == "call" {
		m.enterNavigation()
		if cmd := m.pollNavigationCalls(); cmd != nil {
			m.Update(cmd())
		}
	}
	if view == "call" {
		m.enterNavigation()
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

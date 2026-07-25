package atlas

import "fmt"

type selectionItem struct {
	kind     string
	goal     int
	journey  int
	evidence int
}

type Detail struct {
	Heading string
	Lines   []string
}

type Selection struct {
	items     []selectionItem
	cursor    int
	selected  int
	committed bool
}

func NewSelection(run Run) *Selection {
	items := make([]selectionItem, 0, len(run.Goals)+len(run.Evidence))
	active := 0
	for index, goal := range run.Goals {
		items = append(items, selectionItem{kind: "goal", goal: index})
		if goal.ID == run.ActiveGoal {
			active = index
		}
	}
	for goalIndex, goal := range run.Goals {
		if goal.Verifier == nil {
			continue
		}
		for journeyIndex := range goal.Verifier.Journey {
			items = append(items, selectionItem{kind: "journey", goal: goalIndex, journey: journeyIndex})
		}
	}
	for index := range run.Evidence {
		items = append(items, selectionItem{kind: "evidence", evidence: index})
	}
	return &Selection{items: items, cursor: active, selected: active}
}

func (s *Selection) Next() int {
	if s.cursor+1 < len(s.items) {
		s.cursor++
	}
	return s.cursor
}

func (s *Selection) Previous() int {
	if s.cursor > 0 {
		s.cursor--
	}
	return s.cursor
}

func (s *Selection) Select() int {
	s.selected = s.cursor
	s.committed = true
	return s.selected
}

func (s *Selection) Cursor() int {
	return s.cursor
}

func (s *Selection) Selected() int {
	return s.selected
}

func (s *Selection) Committed() bool {
	return s.committed
}

func (s *Selection) Label(run Run, index int) string {
	if index < 0 || index >= len(s.items) {
		return ""
	}
	item := s.items[index]
	switch item.kind {
	case "goal":
		goal := run.Goals[item.goal]
		return goal.ID + " " + goal.Label
	case "journey":
		goal := run.Goals[item.goal]
		return goal.ID + " · " + goal.Verifier.Journey[item.journey].Label
	case "evidence":
		evidence := run.Evidence[item.evidence]
		return evidence.ID + " " + evidence.Summary
	default:
		return ""
	}
}

func (s *Selection) Detail(run Run) *Detail {
	if !s.committed || s.selected < 0 || s.selected >= len(s.items) {
		return nil
	}
	item := s.items[s.selected]
	switch item.kind {
	case "goal":
		goal := run.Goals[item.goal]
		detail := &Detail{Heading: goal.ID + " · VERIFIER JOURNEY"}
		if goal.Verifier == nil {
			detail.Lines = []string{"status: " + goal.Status}
		} else {
			for _, step := range goal.Verifier.Journey {
				detail.Lines = append(detail.Lines, statusGlyph(step.Status)+" "+step.Label)
			}
		}
		return detail
	case "journey":
		goal := run.Goals[item.goal]
		step := goal.Verifier.Journey[item.journey]
		return &Detail{
			Heading: goal.ID + " · " + step.Label,
			Lines: []string{
				"status: " + step.Status,
				activeSummary(goal),
			},
		}
	case "evidence":
		evidence := run.Evidence[item.evidence]
		return &Detail{
			Heading: evidence.ID + " · EVIDENCE",
			Lines:   []string{evidence.Summary},
		}
	default:
		panic(fmt.Sprintf("unknown selection kind %q", item.kind))
	}
}

func (s *Selection) Key(run Run, index int) string {
	if index < 0 || index >= len(s.items) {
		return ""
	}
	item := s.items[index]
	switch item.kind {
	case "goal":
		return "goal:" + run.Goals[item.goal].ID
	case "journey":
		return fmt.Sprintf("journey:%s:%d", run.Goals[item.goal].ID, item.journey)
	case "evidence":
		return "evidence:" + run.Evidence[item.evidence].ID
	default:
		return ""
	}
}

func (s *Selection) Reconcile(run Run, selectedKey string) {
	next := NewSelection(run)
	for index := range next.items {
		if next.Key(run, index) == selectedKey {
			next.cursor = index
			next.selected = index
			next.committed = s.committed
			break
		}
	}
	*s = *next
}

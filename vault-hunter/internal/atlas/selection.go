package atlas

type Selection struct {
	count    int
	cursor   int
	selected int
}

func NewSelection(run Run) *Selection {
	active := 0
	for index, goal := range run.Goals {
		if goal.ID == run.ActiveGoal {
			active = index
			break
		}
	}
	return &Selection{count: len(run.Goals), cursor: active, selected: active}
}

func (s *Selection) Next() int {
	if s.cursor+1 < s.count {
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
	return s.selected
}

func (s *Selection) Cursor() int {
	return s.cursor
}

func (s *Selection) Selected() int {
	return s.selected
}

package atlas

import (
	"encoding/json"
	"testing"
)

func TestV04NavigationAnimationAndCaptureDoNotMutateRun(t *testing.T) {
	run := loadFixture(t)
	before, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}

	selection := NewSelection(run)
	selection.Next()
	selection.Previous()
	selection.Select()
	transition := NewTransition()
	transition.Toggle()
	for range 4 {
		frame := transition.Advance()
		framed, err := ApplyFrame(run, frame)
		if err != nil {
			t.Fatal(err)
		}
		_ = RenderCompact(framed, 78, 17)
		_ = RenderExpanded(framed, 120, 30)
	}

	after, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatalf("read-only UI operations mutated authoritative run\nbefore: %s\nafter:  %s", before, after)
	}
}

package atlas

import (
	"strings"
	"testing"
)

func TestV03TransitionIsPausedAndDeterministic(t *testing.T) {
	transition := NewTransition()
	if transition.Playing() {
		t.Fatal("transition animation must be off by default")
	}
	if transition.Frame() != FrameRed {
		t.Fatalf("initial frame = %q, want %q", transition.Frame(), FrameRed)
	}

	transition.Toggle()
	got := []Frame{transition.Frame()}
	for range 3 {
		got = append(got, transition.Advance())
	}
	want := []Frame{FrameRed, FrameEdit, FrameTest, FrameGreen}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("frame %d = %q, want %q", index, got[index], want[index])
		}
	}

	transition.Toggle()
	if transition.Playing() {
		t.Fatal("second toggle must pause the transition")
	}
	if transition.Advance() != FrameGreen {
		t.Fatal("a paused transition must not advance")
	}
}

func TestV03EveryFrameCanBeCapturedDirectly(t *testing.T) {
	run := loadFixture(t)
	for _, frame := range Frames() {
		framed, err := ApplyFrame(run, frame)
		if err != nil {
			t.Fatal(err)
		}
		output := RenderCompact(framed, 78, 17)
		if !strings.Contains(output, strings.ToUpper(string(frame))) {
			t.Errorf("%s capture missing frame state:\n%s", frame, output)
		}
		if framed.NextAction == "" || !strings.Contains(output, "next:") {
			t.Errorf("%s capture missing next action:\n%s", frame, output)
		}
	}
}

package atlas

import (
	"fmt"
)

type Frame string

const (
	FrameRed   Frame = "red"
	FrameEdit  Frame = "edit"
	FrameTest  Frame = "test"
	FrameGreen Frame = "green"
)

var frames = []Frame{FrameRed, FrameEdit, FrameTest, FrameGreen}

type Transition struct {
	index   int
	playing bool
}

func NewTransition() *Transition {
	return &Transition{}
}

func Frames() []Frame {
	return append([]Frame(nil), frames...)
}

func (t *Transition) Frame() Frame {
	return frames[t.index]
}

func (t *Transition) Playing() bool {
	return t.playing
}

func (t *Transition) Toggle() {
	t.playing = !t.playing
}

func (t *Transition) Advance() Frame {
	if t.playing {
		t.index = (t.index + 1) % len(frames)
	}
	return t.Frame()
}

func ApplyFrame(run Run, frame Frame) (Run, error) {
	nextActions := map[Frame]string{
		FrameRed:   "Make failure evidence green",
		FrameEdit:  "Apply the minimum implementation",
		FrameTest:  "Run the active verifier suite",
		FrameGreen: "Accept evidence and complete goal",
	}
	next, ok := nextActions[frame]
	if !ok {
		return Run{}, fmt.Errorf("unknown transition frame %q", frame)
	}

	framed := run
	framed.Goals = append([]Goal(nil), run.Goals...)
	for index := range framed.Goals {
		if framed.Goals[index].ID != framed.ActiveGoal || framed.Goals[index].Verifier == nil {
			continue
		}
		verifier := *framed.Goals[index].Verifier
		verifier.Journey = append([]JourneyStep(nil), verifier.Journey...)
		verifier.State = string(frame)
		framed.Goals[index].Verifier = &verifier
	}
	framed.NextAction = next
	return framed, nil
}

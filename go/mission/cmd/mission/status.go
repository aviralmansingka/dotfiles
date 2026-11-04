package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

// StatusView answers one question: where the mission stands, and which command
// moves it forward. The JSON envelope and the terminal block render this struct.
type StatusView struct {
	Handle     string            `json:"handle"`
	Title      string            `json:"title"`
	Status     string            `json:"status"`
	Revision   int               `json:"revision"`
	Step       *StatusStep       `json:"step,omitempty"`
	Attempt    *StatusAttempt    `json:"attempt,omitempty"`
	Checkpoint *StatusCheckpoint `json:"checkpoint,omitempty"`
	Blocker    string            `json:"blocker,omitempty"`
	BlockerAt  string            `json:"blocker_at,omitempty"`
	Next       string            `json:"next"`
}

// StatusStep is the current step and its stored status.
type StatusStep struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

// StatusAttempt is the active attempt, or the last attempt of the current step.
type StatusAttempt struct {
	ID         string `json:"id"`
	Agent      string `json:"agent"`
	Step       string `json:"step"`
	Status     string `json:"status"`
	StartedAt  string `json:"started_at,omitempty"`
	RunningFor string `json:"running_for,omitempty"`
}

// StatusCheckpoint is the pending human checkpoint and its question.
type StatusCheckpoint struct {
	ID       string `json:"id"`
	Question string `json:"question"`
}

// cmdStatus reports one mission as a record-independent view.
func cmdStatus(a platform.Args, s *Store) (any, error) { return s.status(statusHandle(a)) }

// cmdStatusText prints the terminal block. It owns stdout, so it returns an exit code.
func cmdStatusText(a platform.Args, s *Store) int {
	v, e := s.status(statusHandle(a))
	if e != nil {
		return emit(nil, e)
	}
	fmt.Println(statusText(v))
	return 0
}

// statusHandle resolves the mission from --handle, then MISSION_HANDLE, then the
// first positional argument.
func statusHandle(a platform.Args) string {
	return platform.Fallback(a.Get("handle"), platform.Fallback(os.Getenv("MISSION_HANDLE"), a.At(1)))
}

// status loads one mission and summarizes it. It never writes.
func (s *Store) status(h string) (StatusView, error) {
	if strings.TrimSpace(h) == "" {
		return StatusView{}, mission.Problem("usage", "status needs a handle: mission status REPO/SLUG")
	}
	r, e := s.load(h)
	if e != nil {
		return StatusView{}, e
	}
	return statusView(r, time.Now()), nil
}

// statusView builds the view from one record. All fields derive from the record.
func statusView(r mission.Record, now time.Time) StatusView {
	v := StatusView{Handle: r.Handle, Title: r.Mission.Title, Status: r.State.Status, Revision: r.State.Revision}
	if st, ok := currentStep(r); ok {
		v.Step = &StatusStep{ID: st.ID, Title: st.Title, Status: r.State.Steps[st.ID].Status}
	}
	if a, ok := shownAttempt(r); ok {
		v.Attempt = &StatusAttempt{ID: a.ID, Agent: a.Agent, Step: a.Step, Status: a.Status, StartedAt: a.Started, RunningFor: runningFor(a, now)}
	}
	if id := r.State.Pending; id != "" {
		cp := StatusCheckpoint{ID: id}
		for _, c := range r.Mission.Checkpoints {
			if c.ID == id {
				cp.Question = c.Question
			}
		}
		v.Checkpoint = &cp
	}
	v.Blocker, v.BlockerAt = latestBlocker(r)
	v.Next = nextAction(r)
	return v
}

// currentStep returns the step the mission is on. A mission that has not started
// reports the step it would start first.
func currentStep(r mission.Record) (mission.Step, bool) {
	if r.State.Current != "" {
		if idx, e := stepIndex(r.Mission, r.State.Current); e == nil {
			return r.Mission.Steps[idx], true
		}
	}
	st, e := mission.NextStep(r.Mission, r.State)
	return st, e == nil
}

// shownAttempt returns the active attempt. Without one it returns the last attempt
// of the current step, so a failure stays visible.
func shownAttempt(r mission.Record) (mission.Attempt, bool) {
	if r.State.Active != "" {
		if a, e := mission.FindAttempt(&r.State, r.State.Active); e == nil {
			return *a, true
		}
	}
	for i := len(r.State.Attempts) - 1; i >= 0; i-- {
		if r.State.Attempts[i].Step == r.State.Current {
			return r.State.Attempts[i], true
		}
	}
	return mission.Attempt{}, false
}

// runningFor reports how long an active attempt has been running. An attempt
// without a readable start time reports nothing.
func runningFor(a mission.Attempt, now time.Time) string {
	if a.Started == "" || !mission.Active(a) {
		return ""
	}
	t, e := time.Parse(time.RFC3339Nano, a.Started)
	if e != nil {
		return ""
	}
	d := now.Sub(t)
	if d < 0 {
		d = 0
	}
	return d.Round(time.Second).String()
}

// latestBlocker returns the most recent recorded blocker and its timestamp.
func latestBlocker(r mission.Record) (string, string) {
	for i := len(r.State.Attempts) - 1; i >= 0; i-- {
		a := r.State.Attempts[i]
		for j := len(a.Progress) - 1; j >= 0; j-- {
			if p := a.Progress[j]; strings.TrimSpace(p.Blocker) != "" {
				return p.Blocker, p.At
			}
		}
	}
	return "", ""
}

// nextAction names the command that advances the mission. It reads state only.
func nextAction(r mission.Record) string {
	h := r.Handle
	if r.State.Pending != "" {
		return checkpointCommand(h, r.State.Pending)
	}
	if r.State.Active != "" {
		return "wait for attempt " + r.State.Active + "; inspect it with mission show " + h
	}
	switch r.State.Status {
	case "done":
		return "nothing, the mission is done"
	case "failed":
		return "mission retry " + h
	}
	step, e := mission.NextStep(r.Mission, r.State)
	if e != nil {
		code := ""
		if d, ok := e.(*mission.DomainError); ok {
			code = d.Code
		}
		switch code {
		case "complete":
			return "nothing, the mission is done"
		case "checkpoint_pending":
			if id := openCheckpoint(r); id != "" {
				return checkpointCommand(h, id)
			}
		}
		return "inspect the blocked step with mission steps " + h
	}
	if r.Mission.Kind == "implementation" {
		return "mission launch " + h + "   (start " + step.ID + ")"
	}
	return "mission claim " + h + " --agent " + step.Agent + "   (start " + step.ID + ")"
}

// checkpointCommand names the decision command for one checkpoint.
func checkpointCommand(h, id string) string {
	return "mission checkpoint " + h + " --id " + id + " --decision accept|revise --human"
}

// openCheckpoint returns the first checkpoint that no decision has accepted.
func openCheckpoint(r mission.Record) string {
	for _, c := range r.Mission.Checkpoints {
		if r.State.Checkpoints[c.ID].Status != "accepted" {
			return c.ID
		}
	}
	return ""
}

// statusText renders the terminal block: at most seven labelled lines.
func statusText(v StatusView) string {
	lines := []string{heading(v.Handle) + "  " + status(v.Status) + paint(muted, "  ·  rev "+fmt.Sprint(v.Revision))}
	if v.Title != "" {
		lines = append(lines, statusRow("Mission", v.Title))
	}
	if v.Step != nil {
		lines = append(lines, statusRow("Step", v.Step.ID+" · "+v.Step.Title+"  "+status(v.Step.Status)))
	}
	if v.Attempt != nil {
		line := v.Attempt.ID + " · " + v.Attempt.Agent + "  " + status(v.Attempt.Status)
		if v.Attempt.RunningFor != "" {
			line += paint(muted, "  ·  up "+v.Attempt.RunningFor)
		}
		lines = append(lines, statusRow("Attempt", line))
	}
	if v.Checkpoint != nil {
		lines = append(lines, statusRow("Checkpoint", v.Checkpoint.ID+" · "+platform.Fallback(v.Checkpoint.Question, "pending decision")))
	}
	if v.Blocker != "" {
		lines = append(lines, statusRow("Blocker", clip(v.Blocker, 96)))
	}
	lines = append(lines, statusRow("Next", v.Next))
	out := strings.Join(lines, "\n")
	if !platform.Terminal() {
		out = stripANSI(out)
	}
	return out
}

// statusRow pads one label so every value starts in the same column.
func statusRow(label, value string) string {
	return paint(muted, fmt.Sprintf("%-11s", label)) + value
}

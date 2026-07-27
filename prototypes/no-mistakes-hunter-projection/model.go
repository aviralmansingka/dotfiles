package main

import "fmt"

type state string
type action string

const (
	fresh         state = "fresh"
	evidenceReady state = "evidence-ready"
	accepted      state = "accepted"
	blocked       state = "blocked"
	projected     state = "projected"

	emit    action = "emit"
	accept  action = "accept"
	block   action = "block"
	project action = "project"
)

func next(current state, wanted action) (state, error) {
	transitions := map[state]map[action]state{
		fresh:         {emit: evidenceReady},
		evidenceReady: {accept: accepted, block: blocked},
		accepted:      {project: projected},
	}
	if result, ok := transitions[current][wanted]; ok {
		return result, nil
	}
	return current, fmt.Errorf("%s is not allowed while run is %s", wanted, current)
}

func hunterUse(step string) string {
	switch step {
	case "review":
		return "candidate-independent-review"
	case "test", "document", "lint":
		return "candidate-task-verifier"
	case "push", "pr", "ci":
		return "delivery-evidence-only"
	default:
		return "implementation-observation-only"
	}
}

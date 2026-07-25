package atlas

import (
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

type Run = runregistry.Run
type Task = runregistry.Task
type Goal = runregistry.Goal
type Verifier = runregistry.Verifier
type JourneyStep = runregistry.JourneyStep
type Evidence = runregistry.Evidence

func DecodeRun(data []byte) (Run, error) {
	return runregistry.Decode(data)
}

func activeGoal(run Run) Goal {
	return run.Active()
}

package runregistry

import (
	"fmt"
	"strings"
)

func (s *Store) ActivateGoal(runID, goalID string) error {
	return s.mutateRun(runID, func(run *Run) error {
		target, err := goalIndex(*run, goalID)
		if err != nil {
			return err
		}
		if run.Goals[target].Status != "pending" && run.Goals[target].Status != "blocked" {
			return fmt.Errorf("goal %s cannot activate from %s", goalID, run.Goals[target].Status)
		}
		for index := range run.Goals {
			if run.Goals[index].Status == "active" {
				run.Goals[index].Status = "pending"
			}
		}
		run.Goals[target].Status = "active"
		run.ActiveGoal = goalID
		run.Status = "active"
		return nil
	})
}

func (s *Store) BlockGoal(runID, goalID string) error {
	return s.mutateRun(runID, func(run *Run) error {
		target, err := activeGoalIndex(*run, goalID)
		if err != nil {
			return err
		}
		run.Goals[target].Status = "blocked"
		run.Status = "blocked"
		return nil
	})
}

func (s *Store) CompleteGoal(runID, goalID, summary string) error {
	if strings.TrimSpace(summary) == "" {
		return fmt.Errorf("evidence summary is required")
	}
	return s.mutateRun(runID, func(run *Run) error {
		target, err := activeGoalIndex(*run, goalID)
		if err != nil {
			return err
		}
		if verifier := run.Goals[target].Verifier; verifier != nil && verifier.State != "green" {
			return fmt.Errorf("goal %s verifier is %s, not green", goalID, verifier.State)
		}
		run.Goals[target].Status = "done"
		run.Evidence = append(run.Evidence, Evidence{
			ID:      fmt.Sprintf("E%02d", len(run.Evidence)+1),
			Summary: summary,
		})
		return nil
	})
}

func (s *Store) SetVerifier(runID, goalID, state string) error {
	return s.mutateRun(runID, func(run *Run) error {
		target, err := goalIndex(*run, goalID)
		if err != nil {
			return err
		}
		verifier := run.Goals[target].Verifier
		if verifier == nil {
			return fmt.Errorf("goal %s has no verifier", goalID)
		}
		valid := verifier.State == "pending" && state == "red" ||
			verifier.State == "red" && state == "green" ||
			verifier.State == "green" && state == "red"
		if !valid {
			return fmt.Errorf("verifier %s cannot transition from %s to %s", goalID, verifier.State, state)
		}
		if state == "red" {
			verifier.Iteration++
		}
		verifier.State = state
		return nil
	})
}

func (s *Store) mutateRun(runID string, mutate func(*Run) error) error {
	return s.withRunLock(runID, func(run *Run) error {
		if run.Status != "active" && run.Status != "blocked" {
			return fmt.Errorf("Task Run %s is not active", runID)
		}
		if err := mutate(run); err != nil {
			return err
		}
		run.Revision++
		run.UpdatedAt = s.now().Format(timeFormat)
		return s.write(*run)
	})
}

func goalIndex(run Run, goalID string) (int, error) {
	for index := range run.Goals {
		if run.Goals[index].ID == goalID {
			return index, nil
		}
	}
	return -1, fmt.Errorf("goal %s is not in Task Run %s", goalID, run.RunID)
}

func activeGoalIndex(run Run, goalID string) (int, error) {
	index, err := goalIndex(run, goalID)
	if err != nil {
		return -1, err
	}
	if run.ActiveGoal != goalID || run.Goals[index].Status != "active" {
		return -1, fmt.Errorf("goal %s is not the active goal", goalID)
	}
	return index, nil
}

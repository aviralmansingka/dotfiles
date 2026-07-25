package runregistry

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type Herdr interface {
	PaneExists(context.Context, string) bool
	CreateCompanion(context.Context, string, string) (Companion, error)
	ClosePane(context.Context, string) error
}

type Store struct {
	stateDir string
	herdr    Herdr
	now      func() time.Time
}

type EnsureOptions struct {
	Task         Task
	InvokedAt    time.Time
	Orchestrator Participant
	Goals        []Goal
}

func NewStore(stateDir string, herdr Herdr) *Store {
	return &Store{stateDir: stateDir, herdr: herdr, now: time.Now}
}

func (s *Store) Ensure(ctx context.Context, options EnsureOptions) (Run, error) {
	if options.Task.Kind != "task" {
		return Run{}, fmt.Errorf("Atlas is only eligible for Task Runs")
	}
	if options.Task.Path == "" || options.Orchestrator.PaneID == "" || len(options.Goals) == 0 {
		return Run{}, fmt.Errorf("task path, orchestrator pane, and goals are required")
	}
	var result Run
	err := s.withTaskLock(options.Task.Path, func() error {
		existing, found, err := s.findActive(options.Task.Path)
		if err != nil {
			return err
		}
		if found {
			result, err = s.resume(ctx, existing, options.Orchestrator)
			return err
		}
		result, err = s.create(ctx, options)
		return err
	})
	return result, err
}

func (s *Store) resume(ctx context.Context, run Run, orchestrator Participant) (Run, error) {
	changed := false
	if run.Orchestrator.PaneID != orchestrator.PaneID {
		if s.herdr.PaneExists(ctx, run.Orchestrator.PaneID) {
			return Run{}, fmt.Errorf("Task Run %s already has live orchestrator %s", run.RunID, run.Orchestrator.PaneID)
		}
		run.Orchestrator = orchestrator
		if len(run.Participants) == 0 {
			run.Participants = []Participant{orchestrator}
		} else {
			run.Participants[0] = orchestrator
		}
		changed = true
	}
	if run.Companion == nil || !s.herdr.PaneExists(ctx, run.Companion.PaneID) {
		companion, err := s.herdr.CreateCompanion(ctx, orchestrator.PaneID, run.RunID)
		if err != nil {
			return Run{}, err
		}
		run.Companion = &companion
		changed = true
	}
	if changed {
		run.Revision++
		run.UpdatedAt = s.now().Format(time.RFC3339)
		if err := s.write(run); err != nil {
			return Run{}, err
		}
	}
	return run, nil
}

func (s *Store) create(ctx context.Context, options EnsureOptions) (Run, error) {
	runID, err := newRunID()
	if err != nil {
		return Run{}, err
	}
	activeGoal := options.Goals[0].ID
	for _, goal := range options.Goals {
		if goal.Status == "active" {
			activeGoal = goal.ID
			break
		}
	}
	companion, err := s.herdr.CreateCompanion(ctx, options.Orchestrator.PaneID, runID)
	if err != nil {
		return Run{}, err
	}
	now := s.now().Format(time.RFC3339)
	run := Run{
		SchemaVersion: 1,
		RunID:         runID,
		Revision:      1,
		Status:        "active",
		InvokedAt:     options.InvokedAt.Format(time.RFC3339),
		UpdatedAt:     now,
		Task:          options.Task,
		ActiveGoal:    activeGoal,
		Goals:         append([]Goal(nil), options.Goals...),
		Orchestrator:  options.Orchestrator,
		Participants:  []Participant{options.Orchestrator},
		Companion:     &companion,
	}
	if err := s.write(run); err != nil {
		_ = s.herdr.ClosePane(ctx, companion.PaneID)
		return Run{}, err
	}
	return run, nil
}

func (s *Store) Finish(ctx context.Context, runID string) error {
	run, err := s.Read(runID)
	if err != nil {
		return err
	}
	return s.withTaskLock(run.Task.Path, func() error {
		run, err = s.Read(runID)
		if err != nil {
			return err
		}
		for _, goal := range run.Goals {
			if goal.Status != "done" {
				return fmt.Errorf("goal %s is not done", goal.ID)
			}
		}
		if run.Companion != nil {
			if run.Companion.OwnerPaneID != run.Orchestrator.PaneID {
				return fmt.Errorf("companion owner no longer matches the orchestrator")
			}
			if s.herdr.PaneExists(ctx, run.Companion.PaneID) {
				if err := s.herdr.ClosePane(ctx, run.Companion.PaneID); err != nil {
					return err
				}
			}
		}
		run.Status = "completed"
		run.Revision++
		run.UpdatedAt = s.now().Format(time.RFC3339)
		return s.write(run)
	})
}

func (s *Store) Read(runID string) (Run, error) {
	data, err := os.ReadFile(filepath.Join(s.stateDir, "runs", runID+".json"))
	if err != nil {
		return Run{}, err
	}
	return Decode(data)
}

func (s *Store) findActive(taskPath string) (Run, bool, error) {
	paths, err := filepath.Glob(filepath.Join(s.stateDir, "runs", "*.json"))
	if err != nil {
		return Run{}, false, err
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return Run{}, false, err
		}
		run, err := Decode(data)
		if err != nil {
			return Run{}, false, fmt.Errorf("%s: %w", path, err)
		}
		if run.Task.Path == taskPath && (run.Status == "active" || run.Status == "blocked") {
			return run, true, nil
		}
	}
	return Run{}, false, nil
}

func (s *Store) write(run Run) error {
	runsDir := filepath.Join(s.stateDir, "runs")
	if err := os.MkdirAll(runsDir, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	temp, err := os.CreateTemp(runsDir, "."+run.RunID+".*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, filepath.Join(runsDir, run.RunID+".json"))
}

func (s *Store) withTaskLock(taskPath string, fn func() error) error {
	locksDir := filepath.Join(s.stateDir, "locks")
	if err := os.MkdirAll(locksDir, 0o700); err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(taskPath))
	lockPath := filepath.Join(locksDir, hex.EncodeToString(sum[:])+".lock")
	if err := os.Mkdir(lockPath, 0o700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return fmt.Errorf("Task Run writer is already active")
		}
		return err
	}
	defer os.Remove(lockPath)
	return fn()
}

func newRunID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

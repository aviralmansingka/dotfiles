package runregistry

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

const timeFormat = time.RFC3339

type Herdr interface {
	PaneExists(context.Context, string) bool
	CreateCompanion(context.Context, string, string) (Companion, error)
	ClosePane(context.Context, string) error
}

type PaneProbe struct {
	Exists bool
	TabID  string
}

type paneProber interface {
	ProbePane(context.Context, string) (PaneProbe, error)
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
	if err := validateOrchestrator(options.Task, options.Orchestrator); err != nil {
		return Run{}, err
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
	if run.Orchestrator != orchestrator {
		if run.Orchestrator.PaneID != orchestrator.PaneID {
			probe, err := s.probePane(ctx, run.Orchestrator.PaneID)
			if err != nil {
				return Run{}, err
			}
			if probe.Exists {
				return Run{}, fmt.Errorf("Task Run %s already has live orchestrator %s", run.RunID, run.Orchestrator.PaneID)
			}
		} else if !unchangedOrchestrator(run.Orchestrator, orchestrator) {
			return Run{}, fmt.Errorf("Task Run %s live orchestrator identity changed", run.RunID)
		}
		run.Orchestrator = orchestrator
		if len(run.Participants) == 0 {
			run.Participants = []Participant{orchestrator}
		} else {
			run.Participants[0] = orchestrator
		}
		changed = true
	}
	companionProbe := PaneProbe{}
	if run.Companion != nil {
		var err error
		companionProbe, err = s.probePane(ctx, run.Companion.PaneID)
		if err != nil {
			return Run{}, fmt.Errorf("probe companion %s: %w", run.Companion.PaneID, err)
		}
		if companionProbe.Exists && !companionOwnershipMatches(run, companionProbe) {
			return Run{}, fmt.Errorf("live companion ownership does not match Task Run %s", run.RunID)
		}
	}
	if run.Companion == nil || !companionProbe.Exists {
		companion, err := s.herdr.CreateCompanion(ctx, orchestrator.PaneID, run.RunID)
		if err != nil {
			return Run{}, err
		}
		if !companionOwnershipMatches(
			Run{Orchestrator: orchestrator, Companion: &companion},
			PaneProbe{Exists: true, TabID: companion.TabID},
		) {
			_ = s.herdr.ClosePane(ctx, companion.PaneID)
			return Run{}, fmt.Errorf("created companion ownership does not match the orchestrator")
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
	if participantName(options.Task, "orchestrator") != "" && !companionOwnershipMatches(
		Run{Orchestrator: options.Orchestrator, Companion: &companion},
		PaneProbe{Exists: true, TabID: companion.TabID},
	) {
		_ = s.herdr.ClosePane(ctx, companion.PaneID)
		return Run{}, fmt.Errorf("created companion ownership does not match the orchestrator")
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
	return s.withRunLock(runID, func(run *Run) error {
		for _, goal := range run.Goals {
			if goal.Status != "done" {
				return fmt.Errorf("goal %s is not done", goal.ID)
			}
		}
		if run.Companion != nil {
			probe, err := s.probePane(ctx, run.Companion.PaneID)
			if err != nil {
				return fmt.Errorf("probe companion %s: %w", run.Companion.PaneID, err)
			}
			if probe.Exists {
				if !companionOwnershipMatches(*run, probe) {
					return fmt.Errorf("live companion ownership does not match the orchestrator")
				}
				if err := s.herdr.ClosePane(ctx, run.Companion.PaneID); err != nil {
					return err
				}
			}
		}
		run.Status = "completed"
		run.Revision++
		run.UpdatedAt = s.now().Format(timeFormat)
		return s.write(*run)
	})
}

func (s *Store) RegisterParticipant(runID string, participant Participant) (Run, error) {
	return s.registerParticipant(runID, participant, nil, nil)
}

func (s *Store) registerParticipant(
	runID string,
	participant Participant,
	validateLive func(Run) error,
	allowCollision func(Participant) bool,
) (Run, error) {
	var result Run
	target, err := s.Read(runID)
	if err != nil {
		return Run{}, err
	}
	err = s.withRegistryLock(func() error {
		return s.withTaskLock(target.Task.Path, func() error {
			runs, err := s.readAll()
			if err != nil {
				return err
			}
			var run *Run
			for index := range runs {
				if runs[index].RunID == runID {
					run = &runs[index]
					break
				}
			}
			if run == nil {
				return os.ErrNotExist
			}
			if run.Status != "active" && run.Status != "blocked" {
				return fmt.Errorf("Task Run %s is not active", runID)
			}
			if err := validateParticipant(*run, participant); err != nil {
				return err
			}
			if validateLive != nil {
				if err := validateLive(*run); err != nil {
					return err
				}
			}

			idempotent := false
			for _, registeredRun := range runs {
				if registeredRun.Status != "active" && registeredRun.Status != "blocked" {
					continue
				}
				registered := append([]Participant{registeredRun.Orchestrator}, registeredRun.Participants...)
				for index, existing := range registered {
					if existing == (Participant{}) || !participantIdentityCollides(existing, participant) {
						continue
					}
					inTargetParticipants := registeredRun.RunID == runID && index > 0
					if inTargetParticipants && existing == participant {
						idempotent = true
						continue
					}
					if inTargetParticipants && allowCollision != nil && allowCollision(existing) {
						continue
					}
					return fmt.Errorf(
						"participant identity collides with Task Run %s participant %s",
						registeredRun.RunID,
						existing.Name,
					)
				}
			}
			if idempotent {
				result = *run
				return nil
			}
			run.Participants = append(run.Participants, participant)
			return s.writeRegisteredParticipant(run, &result)
		})
	})
	return result, err
}

func unchangedOrchestrator(stored, live Participant) bool {
	return stored.Role == live.Role &&
		stored.Name == live.Name &&
		stored.PaneID == live.PaneID &&
		stored.TerminalID == live.TerminalID &&
		stored.AgentSession == live.AgentSession &&
		(stored.WorkspaceID == "" || stored.WorkspaceID == live.WorkspaceID) &&
		(stored.TabID == "" || stored.TabID == live.TabID)
}

func participantIdentityCollides(left, right Participant) bool {
	return sameNonEmpty(left.Name, right.Name) ||
		participantResourceIdentityCollides(left, right)
}

func participantResourceIdentityCollides(left, right Participant) bool {
	return sameNonEmpty(left.TabID, right.TabID) ||
		sameNonEmpty(left.PaneID, right.PaneID) ||
		sameNonEmpty(left.TerminalID, right.TerminalID) ||
		completeSession(left.AgentSession) && left.AgentSession == right.AgentSession
}

func sameNonEmpty(left, right string) bool {
	return left != "" && left == right
}

func completeSession(session AgentSession) bool {
	return session.Source != "" && session.Kind != "" && session.Value != ""
}

func validateParticipant(run Run, participant Participant) error {
	if participant.Role == "" || participant.Role == "orchestrator" ||
		participant.GoalID == "" || participant.Name == "" ||
		participant.WorkspaceID == "" || participant.TabID == "" ||
		participant.PaneID == "" || participant.TerminalID == "" ||
		participant.AgentSession.Source == "" ||
		participant.AgentSession.Kind == "" ||
		participant.AgentSession.Value == "" {
		return fmt.Errorf("complete non-orchestrator role, goal, agent, workspace, tab, pane, terminal, and session identity are required")
	}
	if expected := participantName(run.Task, participant.Role); expected != "" && participant.Name != expected {
		return fmt.Errorf("participant name %q must be %q", participant.Name, expected)
	}
	for _, goal := range run.Goals {
		if goal.ID == participant.GoalID {
			return nil
		}
	}
	return fmt.Errorf("participant goal %s is not in Task Run %s", participant.GoalID, run.RunID)
}

func (s *Store) writeRegisteredParticipant(run *Run, result *Run) error {
	run.Revision++
	run.UpdatedAt = s.now().Format(time.RFC3339)
	if err := s.write(*run); err != nil {
		return err
	}
	*result = *run
	return nil
}

func (s *Store) Read(runID string) (Run, error) {
	data, err := os.ReadFile(filepath.Join(s.stateDir, "runs", runID+".json"))
	if err != nil {
		return Run{}, err
	}
	return Decode(data)
}

func (s *Store) findActive(taskPath string) (Run, bool, error) {
	runs, err := s.readAll()
	if err != nil {
		return Run{}, false, err
	}
	for _, run := range runs {
		if run.Task.Path == taskPath && (run.Status == "active" || run.Status == "blocked") {
			return run, true, nil
		}
	}
	return Run{}, false, nil
}

func (s *Store) readAll() ([]Run, error) {
	paths, err := filepath.Glob(filepath.Join(s.stateDir, "runs", "*.json"))
	if err != nil {
		return nil, err
	}
	runs := make([]Run, 0, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		run, err := Decode(data)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		runs = append(runs, run)
	}
	return runs, nil
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

func (s *Store) withRegistryLock(fn func() error) error {
	return s.withFileLock("registry", fn)
}

func (s *Store) withTaskLock(taskPath string, fn func() error) error {
	return s.withFileLock("task:"+taskPath, fn)
}

func (s *Store) withRunLock(runID string, fn func(*Run) error) error {
	run, err := s.Read(runID)
	if err != nil {
		return err
	}
	return s.withTaskLock(run.Task.Path, func() error {
		current, err := s.Read(runID)
		if err != nil {
			return err
		}
		return fn(&current)
	})
}

func (s *Store) withFileLock(key string, fn func() error) error {
	locksDir := filepath.Join(s.stateDir, "locks")
	if err := os.MkdirAll(locksDir, 0o700); err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(key))
	lockPath := filepath.Join(locksDir, hex.EncodeToString(sum[:])+".lock")
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		if err == syscall.EWOULDBLOCK {
			return fmt.Errorf("Task Run writer is already active")
		}
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	return fn()
}

func (s *Store) probePane(ctx context.Context, paneID string) (PaneProbe, error) {
	if prober, ok := s.herdr.(paneProber); ok {
		return prober.ProbePane(ctx, paneID)
	}
	return PaneProbe{Exists: s.herdr.PaneExists(ctx, paneID)}, nil
}

func companionOwnershipMatches(run Run, probe PaneProbe) bool {
	if run.Companion == nil || run.Companion.OwnerPaneID != run.Orchestrator.PaneID {
		return false
	}
	if run.Orchestrator.TabID != "" && run.Companion.TabID != run.Orchestrator.TabID {
		return false
	}
	return probe.TabID == "" || probe.TabID == run.Companion.TabID
}

func newRunID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

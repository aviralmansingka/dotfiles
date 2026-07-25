package runregistry

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type WorkerTab struct {
	TabID       string `json:"tab_id"`
	WorkspaceID string `json:"workspace_id"`
	Label       string `json:"label"`
	PaneCount   int    `json:"pane_count"`
}

type WorkerHerdr interface {
	Worker(context.Context, string) (Participant, error)
	WorkerTabs(context.Context) ([]WorkerTab, error)
	PaneExists(context.Context, string) bool
	CloseTab(context.Context, string) error
}

type WorkerLifecycle struct {
	Name  string `json:"name"`
	TabID string `json:"tab_id"`
	State string `json:"state"`
}

type WorkerLifecycleReport struct {
	Workers []WorkerLifecycle `json:"workers"`
}

func (s *Store) RegisterWorker(
	ctx context.Context,
	runID string,
	participant Participant,
	herdr WorkerHerdr,
) (Run, error) {
	var tabs []WorkerTab
	return s.registerParticipant(runID, participant, func(run Run) error {
		var err error
		tabs, err = herdr.WorkerTabs(ctx)
		if err != nil {
			return err
		}
		state := reconcileWorker(ctx, run, participant, tabs, herdr)
		if state != "live" {
			return fmt.Errorf("worker %s capture is %s", participant.Name, state)
		}
		return nil
	}, func(existing Participant) bool {
		return existing.Name == participant.Name &&
			!participantResourceIdentityCollides(existing, participant) &&
			findWorkerTab(tabs, existing.TabID) == nil
	})
}

func (s *Store) ReconcileWorkers(
	ctx context.Context,
	runID string,
	herdr WorkerHerdr,
) (WorkerLifecycleReport, error) {
	var report WorkerLifecycleReport
	err := s.withRegistryLock(func() error {
		run, err := s.Read(runID)
		if err != nil {
			return err
		}
		tabs, err := herdr.WorkerTabs(ctx)
		if err != nil {
			return err
		}
		report = reconcileWorkers(ctx, run, tabs, herdr)
		return nil
	})
	return report, err
}

func (s *Store) CleanupWorkers(
	ctx context.Context,
	runID string,
	herdr WorkerHerdr,
) (WorkerLifecycleReport, error) {
	var report WorkerLifecycleReport
	err := s.withRegistryLock(func() error {
		run, err := s.Read(runID)
		if err != nil {
			return err
		}
		tabs, err := herdr.WorkerTabs(ctx)
		if err != nil {
			return err
		}
		report = reconcileWorkers(ctx, run, tabs, herdr)
		for _, worker := range report.Workers {
			if worker.State == "unexpected" {
				return fmt.Errorf("worker %s ownership is unexpected", worker.Name)
			}
		}
		for _, worker := range report.Workers {
			if worker.State == "live" {
				if err := herdr.CloseTab(ctx, worker.TabID); err != nil {
					return err
				}
			}
		}
		remaining, err := herdr.WorkerTabs(ctx)
		if err != nil {
			return err
		}
		for _, worker := range report.Workers {
			if worker.State == "live" && findWorkerTab(remaining, worker.TabID) != nil {
				return fmt.Errorf("worker tab %s survived cleanup", worker.TabID)
			}
		}
		if len(run.Participants) == 1 && run.Participants[0] == run.Orchestrator {
			return nil
		}
		run.Participants = []Participant{run.Orchestrator}
		run.Revision++
		run.UpdatedAt = s.now().Format(time.RFC3339)
		return s.write(run)
	})
	return report, err
}

func reconcileWorkers(
	ctx context.Context,
	run Run,
	tabs []WorkerTab,
	herdr WorkerHerdr,
) WorkerLifecycleReport {
	report := WorkerLifecycleReport{Workers: []WorkerLifecycle{}}
	for _, participant := range run.Participants {
		if participant.Role == "orchestrator" || participant == run.Orchestrator {
			continue
		}
		report.Workers = append(report.Workers, WorkerLifecycle{
			Name:  participant.Name,
			TabID: participant.TabID,
			State: reconcileWorker(ctx, run, participant, tabs, herdr),
		})
	}
	return report
}

func reconcileWorker(
	ctx context.Context,
	run Run,
	captured Participant,
	tabs []WorkerTab,
	herdr WorkerHerdr,
) string {
	tab := findWorkerTab(tabs, captured.TabID)
	if tab == nil {
		return "stale"
	}
	if captured.WorkspaceID != run.Orchestrator.WorkspaceID ||
		tab.WorkspaceID != captured.WorkspaceID ||
		strings.TrimSpace(tab.Label) == "" ||
		tab.PaneCount != 1 {
		return "unexpected"
	}
	live, err := herdr.Worker(ctx, captured.Name)
	if err != nil {
		return "unexpected"
	}
	live.Role = captured.Role
	live.GoalID = captured.GoalID
	if live != captured || !herdr.PaneExists(ctx, captured.PaneID) {
		return "unexpected"
	}
	return "live"
}

func findWorkerTab(tabs []WorkerTab, tabID string) *WorkerTab {
	for index := range tabs {
		if tabs[index].TabID == tabID {
			return &tabs[index]
		}
	}
	return nil
}

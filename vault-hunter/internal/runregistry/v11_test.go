package runregistry_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/atlas"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

type v11Herdr struct {
	live    map[string]bool
	creates int
	owners  []string
	closed  []string
}

func (h *v11Herdr) PaneExists(_ context.Context, paneID string) bool {
	return h.live[paneID]
}

func (h *v11Herdr) CreateCompanion(_ context.Context, ownerPaneID, runID string) (runregistry.Companion, error) {
	h.creates++
	h.owners = append(h.owners, ownerPaneID)
	paneID := "atlas-" + runID
	h.live[paneID] = true
	return runregistry.Companion{PaneID: paneID, TabID: "task-tab", OwnerPaneID: ownerPaneID}, nil
}

func (h *v11Herdr) ClosePane(_ context.Context, paneID string) error {
	h.closed = append(h.closed, paneID)
	delete(h.live, paneID)
	return nil
}

func TestV11OnlyTaskRunsCreateAndReuseAtlas(t *testing.T) {
	ctx := context.Background()
	stateDir := t.TempDir()
	herdr := &v11Herdr{live: map[string]bool{"task-pane": true, "worker-pane": true}}
	store := runregistry.NewStore(stateDir, herdr)
	options := runregistry.EnsureOptions{
		Task: runregistry.Task{
			ID:          "T11",
			Title:       "Implement the Vault Hunter Atlas",
			Path:        "/vault/task-11.md",
			FeaturePath: "/vault/feature.md",
			Kind:        "task",
		},
		InvokedAt: time.Date(2026, 7, 25, 4, 54, 0, 0, time.FixedZone("EDT", -4*60*60)),
		Orchestrator: runregistry.Participant{
			Role:       "orchestrator",
			Name:       "codex-pi-agent-pi-skills-and-tools-t11",
			PaneID:     "task-pane",
			TerminalID: "task-terminal",
			AgentSession: runregistry.AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "task-session",
			},
		},
		Goals: []runregistry.Goal{{
			ID:       "V11",
			Label:    "Task-only Atlas launch",
			Status:   "done",
			Verifier: &runregistry.Verifier{State: "green", Iteration: 1},
		}},
	}

	for _, kind := range []string{"feature", "project", "issue", "wayfinder"} {
		ineligible := options
		ineligible.Task.Kind = kind
		if _, err := store.Ensure(ctx, ineligible); err == nil {
			t.Fatalf("%s invocation created Atlas state", kind)
		}
	}
	if herdr.creates != 0 {
		t.Fatalf("non-Task invocations created %d Atlas companions", herdr.creates)
	}
	if matches, err := filepath.Glob(filepath.Join(stateDir, "runs", "*.json")); err != nil || len(matches) != 0 {
		t.Fatalf("non-Task invocations created Run Registry state: matches=%v err=%v", matches, err)
	}

	first, err := store.Ensure(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := store.Ensure(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	if first.RunID != resumed.RunID || first.Companion == nil || resumed.Companion == nil {
		t.Fatalf("Task Run was not reused: first=%#v resumed=%#v", first, resumed)
	}
	if first.Companion.PaneID != resumed.Companion.PaneID || herdr.creates != 1 {
		t.Fatalf("Task Run created more than one live Atlas companion: creates=%d", herdr.creates)
	}
	if len(herdr.owners) != 1 || herdr.owners[0] != options.Orchestrator.PaneID {
		t.Fatalf("Atlas was not attached only to the driver pane: %#v", herdr.owners)
	}

	selected, _, err := runregistry.FindParticipant(
		stateDir,
		options.Orchestrator.TerminalID,
		options.Orchestrator.AgentSession,
	)
	if err != nil {
		t.Fatal(err)
	}
	compact := atlas.RenderCompact(selected, 78, 17)
	if !strings.Contains(compact, "Vault Hunter Atlas") || !strings.Contains(compact, "/goal V11") {
		t.Fatalf("Task participant did not receive the compact Atlas preview:\n%s", compact)
	}
	if _, err := os.Stat(filepath.Join(stateDir, "runs", first.RunID+".json")); err != nil {
		t.Fatalf("Task Run Registry state missing: %v", err)
	}
	if err := store.Finish(ctx, first.RunID); err != nil {
		t.Fatal(err)
	}
	if len(herdr.closed) != 1 || herdr.closed[0] != first.Companion.PaneID {
		t.Fatalf("cleanup closed more than the owned Atlas pane: %#v", herdr.closed)
	}
	if !herdr.live["task-pane"] || !herdr.live["worker-pane"] {
		t.Fatalf("cleanup closed the driver or a worker pane: %#v", herdr.live)
	}
}

func TestV11RegistersExactWorkerAndReviewerIdentity(t *testing.T) {
	ctx := context.Background()
	stateDir := t.TempDir()
	herdr := &v11Herdr{live: map[string]bool{"driver-pane": true}}
	store := runregistry.NewStore(stateDir, herdr)
	run, err := store.Ensure(ctx, runregistry.EnsureOptions{
		Task: runregistry.Task{
			ID:   "T11",
			Path: "/vault/task-11.md",
			Kind: "task",
		},
		InvokedAt: time.Now(),
		Orchestrator: runregistry.Participant{
			Role:        "orchestrator",
			Name:        "codex-driver",
			WorkspaceID: "w2R",
			TabID:       "w2R:t8",
			PaneID:      "driver-pane",
			TerminalID:  "driver-terminal",
			AgentSession: runregistry.AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "driver-session",
			},
		},
		Goals: []runregistry.Goal{{ID: "V11", Label: "Run eligibility", Status: "active"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	worker := runregistry.Participant{
		Role:        "implementation",
		GoalID:      "V11",
		Name:        "codex-vault-hunter-t11-v11-implement",
		WorkspaceID: "w2R",
		TabID:       "w2R:tB",
		PaneID:      "w2R:pQ",
		TerminalID:  "term-worker",
		AgentSession: runregistry.AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  "worker-session",
		},
	}
	registered, err := store.RegisterParticipant(run.RunID, worker)
	if err != nil {
		t.Fatal(err)
	}
	revision := registered.Revision
	registered, err = store.RegisterParticipant(run.RunID, worker)
	if err != nil {
		t.Fatal(err)
	}
	if registered.Revision != revision || len(registered.Participants) != 2 {
		t.Fatalf("idempotent registration changed the Run: %#v", registered)
	}
	reviewer := worker
	reviewer.Role = "reviewer"
	reviewer.Name = "codex-vault-hunter-t11-v11-review"
	reviewer.TabID = "w2R:tD"
	reviewer.PaneID = "w2R:pS"
	reviewer.TerminalID = "term-reviewer"
	reviewer.AgentSession.Value = "reviewer-session"
	registered, err = store.RegisterParticipant(run.RunID, reviewer)
	if err != nil {
		t.Fatal(err)
	}
	if len(registered.Participants) != 3 {
		t.Fatalf("reviewer registration did not preserve all participants: %#v", registered.Participants)
	}
	found, participant, err := runregistry.FindParticipant(
		stateDir,
		worker.TerminalID,
		worker.AgentSession,
	)
	if err != nil {
		t.Fatal(err)
	}
	if found.RunID != run.RunID || participant != worker {
		t.Fatalf("worker identity or role/goal context was not preserved: %#v", participant)
	}
	full := atlas.RenderExpanded(registered, 120, 46)
	if !strings.Contains(full, "implementation · V11 · codex-vault-hunter-t11-v11-implement") ||
		!strings.Contains(full, "reviewer · V11 · codex-vault-hunter-t11-v11-review") {
		t.Fatalf("full Atlas omitted participant role/goal context:\n%s", full)
	}

	invalid := worker
	invalid.AgentSession.Value = ""
	if _, err := store.RegisterParticipant(run.RunID, invalid); err == nil {
		t.Fatal("incomplete agent session identity was registered")
	}
	invalid = worker
	invalid.GoalID = "missing"
	if _, err := store.RegisterParticipant(run.RunID, invalid); err == nil {
		t.Fatal("participant was registered against a missing goal")
	}
}

func TestV11ParticipantRegistrationRejectsEveryIdentityCollision(t *testing.T) {
	ctx := context.Background()
	stateDir := t.TempDir()
	herdr := &v11Herdr{live: map[string]bool{"driver-one": true, "driver-two": true}}
	store := runregistry.NewStore(stateDir, herdr)
	ensure := func(id, pane string) runregistry.Run {
		t.Helper()
		run, err := store.Ensure(ctx, runregistry.EnsureOptions{
			Task:      runregistry.Task{ID: id, Path: "/vault/" + id + ".md", Kind: "task"},
			InvokedAt: time.Now(),
			Orchestrator: runregistry.Participant{
				Role:        "orchestrator",
				Name:        "codex-" + id,
				WorkspaceID: "workspace",
				TabID:       "tab-" + id,
				PaneID:      pane,
				TerminalID:  "terminal-" + id,
				AgentSession: runregistry.AgentSession{
					Source: "herdr:codex",
					Kind:   "id",
					Value:  "session-" + id,
				},
			},
			Goals: []runregistry.Goal{{ID: "V11", Status: "active"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		return run
	}
	first := ensure("T11-one", "driver-one")
	second := ensure("T11-two", "driver-two")
	worker := runregistry.Participant{
		Role:        "implementation",
		GoalID:      "V11",
		Name:        "codex-worker",
		WorkspaceID: "workspace",
		TabID:       "worker-tab",
		PaneID:      "worker-pane",
		TerminalID:  "worker-terminal",
		AgentSession: runregistry.AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  "worker-session",
		},
	}
	registered, err := store.RegisterParticipant(first.RunID, worker)
	if err != nil {
		t.Fatal(err)
	}
	revision := registered.Revision

	cases := map[string]func(*runregistry.Participant){
		"name":     func(candidate *runregistry.Participant) { candidate.Name = worker.Name },
		"tab":      func(candidate *runregistry.Participant) { candidate.TabID = worker.TabID },
		"pane":     func(candidate *runregistry.Participant) { candidate.PaneID = worker.PaneID },
		"terminal": func(candidate *runregistry.Participant) { candidate.TerminalID = worker.TerminalID },
		"session":  func(candidate *runregistry.Participant) { candidate.AgentSession = worker.AgentSession },
	}
	for name, collide := range cases {
		t.Run("partial "+name, func(t *testing.T) {
			candidate := runregistry.Participant{
				Role:        "reviewer",
				GoalID:      "V11",
				Name:        "candidate-" + name,
				WorkspaceID: "workspace",
				TabID:       "candidate-tab-" + name,
				PaneID:      "candidate-pane-" + name,
				TerminalID:  "candidate-terminal-" + name,
				AgentSession: runregistry.AgentSession{
					Source: "herdr:codex",
					Kind:   "id",
					Value:  "candidate-session-" + name,
				},
			}
			collide(&candidate)
			if _, err := store.RegisterParticipant(first.RunID, candidate); err == nil {
				t.Fatalf("%s-only collision was accepted", name)
			}
		})
	}

	orchestratorReplacement := second.Orchestrator
	orchestratorReplacement.Role = "implementation"
	orchestratorReplacement.GoalID = "V11"
	if _, err := store.RegisterParticipant(second.RunID, orchestratorReplacement); err == nil {
		t.Fatal("orchestrator identity was replaced by a worker registration")
	}
	if _, err := store.RegisterParticipant(second.RunID, worker); err == nil {
		t.Fatal("an identical participant was registered to a second active Run")
	}
	after, err := store.Read(first.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != revision || len(after.Participants) != 2 {
		t.Fatalf("failed collisions mutated the original Run: %#v", after)
	}
	secondAfter, err := store.Read(second.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(secondAfter.Participants) != 1 || secondAfter.Orchestrator != second.Orchestrator {
		t.Fatalf("failed collisions replaced the orchestrator: %#v", secondAfter)
	}
}

func TestV11ParticipantRegistrationIsAtomicAcrossRuns(t *testing.T) {
	ctx := context.Background()
	stateDir := t.TempDir()
	herdr := &v11Herdr{live: map[string]bool{"driver-one": true, "driver-two": true}}
	store := runregistry.NewStore(stateDir, herdr)
	ensure := func(id, pane string) runregistry.Run {
		t.Helper()
		run, err := store.Ensure(ctx, runregistry.EnsureOptions{
			Task:         runregistry.Task{ID: id, Path: "/vault/" + id + ".md", Kind: "task"},
			InvokedAt:    time.Now(),
			Orchestrator: runregistry.Participant{Role: "orchestrator", Name: id, PaneID: pane},
			Goals:        []runregistry.Goal{{ID: "V11", Status: "active"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		return run
	}
	first := ensure("atomic-one", "driver-one")
	second := ensure("atomic-two", "driver-two")
	participant := func(suffix string) runregistry.Participant {
		return runregistry.Participant{
			Role:        "implementation",
			GoalID:      "V11",
			Name:        "worker-" + suffix,
			WorkspaceID: "workspace",
			TabID:       "tab-" + suffix,
			PaneID:      "pane-" + suffix,
			TerminalID:  "terminal-" + suffix,
			AgentSession: runregistry.AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "shared-session",
			},
		}
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, registration := range []struct {
		runID       string
		participant runregistry.Participant
	}{
		{first.RunID, participant("one")},
		{second.RunID, participant("two")},
	} {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			_, err := store.RegisterParticipant(registration.runID, registration.participant)
			results <- err
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent cross-Run collision produced %d successful registrations, want 1", successes)
	}
}

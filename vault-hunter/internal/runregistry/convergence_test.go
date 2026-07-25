package runregistry

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestV07CompanionOwnershipDistinguishesLiveFromStale(t *testing.T) {
	ctx := context.Background()
	for _, test := range []struct {
		name    string
		live    bool
		wantErr bool
	}{
		{name: "live mismatch is refused", live: true, wantErr: true},
		{name: "stale mismatch is replaced", live: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			stateDir := t.TempDir()
			herdr := &v07Herdr{live: map[string]bool{"driver": true, "old-atlas": test.live}}
			store := NewStore(stateDir, herdr)
			options := v07Options("/vault/project/feature/tasks/T07.md", "T07", "driver")
			run, err := store.Ensure(ctx, options)
			if err != nil {
				t.Fatal(err)
			}
			delete(herdr.live, run.Companion.PaneID)
			run.Companion = &Companion{PaneID: "old-atlas", TabID: "other-tab", OwnerPaneID: "other-driver"}
			if err := store.write(run); err != nil {
				t.Fatal(err)
			}
			herdr.createCount = 0

			resumed, err := store.Ensure(ctx, options)
			if test.wantErr {
				if err == nil {
					t.Fatal("live mismatched companion was reused")
				}
				if !strings.Contains(err.Error(), "companion") || !strings.Contains(err.Error(), "ownership") {
					t.Fatalf("live mismatch returned an indistinct error: %v", err)
				}
				if herdr.createCount != 0 || len(herdr.closed) != 0 {
					t.Fatalf("ownership refusal mutated panes: creates=%d closes=%v", herdr.createCount, herdr.closed)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if herdr.createCount != 1 || resumed.Companion.PaneID == "old-atlas" {
				t.Fatalf("stale companion was not replaced: creates=%d companion=%#v", herdr.createCount, resumed.Companion)
			}
		})
	}
}

func TestV07LocksArePerTask(t *testing.T) {
	ctx := context.Background()
	herdr := &blockingHerdr{
		live:    map[string]bool{"driver-one": true, "driver-two": true},
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	stateDir := t.TempDir()
	firstDone := make(chan error, 1)
	go func() {
		_, err := NewStore(stateDir, herdr).Ensure(
			ctx,
			v07Options("/vault/project/feature/tasks/T01.md", "T01", "driver-one"),
		)
		firstDone <- err
	}()
	<-herdr.entered

	secondDone := make(chan error, 1)
	go func() {
		_, err := NewStore(stateDir, herdr).Ensure(
			ctx,
			v07Options("/vault/project/feature/tasks/T02.md", "T02", "driver-two"),
		)
		secondDone <- err
	}()
	select {
	case err := <-secondDone:
		if err != nil {
			t.Fatalf("different Task was blocked by another Task's writer: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("different Task waited on another Task's writer")
	}
	close(herdr.release)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
}

func TestV07LockRecoversAfterWriterExit(t *testing.T) {
	stateDir := t.TempDir()
	command := exec.Command(os.Args[0], "-test.run=^TestV07LockCrashHelper$")
	command.Env = append(os.Environ(),
		"ATLAS_V07_LOCK_CRASH=1",
		"ATLAS_V07_LOCK_STATE="+stateDir,
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("crash helper: %v\n%s", err, output)
	}

	herdr := &v07Herdr{live: map[string]bool{"driver": true}}
	if _, err := NewStore(stateDir, herdr).Ensure(
		context.Background(),
		v07Options("/vault/project/feature/tasks/T07.md", "T07", "driver"),
	); err != nil {
		t.Fatalf("abandoned Task lock was not recovered: %v", err)
	}
}

func TestV07LockCrashHelper(t *testing.T) {
	if os.Getenv("ATLAS_V07_LOCK_CRASH") != "1" {
		return
	}
	store := NewStore(os.Getenv("ATLAS_V07_LOCK_STATE"), exitDuringCreateHerdr{})
	_, _ = store.Ensure(
		context.Background(),
		v07Options("/vault/project/feature/tasks/T07.md", "T07", "driver"),
	)
	os.Exit(9)
}

func TestV11EnsureRequiresExactProjectInclusiveOrchestrator(t *testing.T) {
	base := v07Options("/vault/1_projects/pi-agent/features/pi-skills-tools/tasks/T11.md", "T11", "driver")
	base.Orchestrator.Name = "codex-pi-agent-pi-skills-tools-t11-orchestrator"
	invalid := []struct {
		name          string
		breakIdentity func(*EnsureOptions)
	}{
		{
			name: "project omitted from name",
			breakIdentity: func(options *EnsureOptions) {
				options.Orchestrator.Name = "codex-pi-skills-tools-t11-orchestrator"
			},
		},
		{name: "role", breakIdentity: func(options *EnsureOptions) { options.Orchestrator.Role = "" }},
		{name: "workspace", breakIdentity: func(options *EnsureOptions) { options.Orchestrator.WorkspaceID = "" }},
		{name: "tab", breakIdentity: func(options *EnsureOptions) { options.Orchestrator.TabID = "" }},
		{name: "terminal", breakIdentity: func(options *EnsureOptions) { options.Orchestrator.TerminalID = "" }},
		{name: "session", breakIdentity: func(options *EnsureOptions) { options.Orchestrator.AgentSession = AgentSession{} }},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			options := base
			test.breakIdentity(&options)
			herdr := &v07Herdr{live: map[string]bool{"driver": true}}
			if _, err := NewStore(t.TempDir(), herdr).Ensure(context.Background(), options); err == nil {
				t.Fatal("incomplete or non-canonical orchestrator identity was accepted")
			}
			if herdr.createCount != 0 {
				t.Fatal("identity validation happened after companion creation")
			}
		})
	}
}

func v07Options(taskPath, taskID, paneID string) EnsureOptions {
	return EnsureOptions{
		Task: Task{
			ID:          taskID,
			Path:        taskPath,
			FeaturePath: "/vault/project/feature/feature.md",
			Kind:        "task",
		},
		InvokedAt: time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC),
		Orchestrator: Participant{
			Role:        "orchestrator",
			Name:        "codex-project-feature-" + strings.ToLower(taskID) + "-orchestrator",
			WorkspaceID: "workspace",
			TabID:       "tab-" + paneID,
			PaneID:      paneID,
			TerminalID:  "terminal-" + paneID,
			AgentSession: AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "session-" + paneID,
			},
		},
		Goals: []Goal{{ID: "V07", Label: "Lifecycle", Status: "active"}},
	}
}

type blockingHerdr struct {
	mu      sync.Mutex
	live    map[string]bool
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (h *blockingHerdr) PaneExists(_ context.Context, paneID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.live[paneID]
}

func (h *blockingHerdr) CreateCompanion(_ context.Context, owner, runID string) (Companion, error) {
	if owner == "driver-one" {
		h.once.Do(func() { close(h.entered) })
		<-h.release
	}
	paneID := "atlas-" + runID
	h.mu.Lock()
	h.live[paneID] = true
	h.mu.Unlock()
	return Companion{PaneID: paneID, TabID: "tab-" + owner, OwnerPaneID: owner}, nil
}

func (h *blockingHerdr) ClosePane(context.Context, string) error { return nil }

type v07Herdr struct {
	live        map[string]bool
	createCount int
	closed      []string
}

func (h *v07Herdr) PaneExists(_ context.Context, paneID string) bool {
	return h.live[paneID]
}

func (h *v07Herdr) CreateCompanion(_ context.Context, owner, runID string) (Companion, error) {
	h.createCount++
	paneID := "atlas-" + runID
	h.live[paneID] = true
	return Companion{PaneID: paneID, TabID: "tab-" + owner, OwnerPaneID: owner}, nil
}

func (h *v07Herdr) ClosePane(_ context.Context, paneID string) error {
	h.closed = append(h.closed, paneID)
	delete(h.live, paneID)
	return nil
}

type exitDuringCreateHerdr struct{}

func (exitDuringCreateHerdr) PaneExists(context.Context, string) bool { return false }
func (exitDuringCreateHerdr) ClosePane(context.Context, string) error { return nil }
func (exitDuringCreateHerdr) CreateCompanion(context.Context, string, string) (Companion, error) {
	os.Exit(0)
	return Companion{}, nil
}

package runregistry_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

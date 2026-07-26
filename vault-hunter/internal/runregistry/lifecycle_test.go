package runregistry

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type fakeHerdr struct {
	live        map[string]bool
	createCount int
	closed      []string
}

func (f *fakeHerdr) PaneExists(_ context.Context, paneID string) bool {
	return f.live[paneID]
}

func (f *fakeHerdr) CreateCompanion(_ context.Context, orchestratorPane, runID string) (Companion, error) {
	f.createCount++
	paneID := "companion-" + runID + "-" + string(rune('0'+f.createCount))
	f.live[paneID] = true
	return Companion{PaneID: paneID, TabID: "task-tab", OwnerPaneID: orchestratorPane}, nil
}

func (f *fakeHerdr) ClosePane(_ context.Context, paneID string) error {
	f.closed = append(f.closed, paneID)
	delete(f.live, paneID)
	return nil
}

func TestV07CompanionLifecycleIsExactlyOwnedAndResumable(t *testing.T) {
	ctx := context.Background()
	stateDir := t.TempDir()
	herdr := &fakeHerdr{live: map[string]bool{"orchestrator": true, "unrelated": true}}
	store := NewStore(stateDir, herdr)
	options := EnsureOptions{
		Task: Task{
			ID:          "T11",
			Title:       "Implement the Vault Hunter Atlas",
			Path:        "/vault/task-11.md",
			FeaturePath: "/vault/feature.md",
			Kind:        "task",
		},
		InvokedAt: time.Date(2026, 7, 25, 4, 54, 0, 0, time.FixedZone("EDT", -4*60*60)),
		Orchestrator: Participant{
			Role:       "orchestrator",
			Name:       "codex-pi-agent-pi-skills-and-tools-t11",
			PaneID:     "orchestrator",
			TerminalID: "term-orchestrator",
			AgentSession: AgentSession{
				Source: "herdr:codex",
				Kind:   "id",
				Value:  "codex-session",
			},
		},
		Goals: []Goal{{ID: "V01", Label: "Shared fixture", Status: "done"}},
	}

	first, err := store.Ensure(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	if herdr.createCount != 1 || first.Companion == nil {
		t.Fatalf("new Run created %d companions: %#v", herdr.createCount, first.Companion)
	}
	registryPath := filepath.Join(stateDir, "runs", first.RunID+".json")
	if info, err := os.Stat(registryPath); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("registry file is not private and durable: info=%v err=%v", info, err)
	}

	resumed, err := store.Ensure(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.RunID != first.RunID || resumed.Companion.PaneID != first.Companion.PaneID || herdr.createCount != 1 {
		t.Fatalf("resume did not reuse Run and companion: first=%#v resumed=%#v creates=%d", first, resumed, herdr.createCount)
	}

	delete(herdr.live, resumed.Companion.PaneID)
	recovered, err := store.Ensure(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.RunID != first.RunID || recovered.Companion.PaneID == first.Companion.PaneID || herdr.createCount != 2 {
		t.Fatalf("dead companion was not replaced on the same Run: %#v", recovered)
	}

	duplicate := options
	duplicate.Orchestrator.PaneID = "duplicate"
	duplicate.Orchestrator.TerminalID = "term-duplicate"
	duplicate.Orchestrator.AgentSession.Value = "other-session"
	herdr.live["duplicate"] = true
	if _, err := store.Ensure(ctx, duplicate); err == nil {
		t.Fatal("a second live orchestrator unexpectedly acquired the active Task Run")
	}

	if err := store.Finish(ctx, recovered.RunID); err != nil {
		t.Fatal(err)
	}
	if len(herdr.closed) != 1 || herdr.closed[0] != recovered.Companion.PaneID {
		t.Fatalf("finish closed the wrong panes: %#v", herdr.closed)
	}
	if !herdr.live["orchestrator"] || !herdr.live["unrelated"] {
		t.Fatalf("finish closed the orchestrator or unrelated pane: %#v", herdr.live)
	}
	finished, err := store.Read(recovered.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Status != "completed" {
		t.Fatalf("finished Run status = %q", finished.Status)
	}
}

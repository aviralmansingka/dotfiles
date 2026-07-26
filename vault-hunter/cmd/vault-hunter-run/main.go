package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/herdrcli"
	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

type goalsFlag []string

func (g *goalsFlag) String() string {
	return strings.Join(*g, ",")
}

func (g *goalsFlag) Set(value string) error {
	*g = append(*g, value)
	return nil
}

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "vault-hunter-run:", err)
		os.Exit(2)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: vault-hunter-run ensure|participant|reconcile-workers|cleanup-workers|finish")
	}
	stateDir, err := defaultStateDir()
	if err != nil {
		return err
	}
	switch args[0] {
	case "ensure":
		flags := flag.NewFlagSet("ensure", flag.ContinueOnError)
		flags.SetOutput(os.Stderr)
		state := flags.String("state-dir", stateDir, "Vault Hunter state directory")
		taskID := flags.String("task-id", "", "stable Task ID")
		taskTitle := flags.String("task-title", "", "Task title")
		taskPath := flags.String("task-path", "", "canonical Task note path")
		featurePath := flags.String("feature-path", "", "canonical Feature note path")
		invokedAt := flags.String("invoked-at", "", "RFC3339 invocation time")
		orchestratorPane := flags.String("orchestrator-pane", os.Getenv("HERDR_PANE_ID"), "orchestrator pane")
		atlasCommand := flags.String("atlas-command", "vault-hunter-atlas", "Atlas executable")
		var goals goalsFlag
		flags.Var(&goals, "goal", "id=label=status; repeat in timeline order")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		when, err := time.Parse(time.RFC3339, *invokedAt)
		if err != nil {
			return fmt.Errorf("--invoked-at: %w", err)
		}
		parsedGoals, err := parseGoals(goals)
		if err != nil {
			return err
		}
		client := herdrcli.Client{AtlasCommand: *atlasCommand}
		agent, err := client.Agent(ctx, *orchestratorPane)
		if err != nil {
			return err
		}
		store := runregistry.NewStore(*state, client)
		result, err := store.Ensure(ctx, runregistry.EnsureOptions{
			Task: runregistry.Task{
				ID:          *taskID,
				Title:       *taskTitle,
				Path:        *taskPath,
				FeaturePath: *featurePath,
				Kind:        "task",
			},
			InvokedAt: when,
			Orchestrator: runregistry.Participant{
				Role:        "orchestrator",
				Name:        agent.Name,
				WorkspaceID: agent.WorkspaceID,
				TabID:       agent.TabID,
				PaneID:      agent.PaneID,
				TerminalID:  agent.TerminalID,
				AgentSession: runregistry.AgentSession{
					Source: agent.AgentSession.Source,
					Kind:   agent.AgentSession.Kind,
					Value:  agent.AgentSession.Value,
				},
			},
			Goals: parsedGoals,
		})
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	case "participant":
		flags := flag.NewFlagSet("participant", flag.ContinueOnError)
		flags.SetOutput(os.Stderr)
		state := flags.String("state-dir", stateDir, "Vault Hunter state directory")
		runID := flags.String("run-id", "", "active Task Run ID")
		goalID := flags.String("goal-id", "", "owned Run goal")
		role := flags.String("role", "", "participant role")
		target := flags.String("agent", "", "live Herdr agent target")
		workspaceID := flags.String("workspace-id", "", "captured workspace ID")
		tabID := flags.String("tab-id", "", "captured tab ID")
		paneID := flags.String("pane-id", "", "captured pane ID")
		terminalID := flags.String("terminal-id", "", "captured terminal ID")
		sessionSource := flags.String("agent-session-source", "", "captured agent session source")
		sessionKind := flags.String("agent-session-kind", "", "captured agent session kind")
		sessionValue := flags.String("agent-session-value", "", "captured agent session value")
		herdrBinary := flags.String("herdr", "herdr", "Herdr executable")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		client := herdrcli.Client{Binary: *herdrBinary}
		result, err := runregistry.NewStore(*state, client).RegisterWorker(
			ctx,
			*runID,
			runregistry.Participant{
				Role:        *role,
				GoalID:      *goalID,
				Name:        *target,
				WorkspaceID: *workspaceID,
				TabID:       *tabID,
				PaneID:      *paneID,
				TerminalID:  *terminalID,
				AgentSession: runregistry.AgentSession{
					Source: *sessionSource,
					Kind:   *sessionKind,
					Value:  *sessionValue,
				},
			},
			client,
		)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	case "reconcile-workers", "cleanup-workers":
		flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
		flags.SetOutput(os.Stderr)
		state := flags.String("state-dir", stateDir, "Vault Hunter state directory")
		runID := flags.String("run-id", "", "active Task Run ID")
		herdrBinary := flags.String("herdr", "herdr", "Herdr executable")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		store := runregistry.NewStore(*state, nil)
		client := herdrcli.Client{Binary: *herdrBinary}
		var report runregistry.WorkerLifecycleReport
		if args[0] == "reconcile-workers" {
			report, err = store.ReconcileWorkers(ctx, *runID, client)
		} else {
			report, err = store.CleanupWorkers(ctx, *runID, client)
		}
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(report)
	case "finish":
		flags := flag.NewFlagSet("finish", flag.ContinueOnError)
		flags.SetOutput(os.Stderr)
		state := flags.String("state-dir", stateDir, "Vault Hunter state directory")
		runID := flags.String("run-id", "", "Run ID")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		return runregistry.NewStore(*state, herdrcli.Client{}).Finish(ctx, *runID)
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func parseGoals(values []string) ([]runregistry.Goal, error) {
	goals := make([]runregistry.Goal, 0, len(values))
	for _, value := range values {
		parts := strings.SplitN(value, "=", 3)
		if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
			return nil, fmt.Errorf("invalid --goal %q; want id=label=status", value)
		}
		goals = append(goals, runregistry.Goal{ID: parts[0], Label: parts[1], Status: parts[2]})
	}
	if len(goals) == 0 {
		return nil, fmt.Errorf("at least one --goal is required")
	}
	return goals, nil
}

func defaultStateDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "state", "vault-hunter"), nil
}

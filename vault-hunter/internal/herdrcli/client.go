package herdrcli

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"

	"github.com/aviralmansingka/dotfiles/vault-hunter/internal/runregistry"
)

type Client struct {
	Binary       string
	AtlasCommand string
}

type AgentInfo struct {
	Name         string       `json:"name"`
	WorkspaceID  string       `json:"workspace_id"`
	PaneID       string       `json:"pane_id"`
	TabID        string       `json:"tab_id"`
	TerminalID   string       `json:"terminal_id"`
	AgentSession AgentSession `json:"agent_session"`
}

type AgentSession struct {
	Source string `json:"source"`
	Kind   string `json:"kind"`
	Value  string `json:"value"`
}

func (c Client) Agent(ctx context.Context, target string) (AgentInfo, error) {
	var result struct {
		Agent AgentInfo `json:"agent"`
	}
	if err := c.call(ctx, &result, "agent", "get", target); err != nil {
		return AgentInfo{}, err
	}
	return result.Agent, nil
}

func (c Client) Worker(ctx context.Context, target string) (runregistry.Participant, error) {
	agent, err := c.Agent(ctx, target)
	if err != nil {
		return runregistry.Participant{}, err
	}
	return runregistry.Participant{
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
	}, nil
}

func (c Client) WorkerTabs(ctx context.Context) ([]runregistry.WorkerTab, error) {
	var result struct {
		Tabs []runregistry.WorkerTab `json:"tabs"`
	}
	if err := c.call(ctx, &result, "tab", "list"); err != nil {
		return nil, err
	}
	return result.Tabs, nil
}

func (c Client) PaneExists(ctx context.Context, paneID string) bool {
	return c.call(ctx, nil, "pane", "get", paneID) == nil
}

func (c Client) CreateCompanion(
	ctx context.Context,
	orchestratorPane string,
	runID string,
) (runregistry.Companion, error) {
	var result struct {
		Pane struct {
			PaneID string `json:"pane_id"`
			TabID  string `json:"tab_id"`
		} `json:"pane"`
	}
	if err := c.call(
		ctx,
		&result,
		"pane",
		"split",
		orchestratorPane,
		"--direction",
		"right",
		"--ratio",
		"0.42",
		"--no-focus",
	); err != nil {
		return runregistry.Companion{}, err
	}
	if result.Pane.PaneID == "" {
		return runregistry.Companion{}, fmt.Errorf("Herdr returned no companion pane")
	}
	command := strconv.Quote(c.AtlasCommand) + " --run " + strconv.Quote(runID)
	if err := c.call(ctx, nil, "pane", "run", result.Pane.PaneID, command); err != nil {
		_ = c.ClosePane(ctx, result.Pane.PaneID)
		return runregistry.Companion{}, err
	}
	return runregistry.Companion{
		PaneID:      result.Pane.PaneID,
		TabID:       result.Pane.TabID,
		OwnerPaneID: orchestratorPane,
	}, nil
}

func (c Client) ClosePane(ctx context.Context, paneID string) error {
	return c.call(ctx, nil, "pane", "close", paneID)
}

func (c Client) CloseTab(ctx context.Context, tabID string) error {
	return c.call(ctx, nil, "tab", "close", tabID)
}

func (c Client) call(ctx context.Context, target any, args ...string) error {
	binary := c.Binary
	if binary == "" {
		binary = "herdr"
	}
	output, err := exec.CommandContext(ctx, binary, args...).Output()
	if err != nil {
		return err
	}
	if target == nil {
		return nil
	}
	var response struct {
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(output, &response); err != nil {
		return err
	}
	if len(response.Result) == 0 {
		return fmt.Errorf("Herdr returned no result")
	}
	return json.Unmarshal(response.Result, target)
}

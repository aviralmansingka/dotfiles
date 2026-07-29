package atlascompanion

import (
	"errors"

	"github.com/aviral/dotfiles/internal/atlas"
	"github.com/aviral/dotfiles/internal/vaultregistry"
)

// PreviewResult is the single read-only response consumed by Sidekick.
type PreviewResult struct {
	Outcome       string `json:"outcome"`
	Projection    string `json:"projection,omitempty"`
	RunID         string `json:"run_id,omitempty"`
	ParticipantID string `json:"participant_id,omitempty"`
	Frame         string `json:"frame,omitempty"`
}

// WorkspacePreview resolves exact registered workspace custody or shows honest Herdr tabs.
func (c Client) WorkspacePreview(reader *vaultregistry.Reader, workspaceID, workspaceLabel string, width, height int) (PreviewResult, error) {
	if reader == nil || workspaceID == "" || width <= 0 || height <= 0 {
		return PreviewResult{}, errors.New("workspace preview requires an exact workspace and positive dimensions")
	}
	runs, err := reader.List()
	if err != nil {
		return PreviewResult{}, err
	}
	matches := make([]vaultregistry.Run, 0, 1)
	for _, run := range runs {
		for _, participant := range runParticipants(run) {
			if participant.Herdr != nil && participant.Herdr.WorkspaceID == workspaceID {
				matches = append(matches, run)
				break
			}
		}
	}
	if len(matches) > 1 {
		return PreviewResult{Outcome: "ambiguous"}, nil
	}
	if len(matches) == 1 {
		run := matches[0]
		if runTaskKind(run) != "task" {
			return PreviewResult{Outcome: "ineligible"}, nil
		}
		return PreviewResult{Outcome: "matched", Projection: "workspace-task", RunID: run.RunID, Frame: atlas.PickerCrewPreview(run, width, height)}, nil
	}
	tabs, err := c.workspaceTabs(workspaceID)
	if err != nil {
		return PreviewResult{}, err
	}
	labels := make([]string, len(tabs))
	for i, tab := range tabs {
		labels[i] = tab.Label
	}
	return PreviewResult{Outcome: "matched", Projection: "workspace-tabs", Frame: atlas.PickerTabsPreview(workspaceLabel, labels, width, height)}, nil
}

func (c Client) workspaceTabs(workspaceID string) ([]tab, error) {
	var response struct {
		Type string `json:"type"`
		Tabs []tab  `json:"tabs"`
	}
	if err := c.call(&response, "tab", "list", "--workspace", workspaceID); err != nil {
		return nil, err
	}
	if response.Type != "tab_list" || response.Tabs == nil {
		return nil, errors.New("invalid Herdr tab list result")
	}
	for _, tab := range response.Tabs {
		if tab.WorkspaceID != workspaceID || tab.TabID == "" || tab.Label == "" || tab.PaneCount < 1 {
			return nil, errors.New("invalid Herdr tab list result")
		}
	}
	return response.Tabs, nil
}

// Preview performs a read-only reverse lookup of one complete live identity.
func (c Client) Preview(reader *vaultregistry.Reader, selected Agent, width, height int) (PreviewResult, error) {
	if reader == nil || !completeAgent(selected) || selected.AgentSession == nil || !completeSession(*selected.AgentSession) || width <= 0 || height <= 0 {
		return PreviewResult{}, errors.New("preview requires a complete identity and positive dimensions")
	}
	runs, err := reader.List()
	if err != nil {
		switch {
		case errors.Is(err, vaultregistry.ErrUnsupportedVersion):
			return PreviewResult{Outcome: "unsupported"}, nil
		case errors.Is(err, vaultregistry.ErrMalformed), errors.Is(err, vaultregistry.ErrInvalidID):
			return PreviewResult{Outcome: "malformed"}, nil
		default:
			return PreviewResult{}, err
		}
	}
	agents, err := c.listAgents()
	if err != nil {
		return PreviewResult{}, err
	}

	liveMatches := make([]Agent, 0, 1)
	for _, agent := range agents {
		if sameAgentIdentity(selected, agent) {
			liveMatches = append(liveMatches, agent)
		}
	}

	type candidate struct {
		run         vaultregistry.Run
		participant vaultregistry.Participant
	}
	var matches []candidate
	recorded, taskRecorded := false, false
	stale, contradictory := false, false
	for _, run := range runs {
		participants := runParticipants(run)
		correlations, _ := correlate(participants, agents)
		for index, participant := range participants {
			if participant.Herdr == nil || !sameRecordedIdentity(*participant.Herdr, selected) {
				continue
			}
			recorded = true
			if runTaskKind(run) != "task" {
				continue
			}
			taskRecorded = true
			switch correlations[index].State {
			case "matched":
				matches = append(matches, candidate{run: run, participant: participant})
			case "contradictory":
				contradictory = true
			default:
				stale = true
			}
		}
	}

	switch {
	case !recorded:
		return PreviewResult{Outcome: "unregistered"}, nil
	case !taskRecorded:
		return PreviewResult{Outcome: "ineligible"}, nil
	case len(liveMatches) > 1 || len(matches) > 1:
		return PreviewResult{Outcome: "ambiguous"}, nil
	case len(liveMatches) != 1 || liveMatches[0].AgentSession == nil || !sameSession(*selected.AgentSession, *liveMatches[0].AgentSession):
		return PreviewResult{Outcome: "stale"}, nil
	case contradictory:
		return PreviewResult{Outcome: "contradictory"}, nil
	case stale || len(matches) != 1:
		return PreviewResult{Outcome: "stale"}, nil
	}

	match := matches[0]
	return PreviewResult{
		Outcome:       "matched",
		RunID:         match.run.RunID,
		ParticipantID: match.participant.ParticipantID,
		Frame:         atlas.CompactView(match.run, match.participant.ParticipantID, width, height),
	}, nil
}

func completeAgent(agent Agent) bool {
	return agent.WorkspaceID != "" && agent.TabID != "" && agent.PaneID != "" && agent.TerminalID != ""
}

func sameAgentIdentity(left, right Agent) bool {
	return completeAgent(left) && completeAgent(right) &&
		left.WorkspaceID == right.WorkspaceID && left.TabID == right.TabID &&
		left.PaneID == right.PaneID && left.TerminalID == right.TerminalID
}

func sameRecordedIdentity(recorded vaultregistry.HerdrIdentity, selected Agent) bool {
	return completeHerdr(recorded) && completeAgent(selected) &&
		recorded.WorkspaceID == selected.WorkspaceID && recorded.TabID == selected.TabID &&
		recorded.PaneID == selected.PaneID && recorded.TerminalID == selected.TerminalID
}

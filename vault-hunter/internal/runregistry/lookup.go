package runregistry

import (
	"fmt"
	"os"
	"path/filepath"
)

func FindParticipant(
	stateDir string,
	terminalID string,
	session AgentSession,
) (Run, Participant, error) {
	if terminalID == "" || session.Source == "" || session.Kind == "" || session.Value == "" {
		return Run{}, Participant{}, fmt.Errorf("terminal ID and complete agent session identity are required")
	}
	paths, err := filepath.Glob(filepath.Join(stateDir, "runs", "*.json"))
	if err != nil {
		return Run{}, Participant{}, err
	}
	var matchedRun Run
	var matchedParticipant Participant
	matches := 0
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return Run{}, Participant{}, err
		}
		run, err := Decode(data)
		if err != nil {
			return Run{}, Participant{}, fmt.Errorf("%s: %w", path, err)
		}
		if run.Status != "active" && run.Status != "blocked" {
			continue
		}
		for _, participant := range run.Participants {
			if participant.TerminalID == terminalID && participant.AgentSession == session {
				matchedRun = run
				matchedParticipant = participant
				matches++
			}
		}
	}
	if matches == 0 {
		return Run{}, Participant{}, fmt.Errorf("selected agent is not in an active Vault Hunter Run")
	}
	if matches > 1 {
		return Run{}, Participant{}, fmt.Errorf("selected agent matched multiple active Vault Hunter Runs")
	}
	return matchedRun, matchedParticipant, nil
}

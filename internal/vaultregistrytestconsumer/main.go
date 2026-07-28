// vaultregistrytestconsumer is a standalone, read-only fixture consumer used by T19.V03.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type output struct {
	Runs []runOutput `json:"runs"`
}

type runOutput struct {
	Summary      vaultregistry.RunSummary `json:"summary"`
	Observations []observationOutput      `json:"observations"`
}

type observationOutput struct {
	ObservationID     string                              `json:"observation_id"`
	Kind              vaultregistry.ObservationKind       `json:"kind"`
	State             vaultregistry.ObservationState      `json:"state"`
	Summary           string                              `json:"summary"`
	Details           []vaultregistry.SemanticDetail      `json:"details"`
	Duration          string                              `json:"duration,omitempty"`
	DurationAvailable bool                                `json:"duration_available"`
	SubjectAttempt    *vaultregistry.ObservationReference `json:"subject_attempt,omitempty"`
	TerminalTrace     *vaultregistry.ObservationReference `json:"terminal_trace,omitempty"`
	Auditor           *vaultregistry.ParticipantReference `json:"auditor,omitempty"`
	AuditorVerdict    *vaultregistry.ObservationReference `json:"auditor_verdict,omitempty"`
}

func consume(root string) (output, error) {
	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		return output{}, err
	}
	summaries, err := reader.ListSummaries(vaultregistry.ListFilter{})
	if err != nil {
		return output{}, err
	}
	result := output{Runs: make([]runOutput, 0, len(summaries))}
	for _, summary := range summaries {
		run, err := reader.Get(summary.RunID)
		if err != nil {
			return output{}, err
		}
		item := runOutput{Summary: summary, Observations: make([]observationOutput, 0, len(run.Observations))}
		for _, observation := range run.Observations {
			duration, available := observation.Duration()
			record := observationOutput{
				ObservationID: observation.ObservationID, Kind: observation.Kind, State: observation.State,
				Summary: observation.Summary, Details: observation.Details, DurationAvailable: available,
			}
			if available {
				record.Duration = duration.String()
			}
			if verdict := observation.Payload.AuditorVerdict; verdict != nil {
				record.SubjectAttempt, record.TerminalTrace, record.Auditor = &verdict.SubjectAttempt, &verdict.TerminalTrace, &verdict.Auditor
			}
			if decision := observation.Payload.VerifierDecision; decision != nil {
				record.AuditorVerdict = decision.AuditorVerdict
			}
			item.Observations = append(item.Observations, record)
		}
		result.Runs = append(result.Runs, item)
	}
	return result, nil
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: vaultregistrytestconsumer STATE_DIR")
		os.Exit(2)
	}
	result, err := consume(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

package atlas

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

// sanitizeRunProjection escapes Registry-owned controls before any Atlas
// layout or truncation. Renderer-owned newlines, box drawing, and styling are
// therefore left intact.
func sanitizeRunProjection(run vaultregistry.Run) vaultregistry.Run {
	run.RunID = sanitizeRegistryString(run.RunID)
	run.InvokedAt = sanitizeRegistryString(run.InvokedAt)
	run.UpdatedAt = sanitizeRegistryString(run.UpdatedAt)
	run.Task.ID = sanitizeRegistryString(run.Task.ID)
	run.Task.Title = sanitizeRegistryString(run.Task.Title)
	run.Task.Path = sanitizeRegistryString(run.Task.Path)
	run.Task.FeaturePath = sanitizeRegistryString(run.Task.FeaturePath)
	run.Task.Kind = sanitizeRegistryString(run.Task.Kind)

	run.Participants = append([]vaultregistry.Participant(nil), run.Participants...)
	for i := range run.Participants {
		participant := &run.Participants[i]
		participant.ParticipantID = sanitizeRegistryString(participant.ParticipantID)
		participant.ObservedAt = sanitizeRegistryString(participant.ObservedAt)
		participant.Role = sanitizeRegistryString(participant.Role)
		participant.GoalID = sanitizeRegistryString(participant.GoalID)
		if participant.Herdr != nil {
			identity := *participant.Herdr
			identity.WorkspaceID = sanitizeRegistryString(identity.WorkspaceID)
			identity.TabID = sanitizeRegistryString(identity.TabID)
			identity.PaneID = sanitizeRegistryString(identity.PaneID)
			identity.TerminalID = sanitizeRegistryString(identity.TerminalID)
			participant.Herdr = &identity
		}
		if participant.AgentSession != nil {
			session := *participant.AgentSession
			session.Source = sanitizeRegistryString(session.Source)
			session.Kind = sanitizeRegistryString(session.Kind)
			session.Value = sanitizeRegistryString(session.Value)
			participant.AgentSession = &session
		}
	}

	run.Lifecycle = append([]vaultregistry.Lifecycle(nil), run.Lifecycle...)
	for i := range run.Lifecycle {
		observation := &run.Lifecycle[i]
		observation.ObservationID = sanitizeRegistryString(observation.ObservationID)
		observation.ObservedAt = sanitizeRegistryString(observation.ObservedAt)
		observation.Kind = sanitizeRegistryString(observation.Kind)
		observation.GoalID = sanitizeRegistryString(observation.GoalID)
		observation.State = sanitizeRegistryString(observation.State)
		observation.Detail = sanitizeRegistryString(observation.Detail)
	}

	run.Evidence = append([]vaultregistry.Evidence(nil), run.Evidence...)
	for i := range run.Evidence {
		observation := &run.Evidence[i]
		observation.ObservationID = sanitizeRegistryString(observation.ObservationID)
		observation.ObservedAt = sanitizeRegistryString(observation.ObservedAt)
		observation.VerifierID = sanitizeRegistryString(observation.VerifierID)
		observation.State = sanitizeRegistryString(observation.State)
		observation.Command = sanitizeRegistryString(observation.Command)
		observation.ImplementationTree = sanitizeRegistryString(observation.ImplementationTree)
		observation.ArtifactSHA256 = sanitizeRegistryString(observation.ArtifactSHA256)
		observation.Detail = sanitizeRegistryString(observation.Detail)
	}
	return run
}

func sanitizeRegistryString(value string) string {
	var result strings.Builder
	for _, character := range value {
		if !unicode.IsControl(character) {
			result.WriteRune(character)
			continue
		}
		switch character {
		case '\b':
			result.WriteString(`\b`)
		case '\t':
			result.WriteString(`\t`)
		case '\n':
			result.WriteString(`\n`)
		case '\f':
			result.WriteString(`\f`)
		case '\r':
			result.WriteString(`\r`)
		default:
			if character <= 0xffff {
				fmt.Fprintf(&result, "\\u%04x", character)
			} else {
				fmt.Fprintf(&result, "\\U%08x", character)
			}
		}
	}
	return result.String()
}

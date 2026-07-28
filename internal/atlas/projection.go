package atlas

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func renderRunProjection(run vaultregistry.Run) vaultregistry.Run {
	if run.SchemaVersion != 2 {
		return run
	}
	if run.WorkReference != nil {
		run.Task = vaultregistry.Task{ID: run.WorkReference.ID, Title: run.WorkReference.Title, Path: run.WorkReference.Path, FeaturePath: run.WorkReference.FeaturePath, Kind: run.WorkReference.Kind}
	}
	run.Participants, run.Lifecycle, run.Evidence = nil, nil, nil
	for _, observation := range run.Observations {
		if payload := observation.Payload.RegisteredParticipant; observation.Kind == vaultregistry.KindRegisteredParticipant && payload != nil {
			session := payload.AgentSession
			run.Participants = append(run.Participants, vaultregistry.Participant{ParticipantID: payload.ParticipantID, ObservedAt: observation.ObservedAt, Role: payload.Role, GoalID: observation.GoalID, Herdr: payload.Herdr, AgentSession: &session})
		}
		identity := attemptIdentity(observation)
		if identity != nil {
			evidence := vaultregistry.Evidence{ObservationID: observation.ObservationID, ObservedAt: observation.ObservedAt, VerifierID: identity.VerifierID, State: string(observation.State), Command: identity.Command, ImplementationTree: identity.ImplementationTree, Detail: observation.Summary}
			if payload := observation.Payload.VerifierAttempt; payload != nil {
				evidence.ExitStatus = payload.ExitStatus
				manifest := payload.ResultManifest
				if manifest == nil {
					manifest = payload.PartialResultManifest
				}
				if manifest != nil {
					evidence.ArtifactSHA256 = manifest.SHA256
				}
			}
			run.Evidence = append(run.Evidence, evidence)
			continue
		}
		run.Lifecycle = append(run.Lifecycle, vaultregistry.Lifecycle{ObservationID: observation.ObservationID, ObservedAt: observation.ObservedAt, Kind: string(observation.Kind), GoalID: observation.GoalID, State: string(observation.State), Detail: observation.Summary})
	}
	return run
}

// sanitizeRunProjection escapes Registry-owned controls before any Atlas
// layout or truncation. Renderer-owned newlines, box drawing, and styling are
// therefore left intact.
func sanitizeRunProjection(run vaultregistry.Run) vaultregistry.Run {
	run = renderRunProjection(run)
	run.RunID = sanitizeRegistryString(run.RunID)
	run.Name = sanitizeRegistryString(run.Name)
	run.Stage = sanitizeRegistryString(run.Stage)
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

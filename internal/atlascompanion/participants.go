package atlascompanion

import "github.com/aviral/dotfiles/internal/vaultregistry"

func runParticipants(run vaultregistry.Run) []vaultregistry.Participant {
	if run.SchemaVersion != 2 {
		return append([]vaultregistry.Participant(nil), run.Participants...)
	}
	builders := map[string]vaultregistry.Participant{}
	order := make([]string, 0)
	for _, observation := range run.Observations {
		if observation.Kind != vaultregistry.KindRegisteredParticipant || observation.Payload.RegisteredParticipant == nil {
			continue
		}
		payload := observation.Payload.RegisteredParticipant
		current, ok := builders[payload.ParticipantID]
		if !ok {
			order = append(order, payload.ParticipantID)
		}
		current.ParticipantID = payload.ParticipantID
		current.ObservedAt = observation.ObservedAt
		current.Role = payload.Role
		current.GoalID = observation.GoalID
		current.Herdr = payload.Herdr
		session := payload.AgentSession
		current.AgentSession = &session
		builders[payload.ParticipantID] = current
	}
	participants := make([]vaultregistry.Participant, 0, len(builders))
	for _, id := range order {
		participants = append(participants, builders[id])
	}
	return participants
}

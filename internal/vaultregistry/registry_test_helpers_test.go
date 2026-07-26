package vaultregistry_test

import (
	"encoding/json"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func baseRun(id string) vaultregistry.Run {
	return vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         id,
		InvokedAt:     "2026-07-26T08:00:00Z",
		UpdatedAt:     "2026-07-26T08:00:00Z",
		Task: vaultregistry.Task{
			ID: "T01", Title: "Build the Run Registry POC", Path: "tasks/01.md",
			FeaturePath: "features/vault-hunter-atlas.md", Kind: "task",
		},
	}
}

func baseParticipant() vaultregistry.Participant {
	return vaultregistry.Participant{
		ParticipantID: "driver",
		ObservedAt:    "2026-07-26T08:00:01Z",
		Role:          "producer",
	}
}

func unknown(key, value string) map[string]json.RawMessage {
	return map[string]json.RawMessage{key: json.RawMessage(value)}
}

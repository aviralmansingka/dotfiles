package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const maxConflictRetries = 8

type request struct {
	Action      string                     `json:"action"`
	Root        string                     `json:"root"`
	RunID       string                     `json:"run_id"`
	Run         *vaultregistry.Run         `json:"run,omitempty"`
	UpdatedAt   string                     `json:"updated_at,omitempty"`
	Participant *vaultregistry.Participant `json:"participant,omitempty"`
	Lifecycle   *vaultregistry.Lifecycle   `json:"lifecycle,omitempty"`
	Evidence    *vaultregistry.Evidence    `json:"evidence,omitempty"`
}

func main() {
	var req request
	if err := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20)).Decode(&req); err != nil {
		fail(err)
	}
	producer, err := vaultregistry.OpenProducer(req.Root)
	if err != nil {
		fail(err)
	}
	var run vaultregistry.Run
	switch req.Action {
	case "create":
		run, err = create(producer, req.Run)
	case "get":
		run, err = producer.Get(req.RunID)
	case "append":
		run, err = appendObservation(producer, req)
	default:
		err = fmt.Errorf("unsupported action %q", req.Action)
	}
	if err != nil {
		fail(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(run); err != nil {
		fail(err)
	}
}

func create(producer *vaultregistry.Producer, wanted *vaultregistry.Run) (vaultregistry.Run, error) {
	if wanted == nil {
		return vaultregistry.Run{}, errors.New("create requires run")
	}
	created, err := producer.Create(*wanted)
	if !errors.Is(err, vaultregistry.ErrConflict) {
		return created, err
	}
	existing, getErr := producer.Get(wanted.RunID)
	if getErr != nil {
		return vaultregistry.Run{}, getErr
	}
	if existing.InvokedAt != wanted.InvokedAt || !sameTask(existing.Task, wanted.Task) {
		return vaultregistry.Run{}, fmt.Errorf("%w: run identity differs", vaultregistry.ErrConflict)
	}
	return existing, nil
}

func sameTask(a, b vaultregistry.Task) bool {
	return a.ID == b.ID && a.Title == b.Title && a.Path == b.Path && a.FeaturePath == b.FeaturePath && a.Kind == b.Kind
}

func appendObservation(producer *vaultregistry.Producer, req request) (vaultregistry.Run, error) {
	if req.RunID == "" || req.UpdatedAt == "" {
		return vaultregistry.Run{}, errors.New("append requires run_id and updated_at")
	}
	if _, err := time.Parse(time.RFC3339, req.UpdatedAt); err != nil {
		return vaultregistry.Run{}, fmt.Errorf("invalid updated_at: %w", err)
	}
	for range maxConflictRetries {
		current, err := producer.Get(req.RunID)
		if err != nil {
			return vaultregistry.Run{}, err
		}
		complete, err := observationState(current, req)
		if err != nil {
			return vaultregistry.Run{}, err
		}
		if complete {
			return current, nil
		}
		next, err := producer.Update(req.RunID, current.Revision, func(run *vaultregistry.Run) error {
			if _, err := observationState(*run, req); err != nil {
				return err
			}
			if after(req.UpdatedAt, run.UpdatedAt) {
				run.UpdatedAt = req.UpdatedAt
			}
			if req.Participant != nil && !participantExists(run.Participants, *req.Participant) {
				run.Participants = append(run.Participants, *req.Participant)
			}
			if req.Lifecycle != nil && !lifecycleExists(run.Lifecycle, req.Lifecycle.ObservationID) {
				run.Lifecycle = append(run.Lifecycle, *req.Lifecycle)
			}
			if req.Evidence != nil && !evidenceExists(run.Evidence, req.Evidence.ObservationID) {
				run.Evidence = append(run.Evidence, *req.Evidence)
			}
			return nil
		})
		if err == nil {
			return next, nil
		}
		if !errors.Is(err, vaultregistry.ErrConflict) {
			return vaultregistry.Run{}, err
		}
	}
	return vaultregistry.Run{}, fmt.Errorf("%w: retries exhausted", vaultregistry.ErrConflict)
}

func observationState(run vaultregistry.Run, req request) (bool, error) {
	complete := true
	if req.Participant != nil {
		found, equal := participantState(run.Participants, *req.Participant)
		if found && !equal {
			return false, fmt.Errorf("%w: participant identity collision", vaultregistry.ErrConflict)
		}
		complete = complete && found
	}
	if req.Lifecycle != nil {
		found, equal := lifecycleState(run.Lifecycle, *req.Lifecycle)
		if found && !equal {
			return false, fmt.Errorf("%w: lifecycle observation collision", vaultregistry.ErrConflict)
		}
		complete = complete && found
	}
	if req.Evidence != nil {
		found, equal := evidenceState(run.Evidence, *req.Evidence)
		if found && !equal {
			return false, fmt.Errorf("%w: evidence observation collision", vaultregistry.ErrConflict)
		}
		complete = complete && found
	}
	return complete, nil
}

func participantState(items []vaultregistry.Participant, wanted vaultregistry.Participant) (bool, bool) {
	for _, item := range items {
		if item.ParticipantID == wanted.ParticipantID && item.ObservedAt == wanted.ObservedAt {
			return true, equalCanonical(item, wanted)
		}
	}
	return false, false
}

func lifecycleState(items []vaultregistry.Lifecycle, wanted vaultregistry.Lifecycle) (bool, bool) {
	for _, item := range items {
		if item.ObservationID == wanted.ObservationID {
			return true, equalCanonical(item, wanted)
		}
	}
	return false, false
}

func evidenceState(items []vaultregistry.Evidence, wanted vaultregistry.Evidence) (bool, bool) {
	for _, item := range items {
		if item.ObservationID == wanted.ObservationID {
			return true, equalCanonical(item, wanted)
		}
	}
	return false, false
}

func equalCanonical[T any](a, b T) bool {
	aa, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return bytes.Equal(aa, bb)
}

func participantExists(items []vaultregistry.Participant, wanted vaultregistry.Participant) bool {
	found, _ := participantState(items, wanted)
	return found
}

func lifecycleExists(items []vaultregistry.Lifecycle, id string) bool {
	for _, item := range items {
		if item.ObservationID == id {
			return true
		}
	}
	return false
}

func evidenceExists(items []vaultregistry.Evidence, id string) bool {
	for _, item := range items {
		if item.ObservationID == id {
			return true
		}
	}
	return false
}

func after(a, b string) bool {
	aa, _ := time.Parse(time.RFC3339, a)
	bb, _ := time.Parse(time.RFC3339, b)
	return aa.After(bb)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

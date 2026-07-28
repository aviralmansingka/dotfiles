package atlas

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func AcceptVerifierAttemptEnvelope(stateRoot string, selector MachineSelector, expectedRevision uint64) (Envelope, error) {
	return decideVerifierAttemptEnvelope(stateRoot, selector, expectedRevision, vaultregistry.StateAccepted, "")
}

func RejectVerifierAttemptEnvelope(stateRoot string, selector MachineSelector, expectedRevision uint64, reason string) (Envelope, error) {
	if reason == "" {
		return Envelope{}, fmt.Errorf("%w: reject requires a non-empty reason", vaultregistry.ErrMalformed)
	}
	return decideVerifierAttemptEnvelope(stateRoot, selector, expectedRevision, vaultregistry.StateRejected, reason)
}

func decideVerifierAttemptEnvelope(stateRoot string, selector MachineSelector, expectedRevision uint64, decision vaultregistry.ObservationState, reason string) (Envelope, error) {
	if expectedRevision == 0 {
		return Envelope{}, fmt.Errorf("%w: expected revision must be positive", vaultregistry.ErrMalformed)
	}
	loaded, err := loadStateStore(stateRoot)
	if err != nil {
		return Envelope{}, err
	}
	attempt, run, err := loaded.resolveAttempt(selector)
	if err != nil {
		return Envelope{}, err
	}
	if attempt.Revision != int(expectedRevision) {
		return Envelope{}, fmt.Errorf("%w: expected attempt revision %d, actual %d", vaultregistry.ErrConflict, expectedRevision, attempt.Revision)
	}
	if attempt.Decision != "pending" {
		return Envelope{}, fmt.Errorf("%w: verifier attempt %q already decided", vaultregistry.ErrConflict, attempt.ID)
	}
	producer, err := vaultregistry.OpenExistingProducer(loaded.stateRoot)
	if err != nil {
		return Envelope{}, err
	}
	decidedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := producer.AppendObservation(run.RunID, run.Revision, decidedAt, decisionObservation(attempt, decision, reason, decidedAt)); err != nil {
		return Envelope{}, err
	}
	data := map[string]any{
		"id":         attempt.ID,
		"revision":   attempt.Revision + 1,
		"outcome":    attempt.Outcome,
		"decision":   string(decision),
		"decided_at": decidedAt,
	}
	meta := map[string]any{"operation": "accept"}
	if decision == vaultregistry.StateRejected {
		data["reason"] = reason
		meta["operation"] = "reject"
	}
	return Envelope{APIVersion: "atlas/v1", Kind: "VerifierAttempt", Data: data, Meta: meta}, nil
}

func RetireRunEnvelope(stateRoot string, selector MachineSelector, expectedRevision uint64) (Envelope, error) {
	if expectedRevision == 0 {
		return Envelope{}, fmt.Errorf("%w: expected revision must be positive", vaultregistry.ErrMalformed)
	}
	loaded, err := loadStateStore(stateRoot)
	if err != nil {
		return Envelope{}, err
	}
	run, err := loaded.resolveRun(selector)
	if err != nil {
		return Envelope{}, err
	}
	producer, err := vaultregistry.OpenExistingProducer(loaded.stateRoot)
	if err != nil {
		return Envelope{}, err
	}
	retired, err := producer.Retire(run.RunID, expectedRevision)
	if err != nil {
		return Envelope{}, err
	}
	data := map[string]any{
		"id":       retired.RunID,
		"name":     runName(retired),
		"revision": retired.Revision,
		"state":    string(retired.State),
	}
	if retired.RetiredAt != nil {
		data["retired_at"] = *retired.RetiredAt
	}
	return Envelope{APIVersion: "atlas/v1", Kind: "Run", Data: data, Meta: map[string]any{"operation": "retire"}}, nil
}

func loadStateStore(stateRoot string) (*store, error) {
	resolved, err := resolveStateRoot(stateRoot)
	if err != nil {
		return nil, err
	}
	active, err := scanRuns(filepath.Join(resolved, "runs"))
	if err != nil {
		return nil, err
	}
	retired, err := scanRuns(filepath.Join(resolved, "retired"))
	if err != nil {
		return nil, err
	}
	return &store{stateRoot: resolved, activeRuns: active, retiredRuns: retired, runsByTask: map[string][]vaultregistry.Run{}}, nil
}

func resolveStateRoot(stateRoot string) (string, error) {
	if stateRoot != "" {
		return stateRoot, nil
	}
	return vaultregistry.ResolveRoot()
}

func (s *store) resolveRun(selector MachineSelector) (vaultregistry.Run, error) {
	return resolveItem(selector, append(append([]vaultregistry.Run(nil), s.activeRuns...), s.retiredRuns...), func(item vaultregistry.Run) string {
		return item.RunID
	}, func(item vaultregistry.Run) string {
		return runName(item)
	})
}

func (s *store) resolveAttempt(selector MachineSelector) (attemptProjection, vaultregistry.Run, error) {
	attempt, err := resolveItem(selector, s.allAttempts(), func(item attemptProjection) string { return item.ID }, func(item attemptProjection) string { return item.ID })
	if err != nil {
		return attemptProjection{}, vaultregistry.Run{}, err
	}
	run, err := s.resolveRun(MachineSelector{ID: attempt.RunID})
	if err != nil {
		return attemptProjection{}, vaultregistry.Run{}, err
	}
	return attempt, run, nil
}

func decisionObservation(attempt attemptProjection, decision vaultregistry.ObservationState, reason, observedAt string) vaultregistry.Observation {
	summary := "accepted"
	title := "Parent accepted " + attempt.ID
	if decision == vaultregistry.StateRejected {
		summary = reason
		title = "Parent rejected " + attempt.ID
	}
	return vaultregistry.Observation{
		ObservationID:  fmt.Sprintf("decision-%s-%s", attempt.ID, decision),
		Kind:           vaultregistry.KindVerifierDecision,
		State:          decision,
		GoalID:         decisionGoalID(attempt),
		Title:          title,
		Summary:        summary,
		ObservedAt:     observedAt,
		CorrelationID:  attempt.RunID,
		Actor:          vaultregistry.Identity{Kind: "operator", ID: "atlas"},
		Source:         vaultregistry.Identity{Kind: "atlas", ID: "atlas"},
		RedactionClass: "internal",
		Payload: vaultregistry.ObservationPayload{VerifierDecision: &vaultregistry.VerifierDecisionPayload{
			AttemptID: attempt.ID,
		}},
	}
}

func decisionGoalID(attempt attemptProjection) string {
	if attempt.Verifier.ID != "" {
		return attempt.Verifier.ID
	}
	return attempt.Task.ID
}

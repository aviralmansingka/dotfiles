package vaultregistry

import (
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	sha256Pattern   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	sha1Pattern     = regexp.MustCompile(`^[0-9a-f]{40}$`)
	decimalPattern  = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`)
	amountPattern   = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]+)?$`)
	currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
)

var knownObservationKinds = map[ObservationKind]bool{
	"verifier_attempt":          true,
	"verifier_attempt_gap":      true,
	"verifier_attempt_relation": true,
	"verifier_decision":         true,
	"registered_participant":    true,
	"worker":                    true,
	"runtime_telemetry":         true,
	"auditor_verdict":           true,
}

func malformed(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrMalformed, fmt.Sprintf(format, args...))
}

func validateReader(run Run) error {
	switch run.SchemaVersion {
	case 1:
		return validateV1(run)
	case 2:
		return validateV2Reader(run)
	default:
		return fmt.Errorf("%w: version %d", ErrUnsupportedVersion, run.SchemaVersion)
	}
}

func validateProducer(run Run, strictFrom int) error {
	switch run.SchemaVersion {
	case 1:
		return validateV1(run)
	case 2:
		if err := validateV2Reader(run); err != nil {
			return err
		}
		if len(run.Participants) != 0 || len(run.Lifecycle) != 0 || len(run.Evidence) != 0 {
			return malformed("schema version 2 cannot produce version-1 histories")
		}
		if strictFrom < 0 || strictFrom > len(run.Observations) {
			strictFrom = 0
		}
		for i, observation := range run.Observations {
			// Existing future kinds and states remain rewritable; every known
			// contract, including existing history, receives strict validation.
			if i < strictFrom && (!knownObservationKinds[observation.Kind] || !knownObservationState(observation)) {
				continue
			}
			if err := validateKnownObservation(observation); err != nil {
				return fmt.Errorf("observation %d: %w", i, err)
			}
			if err := validateNewObservationRelations(run, i); err != nil {
				return fmt.Errorf("observation %d: %w", i, err)
			}
		}
		return nil
	default:
		return fmt.Errorf("%w: version %d", ErrUnsupportedVersion, run.SchemaVersion)
	}
}

func validateV2Reader(run Run) error {
	if run.SchemaVersion != 2 {
		return malformed("invalid schema version")
	}
	if err := validRunIdentity(run); err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(run.Observations))
	for i, observation := range run.Observations {
		if err := validateObservationStructure(observation); err != nil {
			return fmt.Errorf("observation %d: %w", i, err)
		}
		if _, exists := seen[observation.ObservationID]; exists {
			return fmt.Errorf("%w: duplicate observation_id %q", ErrConflict, observation.ObservationID)
		}
		seen[observation.ObservationID] = struct{}{}
	}
	return nil
}

func validateObservationStructure(o Observation) error {
	if o.ObservationID == "" || o.Kind == "" || o.State == "" || o.GoalID == "" ||
		o.Title == "" || o.Summary == "" || !timestamp(o.ObservedAt) || o.CorrelationID == "" ||
		o.RedactionClass == "" || !validIdentity(o.Actor) || !validIdentity(o.Source) {
		return malformed("invalid common envelope")
	}
	if o.ParentObservationID != nil && *o.ParentObservationID == "" {
		return malformed("empty parent_observation_id")
	}
	if o.StartedAt != nil && !timestamp(*o.StartedAt) || o.FinishedAt != nil && !timestamp(*o.FinishedAt) {
		return malformed("invalid interval timestamp")
	}
	if o.StartedAt != nil && o.FinishedAt != nil {
		if _, ok := o.Duration(); !ok {
			return malformed("finished_at precedes started_at")
		}
	}
	for _, detail := range o.Details {
		if err := validateDetail(detail); err != nil {
			return err
		}
	}
	if knownObservationKinds[o.Kind] && payloadCount(o.Payload) != 1 {
		return malformed("known kind %q requires exactly one typed payload", o.Kind)
	}
	if !knownObservationKinds[o.Kind] && payloadCount(o.Payload) != 0 {
		return malformed("future kind has a known payload")
	}
	return nil
}

func validRunIdentity(run Run) error {
	if run.Revision == 0 {
		return malformed("invalid revision")
	}
	if err := validID(run.RunID); err != nil {
		return err
	}
	if !timestamp(run.InvokedAt) || !timestamp(run.UpdatedAt) {
		return malformed("invalid run identity")
	}
	if run.WorkReference == nil {
		if run.Name != "" || run.RunKind != "" || run.State != "" || run.Stage != "" || run.RetiredAt != nil ||
			run.Task.ID == "" || run.Task.Title == "" || run.Task.Path == "" || run.Task.FeaturePath == "" || run.Task.Kind == "" {
			return malformed("invalid legacy run identity")
		}
		return nil
	}
	if err := validID(run.Name); err != nil {
		return malformed("invalid run name")
	}
	work := run.WorkReference
	if !oneOf(run.RunKind, RunKindScout, RunKindHunter) || run.Stage == "" ||
		work.ID == "" || work.Title == "" || work.Path == "" || work.FeaturePath == "" || !oneOf(work.Kind, "issue", "task") ||
		run.Task.ID != "" || run.Task.Title != "" || run.Task.Path != "" || run.Task.FeaturePath != "" || run.Task.Kind != "" {
		return malformed("invalid reconciled run identity")
	}
	switch run.State {
	case RunStateActive:
		if run.RetiredAt != nil {
			return malformed("active run has retired_at")
		}
	case RunStateRetired:
		if run.RetiredAt == nil || !timestamp(*run.RetiredAt) {
			return malformed("retired run requires retired_at")
		}
	default:
		return malformed("invalid run state")
	}
	return nil
}

func validateInitialCreate(run Run, driver Observation) error {
	if run.SchemaVersion != 2 || run.WorkReference == nil || run.Revision != 1 || run.State != RunStateActive || run.RetiredAt != nil || len(run.Observations) != 0 {
		return malformed("reconciled create requires one separate initial driver")
	}
	if driver.Kind != KindRegisteredParticipant || driver.State != StateActive || driver.Payload.RegisteredParticipant == nil ||
		driver.Payload.RegisteredParticipant.Role != "driver" {
		return malformed("initial observation must be an active driver")
	}
	next := run
	next.Observations = []Observation{driver}
	return validateProducer(next, 0)
}

func validSession(session AgentSession) bool {
	return session.Source != "" && session.Kind != "" && session.Value != ""
}

func validHerdr(identity HerdrIdentity) bool {
	return identity.WorkspaceID != "" && identity.TabID != "" && identity.PaneID != "" && identity.TerminalID != ""
}

func validIdentity(identity Identity) bool {
	return identity.Kind != "" && identity.ID != "" && (identity.AgentSession == nil || validSession(*identity.AgentSession))
}

func validateDetail(detail SemanticDetail) error {
	if detail.Key == "" || detail.Role == "" {
		return malformed("detail requires key and semantic role")
	}
	role := strings.ToLower(detail.Role)
	for _, rendererTerm := range []string{"ansi", "css", "color", "style", "renderer"} {
		if strings.Contains(role, rendererTerm) {
			return malformed("detail role %q is renderer-specific", detail.Role)
		}
	}
	count := 0
	if detail.Value.String != nil {
		count++
	}
	if detail.Value.Integer != nil {
		count++
	}
	if detail.Value.Boolean != nil {
		count++
	}
	if detail.Value.Decimal != nil {
		count++
	}
	if count != 1 {
		return malformed("detail value requires exactly one typed value")
	}
	if detail.Value.Decimal != nil && !decimalPattern.MatchString(*detail.Value.Decimal) {
		return malformed("invalid detail decimal")
	}
	return nil
}

func payloadCount(payload ObservationPayload) int {
	count := 0
	for _, present := range []bool{
		payload.VerifierAttempt != nil,
		payload.VerifierAttemptGap != nil,
		payload.VerifierAttemptRelation != nil,
		payload.VerifierDecision != nil,
		payload.RegisteredParticipant != nil,
		payload.Worker != nil,
		payload.RuntimeTelemetry != nil,
		payload.AuditorVerdict != nil,
	} {
		if present {
			count++
		}
	}
	return count
}

func knownObservationState(o Observation) bool {
	switch o.Kind {
	case KindVerifierAttempt:
		return oneOf(o.State, StateActive, StatePassed, StateFailed, StateInterrupted)
	case KindVerifierAttemptGap:
		return o.State == StateIncomplete
	case KindVerifierAttemptRelation:
		return o.State == StateRetried
	case KindVerifierDecision:
		return oneOf(o.State, StateAccepted, StateRejected, StateSuperseded)
	case KindRegisteredParticipant, KindWorker:
		return oneOf(o.State, StateActive, StateSucceeded, StateFailed, StateInterrupted)
	case KindRuntimeTelemetry:
		return o.State == StateRecorded
	case KindAuditorVerdict:
		return oneOf(o.State, StateSupports, StateDoesNotSupport, StateInconclusive, StateError)
	default:
		return false
	}
}

func validateKnownObservation(o Observation) error {
	if !knownObservationKinds[o.Kind] {
		return fmt.Errorf("%w: unknown observation kind %q", ErrUnsupportedVersion, o.Kind)
	}
	if err := validateObservationStructure(o); err != nil {
		return err
	}
	switch o.Kind {
	case "verifier_attempt":
		if o.Payload.VerifierAttempt == nil {
			return malformed("payload does not match verifier_attempt")
		}
		return validateAttempt(o, *o.Payload.VerifierAttempt)
	case "verifier_attempt_gap":
		if o.Payload.VerifierAttemptGap == nil {
			return malformed("payload does not match verifier_attempt_gap")
		}
		return validateGap(o, *o.Payload.VerifierAttemptGap)
	case "verifier_attempt_relation":
		if o.Payload.VerifierAttemptRelation == nil {
			return malformed("payload does not match verifier_attempt_relation")
		}
		if o.State != "retried" || !pointObservation(o) {
			return malformed("invalid retry relation state or interval")
		}
		p := o.Payload.VerifierAttemptRelation
		if p.FromAttemptID == "" || p.ToAttemptID == "" || p.FromAttemptID == p.ToAttemptID {
			return malformed("invalid retry attempt identities")
		}
	case "verifier_decision":
		if o.Payload.VerifierDecision == nil {
			return malformed("payload does not match verifier_decision")
		}
		if !oneOf(o.State, "accepted", "rejected", "superseded") || !pointObservation(o) || o.Payload.VerifierDecision.AttemptID == "" {
			return malformed("invalid verifier decision")
		}
		if ref := o.Payload.VerifierDecision.AuditorVerdict; ref != nil && !validObservationReference(*ref) {
			return malformed("invalid auditor verdict reference")
		}
	case "registered_participant":
		if o.Payload.RegisteredParticipant == nil {
			return malformed("payload does not match registered_participant")
		}
		return validateParticipant(o, *o.Payload.RegisteredParticipant)
	case "worker":
		if o.Payload.Worker == nil {
			return malformed("payload does not match worker")
		}
		return validateWorker(o, *o.Payload.Worker)
	case "runtime_telemetry":
		if o.Payload.RuntimeTelemetry == nil {
			return malformed("payload does not match runtime_telemetry")
		}
		return validateTelemetry(o, *o.Payload.RuntimeTelemetry)
	case "auditor_verdict":
		if o.Payload.AuditorVerdict == nil {
			return malformed("payload does not match auditor_verdict")
		}
		return validateAuditor(o, *o.Payload.AuditorVerdict)
	}
	return nil
}

func validateAttempt(o Observation, payload VerifierAttemptPayload) error {
	if err := validateAttemptIdentity(payload.Identity); err != nil {
		return err
	}
	switch o.State {
	case "active":
		if o.StartedAt == nil || o.FinishedAt != nil || payload.ExitStatus != nil || payload.ResultManifest != nil ||
			payload.PartialResultManifest != nil || len(payload.Diagnostics) != 0 || payload.Interruption != nil {
			return malformed("invalid active attempt matrix")
		}
	case "passed":
		if !terminalInterval(o) || payload.ExitStatus == nil || *payload.ExitStatus != 0 || !validManifest(payload.ResultManifest) ||
			payload.PartialResultManifest != nil || len(payload.Diagnostics) != 0 || payload.Interruption != nil {
			return malformed("invalid passed attempt matrix")
		}
	case "failed":
		if !terminalInterval(o) || payload.ExitStatus == nil || *payload.ExitStatus == 0 || !validManifest(payload.ResultManifest) ||
			payload.PartialResultManifest != nil || len(payload.Diagnostics) == 0 || payload.Interruption != nil {
			return malformed("invalid failed attempt matrix")
		}
		for _, diagnostic := range payload.Diagnostics {
			if diagnostic.Expected == "" || diagnostic.Actual == "" {
				return malformed("diagnostic requires expected and actual")
			}
		}
	case "interrupted":
		if !terminalInterval(o) || payload.ResultManifest != nil || !validManifest(payload.PartialResultManifest) ||
			len(payload.Diagnostics) != 0 || !validInterruption(payload.Interruption) {
			return malformed("invalid interrupted attempt matrix")
		}
	default:
		return malformed("unknown verifier_attempt state %q", o.State)
	}
	return nil
}

func validateAttemptIdentity(identity VerifierAttemptIdentity) error {
	if identity.AttemptID == "" || identity.VerifierID == "" || !sha256Pattern.MatchString(identity.SpecificationSHA256) ||
		!oneOf(identity.Phase, "baseline", "affected", "complete_suite", "final", "post_merge") ||
		identity.InvocationID == "" || identity.Command == "" || identity.WorkingDirectory == "" ||
		!sha256Pattern.MatchString(identity.EnvironmentContractSHA256) || !sha1Pattern.MatchString(identity.ImplementationCommit) ||
		!sha1Pattern.MatchString(identity.ImplementationTree) || !validIdentity(identity.Producer) {
		return malformed("invalid verifier attempt identity")
	}
	return nil
}

func validateGap(o Observation, payload VerifierAttemptGapPayload) error {
	if o.State != "incomplete" || !pointObservation(o) || payload.Reason == "" || len(payload.MissingFields) == 0 {
		return malformed("invalid incomplete attempt gap")
	}
	if err := validateAttemptIdentity(payload.Identity); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, field := range payload.MissingFields {
		if field == "" || seen[field] {
			return malformed("invalid missing_fields")
		}
		seen[field] = true
	}
	return nil
}

func validateParticipant(o Observation, payload RegisteredParticipantPayload) error {
	if payload.ParticipantID == "" || payload.Role == "" || !validSession(payload.AgentSession) || payload.Herdr != nil && !validHerdr(*payload.Herdr) {
		return malformed("invalid registered participant identity")
	}
	return validateLifecycleMatrix(o, payload.TerminalResult)
}

func validateWorker(o Observation, payload WorkerPayload) error {
	if payload.WorkerID == "" || payload.Role == "" || payload.Stage == "" || payload.OwnerParticipantID == "" ||
		!validSession(payload.AgentSession) || payload.Herdr != nil && !validHerdr(*payload.Herdr) ||
		payload.TaskSHA256 != nil && !sha256Pattern.MatchString(*payload.TaskSHA256) ||
		payload.ResultSHA256 != nil && !sha256Pattern.MatchString(*payload.ResultSHA256) {
		return malformed("invalid worker identity")
	}
	return validateLifecycleMatrix(o, payload.TerminalResult)
}

func validateLifecycleMatrix(o Observation, result *string) error {
	switch o.State {
	case "active":
		if o.StartedAt == nil || o.FinishedAt != nil || result != nil {
			return malformed("invalid active lifecycle matrix")
		}
	case "succeeded", "failed", "interrupted":
		if !terminalInterval(o) || result == nil || *result == "" {
			return malformed("invalid terminal lifecycle matrix")
		}
	default:
		return malformed("unknown lifecycle state %q", o.State)
	}
	return nil
}

func validateTelemetry(o Observation, payload RuntimeTelemetryPayload) error {
	if o.State != "recorded" || !pointObservation(o) || payload.ParticipantID == "" || payload.WorkerID == "" || payload.Boundary == "" {
		return malformed("invalid runtime telemetry identity")
	}
	if (payload.Provider == nil) != (payload.Model == nil) || payload.Provider != nil && (*payload.Provider == "" || *payload.Model == "") {
		return malformed("provider and model must be present together")
	}
	present := payload.Provider != nil
	if payload.Usage != nil {
		present = true
		if !oneOf(payload.Usage.Scope, "delta", "cumulative") {
			return malformed("invalid usage scope")
		}
		counters := []*int64{payload.Usage.InputTokens, payload.Usage.OutputTokens, payload.Usage.CacheReadTokens,
			payload.Usage.CacheWriteTokens, payload.Usage.ProviderReportedTotal, payload.Usage.Requests, payload.Usage.Turns, payload.Usage.ToolCount}
		hasCounter := false
		for _, counter := range counters {
			if counter != nil {
				hasCounter = true
				if *counter < 0 {
					return malformed("negative telemetry counter")
				}
			}
		}
		if !hasCounter {
			return malformed("usage requires a counter")
		}
	}
	if payload.Cost != nil {
		present = true
		if !amountPattern.MatchString(payload.Cost.Amount) || !currencyPattern.MatchString(payload.Cost.Currency) ||
			!oneOf(payload.Cost.Basis, "reported", "estimated") {
			return malformed("invalid telemetry cost")
		}
	}
	if !present {
		return malformed("runtime telemetry has no metrics")
	}
	return nil
}

func validateAuditor(o Observation, payload AuditorVerdictPayload) error {
	if !oneOf(o.State, "supports", "does_not_support", "inconclusive", "error") || !terminalInterval(o) ||
		!validObservationReference(payload.SubjectAttempt) || !validObservationReference(payload.TerminalTrace) ||
		!validParticipantReference(payload.Auditor) || payload.Rationale == "" || !utf8.ValidString(payload.Rationale) || len([]byte(payload.Rationale)) > 4096 {
		return malformed("invalid auditor verdict")
	}
	switch o.State {
	case "supports":
		if payload.Classification != "none" {
			return malformed("supports requires none classification")
		}
	case "does_not_support":
		if !oneOf(payload.Classification, "evidence_deficiency", "verifier_failure", "implementation_defect") {
			return malformed("invalid does_not_support classification")
		}
	case "error":
		if payload.Classification != "audit_error" {
			return malformed("error requires audit_error classification")
		}
	case "inconclusive":
		if !oneOf(payload.Classification, "none", "evidence_deficiency", "verifier_failure", "implementation_defect", "audit_error") {
			return malformed("invalid inconclusive classification")
		}
	}
	return nil
}

func validateNewObservationRelations(run Run, index int) error {
	o := run.Observations[index]
	switch o.Kind {
	case "verifier_attempt", "verifier_attempt_gap":
		identity := attemptIdentity(o)
		for i := 0; i < index; i++ {
			prior := run.Observations[i]
			priorIdentity := attemptIdentity(prior)
			if priorIdentity == nil || priorIdentity.AttemptID != identity.AttemptID {
				continue
			}
			if prior.GoalID != o.GoalID || !equalJSON(*priorIdentity, *identity) {
				return fmt.Errorf("%w: attempt_id %q identity reuse", ErrConflict, identity.AttemptID)
			}
			if o.Kind == "verifier_attempt" && oneOf(o.State, "passed", "failed", "interrupted") &&
				prior.Kind == "verifier_attempt" && oneOf(prior.State, "passed", "failed", "interrupted") {
				return fmt.Errorf("%w: attempt_id %q has multiple terminal outcomes", ErrConflict, identity.AttemptID)
			}
			if o.Kind == "verifier_attempt" && o.State == "active" && prior.Kind == "verifier_attempt" {
				if oneOf(prior.State, "passed", "failed", "interrupted") {
					return fmt.Errorf("%w: attempt_id %q is terminal", ErrConflict, identity.AttemptID)
				}
				if prior.State == "active" {
					return fmt.Errorf("%w: attempt_id %q has multiple active observations", ErrConflict, identity.AttemptID)
				}
			}
			if o.Kind == "verifier_attempt" && oneOf(o.State, "passed", "failed", "interrupted") && prior.Kind == "verifier_attempt" && prior.State == "active" &&
				(o.StartedAt == nil || prior.StartedAt == nil || *o.StartedAt != *prior.StartedAt) {
				return fmt.Errorf("%w: attempt_id %q changed started_at", ErrConflict, identity.AttemptID)
			}
		}
	case "verifier_attempt_relation":
		p := o.Payload.VerifierAttemptRelation
		from, fromIndex := findAttempt(run.Observations[:index], p.FromAttemptID)
		to, toIndex := findAttempt(run.Observations[:index], p.ToAttemptID)
		if from == nil || to == nil || fromIndex >= toIndex {
			return malformed("retry must link to a distinct later attempt")
		}
		if !attemptRetryable(run.Observations[:index], p.FromAttemptID) {
			return malformed("retry source is not failed, interrupted, or incomplete")
		}
		if run.Observations[fromIndex].GoalID != o.GoalID || run.Observations[toIndex].GoalID != o.GoalID || !sameRetryIdentity(*from, *to) {
			return malformed("retry identities differ")
		}
		fromStarted := attemptStarted(run.Observations[:index], p.FromAttemptID)
		toStarted := attemptStarted(run.Observations[:index], p.ToAttemptID)
		if fromStarted != nil && toStarted != nil {
			fromTime, _ := time.Parse(time.RFC3339, *fromStarted)
			toTime, _ := time.Parse(time.RFC3339, *toStarted)
			if toTime.Before(fromTime) {
				return malformed("later retry started earlier")
			}
		}
	case "verifier_decision":
		attemptID := o.Payload.VerifierDecision.AttemptID
		if identity, _ := findAttempt(run.Observations[:index], attemptID); identity == nil {
			return malformed("decision references unknown attempt")
		}
		if o.State == "accepted" && !attemptHasTerminal(run.Observations[:index], attemptID) {
			return malformed("incomplete or active attempt cannot be accepted")
		}
	case "registered_participant":
		p := o.Payload.RegisteredParticipant
		for i := 0; i < index; i++ {
			prior := run.Observations[i]
			if prior.Kind != "registered_participant" || prior.Payload.RegisteredParticipant == nil || prior.Payload.RegisteredParticipant.ParticipantID != p.ParticipantID {
				continue
			}
			if prior.GoalID != o.GoalID || !sameParticipantIdentity(*prior.Payload.RegisteredParticipant, *p) {
				return fmt.Errorf("%w: participant_id %q identity reuse", ErrConflict, p.ParticipantID)
			}
			if o.State == "active" {
				if oneOf(prior.State, "succeeded", "failed", "interrupted") {
					return fmt.Errorf("%w: participant_id %q is terminal", ErrConflict, p.ParticipantID)
				}
				if prior.State == "active" {
					return fmt.Errorf("%w: participant_id %q has multiple active observations", ErrConflict, p.ParticipantID)
				}
			}
			if oneOf(o.State, "succeeded", "failed", "interrupted") && oneOf(prior.State, "succeeded", "failed", "interrupted") {
				return fmt.Errorf("%w: participant_id %q has multiple terminal results", ErrConflict, p.ParticipantID)
			}
			if oneOf(o.State, "succeeded", "failed", "interrupted") && prior.State == "active" &&
				(o.StartedAt == nil || prior.StartedAt == nil || *o.StartedAt != *prior.StartedAt) {
				return fmt.Errorf("%w: participant_id %q changed started_at", ErrConflict, p.ParticipantID)
			}
		}
	case "worker":
		p := o.Payload.Worker
		if !participantExists(run.Observations[:index], p.OwnerParticipantID) {
			return malformed("worker owner participant does not exist")
		}
		for i := 0; i < index; i++ {
			prior := run.Observations[i]
			if prior.Kind != "worker" || prior.Payload.Worker == nil || prior.Payload.Worker.WorkerID != p.WorkerID {
				continue
			}
			if prior.GoalID != o.GoalID || !sameWorkerIdentity(*prior.Payload.Worker, *p) {
				return fmt.Errorf("%w: worker_id %q identity reuse", ErrConflict, p.WorkerID)
			}
			if o.State == "active" {
				if oneOf(prior.State, "succeeded", "failed", "interrupted") {
					return fmt.Errorf("%w: worker_id %q is terminal", ErrConflict, p.WorkerID)
				}
				if prior.State == "active" {
					return fmt.Errorf("%w: worker_id %q has multiple active observations", ErrConflict, p.WorkerID)
				}
			}
			if oneOf(o.State, "succeeded", "failed", "interrupted") && oneOf(prior.State, "succeeded", "failed", "interrupted") {
				return fmt.Errorf("%w: worker_id %q has multiple terminal results", ErrConflict, p.WorkerID)
			}
			if oneOf(o.State, "succeeded", "failed", "interrupted") && prior.State == "active" &&
				(o.StartedAt == nil || prior.StartedAt == nil || *o.StartedAt != *prior.StartedAt) {
				return fmt.Errorf("%w: worker_id %q changed started_at", ErrConflict, p.WorkerID)
			}
		}
	case "runtime_telemetry":
		p := o.Payload.RuntimeTelemetry
		if !participantExists(run.Observations[:index], p.ParticipantID) {
			return malformed("telemetry participant does not exist")
		}
		worker := findWorker(run.Observations[:index], p.WorkerID)
		if worker == nil || worker.OwnerParticipantID != p.ParticipantID {
			return malformed("telemetry worker scope is inconsistent")
		}
	case "auditor_verdict":
		p := o.Payload.AuditorVerdict
		if p.SubjectAttempt.RunID == run.RunID || p.TerminalTrace.RunID != run.RunID || p.Auditor.RunID != run.RunID {
			return malformed("auditor verdict references are not scoped to its traced Run")
		}
	}
	return nil
}

func attemptIdentity(o Observation) *VerifierAttemptIdentity {
	if o.Kind == "verifier_attempt" && o.Payload.VerifierAttempt != nil {
		return &o.Payload.VerifierAttempt.Identity
	}
	if o.Kind == "verifier_attempt_gap" && o.Payload.VerifierAttemptGap != nil {
		return &o.Payload.VerifierAttemptGap.Identity
	}
	return nil
}

func findAttempt(observations []Observation, id string) (*VerifierAttemptIdentity, int) {
	for i, observation := range observations {
		identity := attemptIdentity(observation)
		if identity != nil && identity.AttemptID == id {
			return identity, i
		}
	}
	return nil, -1
}

func attemptRetryable(observations []Observation, id string) bool {
	incomplete := false
	for _, observation := range observations {
		identity := attemptIdentity(observation)
		if identity == nil || identity.AttemptID != id {
			continue
		}
		if observation.Kind == KindVerifierAttempt && oneOf(observation.State, StatePassed, StateFailed, StateInterrupted) {
			return oneOf(observation.State, StateFailed, StateInterrupted)
		}
		incomplete = incomplete || observation.Kind == KindVerifierAttemptGap && observation.State == StateIncomplete
	}
	return incomplete
}

func attemptHasTerminal(observations []Observation, id string) bool {
	for _, observation := range observations {
		identity := attemptIdentity(observation)
		if identity != nil && identity.AttemptID == id && observation.Kind == "verifier_attempt" && oneOf(observation.State, "passed", "failed", "interrupted") {
			return true
		}
	}
	return false
}

func attemptStarted(observations []Observation, id string) *string {
	for _, observation := range observations {
		identity := attemptIdentity(observation)
		if identity != nil && identity.AttemptID == id && observation.StartedAt != nil {
			return observation.StartedAt
		}
	}
	return nil
}

func sameRetryIdentity(a, b VerifierAttemptIdentity) bool {
	return a.VerifierID == b.VerifierID && a.SpecificationSHA256 == b.SpecificationSHA256 && a.Phase == b.Phase
}

func sameParticipantIdentity(a, b RegisteredParticipantPayload) bool {
	a.TerminalResult, b.TerminalResult = nil, nil
	return equalJSON(a, b)
}

func sameWorkerIdentity(a, b WorkerPayload) bool {
	a.TerminalResult, b.TerminalResult = nil, nil
	a.ResultSHA256, b.ResultSHA256 = nil, nil
	return equalJSON(a, b)
}

func participantExists(observations []Observation, id string) bool {
	for _, observation := range observations {
		if observation.Kind == "registered_participant" && observation.Payload.RegisteredParticipant != nil && observation.Payload.RegisteredParticipant.ParticipantID == id {
			return true
		}
	}
	return false
}

func findWorker(observations []Observation, id string) *WorkerPayload {
	for _, observation := range observations {
		if observation.Kind == "worker" && observation.Payload.Worker != nil && observation.Payload.Worker.WorkerID == id {
			return observation.Payload.Worker
		}
	}
	return nil
}

func validManifest(manifest *ManifestMetadata) bool {
	return manifest != nil && manifest.Path != "" && sha256Pattern.MatchString(manifest.SHA256) && manifest.MediaType != "" && manifest.Authenticated
}

func validInterruption(reason *InterruptionReason) bool {
	return reason != nil && oneOf(reason.Kind, "timeout", "signal", "cancellation", "runner_loss", "shutdown") && reason.Detail != "" &&
		(reason.ObservedSignal == nil || *reason.ObservedSignal != "")
}

func validObservationReference(ref ObservationReference) bool {
	return validID(ref.RunID) == nil && ref.ObservationID != ""
}

func validParticipantReference(ref ParticipantReference) bool {
	return validID(ref.RunID) == nil && ref.ParticipantID != ""
}

func terminalInterval(o Observation) bool { return o.StartedAt != nil && o.FinishedAt != nil }
func pointObservation(o Observation) bool { return o.StartedAt == nil && o.FinishedAt == nil }
func oneOf[T comparable](value T, values ...T) bool {
	for _, candidate := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

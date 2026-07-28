package vaultregistry

import "encoding/json"

func marshalUnknown(value any, unknown map[string]json.RawMessage) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var known map[string]json.RawMessage
	if err := json.Unmarshal(data, &known); err != nil {
		return nil, err
	}
	return marshalObject(unknown, mapFromRaw(known))
}

func mapFromRaw(fields map[string]json.RawMessage) map[string]any {
	known := make(map[string]any, len(fields))
	for key, value := range fields {
		known[key] = value
	}
	return known
}

func decodeUnknown(data []byte, value any, keys ...string) (map[string]json.RawMessage, error) {
	if err := json.Unmarshal(data, value); err != nil {
		return nil, err
	}
	return unknownFields(data, keys...)
}

func (v Identity) MarshalJSON() ([]byte, error) {
	type plain Identity
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *Identity) UnmarshalJSON(data []byte) error {
	type plain Identity
	var p plain
	u, err := decodeUnknown(data, &p, "kind", "id", "agent_session")
	*v = Identity(p)
	v.Unknown = u
	return err
}

func (v SemanticValue) MarshalJSON() ([]byte, error) {
	type plain SemanticValue
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *SemanticValue) UnmarshalJSON(data []byte) error {
	type plain SemanticValue
	var p plain
	u, err := decodeUnknown(data, &p, "string", "integer", "boolean", "decimal")
	*v = SemanticValue(p)
	v.Unknown = u
	return err
}

func (v SemanticDetail) MarshalJSON() ([]byte, error) {
	type plain SemanticDetail
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *SemanticDetail) UnmarshalJSON(data []byte) error {
	type plain SemanticDetail
	var p plain
	u, err := decodeUnknown(data, &p, "key", "role", "value")
	*v = SemanticDetail(p)
	v.Unknown = u
	return err
}

func (v ObservationReference) MarshalJSON() ([]byte, error) {
	type plain ObservationReference
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *ObservationReference) UnmarshalJSON(data []byte) error {
	type plain ObservationReference
	var p plain
	u, err := decodeUnknown(data, &p, "run_id", "observation_id")
	*v = ObservationReference(p)
	v.Unknown = u
	return err
}

func (v ParticipantReference) MarshalJSON() ([]byte, error) {
	type plain ParticipantReference
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *ParticipantReference) UnmarshalJSON(data []byte) error {
	type plain ParticipantReference
	var p plain
	u, err := decodeUnknown(data, &p, "run_id", "participant_id")
	*v = ParticipantReference(p)
	v.Unknown = u
	return err
}

func (v ManifestMetadata) MarshalJSON() ([]byte, error) {
	type plain ManifestMetadata
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *ManifestMetadata) UnmarshalJSON(data []byte) error {
	type plain ManifestMetadata
	var p plain
	u, err := decodeUnknown(data, &p, "path", "sha256", "media_type", "authenticated")
	*v = ManifestMetadata(p)
	v.Unknown = u
	return err
}

func (v Diagnostic) MarshalJSON() ([]byte, error) {
	type plain Diagnostic
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *Diagnostic) UnmarshalJSON(data []byte) error {
	type plain Diagnostic
	var p plain
	u, err := decodeUnknown(data, &p, "key", "expected", "actual", "summary")
	*v = Diagnostic(p)
	v.Unknown = u
	return err
}

func (v InterruptionReason) MarshalJSON() ([]byte, error) {
	type plain InterruptionReason
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *InterruptionReason) UnmarshalJSON(data []byte) error {
	type plain InterruptionReason
	var p plain
	u, err := decodeUnknown(data, &p, "kind", "detail", "observed_signal")
	*v = InterruptionReason(p)
	v.Unknown = u
	return err
}

func (v VerifierAttemptIdentity) MarshalJSON() ([]byte, error) {
	type plain VerifierAttemptIdentity
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *VerifierAttemptIdentity) UnmarshalJSON(data []byte) error {
	type plain VerifierAttemptIdentity
	var p plain
	u, err := decodeUnknown(data, &p, "attempt_id", "verifier_id", "specification_sha256", "phase", "invocation_id", "command", "working_directory", "environment_contract_sha256", "implementation_commit", "implementation_tree", "producer")
	*v = VerifierAttemptIdentity(p)
	v.Unknown = u
	return err
}

func (v VerifierAttemptPayload) MarshalJSON() ([]byte, error) {
	type plain VerifierAttemptPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *VerifierAttemptPayload) UnmarshalJSON(data []byte) error {
	type plain VerifierAttemptPayload
	var p plain
	u, err := decodeUnknown(data, &p, "identity", "exit_status", "result_manifest", "partial_result_manifest", "diagnostics", "interruption")
	*v = VerifierAttemptPayload(p)
	v.Unknown = u
	return err
}

func (v VerifierAttemptGapPayload) MarshalJSON() ([]byte, error) {
	type plain VerifierAttemptGapPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *VerifierAttemptGapPayload) UnmarshalJSON(data []byte) error {
	type plain VerifierAttemptGapPayload
	var p plain
	u, err := decodeUnknown(data, &p, "identity", "reason", "missing_fields")
	*v = VerifierAttemptGapPayload(p)
	v.Unknown = u
	return err
}

func (v VerifierAttemptRelationPayload) MarshalJSON() ([]byte, error) {
	type plain VerifierAttemptRelationPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *VerifierAttemptRelationPayload) UnmarshalJSON(data []byte) error {
	type plain VerifierAttemptRelationPayload
	var p plain
	u, err := decodeUnknown(data, &p, "from_attempt_id", "to_attempt_id")
	*v = VerifierAttemptRelationPayload(p)
	v.Unknown = u
	return err
}

func (v VerifierDecisionPayload) MarshalJSON() ([]byte, error) {
	type plain VerifierDecisionPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *VerifierDecisionPayload) UnmarshalJSON(data []byte) error {
	type plain VerifierDecisionPayload
	var p plain
	u, err := decodeUnknown(data, &p, "attempt_id", "auditor_verdict")
	*v = VerifierDecisionPayload(p)
	v.Unknown = u
	return err
}

func (v RegisteredParticipantPayload) MarshalJSON() ([]byte, error) {
	type plain RegisteredParticipantPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *RegisteredParticipantPayload) UnmarshalJSON(data []byte) error {
	type plain RegisteredParticipantPayload
	var p plain
	u, err := decodeUnknown(data, &p, "participant_id", "role", "agent_session", "herdr", "terminal_result")
	*v = RegisteredParticipantPayload(p)
	v.Unknown = u
	return err
}

func (v WorkerPayload) MarshalJSON() ([]byte, error) {
	type plain WorkerPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *WorkerPayload) UnmarshalJSON(data []byte) error {
	type plain WorkerPayload
	var p plain
	u, err := decodeUnknown(data, &p, "worker_id", "role", "stage", "owner_participant_id", "agent_session", "herdr", "task_sha256", "result_sha256", "terminal_result")
	*v = WorkerPayload(p)
	v.Unknown = u
	return err
}

func (v UsageCounters) MarshalJSON() ([]byte, error) {
	type plain UsageCounters
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *UsageCounters) UnmarshalJSON(data []byte) error {
	type plain UsageCounters
	var p plain
	u, err := decodeUnknown(data, &p, "scope", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "provider_reported_total", "requests", "turns", "tool_count")
	*v = UsageCounters(p)
	v.Unknown = u
	return err
}

func (v Cost) MarshalJSON() ([]byte, error) {
	type plain Cost
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *Cost) UnmarshalJSON(data []byte) error {
	type plain Cost
	var p plain
	u, err := decodeUnknown(data, &p, "amount", "currency", "basis")
	*v = Cost(p)
	v.Unknown = u
	return err
}

func (v RuntimeTelemetryPayload) MarshalJSON() ([]byte, error) {
	type plain RuntimeTelemetryPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *RuntimeTelemetryPayload) UnmarshalJSON(data []byte) error {
	type plain RuntimeTelemetryPayload
	var p plain
	u, err := decodeUnknown(data, &p, "participant_id", "worker_id", "boundary", "provider", "model", "usage", "cost")
	*v = RuntimeTelemetryPayload(p)
	v.Unknown = u
	return err
}

func (v AuditorVerdictPayload) MarshalJSON() ([]byte, error) {
	type plain AuditorVerdictPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *AuditorVerdictPayload) UnmarshalJSON(data []byte) error {
	type plain AuditorVerdictPayload
	var p plain
	u, err := decodeUnknown(data, &p, "subject_attempt", "terminal_trace", "auditor", "classification", "rationale")
	*v = AuditorVerdictPayload(p)
	v.Unknown = u
	return err
}

func (v ObservationPayload) MarshalJSON() ([]byte, error) {
	type plain ObservationPayload
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *ObservationPayload) UnmarshalJSON(data []byte) error {
	type plain ObservationPayload
	var p plain
	u, err := decodeUnknown(data, &p, "verifier_attempt", "verifier_attempt_gap", "verifier_attempt_relation", "verifier_decision", "registered_participant", "worker", "runtime_telemetry", "auditor_verdict")
	*v = ObservationPayload(p)
	v.Unknown = u
	return err
}

func (v Observation) MarshalJSON() ([]byte, error) {
	type plain Observation
	return marshalUnknown(plain(v), v.Unknown)
}
func (v *Observation) UnmarshalJSON(data []byte) error {
	type plain Observation
	var p plain
	u, err := decodeUnknown(data, &p, "observation_id", "kind", "state", "goal_id", "title", "summary", "observed_at", "correlation_id", "actor", "source", "redaction_class", "parent_observation_id", "started_at", "finished_at", "details", "payload")
	*v = Observation(p)
	v.Unknown = u
	return err
}

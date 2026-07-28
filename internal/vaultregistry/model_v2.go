package vaultregistry

import (
	"encoding/json"
	"time"
)

type ObservationKind string
type ObservationState string
type VerifierPhase string
type InterruptionKind string
type UsageScope string
type CostBasis string
type AuditorClassification string

const (
	KindVerifierAttempt         ObservationKind = "verifier_attempt"
	KindVerifierAttemptGap      ObservationKind = "verifier_attempt_gap"
	KindVerifierAttemptRelation ObservationKind = "verifier_attempt_relation"
	KindVerifierDecision        ObservationKind = "verifier_decision"
	KindRegisteredParticipant   ObservationKind = "registered_participant"
	KindWorker                  ObservationKind = "worker"
	KindRuntimeTelemetry        ObservationKind = "runtime_telemetry"
	KindAuditorVerdict          ObservationKind = "auditor_verdict"
)

const (
	StateActive         ObservationState = "active"
	StatePassed         ObservationState = "passed"
	StateFailed         ObservationState = "failed"
	StateInterrupted    ObservationState = "interrupted"
	StateIncomplete     ObservationState = "incomplete"
	StateRetried        ObservationState = "retried"
	StateAccepted       ObservationState = "accepted"
	StateRejected       ObservationState = "rejected"
	StateSuperseded     ObservationState = "superseded"
	StateSucceeded      ObservationState = "succeeded"
	StateRecorded       ObservationState = "recorded"
	StateSupports       ObservationState = "supports"
	StateDoesNotSupport ObservationState = "does_not_support"
	StateInconclusive   ObservationState = "inconclusive"
	StateError          ObservationState = "error"
)

const (
	PhaseBaseline      VerifierPhase = "baseline"
	PhaseAffected      VerifierPhase = "affected"
	PhaseCompleteSuite VerifierPhase = "complete_suite"
	PhaseFinal         VerifierPhase = "final"
	PhasePostMerge     VerifierPhase = "post_merge"
)

const (
	InterruptionTimeout      InterruptionKind = "timeout"
	InterruptionSignal       InterruptionKind = "signal"
	InterruptionCancellation InterruptionKind = "cancellation"
	InterruptionRunnerLoss   InterruptionKind = "runner_loss"
	InterruptionShutdown     InterruptionKind = "shutdown"
)

const (
	UsageDelta      UsageScope = "delta"
	UsageCumulative UsageScope = "cumulative"
	CostReported    CostBasis  = "reported"
	CostEstimated   CostBasis  = "estimated"
)

const (
	ClassificationNone                 AuditorClassification = "none"
	ClassificationEvidenceDeficiency   AuditorClassification = "evidence_deficiency"
	ClassificationVerifierFailure      AuditorClassification = "verifier_failure"
	ClassificationImplementationDefect AuditorClassification = "implementation_defect"
	ClassificationAuditError           AuditorClassification = "audit_error"
)

// Identity identifies an actor or source without assigning it workflow authority.
type Identity struct {
	Kind         string                     `json:"kind"`
	ID           string                     `json:"id"`
	AgentSession *AgentSession              `json:"agent_session,omitempty"`
	Unknown      map[string]json.RawMessage `json:"-"`
}

// SemanticValue is a one-of typed value used by SemanticDetail.
type SemanticValue struct {
	String  *string                    `json:"string,omitempty"`
	Integer *int64                     `json:"integer,omitempty"`
	Boolean *bool                      `json:"boolean,omitempty"`
	Decimal *string                    `json:"decimal,omitempty"`
	Unknown map[string]json.RawMessage `json:"-"`
}

type SemanticDetail struct {
	Key     string                     `json:"key"`
	Role    string                     `json:"role"`
	Value   SemanticValue              `json:"value"`
	Unknown map[string]json.RawMessage `json:"-"`
}

type ObservationReference struct {
	RunID         string                     `json:"run_id"`
	ObservationID string                     `json:"observation_id"`
	Unknown       map[string]json.RawMessage `json:"-"`
}

type ParticipantReference struct {
	RunID         string                     `json:"run_id"`
	ParticipantID string                     `json:"participant_id"`
	Unknown       map[string]json.RawMessage `json:"-"`
}

type ManifestMetadata struct {
	Path          string                     `json:"path"`
	SHA256        string                     `json:"sha256"`
	MediaType     string                     `json:"media_type"`
	Authenticated bool                       `json:"authenticated"`
	Unknown       map[string]json.RawMessage `json:"-"`
}

type Diagnostic struct {
	Key      string                     `json:"key,omitempty"`
	Expected string                     `json:"expected"`
	Actual   string                     `json:"actual"`
	Summary  string                     `json:"summary,omitempty"`
	Unknown  map[string]json.RawMessage `json:"-"`
}

type InterruptionReason struct {
	Kind           InterruptionKind           `json:"kind"`
	Detail         string                     `json:"detail"`
	ObservedSignal *string                    `json:"observed_signal,omitempty"`
	Unknown        map[string]json.RawMessage `json:"-"`
}

// VerifierAttemptIdentity is immutable for an attempt ID within a Run.
type VerifierAttemptIdentity struct {
	AttemptID                 string                     `json:"attempt_id"`
	VerifierID                string                     `json:"verifier_id"`
	SpecificationSHA256       string                     `json:"specification_sha256"`
	Phase                     VerifierPhase              `json:"phase"`
	InvocationID              string                     `json:"invocation_id"`
	Command                   string                     `json:"command"`
	WorkingDirectory          string                     `json:"working_directory"`
	EnvironmentContractSHA256 string                     `json:"environment_contract_sha256"`
	ImplementationCommit      string                     `json:"implementation_commit"`
	ImplementationTree        string                     `json:"implementation_tree"`
	Producer                  Identity                   `json:"producer"`
	Unknown                   map[string]json.RawMessage `json:"-"`
}

type VerifierAttemptPayload struct {
	Identity              VerifierAttemptIdentity    `json:"identity"`
	ExitStatus            *int                       `json:"exit_status,omitempty"`
	ResultManifest        *ManifestMetadata          `json:"result_manifest,omitempty"`
	PartialResultManifest *ManifestMetadata          `json:"partial_result_manifest,omitempty"`
	Diagnostics           []Diagnostic               `json:"diagnostics,omitempty"`
	Interruption          *InterruptionReason        `json:"interruption,omitempty"`
	Unknown               map[string]json.RawMessage `json:"-"`
}

type VerifierAttemptGapPayload struct {
	Identity      VerifierAttemptIdentity    `json:"identity"`
	Reason        string                     `json:"reason"`
	MissingFields []string                   `json:"missing_fields"`
	Unknown       map[string]json.RawMessage `json:"-"`
}

type VerifierAttemptRelationPayload struct {
	FromAttemptID string                     `json:"from_attempt_id"`
	ToAttemptID   string                     `json:"to_attempt_id"`
	Unknown       map[string]json.RawMessage `json:"-"`
}

type VerifierDecisionPayload struct {
	AttemptID      string                     `json:"attempt_id"`
	AuditorVerdict *ObservationReference      `json:"auditor_verdict,omitempty"`
	Unknown        map[string]json.RawMessage `json:"-"`
}

type RegisteredParticipantPayload struct {
	ParticipantID  string                     `json:"participant_id"`
	Role           string                     `json:"role"`
	AgentSession   AgentSession               `json:"agent_session"`
	Herdr          *HerdrIdentity             `json:"herdr,omitempty"`
	TerminalResult *string                    `json:"terminal_result,omitempty"`
	Unknown        map[string]json.RawMessage `json:"-"`
}

type WorkerPayload struct {
	WorkerID           string                     `json:"worker_id"`
	Role               string                     `json:"role"`
	Stage              string                     `json:"stage"`
	OwnerParticipantID string                     `json:"owner_participant_id"`
	AgentSession       AgentSession               `json:"agent_session"`
	Herdr              *HerdrIdentity             `json:"herdr,omitempty"`
	TaskSHA256         *string                    `json:"task_sha256,omitempty"`
	ResultSHA256       *string                    `json:"result_sha256,omitempty"`
	TerminalResult     *string                    `json:"terminal_result,omitempty"`
	Unknown            map[string]json.RawMessage `json:"-"`
}

type UsageCounters struct {
	Scope                 UsageScope                 `json:"scope"`
	InputTokens           *int64                     `json:"input_tokens,omitempty"`
	OutputTokens          *int64                     `json:"output_tokens,omitempty"`
	CacheReadTokens       *int64                     `json:"cache_read_tokens,omitempty"`
	CacheWriteTokens      *int64                     `json:"cache_write_tokens,omitempty"`
	ProviderReportedTotal *int64                     `json:"provider_reported_total,omitempty"`
	Requests              *int64                     `json:"requests,omitempty"`
	Turns                 *int64                     `json:"turns,omitempty"`
	ToolCount             *int64                     `json:"tool_count,omitempty"`
	Unknown               map[string]json.RawMessage `json:"-"`
}

type Cost struct {
	Amount   string                     `json:"amount"`
	Currency string                     `json:"currency"`
	Basis    CostBasis                  `json:"basis"`
	Unknown  map[string]json.RawMessage `json:"-"`
}

type RuntimeTelemetryPayload struct {
	ParticipantID string                     `json:"participant_id"`
	WorkerID      string                     `json:"worker_id"`
	Boundary      string                     `json:"boundary"`
	Provider      *string                    `json:"provider,omitempty"`
	Model         *string                    `json:"model,omitempty"`
	Usage         *UsageCounters             `json:"usage,omitempty"`
	Cost          *Cost                      `json:"cost,omitempty"`
	Unknown       map[string]json.RawMessage `json:"-"`
}

type AuditorVerdictPayload struct {
	SubjectAttempt ObservationReference       `json:"subject_attempt"`
	TerminalTrace  ObservationReference       `json:"terminal_trace"`
	Auditor        ParticipantReference       `json:"auditor"`
	Classification AuditorClassification      `json:"classification"`
	Rationale      string                     `json:"rationale"`
	Unknown        map[string]json.RawMessage `json:"-"`
}

// ObservationPayload is a one-of payload. Unknown preserves payload members
// introduced by later schema-2 readers.
type ObservationPayload struct {
	VerifierAttempt         *VerifierAttemptPayload         `json:"verifier_attempt,omitempty"`
	VerifierAttemptGap      *VerifierAttemptGapPayload      `json:"verifier_attempt_gap,omitempty"`
	VerifierAttemptRelation *VerifierAttemptRelationPayload `json:"verifier_attempt_relation,omitempty"`
	VerifierDecision        *VerifierDecisionPayload        `json:"verifier_decision,omitempty"`
	RegisteredParticipant   *RegisteredParticipantPayload   `json:"registered_participant,omitempty"`
	Worker                  *WorkerPayload                  `json:"worker,omitempty"`
	RuntimeTelemetry        *RuntimeTelemetryPayload        `json:"runtime_telemetry,omitempty"`
	AuditorVerdict          *AuditorVerdictPayload          `json:"auditor_verdict,omitempty"`
	Unknown                 map[string]json.RawMessage      `json:"-"`
}

// Observation is the common schema-version-2 observation envelope.
type Observation struct {
	ObservationID       string                     `json:"observation_id"`
	Kind                ObservationKind            `json:"kind"`
	State               ObservationState           `json:"state"`
	GoalID              string                     `json:"goal_id"`
	Title               string                     `json:"title"`
	Summary             string                     `json:"summary"`
	ObservedAt          string                     `json:"observed_at"`
	CorrelationID       string                     `json:"correlation_id"`
	Actor               Identity                   `json:"actor"`
	Source              Identity                   `json:"source"`
	RedactionClass      string                     `json:"redaction_class"`
	ParentObservationID *string                    `json:"parent_observation_id,omitempty"`
	StartedAt           *string                    `json:"started_at,omitempty"`
	FinishedAt          *string                    `json:"finished_at,omitempty"`
	Details             []SemanticDetail           `json:"details,omitempty"`
	Payload             ObservationPayload         `json:"payload"`
	Unknown             map[string]json.RawMessage `json:"-"`
}

// Duration derives an interval duration. Point and incomplete intervals have
// no duration; duration is never persisted.
func (o Observation) Duration() (time.Duration, bool) {
	if o.StartedAt == nil || o.FinishedAt == nil {
		return 0, false
	}
	started, err := time.Parse(time.RFC3339, *o.StartedAt)
	if err != nil {
		return 0, false
	}
	finished, err := time.Parse(time.RFC3339, *o.FinishedAt)
	if err != nil || finished.Before(started) {
		return 0, false
	}
	return finished.Sub(started), true
}

package vaultregistry_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const (
	v2Start  = "2026-07-28T01:00:00Z"
	v2Finish = "2026-07-28T01:01:30Z"
)

func strptr(value string) *string { return &value }
func intptr(value int) *int       { return &value }
func i64ptr(value int64) *int64   { return &value }

func v2Run(id string, observations ...vaultregistry.Observation) vaultregistry.Run {
	return vaultregistry.Run{
		SchemaVersion: 2,
		RunID:         id,
		InvokedAt:     "2026-07-28T00:00:00Z",
		UpdatedAt:     "2026-07-28T02:00:00Z",
		Task: vaultregistry.Task{
			ID: "T19", Title: "Structured observations", Path: "tasks/19.md",
			FeaturePath: "features/vault-hunter-atlas.md", Kind: "task",
		},
		Observations: observations,
	}
}

func envelope(id string, kind vaultregistry.ObservationKind, state vaultregistry.ObservationState) vaultregistry.Observation {
	return vaultregistry.Observation{
		ObservationID: id, Kind: kind, State: state, GoalID: "G01",
		Title: "Contract observation", Summary: "A concise structured observation.",
		ObservedAt: "2026-07-28T01:01:30Z", CorrelationID: "corr-1",
		Actor:          vaultregistry.Identity{Kind: "participant", ID: "parent"},
		Source:         vaultregistry.Identity{Kind: "producer", ID: "registry-test"},
		RedactionClass: "internal",
	}
}

func attemptIdentity(id string) vaultregistry.VerifierAttemptIdentity {
	return vaultregistry.VerifierAttemptIdentity{
		AttemptID: id, VerifierID: "T19.V01", SpecificationSHA256: strings.Repeat("a", 64),
		Phase: vaultregistry.PhaseAffected, InvocationID: "invocation-" + id,
		Command: "scripts/verify-vault-hunter-atlas T19.V01", WorkingDirectory: "/worktree",
		EnvironmentContractSHA256: strings.Repeat("b", 64), ImplementationCommit: strings.Repeat("1", 40),
		ImplementationTree: strings.Repeat("2", 40), Producer: vaultregistry.Identity{Kind: "participant", ID: "writer"},
	}
}

func manifest() *vaultregistry.ManifestMetadata {
	return &vaultregistry.ManifestMetadata{
		Path: "evidence/manifest.json", SHA256: strings.Repeat("c", 64),
		MediaType: "application/json", Authenticated: true,
	}
}

func attempt(id string, state vaultregistry.ObservationState, attemptID string) vaultregistry.Observation {
	o := envelope(id, vaultregistry.KindVerifierAttempt, state)
	o.StartedAt = strptr(v2Start)
	payload := &vaultregistry.VerifierAttemptPayload{Identity: attemptIdentity(attemptID)}
	switch state {
	case vaultregistry.StatePassed:
		o.FinishedAt, payload.ExitStatus, payload.ResultManifest = strptr(v2Finish), intptr(0), manifest()
	case vaultregistry.StateFailed:
		o.FinishedAt, payload.ExitStatus, payload.ResultManifest = strptr(v2Finish), intptr(1), manifest()
		payload.Diagnostics = []vaultregistry.Diagnostic{{Key: "output", Expected: "green", Actual: "red"}}
	case vaultregistry.StateInterrupted:
		o.FinishedAt, payload.PartialResultManifest = strptr(v2Finish), manifest()
		payload.Interruption = &vaultregistry.InterruptionReason{Kind: vaultregistry.InterruptionTimeout, Detail: "deadline elapsed"}
	}
	o.Payload.VerifierAttempt = payload
	return o
}

func gap(id, attemptID string) vaultregistry.Observation {
	o := envelope(id, vaultregistry.KindVerifierAttemptGap, vaultregistry.StateIncomplete)
	o.Payload.VerifierAttemptGap = &vaultregistry.VerifierAttemptGapPayload{
		Identity: attemptIdentity(attemptID), Reason: "runner disappeared",
		MissingFields: []string{"finished_at", "result_manifest"},
	}
	return o
}

func participant(id string, state vaultregistry.ObservationState, participantID string) vaultregistry.Observation {
	o := envelope(id, vaultregistry.KindRegisteredParticipant, state)
	o.StartedAt = strptr(v2Start)
	payload := &vaultregistry.RegisteredParticipantPayload{
		ParticipantID: participantID, Role: "writer",
		AgentSession: vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: "session-1"},
	}
	if state != vaultregistry.StateActive {
		o.FinishedAt, payload.TerminalResult = strptr(v2Finish), strptr("completed")
	}
	o.Payload.RegisteredParticipant = payload
	return o
}

func worker(id string, state vaultregistry.ObservationState, workerID string) vaultregistry.Observation {
	o := envelope(id, vaultregistry.KindWorker, state)
	o.StartedAt = strptr(v2Start)
	payload := &vaultregistry.WorkerPayload{
		WorkerID: workerID, Role: "implementation", Stage: "write", OwnerParticipantID: "parent",
		AgentSession: vaultregistry.AgentSession{Source: "codex", Kind: "session", Value: "worker-session"},
		Herdr:        &vaultregistry.HerdrIdentity{WorkspaceID: "ws", TabID: "tab", PaneID: "pane", TerminalID: "term"},
		TaskSHA256:   strptr(strings.Repeat("d", 64)),
	}
	if state != vaultregistry.StateActive {
		o.FinishedAt, payload.TerminalResult = strptr(v2Finish), strptr("completed")
		payload.ResultSHA256 = strptr(strings.Repeat("e", 64))
	}
	o.Payload.Worker = payload
	return o
}

func telemetry() vaultregistry.Observation {
	o := envelope("telemetry", vaultregistry.KindRuntimeTelemetry, vaultregistry.StateRecorded)
	provider, model := "openai", "gpt"
	o.Payload.RuntimeTelemetry = &vaultregistry.RuntimeTelemetryPayload{
		ParticipantID: "parent", WorkerID: "worker-1", Boundary: "worker_terminal",
		Provider: &provider, Model: &model,
		Usage: &vaultregistry.UsageCounters{Scope: vaultregistry.UsageDelta, InputTokens: i64ptr(10), ProviderReportedTotal: i64ptr(12), Requests: i64ptr(1)},
		Cost:  &vaultregistry.Cost{Amount: "0.0123", Currency: "USD", Basis: vaultregistry.CostReported},
	}
	return o
}

func auditor(runID string, state vaultregistry.ObservationState, classification vaultregistry.AuditorClassification) vaultregistry.Observation {
	o := envelope("auditor-"+string(state), vaultregistry.KindAuditorVerdict, state)
	o.StartedAt, o.FinishedAt = strptr(v2Start), strptr(v2Finish)
	o.Payload.AuditorVerdict = &vaultregistry.AuditorVerdictPayload{
		SubjectAttempt: vaultregistry.ObservationReference{RunID: "subject-run", ObservationID: "attempt-terminal"},
		TerminalTrace:  vaultregistry.ObservationReference{RunID: runID, ObservationID: "auditor-trace"},
		Auditor:        vaultregistry.ParticipantReference{RunID: runID, ParticipantID: "auditor"},
		Classification: classification, Rationale: "The authenticated evidence supports this bounded verdict.",
	}
	return o
}

func createV2(t *testing.T, run vaultregistry.Run) (string, vaultregistry.Run, error) {
	t.Helper()
	root := t.TempDir()
	producer := mustProducer(t, root)
	created, err := producer.Create(run)
	return root, created, err
}

func TestT19V01KnownStateMatrix(t *testing.T) {
	cases := []struct {
		name string
		run  func(string) vaultregistry.Run
	}{
		{"attempt active", func(id string) vaultregistry.Run {
			return v2Run(id, attempt("active", vaultregistry.StateActive, "a1"))
		}},
		{"attempt passed", func(id string) vaultregistry.Run {
			return v2Run(id, attempt("passed", vaultregistry.StatePassed, "a1"))
		}},
		{"attempt failed", func(id string) vaultregistry.Run {
			return v2Run(id, attempt("failed", vaultregistry.StateFailed, "a1"))
		}},
		{"attempt interrupted", func(id string) vaultregistry.Run {
			return v2Run(id, attempt("interrupted", vaultregistry.StateInterrupted, "a1"))
		}},
		{"attempt gap", func(id string) vaultregistry.Run { return v2Run(id, gap("gap", "a1")) }},
		{"retry", retryRun},
		{"decision accepted", func(id string) vaultregistry.Run { return decisionRun(id, vaultregistry.StateAccepted) }},
		{"decision rejected", func(id string) vaultregistry.Run { return decisionRun(id, vaultregistry.StateRejected) }},
		{"decision superseded", func(id string) vaultregistry.Run { return decisionRun(id, vaultregistry.StateSuperseded) }},
		{"participant active headless", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateActive, "parent"))
		}},
		{"participant succeeded", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateSucceeded, "parent"))
		}},
		{"participant failed", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateFailed, "parent"))
		}},
		{"participant interrupted", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateInterrupted, "parent"))
		}},
		{"worker active", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateActive, "parent"), worker("worker", vaultregistry.StateActive, "worker-1"))
		}},
		{"worker succeeded", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateActive, "parent"), worker("worker", vaultregistry.StateSucceeded, "worker-1"))
		}},
		{"worker failed", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateActive, "parent"), worker("worker", vaultregistry.StateFailed, "worker-1"))
		}},
		{"worker interrupted", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateActive, "parent"), worker("worker", vaultregistry.StateInterrupted, "worker-1"))
		}},
		{"runtime telemetry", func(id string) vaultregistry.Run {
			return v2Run(id, participant("participant", vaultregistry.StateActive, "parent"), worker("worker", vaultregistry.StateActive, "worker-1"), telemetry())
		}},
		{"auditor supports", func(id string) vaultregistry.Run {
			return v2Run(id, auditor(id, vaultregistry.StateSupports, vaultregistry.ClassificationNone))
		}},
		{"auditor does not support", func(id string) vaultregistry.Run {
			return v2Run(id, auditor(id, vaultregistry.StateDoesNotSupport, vaultregistry.ClassificationImplementationDefect))
		}},
		{"auditor inconclusive", func(id string) vaultregistry.Run {
			return v2Run(id, auditor(id, vaultregistry.StateInconclusive, vaultregistry.ClassificationEvidenceDeficiency))
		}},
		{"auditor error", func(id string) vaultregistry.Run {
			return v2Run(id, auditor(id, vaultregistry.StateError, vaultregistry.ClassificationAuditError))
		}},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id := "positive-" + strings.ReplaceAll(strings.ReplaceAll(tc.name, " ", "-"), "_", "-")
			root, created, err := createV2(t, tc.run(id))
			if err != nil {
				t.Fatal(err)
			}
			if created.Revision != 1 || len(created.Observations) == 0 {
				t.Fatalf("case %d did not round-trip: %#v", i, created)
			}
			read, err := mustReader(t, root).Get(id)
			if err != nil || !equalRunJSON(created, read) {
				t.Fatalf("round trip failed: %v\ncreated=%#v\nread=%#v", err, created, read)
			}
		})
	}
}

func retryRun(id string) vaultregistry.Run {
	from := attempt("from", vaultregistry.StateFailed, "a1")
	to := attempt("to", vaultregistry.StateActive, "a2")
	to.StartedAt = strptr("2026-07-28T01:02:00Z")
	relation := envelope("retry", vaultregistry.KindVerifierAttemptRelation, vaultregistry.StateRetried)
	relation.Payload.VerifierAttemptRelation = &vaultregistry.VerifierAttemptRelationPayload{FromAttemptID: "a1", ToAttemptID: "a2"}
	return v2Run(id, from, to, relation)
}

func decisionRun(id string, state vaultregistry.ObservationState) vaultregistry.Run {
	decision := envelope("decision-"+string(state), vaultregistry.KindVerifierDecision, state)
	decision.Payload.VerifierDecision = &vaultregistry.VerifierDecisionPayload{AttemptID: "a1"}
	return v2Run(id, attempt("attempt", vaultregistry.StatePassed, "a1"), decision)
}

func equalRunJSON(a, b vaultregistry.Run) bool {
	aa, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return bytes.Equal(aa, bb)
}

func TestT19V01RejectsCommonEnvelopeAndStateMatricesWithoutWrites(t *testing.T) {
	common := []struct {
		name   string
		mutate func(*vaultregistry.Observation)
	}{
		{"observation id", func(o *vaultregistry.Observation) { o.ObservationID = "" }},
		{"kind", func(o *vaultregistry.Observation) { o.Kind = "" }},
		{"state", func(o *vaultregistry.Observation) { o.State = "" }},
		{"goal id", func(o *vaultregistry.Observation) { o.GoalID = "" }},
		{"title", func(o *vaultregistry.Observation) { o.Title = "" }},
		{"summary", func(o *vaultregistry.Observation) { o.Summary = "" }},
		{"observed at", func(o *vaultregistry.Observation) { o.ObservedAt = "not-a-time" }},
		{"correlation id", func(o *vaultregistry.Observation) { o.CorrelationID = "" }},
		{"actor", func(o *vaultregistry.Observation) { o.Actor.ID = "" }},
		{"source", func(o *vaultregistry.Observation) { o.Source.Kind = "" }},
		{"redaction class", func(o *vaultregistry.Observation) { o.RedactionClass = "" }},
		{"empty parent", func(o *vaultregistry.Observation) { o.ParentObservationID = strptr("") }},
		{"reverse interval", func(o *vaultregistry.Observation) { o.FinishedAt = strptr("2026-07-28T00:59:00Z") }},
		{"renderer detail role", func(o *vaultregistry.Observation) {
			value := "red"
			o.Details = []vaultregistry.SemanticDetail{{Key: "result", Role: "css_color", Value: vaultregistry.SemanticValue{String: &value}}}
		}},
		{"untyped detail", func(o *vaultregistry.Observation) {
			o.Details = []vaultregistry.SemanticDetail{{Key: "result", Role: "diagnostic"}}
		}},
	}
	for _, tc := range common {
		t.Run("common/"+tc.name, func(t *testing.T) {
			o := attempt("attempt", vaultregistry.StatePassed, "a1")
			tc.mutate(&o)
			assertRejectedCreateNoWrite(t, v2Run("bad-common", o), vaultregistry.ErrMalformed)
		})
	}

	matrix := []struct {
		name string
		run  func() vaultregistry.Run
		want error
	}{
		{"active finished", func() vaultregistry.Run {
			o := attempt("a", vaultregistry.StateActive, "a1")
			o.FinishedAt = strptr(v2Finish)
			return v2Run("bad-active", o)
		}, vaultregistry.ErrMalformed},
		{"passed nonzero", func() vaultregistry.Run {
			o := attempt("a", vaultregistry.StatePassed, "a1")
			o.Payload.VerifierAttempt.ExitStatus = intptr(2)
			return v2Run("bad-passed", o)
		}, vaultregistry.ErrMalformed},
		{"failed no diagnostics", func() vaultregistry.Run {
			o := attempt("a", vaultregistry.StateFailed, "a1")
			o.Payload.VerifierAttempt.Diagnostics = nil
			return v2Run("bad-failed", o)
		}, vaultregistry.ErrMalformed},
		{"interrupted invented manifest", func() vaultregistry.Run {
			o := attempt("a", vaultregistry.StateInterrupted, "a1")
			o.Payload.VerifierAttempt.ResultManifest = manifest()
			return v2Run("bad-interrupted", o)
		}, vaultregistry.ErrMalformed},
		{"gap interval", func() vaultregistry.Run {
			o := gap("gap", "a1")
			o.StartedAt = strptr(v2Start)
			return v2Run("bad-gap", o)
		}, vaultregistry.ErrMalformed},
		{"retry active source", func() vaultregistry.Run {
			run := retryRun("bad-retry")
			run.Observations[0] = attempt("from", vaultregistry.StateActive, "a1")
			return run
		}, vaultregistry.ErrMalformed},
		{"retry recovered passed gap", func() vaultregistry.Run {
			to := attempt("to", vaultregistry.StateActive, "a2")
			to.StartedAt = strptr("2026-07-28T01:02:00Z")
			relation := envelope("retry", vaultregistry.KindVerifierAttemptRelation, vaultregistry.StateRetried)
			relation.Payload.VerifierAttemptRelation = &vaultregistry.VerifierAttemptRelationPayload{FromAttemptID: "a1", ToAttemptID: "a2"}
			return v2Run("bad-recovered-retry", gap("gap", "a1"), attempt("recovered", vaultregistry.StatePassed, "a1"), to, relation)
		}, vaultregistry.ErrMalformed},
		{"accepted incomplete", func() vaultregistry.Run {
			d := envelope("decision", vaultregistry.KindVerifierDecision, vaultregistry.StateAccepted)
			d.Payload.VerifierDecision = &vaultregistry.VerifierDecisionPayload{AttemptID: "a1"}
			return v2Run("bad-decision", gap("gap", "a1"), d)
		}, vaultregistry.ErrMalformed},
		{"participant partial herdr", func() vaultregistry.Run {
			o := participant("p", vaultregistry.StateActive, "parent")
			o.Payload.RegisteredParticipant.Herdr = &vaultregistry.HerdrIdentity{WorkspaceID: "ws"}
			return v2Run("bad-participant", o)
		}, vaultregistry.ErrMalformed},
		{"worker missing owner", func() vaultregistry.Run {
			return v2Run("bad-worker", worker("w", vaultregistry.StateActive, "worker-1"))
		}, vaultregistry.ErrMalformed},
		{"telemetry negative", func() vaultregistry.Run {
			o := telemetry()
			o.Payload.RuntimeTelemetry.Usage.InputTokens = i64ptr(-1)
			return v2Run("bad-telemetry", participant("p", vaultregistry.StateActive, "parent"), worker("w", vaultregistry.StateActive, "worker-1"), o)
		}, vaultregistry.ErrMalformed},
		{"telemetry provider without model", func() vaultregistry.Run {
			o := telemetry()
			o.Payload.RuntimeTelemetry.Model = nil
			return v2Run("bad-model", participant("p", vaultregistry.StateActive, "parent"), worker("w", vaultregistry.StateActive, "worker-1"), o)
		}, vaultregistry.ErrMalformed},
		{"auditor classification", func() vaultregistry.Run {
			return v2Run("bad-auditor", auditor("bad-auditor", vaultregistry.StateSupports, vaultregistry.ClassificationAuditError))
		}, vaultregistry.ErrMalformed},
		{"auditor wrong run", func() vaultregistry.Run {
			o := auditor("bad-auditor-run", vaultregistry.StateError, vaultregistry.ClassificationAuditError)
			o.Payload.AuditorVerdict.TerminalTrace.RunID = "other-run"
			return v2Run("bad-auditor-run", o)
		}, vaultregistry.ErrMalformed},
		{"unknown producer kind", func() vaultregistry.Run {
			o := envelope("future", "future_kind", "future_state")
			o.Payload.Unknown = unknown("future_payload", `{"value":1}`)
			return v2Run("bad-future-kind", o)
		}, vaultregistry.ErrUnsupportedVersion},
	}
	for _, tc := range matrix {
		t.Run("matrix/"+tc.name, func(t *testing.T) { assertRejectedCreateNoWrite(t, tc.run(), tc.want) })
	}
}

func assertRejectedCreateNoWrite(t *testing.T, run vaultregistry.Run, want error) {
	t.Helper()
	root := t.TempDir()
	_, err := mustProducer(t, root).Create(run)
	if !errors.Is(err, want) {
		t.Fatalf("Create error = %v, want %v", err, want)
	}
	if _, statErr := os.Stat(filepath.Join(root, "runs", run.RunID+".json")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("rejected create wrote a Run: %v", statErr)
	}
}

func TestT19V01ObservationReplayConflictAndAtomicFailure(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	created, err := producer.Create(v2Run("append-run"))
	if err != nil {
		t.Fatal(err)
	}
	o := attempt("attempt", vaultregistry.StatePassed, "a1")
	appended, err := producer.AppendObservation(created.RunID, created.Revision, "2026-07-28T02:01:00Z", o)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "runs", created.RunID+".json")
	before := mustReadFile(t, path)

	replayed, err := producer.AppendObservation(created.RunID, 1, "2099-01-01T00:00:00Z", o)
	if err != nil || replayed.Revision != appended.Revision {
		t.Fatalf("idempotent replay = revision %d, error %v", replayed.Revision, err)
	}
	assertFileBytes(t, path, before)

	conflict := o
	conflict.Summary = "different canonical content"
	if _, err = producer.AppendObservation(created.RunID, appended.Revision, "2026-07-28T02:02:00Z", conflict); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("conflicting replay error = %v, want ErrConflict", err)
	}
	assertFileBytes(t, path, before)

	invalid := attempt("invalid", vaultregistry.StatePassed, "a2")
	invalid.Payload.VerifierAttempt.ResultManifest.Authenticated = false
	if _, err = producer.AppendObservation(created.RunID, appended.Revision, "2026-07-28T02:02:00Z", invalid); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("invalid append error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, before)
}

func TestT19V01AttemptAndLifecycleIdentityConflictsPreserveBytes(t *testing.T) {
	cases := []struct {
		name string
		base vaultregistry.Run
		next vaultregistry.Observation
	}{
		{"attempt goal", v2Run("identity-attempt", attempt("active", vaultregistry.StateActive, "a1")), func() vaultregistry.Observation {
			o := attempt("terminal", vaultregistry.StatePassed, "a1")
			o.GoalID = "G02"
			return o
		}()},
		{"attempt started at", v2Run("interval-attempt", attempt("active", vaultregistry.StateActive, "a1")), func() vaultregistry.Observation {
			o := attempt("terminal", vaultregistry.StatePassed, "a1")
			o.StartedAt = strptr("2026-07-28T01:00:01Z")
			return o
		}()},
		{"attempt reopens", v2Run("reopen-attempt", attempt("terminal", vaultregistry.StatePassed, "a1")), attempt("active", vaultregistry.StateActive, "a1")},
		{"participant reopens", v2Run("reopen-participant", participant("terminal", vaultregistry.StateSucceeded, "parent")), participant("active", vaultregistry.StateActive, "parent")},
		{"worker reopens", v2Run("reopen-worker", participant("participant", vaultregistry.StateActive, "parent"), worker("terminal", vaultregistry.StateSucceeded, "worker-1")), worker("active", vaultregistry.StateActive, "worker-1")},
		{"participant role", v2Run("identity-participant", participant("active", vaultregistry.StateActive, "parent")), func() vaultregistry.Observation {
			o := participant("terminal", vaultregistry.StateSucceeded, "parent")
			o.Payload.RegisteredParticipant.Role = "reviewer"
			return o
		}()},
		{"worker task", v2Run("identity-worker", participant("participant", vaultregistry.StateActive, "parent"), worker("active", vaultregistry.StateActive, "worker-1")), func() vaultregistry.Observation {
			o := worker("terminal", vaultregistry.StateSucceeded, "worker-1")
			o.Payload.Worker.TaskSHA256 = strptr(strings.Repeat("f", 64))
			return o
		}()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root, created, err := createV2(t, tc.base)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, "runs", created.RunID+".json")
			before := mustReadFile(t, path)
			_, err = mustProducer(t, root).AppendObservation(created.RunID, created.Revision, "2026-07-28T03:00:00Z", tc.next)
			if !errors.Is(err, vaultregistry.ErrConflict) {
				t.Fatalf("error = %v, want ErrConflict", err)
			}
			assertFileBytes(t, path, before)
		})
	}
}

func TestT19V01DurationAndRecursiveUnknownRetention(t *testing.T) {
	o := attempt("attempt", vaultregistry.StatePassed, "a1")
	if duration, ok := o.Duration(); !ok || duration != 90*time.Second {
		t.Fatalf("Duration = %v, %v; want 1m30s, true", duration, ok)
	}
	point := gap("gap", "a2")
	if _, ok := point.Duration(); ok {
		t.Fatal("point observation reported a duration")
	}
	active := attempt("active", vaultregistry.StateActive, "a3")
	if _, ok := active.Duration(); ok {
		t.Fatal("open interval reported a duration")
	}

	o.Unknown = unknown("observation_future", `{"nested":[1,{"kept":true}]}`)
	o.Actor.AgentSession = &vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: "s1", Unknown: unknown("session_future", `{"kept":true}`)}
	o.Actor.Unknown = unknown("identity_future", `{"kept":true}`)
	o.Payload.Unknown = unknown("payload_future", `{"kept":true}`)
	o.Payload.VerifierAttempt.Unknown = unknown("attempt_future", `{"kept":true}`)
	o.Payload.VerifierAttempt.Identity.Unknown = unknown("attempt_identity_future", `{"kept":true}`)
	o.Payload.VerifierAttempt.ResultManifest.Unknown = unknown("manifest_future", `{"kept":true}`)
	value := "ok"
	o.Details = []vaultregistry.SemanticDetail{{Key: "result", Role: "diagnostic", Value: vaultregistry.SemanticValue{String: &value, Unknown: unknown("value_future", `1`)}, Unknown: unknown("detail_future", `true`)}}
	run := v2Run("unknown-retention", o)
	run.Unknown = unknown("run_v2_future", `{"kept":true}`)
	run.Unknown["participants"] = json.RawMessage(`[{"future_participant":{"kept":true}}]`)
	run.Task.Unknown = unknown("task_v2_future", `{"kept":true}`)
	root, _, err := createV2(t, run)
	if err != nil {
		t.Fatal(err)
	}
	data := mustReadFile(t, filepath.Join(root, "runs", run.RunID+".json"))
	for _, marker := range []string{"observation_future", "session_future", "identity_future", "payload_future", "attempt_future", "attempt_identity_future", "manifest_future", "value_future", "detail_future", "run_v2_future", "future_participant", "task_v2_future"} {
		if !bytes.Contains(data, []byte(`"`+marker+`"`)) {
			t.Errorf("lost recursive unknown field %q", marker)
		}
	}
}

func TestT19V01VersionOneUnknownObservationsRemainUnknown(t *testing.T) {
	run := baseRun("v1-observations-unknown")
	run.Unknown = unknown("observations", `{"future":{"kept":true}}`)
	root := t.TempDir()
	created, err := mustProducer(t, root).Create(run)
	if err != nil {
		t.Fatal(err)
	}
	read, err := mustReader(t, root).Get(run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if read.Observations != nil || read.Unknown["observations"] == nil {
		t.Fatalf("schema-version-1 observations compatibility changed: %#v", read)
	}
	updated, err := mustProducer(t, root).Update(run.RunID, created.Revision, func(next *vaultregistry.Run) error {
		next.UpdatedAt = "2026-07-28T03:00:00Z"
		return nil
	})
	if err != nil || updated.Unknown["observations"] == nil {
		t.Fatalf("version-one update lost unknown observations: %v, %#v", err, updated)
	}
}

func TestT19V01ReaderIsForwardReadableWhileProducerStaysStrict(t *testing.T) {
	futureState := attempt("future-state", "future_attempt_state", "a1")
	futureKind := envelope("future-kind", "future_kind", "future_state")
	futureKind.Unknown = unknown("envelope_extension", `{"kept":true}`)
	futureKind.Payload.Unknown = unknown("future_payload", `{"deep":{"kept":true}}`)
	run := v2Run("forward-run", futureState, futureKind)
	run.Revision = 1
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "runs"), 0700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "runs", run.RunID+".json")
	if err = os.WriteFile(path, append(data, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	before := mustReadFile(t, path)
	read, err := mustReader(t, root).Get(run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if read.Observations[0].State != "future_attempt_state" || read.Observations[1].Kind != "future_kind" || read.Observations[1].Payload.Unknown["future_payload"] == nil {
		t.Fatalf("reader lost future literals: %#v", read.Observations)
	}
	assertFileBytes(t, path, before)

	assertRejectedCreateNoWrite(t, v2Run("strict-state", futureState), vaultregistry.ErrMalformed)
	assertRejectedCreateNoWrite(t, v2Run("strict-kind", futureKind), vaultregistry.ErrUnsupportedVersion)
}

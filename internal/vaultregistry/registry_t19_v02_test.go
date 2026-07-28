package vaultregistry_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

const v02FixtureRoot = "../../scripts/fixtures/vault-hunter-registry-v2"

func installV02Fixture(t *testing.T, name string) (string, string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(v02FixtureRoot, name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var identity struct {
		RunID string `json:"run_id"`
	}
	if err := json.Unmarshal(data, &identity); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "runs"), 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "runs", identity.RunID+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return root, path
}

func TestT19V02VersionDispatchRoundTripsWithoutMigration(t *testing.T) {
	t.Run("version 1 remains version 1", func(t *testing.T) {
		root, _ := installV02Fixture(t, "version-1")
		reader, producer := mustReader(t, root), mustProducer(t, root)
		before, err := reader.Get("t19-v02-version-1")
		if err != nil {
			t.Fatal(err)
		}
		updated, err := producer.Update(before.RunID, before.Revision, func(next *vaultregistry.Run) error {
			next.UpdatedAt = "2026-07-28T00:03:00Z"
			next.Lifecycle = append(next.Lifecycle, vaultregistry.Lifecycle{
				ObservationID: "v1-next", ObservedAt: "2026-07-28T00:03:00Z",
				Kind: "recorded", GoalID: "G02", State: "complete", Detail: "still version one",
			})
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if updated.SchemaVersion != 1 || updated.Observations != nil || len(updated.Lifecycle) != 2 ||
			updated.Unknown["future_run"] == nil || updated.Task.Unknown["future_task"] == nil {
			t.Fatalf("version-1 compatibility changed: %#v", updated)
		}
		data := mustReadFile(t, filepath.Join(root, "runs", before.RunID+".json"))
		if bytes.Contains(data, []byte(`"observations"`)) || !bytes.Contains(data, []byte(`"future_lifecycle"`)) {
			t.Fatalf("version-1 write migrated or lost unknown fields: %s", data)
		}
	})

	t.Run("legacy version 2 remains literal and read only", func(t *testing.T) {
		root, path := installV02Fixture(t, "version-2")
		before, err := mustReader(t, root).Get("t19-v02-version-2")
		if err != nil {
			t.Fatal(err)
		}
		stable := mustReadFile(t, path)
		next := participant("participant-terminal", vaultregistry.StateSucceeded, "writer")
		if _, err := mustProducer(t, root).AppendObservation(before.RunID, before.Revision, "2026-07-28T00:04:00Z", next); !errors.Is(err, vaultregistry.ErrMalformed) {
			t.Fatalf("legacy append error = %v, want ErrMalformed", err)
		}
		assertFileBytes(t, path, stable)
	})
}

func TestT19V02IdempotencyConflictsConcurrencyAndAtomicity(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	created, err := createV2WithProducer(producer, v2Run("t19-v02-conflicts"))
	if err != nil {
		t.Fatal(err)
	}
	observation := attempt("attempt-passed", vaultregistry.StatePassed, "attempt-1")
	appended, err := producer.AppendObservation(created.RunID, created.Revision, "2026-07-28T02:01:00Z", observation)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "runs", created.RunID+".json")
	stable := mustReadFile(t, path)

	if replayed, err := producer.AppendObservation(created.RunID, created.Revision, "2099-01-01T00:00:00Z", observation); err != nil || replayed.Revision != appended.Revision {
		t.Fatalf("byte-equivalent replay = revision %d, %v", replayed.Revision, err)
	}
	assertFileBytes(t, path, stable)

	changed := observation
	changed.Summary = "conflicting observation identity"
	if _, err := producer.AppendObservation(created.RunID, appended.Revision, "2026-07-28T02:02:00Z", changed); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("identity reuse error = %v, want ErrConflict", err)
	}
	assertFileBytes(t, path, stable)

	if _, err := producer.Update(created.RunID, created.Revision, func(*vaultregistry.Run) error { return nil }); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("stale revision error = %v, want ErrConflict", err)
	}
	assertFileBytes(t, path, stable)

	if _, err := producer.Update(created.RunID, appended.Revision, func(next *vaultregistry.Run) error {
		next.RunID = "retargeted"
		return nil
	}); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("immutable identity error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, stable)

	invalid := attempt("invalid", vaultregistry.StatePassed, "attempt-2")
	invalid.Payload.VerifierAttempt.ResultManifest.Authenticated = false
	if _, err := producer.AppendObservation(created.RunID, appended.Revision, "2026-07-28T02:03:00Z", invalid); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("invalid append error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, stable)

	concurrent, err := createV2WithProducer(producer, v2Run("t19-v02-concurrent"))
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	concurrentProducers := []*vaultregistry.Producer{mustProducer(t, root), mustProducer(t, root)}
	var writers sync.WaitGroup
	for i := 0; i < 2; i++ {
		writers.Add(1)
		go func(i int, concurrentProducer *vaultregistry.Producer) {
			defer writers.Done()
			<-start
			o := attempt([]string{"winner-a", "winner-b"}[i], vaultregistry.StatePassed, []string{"attempt-a", "attempt-b"}[i])
			_, err := concurrentProducer.AppendObservation(concurrent.RunID, concurrent.Revision, "2026-07-28T03:00:00Z", o)
			results <- err
		}(i, concurrentProducers[i])
	}
	close(start)
	writers.Wait()
	close(results)
	var successes, conflicts int
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, vaultregistry.ErrConflict) {
			conflicts++
		} else {
			t.Fatalf("concurrent append error = %v", err)
		}
	}
	final, err := mustReader(t, root).Get(concurrent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if successes != 1 || conflicts != 1 || final.Revision != 2 || len(final.Observations) != 2 {
		t.Fatalf("concurrent result: successes=%d conflicts=%d run=%#v", successes, conflicts, final)
	}
}

func TestT19V02ProducerRejectsMalformedKnownHistoryWithoutWriting(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "runs"), 0700); err != nil {
		t.Fatal(err)
	}
	malformed := attempt("malformed-active", vaultregistry.StateActive, "malformed-attempt")
	malformed.FinishedAt = strptr(v2Finish)
	run := v2Run("t19-v02-malformed-history", malformed)
	run.Revision = 1
	data, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "runs", run.RunID+".json")
	if err := os.WriteFile(path, append(data, '\n'), 0600); err != nil {
		t.Fatal(err)
	}

	read, err := mustReader(t, root).Get(run.RunID)
	if err != nil || len(read.Observations) != 1 {
		t.Fatalf("structural Reader rejected known malformed history: %v, %#v", err, read)
	}
	before := mustReadFile(t, path)
	producer := mustProducer(t, root)
	if _, err := producer.Get(run.RunID); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("Producer.Get error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, before)

	if _, err := producer.AppendObservation(run.RunID, run.Revision, "2099-01-01T00:00:00Z", malformed); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("idempotent AppendObservation error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, before)

	if _, err := producer.Update(run.RunID, run.Revision, func(next *vaultregistry.Run) error {
		next.UpdatedAt = "2026-07-28T04:00:00Z"
		return nil
	}); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("Update error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, before)

	if _, err := producer.AppendObservation(run.RunID, run.Revision, "2026-07-28T04:00:00Z", gap("never-appended", "new-attempt")); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("AppendObservation error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, before)

	if _, err := producer.Retire(run.RunID, run.Revision); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("Retire error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, before)
	if _, err := os.Stat(filepath.Join(root, "retired", run.RunID+".json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed Retire created retired record: %v", err)
	}
}

func TestT19V02ListSummariesMatchesTypedAgentSessions(t *testing.T) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	participantRun := v2Run("v2-participant-session", participant("participant", vaultregistry.StateActive, "parent"))
	workerRun := v2Run(
		"v2-worker-session",
		participant("owner", vaultregistry.StateActive, "parent"),
		worker("worker", vaultregistry.StateActive, "worker-1"),
	)
	workerRun.Observations[0].Payload.RegisteredParticipant.AgentSession.Value = "owner-session"
	for _, run := range []vaultregistry.Run{participantRun, workerRun} {
		if _, err := createV2WithProducer(producer, run); err != nil {
			t.Fatal(err)
		}
	}

	reader := mustReader(t, root)
	cases := []struct {
		name    string
		session vaultregistry.AgentSession
		want    []string
	}{
		{"participant", vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: "session-1"}, []string{"v2-participant-session"}},
		{"worker representation ignored", vaultregistry.AgentSession{Source: "codex", Kind: "session", Value: "worker-session"}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			summaries, err := reader.ListSummaries(vaultregistry.ListFilter{AgentSession: &tc.session})
			if err != nil {
				t.Fatal(err)
			}
			if got := summaryIDs(summaries); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("List IDs = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestT19V02ForwardReaderRewriteAndStrictProducer(t *testing.T) {
	root, path := installV02Fixture(t, "future-version-2")
	before, err := mustReader(t, root).Get("t19-v02-future")
	if err != nil {
		t.Fatal(err)
	}
	if before.Observations[0].State != "awaiting_artifact_v3" || before.Observations[1].Kind != "artifact_attestation_v3" ||
		before.Observations[1].State != "sealed_v3" {
		t.Fatalf("future kind/state literals changed: %#v", before.Observations)
	}
	stable := mustReadFile(t, path)
	if _, err := mustProducer(t, root).Update(before.RunID, before.Revision, func(next *vaultregistry.Run) error {
		next.UpdatedAt = "2026-07-28T00:05:00Z"
		return nil
	}); !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("legacy future update error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, stable)
	for _, marker := range []string{"future_run", "future_task", "future_envelope", "future_payload_member", "future_attempt", "artifact_attestation_v3", "awaiting_artifact_v3", "sealed_v3"} {
		if !bytes.Contains(stable, []byte(`"`+marker+`"`)) {
			t.Errorf("reader fixture lost recursive future value %q", marker)
		}
	}

	futureState := attempt("future-state", "future_attempt_state", "strict-state")
	assertRejectedCreateNoWrite(t, v2Run("t19-v02-strict-state", futureState), vaultregistry.ErrMalformed)
	futureKind := envelope("future-kind", "future_kind", "future_state")
	futureKind.Payload.Unknown = unknown("future_kind", `{"nested":{"kept":true}}`)
	assertRejectedCreateNoWrite(t, v2Run("t19-v02-strict-kind", futureKind), vaultregistry.ErrUnsupportedVersion)
}

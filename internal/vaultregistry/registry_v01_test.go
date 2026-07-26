package vaultregistry_test

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type v01Scenario struct {
	root     string
	run      vaultregistry.Run
	created  vaultregistry.Run
	producer *vaultregistry.Producer
	reader   *vaultregistry.Reader
	path     string
}

func TestT01V01RestartUpdateAndUnknownFields(t *testing.T) {
	s := newV01Scenario(t)
	assertRestart(t, s)
	assertRetargetRejected(t, s)
	assertImmutableMutationsRejected(t, s.run)
	updated := appendObservations(t, s)
	assertPersistedRun(t, s, updated)
}

func newV01Scenario(t *testing.T) v01Scenario {
	root := t.TempDir()
	producer := mustProducer(t, root)
	run := richRun()
	created, err := producer.Create(run)
	if err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 {
		t.Fatalf("create revision = %d, want 1", created.Revision)
	}
	reopened := mustProducer(t, root)
	reader := mustReader(t, root)
	return v01Scenario{
		root: root, run: run, created: created, producer: reopened, reader: reader,
		path: filepath.Join(root, "runs", run.RunID+".json"),
	}
}

func richRun() vaultregistry.Run {
	return vaultregistry.Run{
		SchemaVersion: 1,
		RunID:         "task_run-01",
		InvokedAt:     "2026-07-26T07:00:00Z",
		UpdatedAt:     "2026-07-26T07:00:00Z",
		Task: vaultregistry.Task{
			ID: "T01", Title: "Build the Run Registry POC", Path: "tasks/01.md",
			FeaturePath: "features/vault-hunter-atlas.md", Kind: "task",
			Unknown: unknown("task_future", `{"nested":{"kept":true}}`),
		},
		Participants: []vaultregistry.Participant{richParticipant()},
		Lifecycle:    []vaultregistry.Lifecycle{richLifecycle()},
		Evidence:     []vaultregistry.Evidence{richEvidence()},
		Unknown:      unknown("run_future", `{"deep":{"values":[1,2,3]}}`),
	}
}

func richParticipant() vaultregistry.Participant {
	return vaultregistry.Participant{
		ParticipantID: "driver", ObservedAt: "2026-07-26T07:00:01Z",
		Role: "producer", GoalID: "goal-1",
		Herdr: &vaultregistry.HerdrIdentity{
			WorkspaceID: "ws", TabID: "tab", PaneID: "pane", TerminalID: "term",
			Unknown: unknown("herdr_future", `{"level":2}`),
		},
		AgentSession: &vaultregistry.AgentSession{
			Source: "codex", Kind: "session", Value: "session-1",
			Unknown: unknown("session_future", `["a",{"b":1}]`),
		},
		Unknown: unknown("participant_future", `{"enabled":true}`),
	}
}

func richLifecycle() vaultregistry.Lifecycle {
	return vaultregistry.Lifecycle{
		ObservationID: "life-1", ObservedAt: "2026-07-26T07:00:02Z",
		Kind: "recorded", GoalID: "goal-1", State: "in-progress",
		Detail:  "observation only",
		Unknown: unknown("lifecycle_future", `{"owner":"driver"}`),
	}
}

func richEvidence() vaultregistry.Evidence {
	exit := 0
	return vaultregistry.Evidence{
		ObservationID: "evidence-1", ObservedAt: "2026-07-26T07:00:03Z",
		VerifierID: "T01.V01", State: "running",
		Command: "scripts/verify-vault-hunter-atlas T01.V01", ExitStatus: &exit,
		ImplementationTree: "tree-1", ArtifactSHA256: strings.Repeat("a", 64),
		Detail:  "observation only",
		Unknown: unknown("evidence_future", `{"attempt":1}`),
	}
}

func assertRestart(t *testing.T, s v01Scenario) {
	fromProducer, err := s.producer.Get(s.run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	fromReader, err := s.reader.Get(s.run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.created, fromProducer) || !reflect.DeepEqual(s.created, fromReader) {
		t.Fatalf("reopened values differ\ncreated: %#v\nproducer: %#v\nreader: %#v",
			s.created, fromProducer, fromReader)
	}
}

func assertRetargetRejected(t *testing.T, s v01Scenario) {
	before := mustReadFile(t, s.path)
	_, err := s.producer.Update(s.run.RunID, 1, func(next *vaultregistry.Run) error {
		next.Task.ID = "T02"
		next.Task.Path = "tasks/02.md"
		return nil
	})
	if !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("Task retarget error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, s.path, before)
	after, err := s.reader.Get(s.run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, s.created) {
		t.Fatalf("rejected Task retarget changed value\ncreated: %#v\nafter: %#v", s.created, after)
	}
}

type runMutation struct {
	name   string
	mutate func(*vaultregistry.Run)
}

func immutableMutations() []runMutation {
	return []runMutation{
		{"InvokedAt change", func(next *vaultregistry.Run) {
			next.InvokedAt = "2026-07-26T07:00:01Z"
		}},
		{"Run unknown erase", func(next *vaultregistry.Run) { next.Unknown = nil }},
		{"Run unknown replace", func(next *vaultregistry.Run) {
			next.Unknown = unknown("run_future", `{"replacement":true}`)
		}},
		{"Task unknown erase", func(next *vaultregistry.Run) { next.Task.Unknown = nil }},
		{"Task unknown replace", func(next *vaultregistry.Run) {
			next.Task.Unknown = unknown("task_future", `{"replacement":true}`)
		}},
	}
}

func assertImmutableMutationsRejected(t *testing.T, run vaultregistry.Run) {
	for _, tc := range immutableMutations() {
		t.Run(tc.name, func(t *testing.T) {
			assertMutationRejected(t, run, tc.mutate)
		})
	}
}

func assertMutationRejected(t *testing.T, run vaultregistry.Run, mutate func(*vaultregistry.Run)) {
	root := t.TempDir()
	producer := mustProducer(t, root)
	created, err := producer.Create(run)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "runs", run.RunID+".json")
	before := mustReadFile(t, path)
	_, err = producer.Update(run.RunID, created.Revision, func(next *vaultregistry.Run) error {
		mutate(next)
		return nil
	})
	if !errors.Is(err, vaultregistry.ErrMalformed) {
		t.Fatalf("Update error = %v, want ErrMalformed", err)
	}
	assertFileBytes(t, path, before)
	after, err := mustReader(t, root).Get(run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, created) {
		t.Fatalf("rejected mutation changed value\ncreated: %#v\nafter: %#v", created, after)
	}
}

func appendObservations(t *testing.T, s v01Scenario) vaultregistry.Run {
	updated, err := s.producer.Update(s.run.RunID, 1, func(next *vaultregistry.Run) error {
		next.UpdatedAt = "2026-07-26T07:01:00Z"
		next.Participants = append(next.Participants, vaultregistry.Participant{
			ParticipantID: "reviewer", ObservedAt: "2026-07-26T07:01:01Z", Role: "reviewer",
		})
		next.Lifecycle = append(next.Lifecycle, vaultregistry.Lifecycle{
			ObservationID: "life-2", ObservedAt: "2026-07-26T07:01:02Z",
			Kind: "recorded", State: "verifying",
		})
		next.Evidence = append(next.Evidence, vaultregistry.Evidence{
			ObservationID: "evidence-2", ObservedAt: "2026-07-26T07:01:03Z",
			VerifierID: "T01.V01", State: "passed",
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 {
		t.Fatalf("update revision = %d, want 2", updated.Revision)
	}
	assertHistoryPrefixes(t, s.created, updated)
	return updated
}

func assertHistoryPrefixes(t *testing.T, before, after vaultregistry.Run) {
	if !reflect.DeepEqual(after.Participants[:1], before.Participants) ||
		!reflect.DeepEqual(after.Lifecycle[:1], before.Lifecycle) ||
		!reflect.DeepEqual(after.Evidence[:1], before.Evidence) {
		t.Fatal("update did not preserve history prefixes")
	}
}

func assertPersistedRun(t *testing.T, s v01Scenario, updated vaultregistry.Run) {
	reloaded, err := mustReader(t, s.root).Get(s.run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(updated, reloaded) {
		t.Fatalf("updated value did not survive restart\nupdated: %#v\nreloaded: %#v", updated, reloaded)
	}
	data := mustReadFile(t, s.path)
	if len(data) == 0 || data[len(data)-1] != '\n' {
		t.Fatal("persisted JSON lacks trailing newline")
	}
	info, err := os.Stat(s.path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("run mode = %v, err = %v; want 0600", info.Mode().Perm(), err)
	}
	assertUnknownMarkers(t, data)
}

func assertUnknownMarkers(t *testing.T, data []byte) {
	markers := []string{
		"run_future", "task_future", "participant_future", "herdr_future",
		"session_future", "lifecycle_future", "evidence_future",
	}
	for _, marker := range markers {
		if !strings.Contains(string(data), `"`+marker+`"`) {
			t.Fatalf("persisted JSON lost nested unknown field %q", marker)
		}
	}
}

func mustReadFile(t *testing.T, path string) []byte {
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func assertFileBytes(t *testing.T, path string, before []byte) {
	after := mustReadFile(t, path)
	if !reflect.DeepEqual(after, before) {
		t.Fatal("rejected mutation changed persisted bytes")
	}
}

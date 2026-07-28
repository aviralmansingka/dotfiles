package vaultregistry_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

type t20V04RunOutput struct {
	RunID            string                 `json:"run_id"`
	Name             string                 `json:"name"`
	RunKind          vaultregistry.RunKind  `json:"run_kind"`
	WorkKind         string                 `json:"work_kind"`
	State            vaultregistry.RunState `json:"state"`
	Revision         uint64                 `json:"revision"`
	ParticipantMatch bool                   `json:"participant_match"`
}

type t20V04Output struct {
	Runs             []t20V04RunOutput `json:"runs"`
	IDSelector       string            `json:"id_selector"`
	NameSelector     string            `json:"name_selector"`
	ParticipantMatch []string          `json:"participant_match"`
	SessionMatch     []string          `json:"session_match"`
}

func TestT20V04StandaloneTypedConsumer(t *testing.T) {
	root := t.TempDir()
	producer, err := vaultregistry.OpenProducer(root)
	if err != nil {
		t.Fatal(err)
	}
	requests := []vaultregistry.CreateRequest{
		t20V04Request("consumer-hunter", "hunter-consumer", vaultregistry.RunKindHunter, "task", "hunter-driver", "hunter-session"),
		t20V04Request("consumer-scout", "scout-consumer", vaultregistry.RunKindScout, "issue", "scout-driver", "scout-session"),
	}
	for _, request := range requests {
		if _, err := producer.CreateRun(request); err != nil {
			t.Fatal(err)
		}
	}

	reader, err := vaultregistry.OpenReader(root)
	if err != nil {
		t.Fatal(err)
	}

	hunterByName, err := reader.Get("hunter-consumer")
	if err != nil {
		t.Fatal(err)
	}
	scoutByID, err := reader.Get("consumer-scout")
	if err != nil {
		t.Fatal(err)
	}
	participant, err := reader.ListSummaries(vaultregistry.ListFilter{ParticipantID: "hunter-driver"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := reader.ListSummaries(vaultregistry.ListFilter{AgentSession: &vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: "scout-session"}})
	if err != nil {
		t.Fatal(err)
	}
	retired, err := producer.Retire(hunterByName.RunID, hunterByName.Revision)
	if err != nil {
		t.Fatal(err)
	}

	output := t20V04Output{
		Runs: []t20V04RunOutput{
			t20V04TypedRun(retired, len(participant) == 1 && participant[0].RunID == retired.RunID),
			t20V04TypedRun(scoutByID, len(session) == 1 && session[0].RunID == scoutByID.RunID),
		},
		IDSelector: scoutByID.Name, NameSelector: hunterByName.RunID,
		ParticipantMatch: t20V04SummaryIDs(participant), SessionMatch: t20V04SummaryIDs(session),
	}
	want := t20V04Output{
		Runs: []t20V04RunOutput{
			{RunID: "consumer-hunter", Name: "hunter-consumer", RunKind: vaultregistry.RunKindHunter, WorkKind: "task", State: vaultregistry.RunStateRetired, Revision: 2, ParticipantMatch: true},
			{RunID: "consumer-scout", Name: "scout-consumer", RunKind: vaultregistry.RunKindScout, WorkKind: "issue", State: vaultregistry.RunStateActive, Revision: 1, ParticipantMatch: true},
		},
		IDSelector: "scout-consumer", NameSelector: "consumer-hunter",
		ParticipantMatch: []string{"consumer-hunter"}, SessionMatch: []string{"consumer-scout"},
	}
	if !reflect.DeepEqual(output, want) {
		t.Fatalf("typed consumer output = %#v, want %#v", output, want)
	}
	data, err := json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("T20.V04_CONSUMER_OUTPUT data=%s", data)
}

func t20V04Request(runID, name string, runKind vaultregistry.RunKind, workKind, participantID, session string) vaultregistry.CreateRequest {
	observedAt := "2026-07-30T04:00:00Z"
	startedAt := observedAt
	return vaultregistry.CreateRequest{
		Run: vaultregistry.Run{
			SchemaVersion: 2, RunID: runID, Name: name, RunKind: runKind,
			WorkReference: &vaultregistry.WorkReference{ID: "T20", Title: "Standalone consumer", Path: "tasks/20.md", FeaturePath: "features/atlas.md", Kind: workKind},
			State:         vaultregistry.RunStateActive, Stage: "invoked", InvokedAt: observedAt, UpdatedAt: observedAt,
		},
		InitialDriver: vaultregistry.Observation{
			ObservationID: "driver-" + runID, Kind: vaultregistry.KindRegisteredParticipant, State: vaultregistry.StateActive,
			GoalID: "G04", Title: "Standalone driver", Summary: "Registered by the standalone consumer.", ObservedAt: observedAt,
			CorrelationID: runID, StartedAt: &startedAt, Actor: vaultregistry.Identity{Kind: "participant", ID: participantID},
			Source: vaultregistry.Identity{Kind: "consumer", ID: "t20-v04"}, RedactionClass: "internal",
			Payload: vaultregistry.ObservationPayload{RegisteredParticipant: &vaultregistry.RegisteredParticipantPayload{
				ParticipantID: participantID, Role: "driver", AgentSession: vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: session},
			}},
		},
	}
}

func t20V04TypedRun(run vaultregistry.Run, participantMatch bool) t20V04RunOutput {
	return t20V04RunOutput{
		RunID: run.RunID, Name: run.Name, RunKind: run.RunKind, WorkKind: run.WorkReference.Kind,
		State: run.State, Revision: run.Revision, ParticipantMatch: participantMatch,
	}
}

func t20V04SummaryIDs(summaries []vaultregistry.RunSummary) []string {
	ids := make([]string, len(summaries))
	for i := range summaries {
		ids[i] = summaries[i].RunID
	}
	return ids
}

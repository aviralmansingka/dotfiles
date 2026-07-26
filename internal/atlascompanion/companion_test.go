package atlascompanion

import (
	"reflect"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestExactParticipantCorrelation(t *testing.T) {
	session := func(value string) *vaultregistry.AgentSession {
		return &vaultregistry.AgentSession{Source: "herdr:pi", Kind: "path", Value: value}
	}
	identity := func(suffix string) *vaultregistry.HerdrIdentity {
		return &vaultregistry.HerdrIdentity{WorkspaceID: "ws", TabID: "tab-" + suffix, PaneID: "pane-" + suffix, TerminalID: "term-" + suffix}
	}
	participants := []vaultregistry.Participant{
		{ParticipantID: "matched", Herdr: identity("matched"), AgentSession: session("same")},
		{ParticipantID: "one-sided", Herdr: identity("one-sided")},
		{ParticipantID: "stale", Herdr: identity("stale")},
		{ParticipantID: "contradictory", Herdr: identity("contradictory"), AgentSession: session("recorded")},
		{ParticipantID: "recorded-only"},
	}
	agents := []Agent{
		{WorkspaceID: "ws", TabID: "tab-matched", PaneID: "pane-matched", TerminalID: "term-matched", AgentSession: session("same")},
		{WorkspaceID: "ws", TabID: "tab-one-sided", PaneID: "pane-one-sided", TerminalID: "term-one-sided", AgentSession: session("live")},
		{WorkspaceID: "ws", TabID: "tab-contradictory", PaneID: "pane-contradictory", TerminalID: "term-contradictory", AgentSession: session("live")},
		{Name: "same-name-is-not-identity", WorkspaceID: "ws", TabID: "tab-live", PaneID: "pane-live", TerminalID: "term-live"},
	}

	got, liveOnly := correlate(participants, agents)
	states := []string{"matched", "matched", "stale", "contradictory", "recorded-only"}
	for i := range states {
		if got[i].State != states[i] {
			t.Fatalf("participant %s state = %q, want %q", participants[i].ParticipantID, got[i].State, states[i])
		}
	}
	if got[2].Live != nil || got[4].Live != nil || len(liveOnly) != 1 || liveOnly[0].TerminalID != "term-live" {
		t.Fatalf("recorded/live separation lost: correlations=%#v live-only=%#v", got, liveOnly)
	}
}

func TestAttachmentEligibilityFailsBeforeHerdr(t *testing.T) {
	client := Client{Herdr: "/does/not/exist", Executable: "atlas"}
	eligibleIdentity := &vaultregistry.HerdrIdentity{WorkspaceID: "ws", TabID: "tab", PaneID: "pane", TerminalID: "term"}
	for _, run := range []vaultregistry.Run{
		{Task: vaultregistry.Task{Kind: "feature"}, Participants: []vaultregistry.Participant{{Herdr: eligibleIdentity}}},
		{Task: vaultregistry.Task{Kind: "task"}, Participants: []vaultregistry.Participant{{Herdr: &vaultregistry.HerdrIdentity{WorkspaceID: "ws"}}}},
		{Task: vaultregistry.Task{Kind: "task"}, Participants: []vaultregistry.Participant{{Herdr: &vaultregistry.HerdrIdentity{WorkspaceID: "other", TabID: "tab", PaneID: "pane", TerminalID: "term"}}}},
	} {
		if _, _, err := client.correlate(run, "ws"); err == nil || strings.Contains(err.Error(), "does/not/exist") {
			t.Fatalf("eligibility error = %v", err)
		}
	}
}

func TestExactOwnershipIdentity(t *testing.T) {
	tuple := Tuple{RunID: "run ' one", WorkspaceID: "workspace", TabID: "tab", PaneID: "pane", TerminalID: "terminal"}
	atlas := []string{"/tmp/vault hunter atlas", "--run-id", tuple.RunID, "--state-dir", "/tmp/state ' one"}
	encoded := marker(tuple)
	decoded, ok := decodeMarker(encoded)
	if !ok || decoded != tuple {
		t.Fatalf("marker round trip = %#v, %v", decoded, ok)
	}
	if strings.Contains(label(tuple.RunID, tuple.WorkspaceID), tuple.RunID) {
		t.Fatal("ownership label leaked the untrusted Run ID")
	}
	processes := []process{
		{Argv: append([]string{"/bin/sh", "-c", wrapper, encoded}, atlas...)},
		{Argv: atlas},
	}
	if !ownedProcess(processes, tuple, atlas) || !healthy(processes, atlas) {
		t.Fatal("exact wrapper and Atlas process were not accepted")
	}
	forged := append([]process(nil), processes...)
	forged[0].Argv = append([]string(nil), forged[0].Argv...)
	forged[0].Argv[3] += "forged"
	if ownedProcess(forged, tuple, atlas) {
		t.Fatal("forged ownership marker was accepted")
	}
	if got := shellCommand(tuple, atlas); !strings.Contains(got, `'run '\'' one'`) {
		t.Fatalf("shell command did not quote untrusted input: %s", got)
	}
	if !reflect.DeepEqual(processes[1].Argv, atlas) {
		t.Fatal("test setup changed Atlas argv")
	}
}

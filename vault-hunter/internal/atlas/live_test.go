package atlas

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestV08RegisteredParticipantStatesStaySeparateFromGoals(t *testing.T) {
	run := loadFixture(t)
	before, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	live := NewLiveState(run.Participants)
	cases := []struct {
		status string
		glyph  string
	}{
		{"working", "› working"},
		{"blocked", "! blocked"},
		{"done", "● done"},
		{"idle", "· idle"},
		{"unknown", "? unknown"},
	}
	for _, test := range cases {
		live.Refresh(AgentSnapshot{PaneID: "w2R:pF", Status: test.status})
		output := live.RenderParticipant("w2R:pF", 0)
		if !strings.Contains(output, test.glyph) {
			t.Errorf("%s state rendered as %q", test.status, output)
		}
	}

	live.Refresh(AgentSnapshot{PaneID: "not-registered", Status: "blocked"})
	if live.RenderParticipant("not-registered", 0) != "" {
		t.Fatal("an unregistered participant entered the live projection")
	}
	live.Refresh(AgentSnapshot{PaneID: "w2R:pF", Status: "working"})
	first := live.RenderParticipant("w2R:pF", 0)
	second := live.RenderParticipant("w2R:pF", 1)
	if first == second {
		t.Fatalf("working spinner did not advance: %q", first)
	}
	live.MarkStale()
	if !strings.Contains(live.RenderParticipant("w2R:pF", 1), "stale") {
		t.Fatal("connection loss did not mark cached participant state stale")
	}

	after, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) || run.ActiveGoal != "V03" || run.Active().Status != "active" {
		t.Fatal("Herdr participant state mutated or completed the active Vault Hunter goal")
	}
}

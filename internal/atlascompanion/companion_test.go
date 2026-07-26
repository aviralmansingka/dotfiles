package atlascompanion

import (
	"encoding/json"
	"os"
	"path/filepath"
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

func TestMalformedHerdrStateFailsClosed(t *testing.T) {
	validTabs := herdrResponse(map[string]any{"type": "tab_list", "tabs": []any{map[string]any{"workspace_id": "ws", "tab_id": "other-tab", "label": "other", "pane_count": 1}}})
	validPanes := herdrResponse(map[string]any{"type": "pane_list", "panes": []any{map[string]any{"workspace_id": "ws", "tab_id": "other-tab", "pane_id": "other-pane", "terminal_id": "other-terminal"}}})
	cases := []struct {
		name, tabs, panes, info string
	}{
		{name: "null response", tabs: "null"},
		{name: "empty response", tabs: "{}"},
		{name: "missing result", tabs: `{"id":"fake"}`},
		{name: "null result", tabs: `{"id":"fake","result":null}`},
		{name: "empty result", tabs: `{"id":"fake","result":{}}`},
		{name: "missing tabs", tabs: herdrResponse(map[string]any{"type": "tab_list"})},
		{name: "null tabs", tabs: herdrResponse(map[string]any{"type": "tab_list", "tabs": nil})},
		{name: "missing panes", tabs: validTabs, panes: herdrResponse(map[string]any{"type": "pane_list"})},
		{name: "missing process info", tabs: validTabs, panes: validPanes, info: herdrResponse(map[string]any{"type": "pane_process_info"})},
		{name: "wrong process pane", tabs: validTabs, panes: validPanes, info: herdrResponse(map[string]any{"type": "pane_process_info", "process_info": map[string]any{"pane_id": "wrong", "foreground_processes": []any{}}})},
		{name: "missing processes", tabs: validTabs, panes: validPanes, info: herdrResponse(map[string]any{"type": "pane_process_info", "process_info": map[string]any{"pane_id": "other-pane"}})},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, log := fakeHerdr(t, tc.tabs, tc.panes, tc.info, "")
			if _, err := client.Attach("run", "ws", "/state"); err == nil {
				t.Fatal("attach accepted malformed Herdr state")
			}
			want := Tuple{RunID: "run", WorkspaceID: "ws", TabID: "tab", PaneID: "pane", TerminalID: "terminal"}
			if err := client.Cleanup(want, "/state"); err == nil {
				t.Fatal("cleanup claimed success for malformed Herdr state")
			}
			commands, err := os.ReadFile(log)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(commands), "tab create\n") || strings.Contains(string(commands), "tab close\n") {
				t.Fatalf("malformed state caused tab mutation:\n%s", commands)
			}
		})
	}
}

func TestCreateRequiresExactOnePaneResult(t *testing.T) {
	for _, tc := range []struct {
		name   string
		result map[string]any
	}{
		{name: "missing root pane", result: map[string]any{"type": "tab_created"}},
		{name: "two panes", result: map[string]any{
			"type":      "tab_created",
			"tab":       map[string]any{"workspace_id": "ws", "tab_id": "created-tab", "label": label("run", "ws"), "pane_count": 2},
			"root_pane": map[string]any{"workspace_id": "ws", "tab_id": "created-tab", "pane_id": "created-pane", "terminal_id": "created-terminal"},
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, log := fakeHerdr(t, "", "", "", herdrResponse(tc.result))
			if _, err := client.Attach("run", "ws", "/state"); err == nil {
				t.Fatal("attach accepted malformed tab create result")
			}
			commands, err := os.ReadFile(log)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(commands), "tab create\n") || strings.Contains(string(commands), "pane run\n") {
				t.Fatalf("malformed create result advanced lifecycle:\n%s", commands)
			}
		})
	}
}

func herdrResponse(result any) string {
	response, _ := json.Marshal(map[string]any{"id": "fake", "result": result})
	return string(response)
}

func fakeHerdr(t *testing.T, tabs, panes, info, create string) (Client, string) {
	t.Helper()
	if tabs == "" {
		tabs = herdrResponse(map[string]any{"type": "tab_list", "tabs": []any{}})
	}
	if panes == "" {
		panes = herdrResponse(map[string]any{"type": "pane_list", "panes": []any{}})
	}
	if info == "" {
		info = herdrResponse(map[string]any{"type": "pane_process_info", "process_info": map[string]any{"pane_id": "other-pane", "foreground_processes": []any{map[string]any{"argv": []string{"other"}}}}})
	}
	if create == "" {
		create = herdrResponse(map[string]any{"type": "tab_created"})
	}
	dir := t.TempDir()
	log := filepath.Join(dir, "commands")
	script := filepath.Join(dir, "herdr")
	contents := `#!/bin/sh
printf '%s %s\n' "$1" "$2" >>"$HERDR_TEST_LOG"
case "$1 $2" in
  "tab list") printf '%s\n' "$HERDR_TEST_TABS" ;;
  "pane list") printf '%s\n' "$HERDR_TEST_PANES" ;;
  "pane process-info") printf '%s\n' "$HERDR_TEST_INFO" ;;
  "tab create") printf '%s\n' "$HERDR_TEST_CREATE" ;;
  "pane run"|"tab close") printf '%s\n' '{"id":"fake","result":{"type":"ok"}}' ;;
esac
`
	if err := os.WriteFile(script, []byte(contents), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HERDR_TEST_LOG", log)
	t.Setenv("HERDR_TEST_TABS", tabs)
	t.Setenv("HERDR_TEST_PANES", panes)
	t.Setenv("HERDR_TEST_INFO", info)
	t.Setenv("HERDR_TEST_CREATE", create)
	return Client{Herdr: script, Executable: "atlas"}, log
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

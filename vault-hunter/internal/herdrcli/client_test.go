package herdrcli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestV11CompanionIsAnOccupiedDriverRightSplit(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "herdr.log")
	binary := filepath.Join(t.TempDir(), "herdr")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' "$*" >> %q
case "$1:$2" in
  pane:split)
    printf '{"result":{"pane":{"pane_id":"driver:atlas","tab_id":"driver:tab"}}}\n'
    ;;
  pane:run)
    case "$4" in
      *run-fail*) exit 1 ;;
    esac
    ;;
esac
`, logPath)
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}

	client := Client{Binary: binary, AtlasCommand: "vault-hunter-atlas"}
	companion, err := client.CreateCompanion(context.Background(), "driver:pane", "run-ok")
	if err != nil {
		t.Fatal(err)
	}
	if companion.PaneID != "driver:atlas" ||
		companion.TabID != "driver:tab" ||
		companion.OwnerPaneID != "driver:pane" {
		t.Fatalf("companion escaped its driver tab: %#v", companion)
	}
	assertV11Calls(t, logPath, []string{
		"pane split driver:pane --direction right --ratio 0.42 --no-focus",
		`pane run driver:atlas "vault-hunter-atlas" --run "run-ok"`,
	})

	if _, err := client.CreateCompanion(context.Background(), "driver:pane", "run-fail"); err == nil {
		t.Fatal("failed Atlas startup left an empty companion")
	}
	assertV11Calls(t, logPath, []string{
		"pane split driver:pane --direction right --ratio 0.42 --no-focus",
		`pane run driver:atlas "vault-hunter-atlas" --run "run-ok"`,
		"pane split driver:pane --direction right --ratio 0.42 --no-focus",
		`pane run driver:atlas "vault-hunter-atlas" --run "run-fail"`,
		"pane close driver:atlas",
	})
}

func TestV11AgentPreservesExactWorkspaceTabPaneAndSession(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "herdr")
	script := `#!/bin/sh
printf '{"result":{"agent":{"name":"codex-worker","workspace_id":"w2R","tab_id":"w2R:tB","pane_id":"w2R:pQ","terminal_id":"term-worker","agent_session":{"source":"herdr:codex","kind":"id","value":"session-worker"}}}}\n'
`
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	agent, err := (Client{Binary: binary}).Agent(context.Background(), "codex-worker")
	if err != nil {
		t.Fatal(err)
	}
	if agent.Name != "codex-worker" ||
		agent.WorkspaceID != "w2R" ||
		agent.TabID != "w2R:tB" ||
		agent.PaneID != "w2R:pQ" ||
		agent.TerminalID != "term-worker" ||
		agent.AgentSession != (AgentSession{
			Source: "herdr:codex",
			Kind:   "id",
			Value:  "session-worker",
		}) {
		t.Fatalf("Herdr identity was not preserved: %#v", agent)
	}
}

func assertV11Calls(t *testing.T, path string, want []string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Split(strings.TrimSpace(string(data)), "\n")
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Herdr calls:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

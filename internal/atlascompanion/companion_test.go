package atlascompanion

import (
	"reflect"
	"strings"
	"testing"
)

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

package atlas

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT18V04AcceptRejectRetryAndRetire(t *testing.T) {
	fixture := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t18-v04")
	stateRoot := t.TempDir()
	vaultRoot := t.TempDir()
	if err := copyTree(stateRoot, filepath.Join(fixture, "state")); err != nil {
		t.Fatal(err)
	}
	if err := copyTree(vaultRoot, filepath.Join(fixture, "vault")); err != nil {
		t.Fatal(err)
	}

	globalTaskID := atlasTaskID("T18", "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/18-parent-decisions.md")
	globalV02 := atlasVerifierID(globalTaskID, "V02")
	globalV03 := atlasVerifierID(globalTaskID, "V03")

	accepted, err := AcceptVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-201"}, 1)
	if err != nil {
		t.Fatal(err)
	}
	acceptedData := accepted.Data.(map[string]any)
	if accepted.Kind != "VerifierAttempt" || accepted.Meta["operation"] != "accept" || acceptedData["decision"] != "accepted" || acceptedData["revision"] != 2 {
		t.Fatalf("accepted envelope = %#v", accepted)
	}

	taskEnvelope, err := BuildEnvelope(vaultRoot, stateRoot, "tasks", MachineSelector{ID: globalTaskID}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	taskData := taskEnvelope.Data.(map[string]any)
	if taskData["status"] != "in-progress" {
		t.Fatalf("task status = %#v", taskData["status"])
	}
	verifiers := map[string]map[string]any{}
	for _, raw := range taskData["verifiers"].([]map[string]any) {
		verifiers[raw["id"].(string)] = raw
	}
	if verifiers[atlasVerifierID(globalTaskID, "V01")]["status"] != "passed" {
		t.Fatalf("V01 status = %#v", verifiers[atlasVerifierID(globalTaskID, "V01")])
	}
	if verifiers[globalV02]["status"] != "pending" || verifiers[globalV03]["status"] != "pending" || verifiers[atlasVerifierID(globalTaskID, "V04")]["status"] != "pending" {
		t.Fatalf("unexpected verifier statuses = %#v", verifiers)
	}
	runs := map[string]map[string]any{}
	for _, raw := range taskData["runs"].([]map[string]any) {
		runs[raw["id"].(string)] = raw
	}
	if runs["run-201"]["state"] != "active" || runs["run-202"]["state"] != "active" {
		t.Fatalf("task runs = %#v", runs)
	}

	if _, err := AcceptVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-201"}, 1); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("stale accept error = %v, want ErrConflict", err)
	}
	if _, err := RejectVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-201"}, 2, "too-late"); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("accepted attempt reject error = %v, want ErrConflict", err)
	}

	rejected, err := RejectVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-202"}, 1, "insufficient-evidence")
	if err != nil {
		t.Fatal(err)
	}
	rejectedData := rejected.Data.(map[string]any)
	if rejected.Kind != "VerifierAttempt" || rejected.Meta["operation"] != "reject" || rejectedData["decision"] != "rejected" || rejectedData["reason"] != "insufficient-evidence" {
		t.Fatalf("rejected envelope = %#v", rejected)
	}
	verifierEnvelope, err := BuildEnvelope(vaultRoot, stateRoot, "verifiers", MachineSelector{ID: globalV02}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	verifierData := verifierEnvelope.Data.(map[string]any)
	if verifierData["status"] != "pending" {
		t.Fatalf("rejected verifier status = %#v", verifierData)
	}
	attempts := verifierData["attempts"].([]map[string]any)
	if len(attempts) != 1 || attempts[0]["decision"] != "rejected" {
		t.Fatalf("rejected verifier attempts = %#v", attempts)
	}
	if _, err := RejectVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-202"}, 2, "again"); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("repeated reject error = %v, want ErrConflict", err)
	}
	if _, err := AcceptVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-202"}, 2); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("rejected attempt accept error = %v, want ErrConflict", err)
	}

	pendingEnvelope, err := BuildEnvelope(vaultRoot, stateRoot, "verifierattempts", MachineSelector{}, MachineGetOptions{Run: "retry-me", Pending: true})
	if err != nil {
		t.Fatal(err)
	}
	pendingData := pendingEnvelope.Data.([]map[string]any)
	if len(pendingData) != 1 || pendingData[0]["id"] != "attempt-204" {
		t.Fatalf("retry pending attempts = %#v", pendingData)
	}
	verifierEnvelope, err = BuildEnvelope(vaultRoot, stateRoot, "verifiers", MachineSelector{ID: globalV03}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	verifierData = verifierEnvelope.Data.(map[string]any)
	if verifierData["status"] != "pending" {
		t.Fatalf("retry verifier status = %#v", verifierData)
	}
	v03Attempts := verifierData["attempts"].([]map[string]any)
	if len(v03Attempts) != 2 || v03Attempts[0]["id"] == v03Attempts[1]["id"] {
		t.Fatalf("retry attempt history = %#v", v03Attempts)
	}

	if _, err := AcceptVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-shared"}, 1); !errors.Is(err, vaultregistry.ErrAmbiguous) {
		t.Fatalf("cross-run attempt selector error = %v, want ErrAmbiguous", err)
	}

	retired, err := RetireRunEnvelope(stateRoot, MachineSelector{Name: "retire-me"}, 1)
	if err != nil {
		t.Fatal(err)
	}
	retiredData := retired.Data.(map[string]any)
	if retired.Kind != "Run" || retired.Meta["operation"] != "retire" || retiredData["state"] != string(vaultregistry.RunStateRetired) || retiredData["revision"] != uint64(2) {
		t.Fatalf("retired envelope = %#v", retired)
	}
	listEnvelope, err := BuildEnvelope(vaultRoot, stateRoot, "runs", MachineSelector{}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var activeIDs []string
	for _, raw := range listEnvelope.Data.([]map[string]any) {
		activeIDs = append(activeIDs, raw["id"].(string))
	}
	sort.Strings(activeIDs)
	for _, id := range activeIDs {
		if id == "run-204" {
			t.Fatalf("retired run stayed in active list: %v", activeIDs)
		}
	}
	explicitRetired, err := BuildEnvelope(vaultRoot, stateRoot, "runs", MachineSelector{ID: "run-204"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	explicitData := explicitRetired.Data.(map[string]any)
	if explicitData["state"] != string(vaultregistry.RunStateRetired) {
		t.Fatalf("explicit retired read = %#v", explicitRetired)
	}
	retiredAttempts, err := BuildEnvelope(vaultRoot, stateRoot, "verifierattempts", MachineSelector{}, MachineGetOptions{Run: "retire-me"})
	if err != nil {
		t.Fatal(err)
	}
	attemptRows := retiredAttempts.Data.([]map[string]any)
	if len(attemptRows) != 1 || attemptRows[0]["run"].(map[string]any)["id"] != "run-204" {
		t.Fatalf("retired attempt history = %#v", attemptRows)
	}
	retiredParticipant, err := BuildEnvelope(vaultRoot, stateRoot, "participants", MachineSelector{ID: "participant-retired"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	participantData := retiredParticipant.Data.(map[string]any)
	if participantData["run"].(map[string]any)["id"] != "run-204" || participantData["usage"].(map[string]any)["total_tokens"] != int64(75) {
		t.Fatalf("retired participant read = %#v", participantData)
	}
	retiredUsage, err := BuildEnvelope(vaultRoot, stateRoot, "usage", MachineSelector{ID: "run-204"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	usageData := retiredUsage.Data.(map[string]any)
	if usageData["total_tokens"] != int64(75) {
		t.Fatalf("retired usage read = %#v", usageData)
	}
	usageList, err := BuildEnvelope(vaultRoot, stateRoot, "usage", MachineSelector{}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range usageList.Data.([]map[string]any) {
		if raw["run"].(map[string]any)["id"] == "run-204" {
			t.Fatalf("retired usage leaked into active list: %#v", usageList)
		}
	}
	participantList, err := BuildEnvelope(vaultRoot, stateRoot, "participants", MachineSelector{}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range participantList.Data.([]map[string]any) {
		if raw["id"] == "participant-retired" {
			t.Fatalf("retired participant leaked into active list: %#v", participantList)
		}
	}
	beforeFailedWrite, err := treeHash(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := RejectVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-205"}, 1, "too-late"); !errors.Is(err, vaultregistry.ErrConflict) {
		t.Fatalf("retired write error = %v, want ErrConflict", err)
	}
	afterFailedWrite, err := treeHash(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if beforeFailedWrite != afterFailedWrite {
		t.Fatalf("retired write changed bytes: before=%q after=%q", beforeFailedWrite, afterFailedWrite)
	}
}

func treeHash(root string) (string, error) {
	rows := make([]string, 0)
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rows = append(rows, rel+":"+string(data))
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Strings(rows)
	encoded, err := json.Marshal(rows)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

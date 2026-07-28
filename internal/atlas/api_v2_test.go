package atlas

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT18V02TypedReadsAndUsage(t *testing.T) {
	fixture := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t18-v02")
	vaultRoot := filepath.Join(fixture, "vault")
	stateRoot := filepath.Join(fixture, "state")

	project, err := BuildEnvelope(vaultRoot, stateRoot, "projects", MachineSelector{Name: "pi-agent"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	projectData := project.Data.(map[string]any)
	if project.Kind != "Project" || projectData["working_directory"] != "/worktrees/dotfiles" || projectData["repository"] != "git@github.com:aviralmansingka/dotfiles" {
		t.Fatalf("project = %#v", project)
	}

	globalTaskID := atlasTaskID("T09", "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/09-list-retire.md")
	globalVerifierID := atlasVerifierID(globalTaskID, "V01")

	run, err := BuildEnvelope(vaultRoot, stateRoot, "runs", MachineSelector{ID: "run-041"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	runData := run.Data.(map[string]any)
	attempts := runData["verifier_attempts"].([]map[string]any)
	task := runData["task"].(map[string]any)
	verifier := attempts[0]["verifier"].(map[string]any)
	if run.Kind != "Run" || runData["name"] != "registry-list-and-retire" || len(attempts) != 1 || task["id"] != globalTaskID || task["local_id"] != "T09" || verifier["id"] != globalVerifierID || verifier["local_id"] != "V01" {
		t.Fatalf("run = %#v", run)
	}

	usage, err := BuildEnvelope(vaultRoot, stateRoot, "usage", MachineSelector{ID: "run-041"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	usageData := usage.Data.(map[string]any)
	if usageData["input_tokens"] != int64(28410) || usageData["cached_input_tokens"] != int64(16600) || usageData["output_tokens"] != int64(5920) || usageData["total_tokens"] != int64(34330) {
		t.Fatalf("usage = %#v", usage)
	}

	pending, err := BuildEnvelope(vaultRoot, stateRoot, "verifierattempts", MachineSelector{}, MachineGetOptions{Run: "pending-review", Pending: true})
	if err != nil {
		t.Fatal(err)
	}
	if pending.Kind != "VerifierAttemptList" || len(pending.Data.([]map[string]any)) != 1 {
		t.Fatalf("pending = %#v", pending)
	}

	empty, err := BuildEnvelope(vaultRoot, stateRoot, "verifierattempts", MachineSelector{}, MachineGetOptions{Run: "registry-list-and-retire", Pending: true})
	if err != nil {
		t.Fatal(err)
	}
	if empty.Kind != "VerifierAttemptList" || len(empty.Data.([]map[string]any)) != 0 {
		t.Fatalf("empty = %#v", empty)
	}

	evidence, err := BuildEvidenceEnvelope(vaultRoot, stateRoot, MachineSelector{Positional: "evidence-017"})
	if err != nil {
		t.Fatal(err)
	}
	evidenceData := evidence.Data.(map[string]any)
	if evidence.Kind != "Evidence" || evidenceData["implementation_tree"] != "7a3d9f1" || evidenceData["task"].(map[string]any)["id"] != globalTaskID || evidenceData["verifier"].(map[string]any)["id"] != globalVerifierID {
		t.Fatalf("evidence = %#v", evidence)
	}
}

func TestT18V02CreateRunEnvelope(t *testing.T) {
	fixture := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t18-v02", "state")
	stateRoot := t.TempDir()
	if err := copyTree(stateRoot, fixture); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VAULT_HUNTER_STATE_DIR", stateRoot)

	response, err := CreateRunEnvelope("", []byte(`{
  "run": {
    "schema_version": 2,
    "run_id": "run-043",
    "name": "release-check",
    "run_kind": "hunter",
    "work_reference": {
      "id": "T09",
      "title": "Add Run Registry list and retire actions",
      "path": "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/tasks/09-list-retire.md",
      "feature_path": "1_projects/pi-agent/themes/pi-customization/features/vault-hunter-atlas/feature.md",
      "kind": "task"
    },
    "revision": 0,
    "state": "active",
    "stage": "invoked",
    "invoked_at": "2026-07-27T15:00:00Z",
    "updated_at": "2026-07-27T15:00:00Z",
    "observations": []
  },
  "initial_driver": {
    "observation_id": "driver-registered",
    "kind": "registered_participant",
    "state": "active",
    "goal_id": "run",
    "title": "Driver registered",
    "summary": "Driver registered.",
    "observed_at": "2026-07-27T15:00:00Z",
    "correlation_id": "run-043",
    "actor": {"kind": "participant", "id": "participant-100"},
    "source": {"kind": "producer", "id": "atlas"},
    "redaction_class": "internal",
    "started_at": "2026-07-27T15:00:00Z",
    "payload": {"registered_participant": {"participant_id": "participant-100", "role": "driver", "agent_session": {"source": "pi", "kind": "session", "value": "session-100"}}}
  }
}`))
	if err != nil {
		t.Fatal(err)
	}
	data := response.Data.(map[string]any)
	if response.Kind != "Run" || data["id"] != "run-043" || data["state"] != vaultregistry.RunStateActive {
		t.Fatalf("response = %#v", response)
	}
	created, err := os.ReadFile(filepath.Join(stateRoot, "runs", "run-043.json"))
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(created, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["name"] != "release-check" {
		t.Fatalf("created run = %#v", decoded)
	}
}

func copyTree(dst, src string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}

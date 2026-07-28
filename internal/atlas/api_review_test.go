package atlas

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestT18V02ScopesIncompleteProjectMetadata(t *testing.T) {
	vaultRoot := t.TempDir()
	stateRoot := t.TempDir()

	writeAtlasTestFile(t, vaultRoot, "1_projects/alpha/README.md", `---
working_directory: /worktrees/alpha
repository: git@example.com:alpha.git
---
# Alpha

Alpha project.
`)
	writeAtlasTestFile(t, vaultRoot, "1_projects/alpha/themes/core/theme.md", `---
description: Alpha theme.
---
# Core
`)
	writeAtlasTestFile(t, vaultRoot, "1_projects/alpha/themes/core/features/atlas/feature.md", `---
description: Alpha feature.
---
# Atlas
`)
	writeAtlasTestFile(t, vaultRoot, "1_projects/alpha/themes/core/features/atlas/tasks/01-good.md", `---
status: pending
---
# T01: Good task

## Intent
Ship the good task.

## Verifiers

- [ ] **V01 — Good verifier**
  - **Command:** go test ./good
  - **Expected:** Passes.
`)

	writeAtlasTestFile(t, vaultRoot, "1_projects/broken/README.md", `---
status: active
---
# Broken

Broken project.
`)
	writeAtlasTestFile(t, vaultRoot, "1_projects/broken/themes/missing/theme.md", `# Missing
`)
	writeAtlasTestFile(t, vaultRoot, "1_projects/broken/themes/missing/features/missing/feature.md", `# Missing
`)
	writeAtlasTestFile(t, vaultRoot, "1_projects/broken/themes/missing/features/missing/tasks/01-bad.md", `# T01: Bad task
`)

	projects, err := BuildEnvelope(vaultRoot, stateRoot, "projects", MachineSelector{}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if got := len(projects.Data.([]map[string]any)); got != 1 {
		t.Fatalf("project count = %d, want 1", got)
	}

	tasks, err := BuildEnvelope(vaultRoot, stateRoot, "tasks", MachineSelector{}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	taskRows := tasks.Data.([]map[string]any)
	goodTaskID := atlasTaskID("T01", "1_projects/alpha/themes/core/features/atlas/tasks/01-good.md")
	if len(taskRows) != 1 || taskRows[0]["id"] != goodTaskID {
		t.Fatalf("scoped task rows = %#v", taskRows)
	}

	goodTask, err := BuildEnvelope(vaultRoot, stateRoot, "tasks", MachineSelector{ID: goodTaskID}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if goodTask.Data.(map[string]any)["local_id"] != "T01" {
		t.Fatalf("good task local id = %#v", goodTask.Data)
	}

	_, err = BuildEnvelope(vaultRoot, stateRoot, "projects", MachineSelector{Name: "broken"}, MachineGetOptions{})
	if err == nil || !strings.Contains(err.Error(), "Project broken requires working_directory and repository frontmatter") {
		t.Fatalf("broken project error = %v", err)
	}
}

func TestT18V02GlobalizesDuplicateLocalTaskAndVerifierIDs(t *testing.T) {
	vaultRoot := t.TempDir()
	stateRoot := t.TempDir()

	const taskPathA = "1_projects/alpha/themes/core/features/atlas/tasks/01-shared.md"
	const featurePathA = "1_projects/alpha/themes/core/features/atlas/feature.md"
	const taskPathB = "1_projects/beta/themes/core/features/atlas/tasks/01-shared.md"
	const featurePathB = "1_projects/beta/themes/core/features/atlas/feature.md"

	writeAtlasTaskFixture(t, vaultRoot, "alpha", taskPathA, featurePathA, "T01", "Alpha shared task", "Alpha verifier")
	writeAtlasTaskFixture(t, vaultRoot, "beta", taskPathB, featurePathB, "T01", "Beta shared task", "Beta verifier")

	runA := atlasTestRun("run-a", "alpha-run", "T01", "Alpha shared task", taskPathA, featurePathA, "V01", "attempt-a", "participant-a", true)
	runB := atlasTestRun("run-b", "beta-run", "T01", "Beta shared task", taskPathB, featurePathB, "V01", "attempt-b", "participant-b", false)
	writeAtlasRun(t, stateRoot, "runs", runA)
	writeAtlasRun(t, stateRoot, "runs", runB)

	taskIDA := atlasTaskID("T01", taskPathA)
	taskIDB := atlasTaskID("T01", taskPathB)
	verifierIDA := atlasVerifierID(taskIDA, "V01")
	verifierIDB := atlasVerifierID(taskIDB, "V01")

	tasks, err := BuildEnvelope(vaultRoot, stateRoot, "tasks", MachineSelector{}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	rows := tasks.Data.([]map[string]any)
	ids := []string{rows[0]["id"].(string), rows[1]["id"].(string)}
	sort.Strings(ids)
	if len(rows) != 2 || ids[0] != taskIDA || ids[1] != taskIDB {
		t.Fatalf("global task ids = %#v", rows)
	}
	for _, row := range rows {
		if row["local_id"] != "T01" {
			t.Fatalf("task local id missing from %#v", row)
		}
	}

	run, err := BuildEnvelope(vaultRoot, stateRoot, "runs", MachineSelector{ID: "run-a"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	runData := run.Data.(map[string]any)
	if runData["task"].(map[string]any)["id"] != taskIDA || runData["task"].(map[string]any)["local_id"] != "T01" {
		t.Fatalf("run task identity = %#v", runData["task"])
	}
	attempt := runData["verifier_attempts"].([]map[string]any)[0]
	if attempt["verifier"].(map[string]any)["id"] != verifierIDA || attempt["verifier"].(map[string]any)["local_id"] != "V01" {
		t.Fatalf("run verifier identity = %#v", attempt["verifier"])
	}

	verifier, err := BuildEnvelope(vaultRoot, stateRoot, "verifiers", MachineSelector{ID: verifierIDB}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	verifierData := verifier.Data.(map[string]any)
	if verifierData["task"].(map[string]any)["id"] != taskIDB || verifierData["local_id"] != "V01" {
		t.Fatalf("verifier envelope = %#v", verifierData)
	}

	evidence, err := BuildEvidenceEnvelope(vaultRoot, stateRoot, MachineSelector{ID: "evidence-a"})
	if err != nil {
		t.Fatal(err)
	}
	evidenceData := evidence.Data.(map[string]any)
	if evidenceData["task"].(map[string]any)["id"] != taskIDA || evidenceData["verifier"].(map[string]any)["id"] != verifierIDA {
		t.Fatalf("evidence envelope = %#v", evidenceData)
	}

	if _, err := AcceptVerifierAttemptEnvelope(stateRoot, MachineSelector{ID: "attempt-b"}, 1); err != nil {
		t.Fatal(err)
	}
	reader, err := vaultregistry.OpenReader(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := reader.Get("run-b")
	if err != nil {
		t.Fatal(err)
	}
	if got := updated.Observations[len(updated.Observations)-1].GoalID; got != verifierIDB {
		t.Fatalf("decision goal id = %q, want %q", got, verifierIDB)
	}
}

func TestT18V04RetiredSecondaryReads(t *testing.T) {
	fixture := filepath.Join("..", "..", "scripts", "fixtures", "vault-hunter-atlas-t18-v04")
	stateRoot := t.TempDir()
	vaultRoot := t.TempDir()
	if err := copyTree(stateRoot, filepath.Join(fixture, "state")); err != nil {
		t.Fatal(err)
	}
	if err := copyTree(vaultRoot, filepath.Join(fixture, "vault")); err != nil {
		t.Fatal(err)
	}
	if _, err := RetireRunEnvelope(stateRoot, MachineSelector{Name: "retire-me"}, 1); err != nil {
		t.Fatal(err)
	}

	attempts, err := BuildEnvelope(vaultRoot, stateRoot, "verifierattempts", MachineSelector{}, MachineGetOptions{Run: "retire-me"})
	if err != nil {
		t.Fatal(err)
	}
	attemptRows := attempts.Data.([]map[string]any)
	if len(attemptRows) != 1 || attemptRows[0]["run"].(map[string]any)["id"] != "run-204" {
		t.Fatalf("retired verifier attempts = %#v", attemptRows)
	}

	participant, err := BuildEnvelope(vaultRoot, stateRoot, "participants", MachineSelector{ID: "participant-retired"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	participantData := participant.Data.(map[string]any)
	if participantData["run"].(map[string]any)["id"] != "run-204" || participantData["usage"].(map[string]any)["total_tokens"] != int64(75) {
		t.Fatalf("retired participant = %#v", participantData)
	}

	usage, err := BuildEnvelope(vaultRoot, stateRoot, "usage", MachineSelector{ID: "run-204"}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	usageData := usage.Data.(map[string]any)
	if usageData["total_tokens"] != int64(75) || usageData["participants"].([]map[string]any)[0]["id"] != "participant-retired" {
		t.Fatalf("retired usage = %#v", usageData)
	}

	activeUsage, err := BuildEnvelope(vaultRoot, stateRoot, "usage", MachineSelector{}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range activeUsage.Data.([]map[string]any) {
		if row["run"].(map[string]any)["id"] == "run-204" {
			t.Fatalf("retired usage leaked into active list: %#v", activeUsage.Data)
		}
	}

	activeParticipants, err := BuildEnvelope(vaultRoot, stateRoot, "participants", MachineSelector{}, MachineGetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range activeParticipants.Data.([]map[string]any) {
		if row["id"] == "participant-retired" {
			t.Fatalf("retired participant leaked into active list: %#v", activeParticipants.Data)
		}
	}
}

func writeAtlasTaskFixture(t *testing.T, vaultRoot, project, taskPath, featurePath, localTaskID, taskTitle, verifierTitle string) {
	t.Helper()
	writeAtlasTestFile(t, vaultRoot, filepath.Join("1_projects", project, "README.md"), "---\nworking_directory: /worktrees/"+project+"\nrepository: git@example.com:"+project+".git\n---\n# "+strings.Title(project)+"\n\nProject.\n")
	writeAtlasTestFile(t, vaultRoot, filepath.Join("1_projects", project, "themes/core/theme.md"), "---\ndescription: Core theme.\n---\n# Core\n")
	writeAtlasTestFile(t, vaultRoot, featurePath, "---\ndescription: Atlas feature.\n---\n# Atlas\n")
	writeAtlasTestFile(t, vaultRoot, taskPath, "---\nstatus: pending\n---\n# "+localTaskID+": "+taskTitle+"\n\n## Intent\nDeliver "+taskTitle+".\n\n## Verifiers\n\n- [ ] **V01 — "+verifierTitle+"**\n  - **Command:** go test ./...\n  - **Expected:** Passes.\n")
}

func writeAtlasTestFile(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeAtlasRun(t *testing.T, stateRoot, namespace string, run vaultregistry.Run) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(stateRoot, "registry.lock"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(stateRoot, namespace, run.RunID+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}

func atlasTestRun(runID, runName, localTaskID, taskTitle, taskPath, featurePath, localVerifierID, attemptID, participantID string, accepted bool) vaultregistry.Run {
	startedAt := "2026-07-29T10:00:00Z"
	finishedAt := "2026-07-29T10:01:00Z"
	decisionAt := "2026-07-29T10:02:00Z"
	exitStatus := 0
	observations := []vaultregistry.Observation{{
		ObservationID:  attemptID + "-terminal",
		Kind:           vaultregistry.KindVerifierAttempt,
		State:          vaultregistry.StatePassed,
		GoalID:         localTaskID + "." + localVerifierID,
		Title:          taskTitle,
		Summary:        taskTitle + " passed.",
		ObservedAt:     finishedAt,
		CorrelationID:  runID,
		Actor:          vaultregistry.Identity{Kind: "participant", ID: participantID},
		Source:         vaultregistry.Identity{Kind: "producer", ID: "fixture"},
		RedactionClass: "internal",
		StartedAt:      stringPointer(startedAt),
		FinishedAt:     stringPointer(finishedAt),
		Payload: vaultregistry.ObservationPayload{VerifierAttempt: &vaultregistry.VerifierAttemptPayload{Identity: vaultregistry.VerifierAttemptIdentity{
			AttemptID:                 attemptID,
			VerifierID:                localVerifierID,
			SpecificationSHA256:       strings.Repeat("a", 64),
			Phase:                     vaultregistry.PhaseAffected,
			InvocationID:              "invoke-" + attemptID,
			Command:                   "go test ./...",
			WorkingDirectory:          "/worktrees/dotfiles",
			EnvironmentContractSHA256: strings.Repeat("b", 64),
			ImplementationCommit:      strings.Repeat("1", 40),
			ImplementationTree:        strings.Repeat("2", 40),
			Producer:                  vaultregistry.Identity{Kind: "participant", ID: participantID},
		}, ExitStatus: &exitStatus, ResultManifest: &vaultregistry.ManifestMetadata{Path: "manifests/" + attemptID + ".json", SHA256: strings.Repeat("c", 64), MediaType: "application/json", Authenticated: true}}},
	}}
	updatedAt := finishedAt
	revision := uint64(1)
	if accepted {
		observations = append(observations, vaultregistry.Observation{
			ObservationID:  "decision-" + attemptID,
			Kind:           vaultregistry.KindVerifierDecision,
			State:          vaultregistry.StateAccepted,
			GoalID:         localTaskID + "." + localVerifierID,
			Title:          "accepted",
			Summary:        "accepted",
			ObservedAt:     decisionAt,
			CorrelationID:  runID,
			Actor:          vaultregistry.Identity{Kind: "participant", ID: "parent"},
			Source:         vaultregistry.Identity{Kind: "producer", ID: "fixture"},
			RedactionClass: "internal",
			Payload:        vaultregistry.ObservationPayload{VerifierDecision: &vaultregistry.VerifierDecisionPayload{AttemptID: attemptID}},
		})
		updatedAt = decisionAt
		revision = 2
	}
	return vaultregistry.Run{
		SchemaVersion: 2,
		RunID:         runID,
		Name:          runName,
		RunKind:       vaultregistry.RunKindHunter,
		WorkReference: &vaultregistry.WorkReference{ID: localTaskID, Title: taskTitle, Path: taskPath, FeaturePath: featurePath, Kind: "task"},
		Revision:      revision,
		State:         vaultregistry.RunStateActive,
		Stage:         "awaiting-parent",
		InvokedAt:     startedAt,
		UpdatedAt:     updatedAt,
		Observations:  observations,
	}
}

func TestT18V02BoundedCollectionResources(t *testing.T) {
	vaultRoot := t.TempDir()
	stateRoot := t.TempDir()

	for i := 1; i <= 8; i++ {
		project := fmt.Sprintf("proj-%02d", i)
		taskPath := fmt.Sprintf("1_projects/%s/themes/core/features/atlas/tasks/01-shared.md", project)
		featurePath := fmt.Sprintf("1_projects/%s/themes/core/features/atlas/feature.md", project)
		writeAtlasTaskFixture(t, vaultRoot, project, taskPath, featurePath, "T01", strings.Repeat("Atlas task ", 8)+project, strings.Repeat("Verifier ", 8)+project)
		run := atlasTestRun(
			fmt.Sprintf("run-%02d", i),
			fmt.Sprintf("run-name-%02d", i),
			"T01",
			strings.Repeat("Atlas task ", 8)+project,
			taskPath,
			featurePath,
			"V01",
			fmt.Sprintf("attempt-%02d", i),
			fmt.Sprintf("participant-%02d", i),
			i%2 == 0,
		)
		run.Observations = append([]vaultregistry.Observation{
			atlasParticipantObservation(run.RunID, fmt.Sprintf("participant-%02d", i), fmt.Sprintf("2026-07-29T09:%02d:00Z", i)),
			atlasTelemetryObservation(run.RunID, fmt.Sprintf("participant-%02d", i), fmt.Sprintf("2026-07-29T09:%02d:30Z", i), int64(100+i), int64(10+i), int64(40+i)),
		}, run.Observations...)
		writeAtlasRun(t, stateRoot, "runs", run)
	}

	specs := []struct {
		resource string
		id       func(map[string]any) string
	}{
		{resource: "projects", id: func(item map[string]any) string { return item["id"].(string) }},
		{resource: "themes", id: func(item map[string]any) string { return item["id"].(string) }},
		{resource: "features", id: func(item map[string]any) string { return item["id"].(string) }},
		{resource: "tasks", id: func(item map[string]any) string { return item["id"].(string) }},
		{resource: "runs", id: func(item map[string]any) string { return item["id"].(string) }},
		{resource: "verifiers", id: func(item map[string]any) string { return item["id"].(string) }},
		{resource: "verifierattempts", id: func(item map[string]any) string { return item["id"].(string) }},
		{resource: "participants", id: func(item map[string]any) string { return item["id"].(string) }},
		{resource: "usage", id: func(item map[string]any) string { return item["run"].(map[string]any)["id"].(string) }},
	}

	for _, spec := range specs {
		t.Run(spec.resource, func(t *testing.T) {
			t.Setenv("ATLAS_MAX_COLLECTION_BYTES", "1000000")
			full, err := BuildEnvelope(vaultRoot, stateRoot, spec.resource, MachineSelector{}, MachineGetOptions{})
			if err != nil {
				t.Fatal(err)
			}
			fullData := full.Data.([]map[string]any)
			if len(fullData) != 8 || full.Meta["count"] != 8 || full.Meta["truncated"].(bool) {
				t.Fatalf("full %s envelope = %#v", spec.resource, full)
			}
			fullIDs := make([]string, 0, len(fullData))
			for _, item := range fullData {
				fullIDs = append(fullIDs, spec.id(item))
			}
			sortedIDs := append([]string(nil), fullIDs...)
			sort.Strings(sortedIDs)
			if strings.Join(fullIDs, ",") != strings.Join(sortedIDs, ",") {
				t.Fatalf("full %s ids = %v, want deterministic order %v", spec.resource, fullIDs, sortedIDs)
			}

			t.Setenv("ATLAS_MAX_COLLECTION_BYTES", "700")
			bounded, err := BuildEnvelope(vaultRoot, stateRoot, spec.resource, MachineSelector{}, MachineGetOptions{})
			if err != nil {
				t.Fatal(err)
			}
			boundedData := bounded.Data.([]map[string]any)
			if !bounded.Meta["truncated"].(bool) || bounded.Meta["count"] != 8 || len(boundedData) >= len(fullData) {
				t.Fatalf("bounded %s envelope = %#v", spec.resource, bounded)
			}
			for i, item := range boundedData {
				if got, want := spec.id(item), fullIDs[i]; got != want {
					t.Fatalf("bounded %s prefix[%d] = %q, want %q", spec.resource, i, got, want)
				}
			}
		})
	}
}

func atlasParticipantObservation(runID, participantID, observedAt string) vaultregistry.Observation {
	startedAt := observedAt
	return vaultregistry.Observation{
		ObservationID:  "participant-" + participantID,
		Kind:           vaultregistry.KindRegisteredParticipant,
		State:          vaultregistry.StateActive,
		GoalID:         "T18.V02",
		Title:          "participant",
		Summary:        "participant registered",
		ObservedAt:     observedAt,
		CorrelationID:  runID,
		StartedAt:      &startedAt,
		Actor:          vaultregistry.Identity{Kind: "participant", ID: participantID},
		Source:         vaultregistry.Identity{Kind: "fixture", ID: "fixture"},
		RedactionClass: "internal",
		Payload: vaultregistry.ObservationPayload{RegisteredParticipant: &vaultregistry.RegisteredParticipantPayload{
			ParticipantID: participantID,
			Role:          "worker",
			AgentSession:  vaultregistry.AgentSession{Source: "pi", Kind: "session", Value: runID},
		}},
	}
}

func atlasTelemetryObservation(runID, participantID, observedAt string, input, cached, output int64) vaultregistry.Observation {
	return vaultregistry.Observation{
		ObservationID:  "usage-" + participantID,
		Kind:           vaultregistry.KindRuntimeTelemetry,
		State:          vaultregistry.StateActive,
		GoalID:         "T18.V02",
		Title:          "usage",
		Summary:        "usage recorded",
		ObservedAt:     observedAt,
		CorrelationID:  runID,
		Actor:          vaultregistry.Identity{Kind: "participant", ID: participantID},
		Source:         vaultregistry.Identity{Kind: "fixture", ID: "fixture"},
		RedactionClass: "internal",
		Payload: vaultregistry.ObservationPayload{RuntimeTelemetry: &vaultregistry.RuntimeTelemetryPayload{
			ParticipantID: participantID,
			Usage: &vaultregistry.UsageCounters{
				Scope:           vaultregistry.UsageDelta,
				InputTokens:     i64ptr(input),
				CacheReadTokens: i64ptr(cached),
				OutputTokens:    i64ptr(output),
			},
		}},
	}
}

func i64ptr(value int64) *int64 { return &value }

func stringPointer(value string) *string { return &value }

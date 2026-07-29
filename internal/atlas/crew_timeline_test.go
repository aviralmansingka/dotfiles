package atlas

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aviral/dotfiles/internal/vaultregistry"
)

func TestCrewTimelineCanonicalSignalsAndRoles(t *testing.T) {
	compat, _ := json.Marshal("Delivery Steward")
	role, source := participantCrewRole(vaultregistry.Participant{Role: "Convergence Engineer"})
	if role != "Convergence Engineer" || source != "inferred/v1-role" {
		t.Fatalf("v1 role = %q, %q", role, source)
	}
	role, _ = participantCrewRole(vaultregistry.Participant{Role: "worker", Unknown: map[string]json.RawMessage{"crew_role": compat}})
	if role != "Delivery Steward" {
		t.Fatalf("compatibility role = %q", role)
	}

	vault := t.TempDir()
	t.Setenv("VAULT_ROOT", vault)
	path := filepath.Join(vault, "task.md")
	body := "---\nstatus: failed\n---\nReferenced prototype https://github.com/acme/prototype/pull/1\n\n## Verifiers\n- [x] **V01 — pass**\n- [-] **V02 — fail**\n\n## Pull Request Evidence\n- https://github.com/acme/implementation/pull/42\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	signals := readTaskSignals(vaultregistry.Run{Task: vaultregistry.Task{Path: "task.md"}}, nil)
	if signals.pullRequest != "https://github.com/acme/implementation/pull/42" || !signals.verifiersFailed || !signals.taskFailed {
		t.Fatalf("signals = %#v", signals)
	}
}

func TestCrewTimelineQualifiedRegistryFallbackAndFailureLegend(t *testing.T) {
	zero := 0
	run := vaultregistry.Run{
		Task: vaultregistry.Task{ID: "T14", Path: "missing.md"}, RunID: "run", Revision: 1,
		Evidence: []vaultregistry.Evidence{{VerifierID: "T14.V01", State: "passed", ExitStatus: &zero}},
	}
	signals := readTaskSignals(run, []string{"V01"})
	if !signals.verifiersComplete || signals.completeVerifiers != 1 {
		t.Fatalf("fallback = %#v", signals)
	}
	view := NewJournalModel(run, 100, 24).ViewColor(false)
	if !strings.Contains(view, "× failed") {
		t.Fatalf("failure legend missing from %q", view)
	}
}

func TestImplementationPullRequestRequiresCanonicalLocation(t *testing.T) {
	body := "Dependency: https://github.com/acme/dependency/pull/7\n"
	if got := implementationPullRequest(body); got != "" {
		t.Fatalf("unrelated PR accepted: %q", got)
	}
	body += "Implementation PR: https://github.com/acme/project/pull/8\n"
	if got := implementationPullRequest(body); got != "https://github.com/acme/project/pull/8" {
		t.Fatalf("implementation PR = %q", got)
	}
}

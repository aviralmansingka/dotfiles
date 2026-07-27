// P03 asks whether parent acceptance can be the sole transition that projects temporary
// No Mistakes Markdown into a canonical Vault Hunter Task without letting blocked or
// unaccepted runs mutate vault state.
//
// Run the proof: go run ./prototypes/no-mistakes-hunter-projection --scenario
// Drive it by hand: go run ./prototypes/no-mistakes-hunter-projection
package main

import (
	"bufio"
	"crypto/sha256"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const runID = "nm-p03-synthetic-run"

type prototype struct {
	root     string
	state    state
	task     string
	runtime  string
	evidence string
}

func newPrototype() (*prototype, error) {
	root, err := os.MkdirTemp("", "no-mistakes-hunter-projection-")
	if err != nil {
		return nil, err
	}
	p := &prototype{
		root:     root,
		state:    fresh,
		task:     filepath.Join(root, "vault", "tasks", "01-synthetic-delivery.md"),
		runtime:  filepath.Join(root, "runtime", runID),
		evidence: filepath.Join(root, "vault", "tasks", "01-synthetic-delivery", "evidence", "no-mistakes", runID),
	}
	if err := os.MkdirAll(filepath.Dir(p.task), 0o755); err != nil {
		return nil, err
	}
	task := "# Synthetic Delivery\n\n## Intent\n\nProve parent-owned evidence projection.\n\n" +
		"## Decisions and boundaries\n\nNo Mistakes cannot write this Task.\n\n" +
		"## Verifiers\n\n- V01: exercise accepted and blocked projection.\n\n" +
		"## Unresolved decisions\n\nNone.\n\n## Evidence\n\nPending.\n"
	return p, os.WriteFile(p.task, []byte(task), 0o644)
}

func (p *prototype) apply(wanted action) error {
	result, err := next(p.state, wanted)
	if err != nil {
		return err
	}
	switch wanted {
	case emit:
		err = p.emit()
	case project:
		err = p.project()
	}
	if err == nil {
		p.state = result
	}
	return err
}

func (p *prototype) emit() error {
	if err := os.MkdirAll(p.runtime, 0o755); err != nil {
		return err
	}
	files := map[string]string{
		"intent.md":   "# Intent\n\nDeliver the synthetic change without changing Task authority.\n",
		"findings.md": "# Findings\n\n- Targeted checks passed.\n- No blocking findings.\n",
		"outcome.md":  "# Outcome\n\nNo Mistakes result: passed; parent acceptance required.\n",
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(p.runtime, name), []byte(body), 0o600); err != nil {
			return err
		}
	}
	return nil
}

func (p *prototype) project() error {
	findings := filepath.Join(p.runtime, "findings.md")
	body, err := os.ReadFile(findings)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(p.evidence, 0o755); err != nil {
		return err
	}
	destination := filepath.Join(p.evidence, "findings.md")
	if err := os.WriteFile(destination, body, 0o644); err != nil {
		return err
	}
	task, err := os.ReadFile(p.task)
	if err != nil {
		return err
	}
	sourceHash := hash(body)
	block := fmt.Sprintf("Run `%s` accepted by the Vault Hunter parent.\n\n"+
		"- Runtime source: `findings.md`\n"+
		"- SHA-256: `%s`\n"+
		"- Vault artifact: `01-synthetic-delivery/evidence/no-mistakes/%s/findings.md`\n", runID, sourceHash, runID)
	updated := strings.Replace(string(task), "## Evidence\n\nPending.", "## Evidence\n\n"+block, 1)
	return os.WriteFile(p.task, []byte(updated), 0o644)
}

func hash(body []byte) string {
	return fmt.Sprintf("%x", sha256.Sum256(body))
}

func fileHash(path string) (string, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return hash(body), nil
}

func (p *prototype) render() {
	fmt.Printf("\033[2J\033[H\033[1mP03 Hunter projection\033[0m\n")
	fmt.Printf("\033[1mstate\033[0m: %s\n", p.state)
	fmt.Printf("\033[1mruntime\033[0m: runtime/%s\n", runID)
	fmt.Printf("\033[1mtask\033[0m: vault/tasks/01-synthetic-delivery.md\n")
	fmt.Printf("\033[1mevidence\033[0m: vault/tasks/01-synthetic-delivery/evidence/no-mistakes/%s\n\n", runID)
	fmt.Println("[e] emit temporary Markdown  [a] parent accepts  [b] block run  [p] project  [q] quit")
}

func scenario() error {
	fmt.Printf("stage mapping: review=%s test=%s push=%s rebase=%s\n",
		hunterUse("review"), hunterUse("test"), hunterUse("push"), hunterUse("rebase"))
	fmt.Println("authority: passed=parent-evaluation blocked=decision-only canonical-write=parent-accept-only")

	allowed, err := newPrototype()
	if err != nil {
		return err
	}
	defer os.RemoveAll(allowed.root)

	if err := allowed.apply(emit); err != nil {
		return err
	}
	before, err := fileHash(allowed.task)
	if err != nil {
		return err
	}
	unacceptedErr := allowed.apply(project)
	after, err := fileHash(allowed.task)
	if err != nil {
		return err
	}
	fmt.Printf("unaccepted projection: denied=%t task_unchanged=%t\n", unacceptedErr != nil, before == after)

	if err := allowed.apply(accept); err != nil {
		return err
	}
	if err := allowed.apply(project); err != nil {
		return err
	}
	sourceHash, err := fileHash(filepath.Join(allowed.runtime, "findings.md"))
	if err != nil {
		return err
	}
	vaultHash, err := fileHash(filepath.Join(allowed.evidence, "findings.md"))
	if err != nil {
		return err
	}
	task, err := os.ReadFile(allowed.task)
	if err != nil {
		return err
	}
	dotfilesEvidence := filepath.Join(allowed.root, "dotfiles", ".no-mistakes", "evidence")
	fmt.Printf("accepted projection: state=%s hashes_match=%t provenance_recorded=%t dotfiles_evidence_absent=%t\n",
		allowed.state,
		sourceHash == vaultHash,
		strings.Contains(string(task), runID) && strings.Contains(string(task), sourceHash),
		!pathExists(dotfilesEvidence),
	)

	denied, err := newPrototype()
	if err != nil {
		return err
	}
	defer os.RemoveAll(denied.root)
	if err := denied.apply(emit); err != nil {
		return err
	}
	if err := denied.apply(block); err != nil {
		return err
	}
	before, err = fileHash(denied.task)
	if err != nil {
		return err
	}
	blockedErr := denied.apply(project)
	after, err = fileHash(denied.task)
	if err != nil {
		return err
	}
	fmt.Printf("blocked projection: denied=%t task_unchanged=%t vault_artifact_absent=%t\n",
		blockedErr != nil, before == after, !pathExists(denied.evidence))

	if unacceptedErr == nil || blockedErr == nil || sourceHash != vaultHash ||
		!strings.Contains(string(task), sourceHash) || before != after || pathExists(dotfilesEvidence) ||
		hunterUse("review") != "candidate-independent-review" ||
		hunterUse("test") != "candidate-task-verifier" ||
		hunterUse("push") != "delivery-evidence-only" ||
		hunterUse("rebase") != "implementation-observation-only" {
		return fmt.Errorf("scenario assertions failed")
	}
	fmt.Println("P03 PASS")
	return nil
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func main() {
	runScenario := flag.Bool("scenario", false, "run the deterministic accepted and denied proof")
	flag.Parse()
	if *runScenario {
		if err := scenario(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	p, err := newPrototype()
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(p.root)
	reader := bufio.NewReader(os.Stdin)
	for {
		p.render()
		key, _, err := reader.ReadRune()
		if err != nil || key == 'q' {
			return
		}
		wanted := map[rune]action{'e': emit, 'a': accept, 'b': block, 'p': project}[key]
		if wanted != "" {
			if err := p.apply(wanted); err != nil {
				fmt.Printf("\nDenied: %v\nPress enter to continue.", err)
				_, _ = reader.ReadString('\n')
			}
		}
	}
}

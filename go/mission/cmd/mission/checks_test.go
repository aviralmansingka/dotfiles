package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.yaml.in/yaml/v3"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func TestTitlesOnlyStepsAndCustomization(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	r.Mission.Slug = "titles-only"
	r.Mission.Steps = []mission.Step{{Title: "Map events"}, {Title: "Propose the adapter"}}
	r, e = s.create(r.Mission)
	must(t, e)
	steps, e := s.steps(r.Handle)
	must(t, e)
	st := steps[0].Step
	if st.ID != "S01" || st.Agent != "any" || st.Output != "step-01.md" || strings.Join(st.Checks, ",") != "nonempty-artifact" {
		t.Fatalf("unexpected defaults: %+v", st)
	}
	st.Instructions = "Inspect session shutdown"
	st.Acceptance = "Cover all shutdown paths"
	st.Output = "events.json"
	st.Checks = []string{"json-valid"}
	updated, e := s.editStep(r.Handle, st.ID, st, r.State.Revision, false)
	must(t, e)
	if len(updated.State.Edits) != 1 {
		t.Fatal("edit not preserved")
	}
	one, e := s.step(r.Handle, "S01")
	must(t, e)
	if one.Step.Instructions != st.Instructions || len(one.Step.Checks) != 2 {
		t.Fatal("customization not saved")
	}
	c, e := s.claim(r.Handle, "scout", "", "", false)
	must(t, e)
	if c.Attempt.Definition.Acceptance != st.Acceptance || !strings.Contains(c.Attempt.Brief, st.Instructions) {
		t.Fatal("attempt did not snapshot the customized step")
	}
	_, e = s.editStep(r.Handle, "S02", updated.Mission.Steps[1], updated.State.Revision+1, false)
	wantCode(t, e, "busy")
}

func TestCheckEvidenceAndCompletionGate(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	st := r.Mission.Steps[0]
	st.Checks = []string{"json-valid"}
	r, e = s.editStep(h, "S01", st, r.State.Revision, false)
	must(t, e)
	c := claimTest(t, s, h)
	r, e = s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	v := r.State.Attempts[0].Verifications[0]
	if v.Results[0].Verdict != "failed" || v.Results[1].Verdict != "not_run" {
		t.Fatal("missing result did not prevent dependent checks")
	}
	result(t, s, c, "not JSON")
	_, e = s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	wantCode(t, e, "checks_failed")
	r, e = s.load(h)
	must(t, e)
	if r.State.Active == "" || r.State.Steps["S01"].Status != "running" {
		t.Fatal("failed checks advanced the step")
	}
	result(t, s, c, `{"events":["session-start"]}`)
	r, e = s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	a := r.State.Attempts[0]
	if len(a.Verifications) != 3 || !s.verified(r, a) {
		t.Fatal("verification history or proof missing")
	}
	latest := a.Verifications[2]
	if latest.Results[1].Verdict != "passed" || latest.SubjectHash == "" || latest.Runner == "" {
		t.Fatal("structured verification incomplete")
	}
	d, _ := s.dir(h)
	log := filepath.Join(d, latest.Results[1].Evidence[0].Path)
	original, e := os.ReadFile(log)
	must(t, e)
	must(t, os.WriteFile(log, []byte("altered log"), 0600))
	_, e = s.checkpoint(h, "C01", "accept", "Reviewed", "aviral", true, r.State.Revision)
	wantCode(t, e, "evidence_changed")
	must(t, os.WriteFile(log, original, 0600))
	_, e = s.checkpoint(h, "C01", "accept", "Reviewed", "aviral", true, r.State.Revision)
	must(t, e)
}

func TestStepResetKeepsOldAttemptsAndDecisions(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Original evidence")
	r, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	r, e = s.checkpoint(h, "C01", "accept", "Accept", "aviral", true, r.State.Revision)
	must(t, e)
	next, e := s.claim(h, "scout", "", "", false)
	must(t, e)
	result(t, s, next, "Final evidence")
	r, e = s.finish(h, next.Attempt.ID, next.Token, false, "", false, 0)
	must(t, e)
	st := r.Mission.Steps[0]
	st.Acceptance = "Also cover cancelled sessions"
	_, e = s.editStep(h, "S01", st, r.State.Revision, false)
	wantCode(t, e, "step_started")
	r, e = s.editStep(h, "S01", st, r.State.Revision, true)
	must(t, e)
	if r.State.Steps["S02"].Status != "pending" || r.State.Checkpoints["C01"].Status != "invalidated" || len(r.State.Decisions) != 1 {
		t.Fatal("downstream progress not invalidated or history lost")
	}
	if r.State.Attempts[0].Definition.Acceptance == st.Acceptance {
		t.Fatal("old attempt definition was rewritten")
	}
	b, e := os.ReadFile(s.Artifacts(c))
	must(t, e)
	if string(b) != "Original evidence" {
		t.Fatal("old evidence changed")
	}
	newAttempt, e := s.claim(h, "scout", "", "", false)
	must(t, e)
	if newAttempt.Attempt.Sequence != 3 || newAttempt.Step.Acceptance != st.Acceptance {
		t.Fatal("new attempt did not use edited step")
	}
}

func TestInterruptedStepEditIsRepairable(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	baseRev, baseHash := r.State.Revision, r.State.SpecHash
	r.Mission.Steps[0].Instructions = "Recovered customization"
	r.State.Revision++
	b, e := platform.Markdown(r.Mission, r.Mission.Body)
	must(t, e)
	r.State.SpecHash = mission.Digest(b)
	tx := pendingEdit{Handle: h, Mission: r.Mission, Body: r.Mission.Body, State: r.State, BaseRevision: baseRev, BaseHash: baseHash}
	journal, e := yaml.Marshal(tx)
	must(t, e)
	p, e := s.editPath(h)
	must(t, e)
	must(t, platform.AtomicWrite(p, journal))
	d, _ := s.dir(h)
	must(t, platform.AtomicWrite(filepath.Join(d, "mission.md"), b))
	_, e = s.load(h)
	wantCode(t, e, "edit_pending")
	r, e = s.repair(h)
	must(t, e)
	if r.Mission.Steps[0].Instructions != "Recovered customization" {
		t.Fatal("edit not replayed")
	}
	_, e = s.claim(h, "scout", "", "", false)
	must(t, e)
}

func TestInvalidChecksAndStaleEditsDoNotChangeNotes(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	st := r.Mission.Steps[0]
	st.Checks = []string{"arbitrary-shell"}
	_, e = s.editStep(h, "S01", st, r.State.Revision, false)
	wantCode(t, e, "invalid_check")
	st.Checks = []string{"json-valid"}
	_, e = s.editStep(h, "S01", st, r.State.Revision+1, false)
	wantCode(t, e, "revision_conflict")
	same, e := s.load(h)
	must(t, e)
	if len(same.State.Edits) != 0 || same.State.SpecHash != r.State.SpecHash {
		t.Fatal("invalid edit changed state")
	}
}

func TestGoCheckAllowsOtherMissionsAndDetectsChangedSource(t *testing.T) {
	s, h := fixture(t)
	checkout := t.TempDir()
	cgit := exec.Command("git", "-C", checkout, "init", "-q")
	if b, e := cgit.CombinedOutput(); e != nil {
		t.Fatalf("git init: %s %v", b, e)
	}
	_, e := s.addRepo("dotfiles", checkout, "")
	must(t, e)
	must(t, os.WriteFile(filepath.Join(checkout, "go.mod"), []byte("module example.test/checkfixture\n\ngo 1.26.0\n"), 0600))
	source := filepath.Join(checkout, "value.go")
	must(t, os.WriteFile(source, []byte("package sample\nfunc Value() int { return 42 }\n"), 0600))
	gate := t.TempDir()
	ready, release := filepath.Join(gate, "ready"), filepath.Join(gate, "release")
	test := fmt.Sprintf("package sample\nimport(\"testing\";\"os\";\"time\")\nfunc TestValue(t *testing.T){os.WriteFile(%q,[]byte(\"ready\"),0600);for {if _,e:=os.Stat(%q);e==nil{break};time.Sleep(10*time.Millisecond)};if Value()!=42{t.Fatal(\"wrong value\")}}\n", ready, release)
	must(t, os.WriteFile(filepath.Join(checkout, "value_test.go"), []byte(test), 0600))
	r, e := s.load(h)
	must(t, e)
	st := r.Mission.Steps[0]
	st.Checks = []string{"go-test"}
	_, e = s.editStep(h, "S01", st, r.State.Revision, false)
	must(t, e)
	c := claimTest(t, s, h)
	result(t, s, c, "Implementation ready")
	type answer struct {
		r mission.Record
		e error
	}
	done := make(chan answer, 1)
	go func() { r, e := s.verify(h, c.Attempt.ID, c.Token); done <- answer{r, e} }()
	defer func() { _ = os.WriteFile(release, []byte("release"), 0600) }()
	deadline := time.Now().Add(20 * time.Second)
	for {
		if _, e := os.Stat(ready); e == nil {
			break
		}
		select {
		case result := <-done:
			t.Fatalf("checker stopped before reaching its gate: %v %+v", result.e, result.r.State)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("Go check did not start within 20 seconds")
		}
		time.Sleep(10 * time.Millisecond)
	}
	other := make(chan error, 1)
	go func() {
		_, e := s.create(mission.Mission{Repo: "dotfiles", Slug: "other-mission", Title: "Other work", Goal: "Proceed during tests", Kind: "research", Steps: []mission.Step{{Title: "Inspect"}}})
		other <- e
	}()
	select {
	case e := <-other:
		must(t, e)
	case <-time.After(time.Second):
		t.Fatal("Go check held the vault lock")
	}
	must(t, os.WriteFile(source, []byte("package sample\nfunc Value() int { return 42 } // source changed during test\n"), 0600))
	must(t, os.WriteFile(release, []byte("release"), 0600))
	out := <-done
	must(t, out.e)
	v := out.r.State.Attempts[0].Verifications[0]
	if v.Results[1].Verdict != "inconclusive" {
		t.Fatalf("changed source got verdict %s", v.Results[1].Verdict)
	}
	r, e = s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	a := r.State.Attempts[0]
	if !s.verified(r, a) {
		t.Fatalf("unchanged source didn't pass: %+v", a.Verifications)
	}
	d, _ := s.dir(h)
	log := a.Verifications[len(a.Verifications)-1].Results[1].Evidence[0].Path
	b, e := os.ReadFile(filepath.Join(d, log))
	must(t, e)
	if !strings.Contains(string(b), "ok ") {
		t.Fatal("actual Go test output was not preserved")
	}
	must(t, os.WriteFile(source, []byte("package sample\nfunc Value() int { return 0 }\n"), 0600))
	if s.verified(r, a) {
		t.Fatal("changed untracked source retained passing proof")
	}
	_, e = s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	wantCode(t, e, "checks_failed")
}

func TestFutureStepEditWaitsForReviewDecision(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Accepted input")
	r, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	st := r.Mission.Steps[1]
	st.Instructions = "Use the reviewed map"
	_, e = s.editStep(h, "S02", st, r.State.Revision, false)
	wantCode(t, e, "review_pending")
	r, e = s.checkpoint(h, "C01", "accept", "Reviewed", "aviral", true, r.State.Revision)
	must(t, e)
	if r.State.Pending != "" {
		t.Fatal("decided review is still pending")
	}
	st = r.Mission.Steps[1]
	st.Instructions = "Use the reviewed map"
	r, e = s.editStep(h, "S02", st, r.State.Revision, false)
	must(t, e)
	_, e = s.hook(h, c.Attempt.ID, c.Token, mission.Event{Type: "note", Summary: "late metadata on prior attempt"})
	must(t, e)
	next, e := s.claim(h, "scout", "", "", false)
	must(t, e)
	if !strings.Contains(next.Attempt.Brief, st.Instructions) {
		t.Fatal("future customization not applied")
	}
}

// TestGoTestScopesToTheModuleRoot pins the fingerprint scope: the module is found
// under the checkout, its files are hashed, and a symlink elsewhere in the
// checkout no longer refuses the run.
func TestGoTestScopesToTheModuleRoot(t *testing.T) {
	raw := t.TempDir()
	root, e := filepath.EvalSymlinks(raw)
	must(t, e)
	module := filepath.Join(root, "go", "mission")
	must(t, os.MkdirAll(module, 0o755))
	must(t, os.WriteFile(filepath.Join(module, "go.mod"), []byte("module example.test/x\n\ngo 1.26.0\n"), 0o644))
	must(t, os.WriteFile(filepath.Join(module, "main.go"), []byte("package main\n\nfunc main() {}\n"), 0o644))
	// a stow-style symlink outside the module, which used to block every run
	must(t, os.Symlink(module, filepath.Join(root, "linked-skill")))
	_, e = gitText(root, "init", "-b", "main")
	must(t, e)
	_, e = gitText(root, "add", "-A")
	must(t, e)

	got, e := moduleRoot(root)
	must(t, e)
	if got != module {
		t.Fatalf("moduleRoot = %q, want %q", got, module)
	}
	first, e := repositoryHash(root)
	must(t, e)
	if first == "" {
		t.Fatal("empty module fingerprint")
	}
	must(t, os.WriteFile(filepath.Join(module, "extra.go"), []byte("package main\n"), 0o644))
	_, e = gitText(root, "add", "-A")
	must(t, e)
	second, e := repositoryHash(root)
	must(t, e)
	if second == first {
		t.Fatal("a new module file must change the fingerprint")
	}
	must(t, os.WriteFile(filepath.Join(root, "README.md"), []byte("outside the module\n"), 0o644))
	_, e = gitText(root, "add", "-A")
	must(t, e)
	third, e := repositoryHash(root)
	must(t, e)
	if third != second {
		t.Fatal("a file outside the module must not change the fingerprint")
	}
}

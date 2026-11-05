package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

func lastAttempt(t *testing.T, s *Store, h string) (*mission.Record, *mission.Attempt) {
	t.Helper()
	r, e := s.load(h)
	must(t, e)
	a, e := mission.FindAttempt(&r.State, r.State.Active)
	must(t, e)
	return &r, a
}

func TestVerifyFailsUntilTheArtifactIsWritten(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	r, e := s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	if s.verified(r, *lastRun(t, r)) {
		t.Fatal("verified without an artifact")
	}
	result(t, s, c, "# Evidence\n\nThe suite reached the vault.\n")
	r, e = s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	if !s.verified(r, *lastRun(t, r)) {
		t.Fatalf("valid artifact not verified: %+v", lastVerification(t, r).Results)
	}
}

func TestVerifyRefusesForeignTokensAndStaleEvidence(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	if _, e := s.verify(h, c.Attempt.ID, "wrong-token"); e == nil {
		t.Fatal("foreign token accepted")
	} else {
		wantCode(t, e, "not_owner")
	}
	result(t, s, c, "{\"ok\":true}\n")
	r, e := s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	a := lastRun(t, r)
	if !s.verified(r, *a) {
		t.Fatal("valid artifact not verified")
	}
	// The proof binds to the evidence bytes: a later edit invalidates it.
	result(t, s, c, "{\"ok\":false}\n")
	if s.verified(r, *a) {
		t.Fatal("stale evidence still counts as verified")
	}
}

func TestVerifyRunsRegisteredChecksInOrder(t *testing.T) {
	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	view, e := s.step(h, "S01")
	must(t, e)
	st := view.Step
	st.Checks = []string{"json-valid", "nonempty-artifact"}
	_, e = s.editStep(h, "S01", st, r.State.Revision, false)
	must(t, e)
	c := claimTest(t, s, h)
	result(t, s, c, "not json\n")
	r, e = s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	res := lastVerification(t, r).Results
	verdict := map[string]string{}
	for _, c := range res {
		verdict[c.Check] = c.Verdict
	}
	if len(res) != 2 || verdict["json-valid"] != "failed" || verdict["nonempty-artifact"] != "passed" {
		t.Fatalf("unexpected results: %+v", res)
	}
}

// TestCmdCheckPresetAndNameRules pins the cmd: preset: it is listed in the
// catalog, accepted with a command body, and refused when the body is empty or
// the name is an unknown preset.
func TestCmdCheckPresetAndNameRules(t *testing.T) {
	var entry *CheckPreset
	for i := range checkCatalog() {
		if c := checkCatalog()[i]; c.Name == "cmd:<shell command>" {
			entry = &c
		}
	}
	if entry == nil {
		t.Fatalf("cmd preset missing from catalog: %+v", checkCatalog())
	}
	if entry.Version != "1" {
		t.Fatalf("cmd preset version = %q, want 1", entry.Version)
	}
	for _, want := range []string{"attempt checkout", "two-minute deadline"} {
		if !strings.Contains(entry.Description, want) {
			t.Fatalf("cmd preset description %q lacks %q", entry.Description, want)
		}
	}
	for name, want := range map[string]bool{
		"cmd:go version":      true,
		"cmd: mission checks": true,
		"cmd:":                false,
		"cmd:   ":             false,
		"arbitrary-shell":     false,
		"go-test":             true,
	} {
		if got := knownCheck(name); got != want {
			t.Fatalf("knownCheck(%q) = %v, want %v", name, got, want)
		}
	}

	s, h := fixture(t)
	r, e := s.load(h)
	must(t, e)
	view, e := s.step(h, "S01")
	must(t, e)
	st := view.Step
	st.Checks = []string{"cmd:go version"}
	r, e = s.editStep(h, "S01", st, r.State.Revision, false)
	if e != nil {
		t.Fatalf("cmd: check refused: %v", e)
	}
	if got := mission.StepChecks(r.Mission.Steps[0]); len(got) != 2 || got[1] != "cmd:go version" {
		t.Fatalf("stored checks = %v", got)
	}

	st = r.Mission.Steps[0]
	st.Checks = []string{"cmd:"}
	if r, e = s.load(h); e != nil {
		t.Fatal(e)
	}
	_, e = s.editStep(h, "S01", st, r.State.Revision, false)
	wantCode(t, e, "invalid_check")
	if e == nil || !strings.Contains(e.Error(), "cmd: prefix") {
		t.Fatalf("empty cmd body refusal = %v", e)
	}

	st.Checks = []string{"arbitrary-shell"}
	_, e = s.editStep(h, "S01", st, r.State.Revision, false)
	wantCode(t, e, "invalid_check")
}

// commandCheckMission is a minimal mission whose one step declares check.
func commandCheckMission(check string) mission.Mission {
	return mission.Mission{
		Repo: "dotfiles", Slug: "cmd-check", Title: "Command check", Goal: "Prove the preset", Kind: "implementation",
		Steps: []mission.Step{{ID: "S01", Title: "Prove", Agent: "any", Output: "step-01.md", Checks: []string{check}}},
	}
}

// TestCommandCheck proves the catalog and the executor agree on the cmd:
// preset. mission checks lists the name and validateMission accepts that same
// name, then the three commands from S02 each record their verdict, their
// summary, and an evidence log under artifacts/<n>/checks/<verify>/.
func TestCommandCheck(t *testing.T) {
	v, e := cmdChecks(platform.Args{}, nil)
	must(t, e)
	presets, ok := v.([]CheckPreset)
	if !ok {
		t.Fatalf("mission checks returned %T, want []CheckPreset", v)
	}
	listed := false
	for _, c := range presets {
		if c.Name == "cmd:<shell command>" {
			listed = true
		}
	}
	if !listed {
		t.Fatalf("mission checks does not list cmd:<shell command>: %+v", presets)
	}
	if e := validateMission(commandCheckMission("cmd:exit 0")); e != nil {
		t.Fatalf("validateMission refused the name mission checks lists: %v", e)
	}

	t.Run("passed", func(t *testing.T) {
		s, h, dir := cmdCheckCheckout(t)
		c := cmdCheckStep(t, s, h, dir, "cmd:exit 0")
		r, e := s.verify(h, c.Attempt.ID, c.Token)
		must(t, e)
		res := lastVerification(t, r).Results
		if len(res) != 2 {
			t.Fatalf("results = %+v", res)
		}
		wantCommandResult(t, s, r, res[1], "passed", "cmd:exit 0 passed")
		if !s.verified(r, *lastRun(t, r)) {
			t.Fatal("a passed cmd: check did not verify")
		}
		// The subject carries the repository hash, so a later checkout change
		// invalidates this evidence exactly as it invalidates a go-test result.
		a := *lastRun(t, r)
		st, ver := attemptDefinition(r, a), lastVerification(t, r)
		if s.subject(r, a, st).Hash != ver.SubjectHash {
			t.Fatal("subject moved between the check and its record")
		}
		must(t, os.WriteFile(filepath.Join(dir, "extra.txt"), []byte("changed\n"), 0o600))
		if s.subject(r, a, st).Hash == ver.SubjectHash {
			t.Fatal("cmd: subject ignored a change to the checkout")
		}
	})

	t.Run("failed", func(t *testing.T) {
		s, h, dir := cmdCheckCheckout(t)
		c := cmdCheckStep(t, s, h, dir, "cmd:exit 3", "cmd:exit 0")
		r, e := s.verify(h, c.Attempt.ID, c.Token)
		must(t, e)
		res := lastVerification(t, r).Results
		if len(res) != 3 {
			t.Fatalf("results = %+v", res)
		}
		wantCommandResult(t, s, r, res[1], "failed", "cmd:exit 3 exited 3")
		if res[2].Verdict != "not_run" || res[2].Summary != "Earlier required check did not pass" {
			t.Fatalf("check after a failed cmd: ran: %+v", res[2])
		}
		if s.verified(r, *lastRun(t, r)) {
			t.Fatal("a failed cmd: check still verified")
		}
	})

	t.Run("inconclusive at the deadline", func(t *testing.T) {
		if os.Getenv("MISSION_SLOW_CHECK") == "" {
			t.Skip("set MISSION_SLOW_CHECK=1 to wait out the two-minute deadline")
		}
		s, h, dir := cmdCheckCheckout(t)
		c := cmdCheckStep(t, s, h, dir, "cmd:sleep 130")
		start := time.Now()
		r, e := s.verify(h, c.Attempt.ID, c.Token)
		must(t, e)
		if d := time.Since(start); d < 2*time.Minute {
			t.Fatalf("cmd:sleep 130 returned after %s, before the deadline", d)
		}
		res := lastVerification(t, r).Results
		wantCommandResult(t, s, r, res[1], "inconclusive", "cmd:sleep 130 exceeded the two-minute deadline")
		if s.verified(r, *lastRun(t, r)) {
			t.Fatal("a timed-out cmd: check verified")
		}
	})
}

// wantCommandResult asserts one check's verdict, summary, and evidence log: the
// log sits under artifacts/<n>/checks/<verify>/, its name is one safe path
// component, and it repeats the verdict and the summary it recorded.
func wantCommandResult(t *testing.T, s *Store, r mission.Record, res mission.CheckResult, verdict, summary string) {
	t.Helper()
	if res.Verdict != verdict || res.Summary != summary {
		t.Fatalf("%s result = %s %q, want %s %q", res.Check, res.Verdict, res.Summary, verdict, summary)
	}
	rel, log := checkLog(t, s, r, res)
	a, v := lastRun(t, r), lastVerification(t, r)
	want := filepath.ToSlash(filepath.Join("artifacts", fmt.Sprintf("%03d", a.Sequence), "checks", v.ID, checkLogName(res.Check)))
	if rel != want {
		t.Fatalf("%s log path = %s, want %s", res.Check, rel, want)
	}
	if base := filepath.Base(rel); strings.ContainsAny(base, `:/ `) {
		t.Fatalf("%s log name is not one safe path component: %s", res.Check, rel)
	}
	for _, want := range []string{"check: " + res.Check, "verdict: " + verdict, "summary: " + summary} {
		if !strings.Contains(log, want) {
			t.Fatalf("%s log %s lacks %q:\n%s", res.Check, rel, want, log)
		}
	}
}

// cmdCheckCheckout builds a Git checkout with one Go module and returns the
// store, handle, and that checkout. The cmd: subject carries a repository hash,
// so the test needs a real checkout to prove the binding; the command itself
// runs in the checkout root, not the module.
func cmdCheckCheckout(t *testing.T) (*Store, string, string) {
	t.Helper()
	s, h := fixture(t)
	dir := t.TempDir()
	_, e := gitText(dir, "init", "-b", "main")
	must(t, e)
	must(t, os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module example.test/cmdcheck\n\ngo 1.26\n"), 0o600))
	return s, h, dir
}

// cmdCheckStep replaces S01's checks with the given cmd: checks, claims the
// step in the checkout, and writes a result.
func cmdCheckStep(t *testing.T, s *Store, h, dir string, checks ...string) mission.Claim {
	t.Helper()
	r, e := s.load(h)
	must(t, e)
	view, e := s.step(h, "S01")
	must(t, e)
	st := view.Step
	st.Checks = checks
	_, e = s.editStep(h, "S01", st, r.State.Revision, false)
	must(t, e)
	c, e := s.claim(h, "scout", "session-test", dir, false)
	must(t, e)
	result(t, s, c, "# Evidence\n\nThe command check ran.\n")
	return c
}

// checkLog reads one result's evidence log back from the vault.
func checkLog(t *testing.T, s *Store, r mission.Record, res mission.CheckResult) (string, string) {
	t.Helper()
	if len(res.Evidence) == 0 {
		t.Fatalf("%s recorded no evidence", res.Check)
	}
	rel := res.Evidence[0].Path
	p, e := s.path(r.Mission.Repo, r.Mission.Slug, rel)
	must(t, e)
	b, e := boundedFile(p, 1<<20)
	must(t, e)
	return rel, string(b)
}

// TestCmdCheckCapturesCombinedOutput proves the log holds stdout and stderr,
// and that a command name with a slash still gets one evidence log file.
func TestCmdCheckCapturesCombinedOutput(t *testing.T) {
	s, h, dir := cmdCheckCheckout(t)
	must(t, os.WriteFile(filepath.Join(dir, "probe.sh"), []byte("#!/bin/sh\necho probe-stdout\necho probe-stderr >&2\n"), 0o755))
	c := cmdCheckStep(t, s, h, dir, "cmd:./probe.sh")
	r, e := s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	res := lastVerification(t, r).Results
	if res[1].Verdict != "passed" {
		t.Fatalf("cmd:./probe.sh verdict = %s (%s)", res[1].Verdict, res[1].Summary)
	}
	rel, log := checkLog(t, s, r, res[1])
	for _, want := range []string{"probe-stdout", "probe-stderr"} {
		if !strings.Contains(log, want) {
			t.Fatalf("log %s lacks %q:\n%s", rel, want, log)
		}
	}
	if base := filepath.Base(rel); strings.ContainsAny(base, ":/") {
		t.Fatalf("cmd log name is not one path component: %s", rel)
	}
}

// TestCappedOutputKeepsOneMiB pins the cap itself through io.Copy, the path
// os/exec uses for a pipe: an embedded bytes.Buffer would promote ReadFrom and
// copy the whole stream past the cap.
func TestCappedOutputKeepsOneMiB(t *testing.T) {
	var out cappedOutput
	n, e := io.Copy(&out, bytes.NewReader(bytes.Repeat([]byte("x"), 3<<20)))
	must(t, e)
	if n != 3<<20 || len(out.Bytes()) != 1<<20 || !out.truncated {
		t.Fatalf("copied %d, kept %d bytes, truncated %v", n, len(out.Bytes()), out.truncated)
	}
}

// TestCmdCheckTruncatesOutputAtOneMiB proves a noisy command cannot fill the
// vault: the evidence log stops at the cap and the summary says so.
func TestCmdCheckTruncatesOutputAtOneMiB(t *testing.T) {
	s, h, dir := cmdCheckCheckout(t)
	c := cmdCheckStep(t, s, h, dir, "cmd:head -c 3000000 /dev/zero | tr '\\000' x")
	r, e := s.verify(h, c.Attempt.ID, c.Token)
	must(t, e)
	res := lastVerification(t, r).Results
	if res[1].Verdict != "passed" || !strings.Contains(res[1].Summary, "log truncated at 1 MiB") {
		t.Fatalf("noisy cmd result = %+v", res[1])
	}
	p, e := s.path(r.Mission.Repo, r.Mission.Slug, res[1].Evidence[0].Path)
	must(t, e)
	st, e := os.Stat(p)
	must(t, e)
	if st.Size() > 1<<20+512 {
		t.Fatalf("evidence log holds %d bytes, above the 1 MiB cap", st.Size())
	}
}

func lastVerification(t *testing.T, r mission.Record) mission.Verification {
	t.Helper()
	a := lastRun(t, r)
	if len(a.Verifications) == 0 {
		t.Fatal("no verification recorded")
	}
	return a.Verifications[len(a.Verifications)-1]
}

func lastRun(t *testing.T, r mission.Record) *mission.Attempt {
	t.Helper()
	a, e := mission.FindAttempt(&r.State, r.State.Active)
	if e != nil {
		t.Fatal(e)
	}
	return a
}

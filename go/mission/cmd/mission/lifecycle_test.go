package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mission.local/prototype/internal/domain/mission"
)

func TestOwnershipAndIdempotentHooks(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	ev := mission.Event{ID: "stable-hook", Type: "agent-end", Summary: "Turn finished"}
	_, e := s.hook(h, c.Attempt.ID, "wrong-token", ev)
	wantCode(t, e, "not_owner")
	_, e = s.hook(h, c.Attempt.ID, c.Token, ev)
	must(t, e)
	_, e = s.hook(h, c.Attempt.ID, c.Token, ev)
	must(t, e)
	r, e := s.load(h)
	must(t, e)
	if len(r.State.Attempts[0].Events) != 1 || r.State.Active == "" {
		t.Fatal("agent-end completed attempt or duplicate event was appended")
	}
	ev.Summary = "different payload"
	_, e = s.hook(h, c.Attempt.ID, c.Token, ev)
	wantCode(t, e, "event_conflict")
	_, e = s.hook(h, c.Attempt.ID, c.Token, mission.Event{Type: "session-start", SessionID: "other"})
	wantCode(t, e, "session_mismatch")
}

func TestCheckpointBlocksAndBindsEvidence(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	_, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	wantCode(t, e, "missing_artifact")
	result(t, s, c, "Original result\n")
	r, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	_, e = s.claim(h, "scout", "", "", false)
	wantCode(t, e, "checkpoint_pending")
	_, e = s.checkpoint(h, "C01", "accept", "ok", "aviral", false, r.State.Revision)
	wantCode(t, e, "human_required")
	_, e = s.checkpoint(h, "C01", "accept", "ok", "aviral", true, r.State.Revision-1)
	wantCode(t, e, "revision_conflict")
	result(t, s, c, "Mutated result\n")
	_, e = s.checkpoint(h, "C01", "accept", "ok", "aviral", true, r.State.Revision)
	wantCode(t, e, "evidence_changed")
	result(t, s, c, "Original result\n")
	r, e = s.checkpoint(h, "C01", "accept", "Reviewed artifact", "aviral", true, r.State.Revision)
	must(t, e)
	if r.State.Status != "ready" || len(r.State.Decisions) != 1 {
		t.Fatal("decision not recorded")
	}
	next, e := s.claim(h, "worker", "", "", false)
	must(t, e)
	if next.Step.ID != "S02" {
		t.Fatal("wrong next step")
	}
	result(t, s, next, "Final result")
	r, e = s.finish(h, next.Attempt.ID, next.Token, false, "", false, 0)
	must(t, e)
	if r.State.Status != "done" {
		t.Fatal(r.State.Status)
	}
}

func TestRevisionPreservesAttempts(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "First evidence")
	r, e := s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	must(t, e)
	_, e = s.checkpoint(h, "C01", "revise", "Check shutdown too", "aviral", true, r.State.Revision)
	must(t, e)
	again, e := s.claim(h, "scout", "next-session", "", false)
	must(t, e)
	if again.Step.ID != "S01" || again.Attempt.ID == c.Attempt.ID || again.Attempt.Artifact == c.Attempt.Artifact {
		t.Fatal("retry reused evidence or identity")
	}
	b, e := os.ReadFile(artifactPath(s, c))
	must(t, e)
	if string(b) != "First evidence" {
		t.Fatal("old evidence changed")
	}
	result(t, s, again, "Improved evidence")
	r, e = s.finish(h, again.Attempt.ID, again.Token, false, "", false, 0)
	must(t, e)
	if len(r.State.Decisions) != 1 || r.State.Checkpoints["C01"].Attempt != again.Attempt.ID {
		t.Fatal("decision history or checkpoint binding lost")
	}
}

func TestShutdownPreservesTranscriptAndInterrupts(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	session := filepath.Join(t.TempDir(), "pi.jsonl")
	must(t, os.WriteFile(session, []byte("{\"id\":\"session-test\"}\n"), 0600))
	_, e := s.hook(h, c.Attempt.ID, c.Token, mission.Event{Type: "session-start", SessionFile: session})
	must(t, e)
	r, e := s.hook(h, c.Attempt.ID, c.Token, mission.Event{Type: "session-end"})
	must(t, e)
	must(t, os.Remove(session))
	a := r.State.Attempts[0]
	if a.Status != "interrupted" || r.State.Active != "" {
		t.Fatal("shutdown didn't interrupt unmanaged research attempt")
	}
	d, _ := s.dir(h)
	b, e := os.ReadFile(filepath.Join(d, a.Transcript))
	must(t, e)
	if !strings.Contains(string(b), "session-test") {
		t.Fatal("session evidence missing")
	}
	_, e = s.retry(h)
	must(t, e)
	if _, e = s.claim(h, "scout", "new", "", false); e != nil {
		t.Fatal(e)
	}
}

func TestManagedFinishHoldsOwnership(t *testing.T) {
	s, h := fixture(t)
	c, e := s.claim(h, "worker", "", "", true)
	must(t, e)
	result(t, s, c, "Output")
	r, e := s.finish(h, c.Attempt.ID, c.Token, false, "reported", false, 0)
	must(t, e)
	if r.State.Active != c.Attempt.ID || r.State.Attempts[0].Status != "reported" {
		t.Fatal("writer ownership released before process exit")
	}
	_, e = s.hook(h, c.Attempt.ID, c.Token, mission.Event{Type: "session-end"})
	must(t, e)
	_, e = s.claim(h, "worker", "", "", false)
	wantCode(t, e, "busy")
	_, e = s.hook(h, c.Attempt.ID, c.Token, mission.Event{Type: "process-exit"})
	wantCode(t, e, "reserved_event")
}

func TestRunWrapperSuccessAndMissingArtifact(t *testing.T) {
	s, h := fixture(t)
	r, e := runAgent(s, h, "worker", "", []string{"/bin/sh", "-c", `printf 'actual process output\n'; printf 'evidence\n' > "$MISSION_ARTIFACT"`})
	must(t, e)
	a := r.State.Attempts[0]
	if !a.ProcessExited || a.PID == 0 || a.Status != "succeeded" || r.State.Pending != "C01" {
		t.Fatalf("wrong state: %+v", a)
	}
	s2, h2 := fixture(t)
	_, e = runAgent(s2, h2, "worker", "", []string{"/bin/sh", "-c", "exit 0"})
	wantCode(t, e, "missing_artifact")
	r, e = s2.load(h2)
	must(t, e)
	if r.State.Active != "" || !r.State.Attempts[0].ProcessExited || r.State.Attempts[0].Status != "failed" {
		t.Fatal("missing result erased exit facts or retained active owner")
	}
}

func TestRepairFromCanonicalState(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	d, _ := s.dir(h)
	p := filepath.Join(d, "attempts", "001.md")
	must(t, os.Remove(p))
	_, e := s.mutate(h, func(*mission.Record) error { return nil })
	must(t, e)
	b, e := os.ReadFile(p)
	must(t, e)
	if !strings.Contains(string(b), c.Attempt.ID) {
		t.Fatal("repair didn't restore attempt")
	}
}

func TestPathTraversalAndSymlinks(t *testing.T) {
	s, h := fixture(t)
	_, e := s.dir("dotfiles/../outside")
	wantCode(t, e, "invalid_handle")
	d, _ := s.dir(h)
	outside := t.TempDir()
	must(t, os.Symlink(outside, filepath.Join(d, "artifacts")))
	_, e = s.claim(h, "scout", "", "", false)
	wantCode(t, e, "invalid_path")
	if len(mustReadDir(t, outside)) != 0 {
		t.Fatal("wrote through symlink")
	}
}

func mustReadDir(t *testing.T, p string) []os.DirEntry {
	t.Helper()
	v, e := os.ReadDir(p)
	must(t, e)
	return v
}

func TestBriefEditsAndReservedOutputAreRejected(t *testing.T) {
	s, h := fixture(t)
	d, _ := s.dir(h)
	f := filepath.Join(d, "mission.md")
	b, e := os.ReadFile(f)
	must(t, e)
	must(t, os.WriteFile(f, append(b, []byte("\nChanged scope")...), 0600))
	_, e = s.claim(h, "scout", "", "", false)
	wantCode(t, e, "brief_changed")
	r, e := s.load(h)
	must(t, e)
	r.Mission.Steps[0].Output = "session.jsonl"
	wantCode(t, validateMission(r.Mission), "invalid_output")
}

func TestWriterRequiresLinkedWorktree(t *testing.T) {
	s, h := fixture(t)
	root := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		c := exec.Command("git", append([]string{"-C", root}, args...)...)
		if b, e := c.CombinedOutput(); e != nil {
			t.Fatalf("git: %s %v", b, e)
		}
	}
	git("init", "-b", "main")
	git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture")
	_, e := s.addRepo("dotfiles", root, "")
	must(t, e)
	d, _ := s.dir(h)
	p := filepath.Join(d, "mission.md")
	r, e := s.load(h)
	must(t, e)
	r.Mission.Kind = "implementation"
	b, e := markdown(r.Mission, r.Mission.Body)
	must(t, e)
	must(t, atomicWrite(p, b))
	_, e = s.mutate(h, func(r *mission.Record) error { r.State.SpecHash = mission.Digest(b); return nil })
	must(t, e)
	_, e = s.claim(h, "worker", "", root, false)
	wantCode(t, e, "managed_required")
	_, e = s.claim(h, "worker", "", root, true)
	wantCode(t, e, "isolated_worktree_required")
	git("checkout", "-b", "feature")
	_, e = s.claim(h, "worker", "", root, true)
	wantCode(t, e, "isolated_worktree_required")
	wt := filepath.Join(t.TempDir(), "owned")
	git("worktree", "add", "-b", "mission-test", wt)
	_, e = s.claim(h, "worker", "", wt, true)
	must(t, e)
	r.Mission.Slug = "second-writer"
	second, e := s.create(r.Mission)
	must(t, e)
	sub := filepath.Join(wt, "nested")
	must(t, os.MkdirAll(sub, 0700))
	_, e = s.claim(second.Handle, "worker", "", sub, true)
	wantCode(t, e, "worktree_busy")
}

func TestManagedFailureReportIsPreserved(t *testing.T) {
	s, h := fixture(t)
	c, e := s.claim(h, "worker", "", "", true)
	must(t, e)
	r, e := s.finish(h, c.Attempt.ID, c.Token, true, "Cannot satisfy the request", false, 0)
	must(t, e)
	if r.State.Active == "" {
		t.Fatal("report released owner")
	}
	r, e = s.finish(h, c.Attempt.ID, c.Token, false, "process exited zero", true, 0)
	must(t, e)
	if r.State.Status != "failed" || r.State.Attempts[0].Status != "failed" {
		t.Fatal("agent failure was upgraded to success")
	}
}

func TestChangedBriefCannotCompleteSuccessfully(t *testing.T) {
	s, h := fixture(t)
	c := claimTest(t, s, h)
	result(t, s, c, "Original scope result")
	d, _ := s.dir(h)
	p := filepath.Join(d, "mission.md")
	b, e := os.ReadFile(p)
	must(t, e)
	must(t, os.WriteFile(p, append(b, []byte("\nDifferent scope")...), 0600))
	_, e = s.finish(h, c.Attempt.ID, c.Token, false, "", false, 0)
	wantCode(t, e, "brief_changed")
}

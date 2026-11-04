package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unicode/utf8"

	"mission.local/prototype/internal/domain/mission"
	"mission.local/prototype/internal/platform"
)

type cappedOutput struct {
	bytes.Buffer
	truncated bool
}

func goTest(cwd string) (string, string, []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	c := exec.CommandContext(ctx, "go", "test", "./...")
	c.Dir = cwd
	c.Env = append(os.Environ(), "GOTOOLCHAIN=local")
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	c.WaitDelay = 3 * time.Second
	c.Cancel = func() error {
		if c.Process == nil {
			return nil
		}
		return syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
	}
	var log cappedOutput
	c.Stdout = &log
	c.Stderr = &log
	e := c.Run()
	if c.Process != nil && syscall.Kill(-c.Process.Pid, 0) == nil {
		_ = syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
		return "inconclusive", "Test process left background work; group stopped", log.Bytes()
	}
	if ctx.Err() != nil {
		return "inconclusive", "Go tests exceeded the two-minute deadline", log.Bytes()
	}
	if e != nil {
		var exit *exec.ExitError
		if errors.As(e, &exit) {
			return "failed", fmt.Sprintf("go test ./... exited %d", exit.ExitCode()), log.Bytes()
		}
		return "inconclusive", "Could not run Go tests: " + e.Error(), log.Bytes()
	}
	summary := "go test ./... passed"
	if log.truncated {
		summary += "; log truncated at 1 MiB"
	}
	return "passed", summary, log.Bytes()
}
func (s *Store) verify(h, id, token string) (mission.Record, error) {
	var current mission.Record
	var attempt mission.Attempt
	var st mission.Step
	var before subjectSnapshot
	run := mission.Verification{ID: mission.UID("verify-"), Started: mission.Now(), Runner: "mission/checks@" + platform.Machine()}
	_, e := s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		if !mission.Active(*a) || r.State.Active != id {
			return mission.Problem("stale_attempt", "only the active attempt can run checks")
		}
		if a.Verifying != "" {
			return mission.Problem("verification_busy", "check run %s already owns verification; inspect an interrupted runner before recovery", a.Verifying)
		}
		d, _ := s.dir(h)
		b, e := os.ReadFile(filepath.Join(d, "mission.md"))
		if e != nil {
			return e
		}
		if mission.Digest(b) != a.SpecHash {
			return mission.Problem("brief_changed", "mission changed since this attempt started")
		}
		st = attemptDefinition(*r, *a)
		before = s.subject(*r, *a, st)
		run.SubjectHash = before.Hash
		run.DefinitionHash = definitionHash(st)
		for _, name := range mission.StepChecks(st) {
			run.Results = append(run.Results, mission.CheckResult{Check: name, Version: "1", Verdict: "not_run", At: run.Started, Summary: "Check has not run"})
		}
		a.Verifying = run.ID
		a.Verifications = append(a.Verifications, run)
		attempt = *a
		current = *r
		return nil
	})
	if e != nil {
		return current, e
	}
	// Check processes run without the vault lock so other missions can make progress.
	logs := make([][]byte, len(run.Results))
	blocked := false
	for i := range run.Results {
		res := &run.Results[i]
		res.At = mission.Now()
		if blocked {
			res.Summary = "Earlier required check did not pass"
			continue
		}
		res.Verdict = "passed"
		switch res.Check {
		case "nonempty-artifact":
			if before.ArtifactErr != nil {
				res.Verdict = "failed"
				res.Summary = "Result unavailable: " + before.ArtifactErr.Error()
			} else if !utf8.Valid(before.Artifact) || len(bytes.TrimSpace(before.Artifact)) == 0 {
				res.Verdict = "failed"
				res.Summary = "Result must contain non-whitespace UTF-8 text"
			} else {
				res.Summary = "Nonempty UTF-8 result exists"
			}
		case "json-valid":
			if !json.Valid(before.Artifact) {
				res.Verdict = "failed"
				res.Summary = "Result is not one valid JSON value"
			} else {
				res.Summary = "Result parses as one JSON value"
			}
		case "go-test":
			module, e := moduleRoot(attempt.Cwd)
			if before.RepoErr != nil {
				res.Verdict = "inconclusive"
				res.Summary = before.RepoErr.Error()
			} else if e != nil {
				res.Verdict, res.Summary = "inconclusive", e.Error()
			} else {
				res.Verdict, res.Summary, logs[i] = goTest(module)
			}
		}
		if res.Verdict != "passed" {
			blocked = true
		}
	}
	return s.mutate(h, func(r *mission.Record) error {
		a, e := mission.FindAttempt(&r.State, id)
		if e != nil {
			return e
		}
		if e = authorize(a, token); e != nil {
			return e
		}
		if a.Verifying != run.ID || r.State.Active != id {
			return mission.Problem("stale_attempt", "verification no longer owns this attempt")
		}
		after := s.subject(*r, *a, st)
		if after.Hash != before.Hash {
			for i := range run.Results {
				if run.Results[i].Verdict == "passed" {
					run.Results[i].Verdict = "inconclusive"
					run.Results[i].Summary = "Checked input changed during verification; rerun checks"
				}
			}
		}
		run.Ended = mission.Now()
		for i := range run.Results {
			res := &run.Results[i]
			rel := filepath.ToSlash(filepath.Join("artifacts", fmt.Sprintf("%03d", a.Sequence), "checks", run.ID, res.Check+".log"))
			p, e := s.path(r.Mission.Repo, r.Mission.Slug, rel)
			if e != nil {
				return e
			}
			b := []byte(fmt.Sprintf("check: %s\nversion: %s\nverdict: %s\nsubject: %s\nrunner: %s\nsummary: %s\n\n", res.Check, res.Version, res.Verdict, run.SubjectHash, run.Runner, res.Summary))
			b = append(b, logs[i]...)
			if e = atomicWrite(p, b); e != nil {
				return e
			}
			res.Evidence = []mission.Evidence{{Path: rel, Hash: mission.Digest(b)}}
			if before.ArtifactErr == nil {
				res.Evidence = append(res.Evidence, mission.Evidence{Path: a.Artifact, Hash: before.ArtifactHash})
			}
		}
		for i := range a.Verifications {
			if a.Verifications[i].ID == run.ID {
				a.Verifications[i] = run
			}
		}
		a.Verifying = ""
		a.Updated = mission.Now()
		a.Events = append(a.Events, mission.Event{ID: mission.UID("event-"), Type: "checks-completed", At: mission.Now(), Summary: verificationSummary(run)})
		return nil
	})
}

func (b *cappedOutput) Write(p []byte) (int, error) {
	n := len(p)
	remaining := (1 << 20) - b.Len()
	if remaining > 0 {
		_, _ = b.Buffer.Write(p[:min(n, remaining)])
	}
	if n > remaining {
		b.truncated = true
	}
	return n, nil
}
